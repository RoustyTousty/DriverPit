import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DriverWithActivity } from "@/lib/db/queries";
import type { CustomLobbyState } from "@/lib/duel/customLobby";

import { CustomLobbyJoin } from "./CustomLobbyJoin";

// The join box is the one place in this feature where a PERSON transcribes a
// value, and every way that goes wrong is invisible to `tsc`.
//
// A code arrives out of band: read aloud over a call, forwarded through a group
// chat, pasted with the surrounding "join with abc-123". So the box has to
// accept what people actually type -- lowercase, spaces, dashes -- and it must
// not offer Join until it holds something that could be a real code, because
// joining CONSUMES the lobby and getting it wrong burns somebody else's game.
//
// Written to fail against the pre-fix code: without normalizeLobbyCode wired
// into onChange, "abc-234" stays "abc-234" in the box and Join stays disabled
// forever; without the completeness gate, Join is pressable on one character.
const HOST: CustomLobbyState = {
  code: "ABC234",
  mode: "duel",
  rounds: 3,
  roundSeconds: 60,
  filter: { fromYear: 1950, toYear: 2026, nationality: null, team: null, achievement: "any" },
  hostId: "host-id",
  hostUsername: "user123456",
  hostDisplayName: "Ayrton",
  hostAvatarUrl: "Apex",
  hostRating: 1180,
  matchId: null,
  isHost: false,
};

const getCustomLobbyState = vi.hoisted(() => vi.fn());
const joinCustomLobby = vi.hoisted(() => vi.fn());

// Only the network edge is stubbed. normalizeLobbyCode and isCompleteLobbyCode
// are the pure functions under test here, so they run for real -- mocking them
// would leave this asserting that a mock was called.
// Joining acquires an identity first (roadmap Pass 4a): the likeliest arrival
// on this screen is a shared link opened cold, which is exactly the visitor who
// has none yet. Stubbed to "already have one", so what these tests exercise
// stays the code-normalising behaviour they were written for.
const ensureIdentity = vi.hoisted(() => vi.fn().mockResolvedValue("guest-1"));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuthIdentity: () => ({ ensureIdentity }),
}));

vi.mock("@/lib/duel/customLobby", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/duel/customLobby")>();
  return { ...actual, getCustomLobbyState, joinCustomLobby };
});

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    channel: () => ({ subscribe: async () => {}, send: async () => {} }),
    removeChannel: async () => {},
  }),
}));

// Only counted, never rendered by name -- the preview needs a roster to say
// how big the host's pool is.
const ROSTER = [
  {
    id: 1,
    fullName: "Driver 1",
    nationality: "Italy",
    teams: ["Ferrari"],
    debutYear: 2015,
    lastActiveYear: 2026,
    careerWins: 0,
    championshipWins: 0,
    podiums: 0,
    polePositions: 0,
  },
] as unknown as DriverWithActivity[];

function renderJoin(initialCode?: string) {
  return render(
    <CustomLobbyJoin
      allDrivers={ROSTER}
      initialCode={initialCode}
      referenceYear={2026}
      onMatchFound={vi.fn()}
    />,
  );
}

const joinButton = () => screen.getByRole("button", { name: /join game/i });
const codeInput = () => screen.getByLabelText(/game code/i) as HTMLInputElement;

describe("CustomLobbyJoin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCustomLobbyState.mockResolvedValue(HOST);
    joinCustomLobby.mockResolvedValue({ ok: true, match: { matchId: 7 } });
  });

  it("normalizes what a person actually types -- lowercase, dashes, spaces", async () => {
    const user = userEvent.setup();
    renderJoin();

    await user.type(codeInput(), "abc-234");
    // The box shows exactly what will be sent, rather than silently
    // reinterpreting it later.
    expect(codeInput().value).toBe("ABC234");
  });

  // The dashed/spaced form is what a shared code actually looks like, and it is
  // SEVEN characters before stripping. A maxLength={6} on the input bounds the
  // raw value, truncating "ABC-234" to "ABC-23" and normalizing that to a
  // five-character "ABC23" -- a valid code silently losing its last character.
  // Both forms are pinned so the fix cannot be undone by re-adding maxLength.
  it.each([
    "abc 234",
    "abc-234",
    "  ABC234  ",
    // The likeliest paste of all: the host's primary button is "Copy link".
    "https://driverpit.app/online?join=ABC234",
    "https://driverpit.app/online?join=abc-234",
  ])(
    "strips a pasted code out of its surroundings: %s",
    async (pasted) => {
      const user = userEvent.setup();
      renderJoin();

      await user.click(codeInput());
      await user.paste(pasted);
      expect(codeInput().value).toBe("ABC234");
    },
  );

  it("cannot be typed past six characters", async () => {
    const user = userEvent.setup();
    renderJoin();

    await user.type(codeInput(), "ABC234XYZ");
    expect(codeInput().value).toBe("ABC234");
  });

  // The gate. Joining is irreversible -- it consumes the lobby -- so the button
  // must not be live on a half-typed code.
  it("keeps Join disabled until six valid characters are present", async () => {
    const user = userEvent.setup();
    renderJoin();

    expect(joinButton()).toBeDisabled();

    await user.type(codeInput(), "ABC23");
    expect(joinButton()).toBeDisabled();

    await user.type(codeInput(), "4");
    await waitFor(() => expect(joinButton()).toBeEnabled());
  });

  // Enabling Join needs BOTH a complete code and a lobby behind it: a complete
  // but wrong code must not offer a button that can only fail.
  it("keeps Join disabled when the code is complete but no lobby exists", async () => {
    getCustomLobbyState.mockResolvedValue(null);
    const user = userEvent.setup();
    renderJoin();

    await user.type(codeInput(), "ZZZZZZ");
    await screen.findByText(/no open game with that code/i);
    expect(joinButton()).toBeDisabled();
  });

  it("previews the host and the match's shape before joining", async () => {
    renderJoin("ABC234");

    // The whole reason joining is two steps: "is this the right game?" has to
    // be answerable before the irreversible press.
    expect(await screen.findByText("Ayrton")).toBeInTheDocument();
    expect(screen.getByText(/3 rounds/)).toBeInTheDocument();
    expect(screen.getByText(/60s each/)).toBeInTheDocument();
    // The pool, described in exactly the words the host composed it in --
    // the shared DriverFilterSummary, same as the create screen.
    expect(screen.getByText("All time")).toBeInTheDocument();
    // Stated before the press, not after the match.
    expect(screen.getByText(/unranked/i)).toBeInTheDocument();
  });

  // A deep link pre-fills and previews; it deliberately does NOT auto-join,
  // for the same reason as above -- a forwarded link would otherwise consume a
  // lobby the moment it was opened.
  it("pre-fills from a deep link without joining on its own", async () => {
    renderJoin("abc-234");

    expect(codeInput().value).toBe("ABC234");
    await screen.findByText("Ayrton");
    expect(joinCustomLobby).not.toHaveBeenCalled();
  });

  it("drops the preview when the code stops being complete", async () => {
    const user = userEvent.setup();
    renderJoin("ABC234");
    await screen.findByText("Ayrton");

    await user.clear(codeInput());
    await user.type(codeInput(), "ABC23");
    // A preview of the code someone just backspaced out of is worse than none.
    await waitFor(() => expect(screen.queryByText("Ayrton")).not.toBeInTheDocument());
    expect(joinButton()).toBeDisabled();
  });

  // The button's accessible name must not change when the preview lands. A
  // tempting "Join Ayrton" renames a control under a screen-reader user
  // mid-read, and the host's name is already on screen right above it.
  it("keeps one stable name on the join button", async () => {
    renderJoin("ABC234");
    await screen.findByText("Ayrton");
    expect(joinButton()).toBeEnabled();
  });

  // A wrong code used to INSERT a paragraph, pushing the preview, the button
  // and everything below it down as the sixth character was typed. The fix is
  // one always-present status line that swaps its text, and both halves of that
  // are pinned here: the region exists before there is anything to say (which
  // is what makes role="alert" actually announce, rather than mounting
  // alongside its own message), and an error REPLACES the hint instead of
  // joining it.
  it("reports a bad code in place, without adding anything to the layout", async () => {
    getCustomLobbyState.mockResolvedValue(null);
    const user = userEvent.setup();
    renderJoin();

    const status = screen.getByRole("alert");
    expect(status).toHaveTextContent(/6 characters/i);
    const before = screen.getAllByRole("alert").length;

    await user.type(codeInput(), "ZZZZZZ");
    await waitFor(() => expect(status).toHaveTextContent(/no open game with that code/i));

    // The same node, re-worded -- not a second one that appeared beneath it.
    expect(screen.getAllByRole("alert")).toHaveLength(before);
    expect(status).not.toHaveTextContent(/6 characters/i);
  });

  // The RPC's messages name different things to do about them ("your own
  // lobby", "expired", "already been used"), so they are surfaced rather than
  // flattened into one house error.
  it("surfaces the server's own refusal", async () => {
    joinCustomLobby.mockResolvedValue({ ok: false, error: "You cannot join your own lobby" });
    const user = userEvent.setup();
    renderJoin("ABC234");

    await screen.findByText("Ayrton");
    await user.click(joinButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/your own lobby/i);
  });
});
