import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GuessResult } from "@/lib/game/compare";
import type { DailyBoardGuess, DailyBoardState } from "@/lib/game/dailyBoard";
import type { DailySubmitResult } from "@/lib/game/submitDailyGuessRpc";

import { DailyGame } from "./DailyGame";

// The shimmer row's lifetime, as rendered. It is bounded by ONE thing -- the
// authoritative row arriving -- and on the completing guess that stopped being
// true: `setPending(false)` lived in the submit's `finally`, two real round
// trips (recordDailyResult, then refresh) past the `setBoard` that appended the
// finished row. So a solved day rendered its winning row AND a shimmer beneath
// it for as long as the stats write took, and on the 6th guess there was no
// empty slot left for that shimmer to consume, so the grid grew a seventh row
// and pushed the result card and share button down the page.
//
// tsc cannot see any of that: the ordering is well-typed either way, and both
// halves of the symptom are facts about a rendered DOM at a moment when a
// promise is deliberately still pending. Hence a component test, and hence the
// deferred `recordDailyResult` below -- it is what holds the board in the exact
// state the player was complaining about.

const NOW_PLAYING = "Lando Norris";

const RESULT: GuessResult = {
  nationality: "exact",
  team: "miss",
  age: "higher",
  ageCloseness: 0.5,
  debutYear: "lower",
  debutYearCloseness: 0.3,
  careerWins: "higher",
  careerWinsCloseness: 0.2,
};

const WINNING_RESULT: GuessResult = {
  nationality: "exact",
  team: "exact",
  age: "correct",
  debutYear: "correct",
  careerWins: "correct",
};

function boardGuess(id: number, name: string, tiles: GuessResult = RESULT): DailyBoardGuess {
  return {
    driverId: id,
    name,
    code: name.slice(0, 3).toUpperCase(),
    nationality: "United Kingdom",
    team: "McLaren",
    age: 26,
    debutYear: 2019,
    careerWins: 10,
    tiles,
  };
}

// Five already-played guesses: the next one is the sixth, which is the case
// where the phantom row had nowhere to go but past the bottom of the grid.
const FIVE_PLAYED: DailyBoardState = {
  guesses: [1, 2, 3, 4, 5].map((id) => boardGuess(id, `Driver ${id}`)),
  completed: false,
  won: false,
  guessesRemaining: 1,
  target: null,
};

const WINNING_SUBMIT: DailySubmitResult = {
  guess: boardGuess(6, NOW_PLAYING, WINNING_RESULT),
  completed: true,
  won: true,
  guessesRemaining: 0,
  target: { driverId: 6, name: NOW_PLAYING, code: "NOR" },
};

const fetchDailyState = vi.hoisted(() => vi.fn());
const submitDailyGuessRpc = vi.hoisted(() => vi.fn());
const recordDailyResult = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/game/dailyStateRpc", () => ({ fetchDailyState }));
vi.mock("@/lib/game/submitDailyGuessRpc", () => ({ submitDailyGuessRpc }));
vi.mock("@/lib/stats/actions", () => ({ recordDailyResult }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
// Mutable so the deferred-identity suite below can put the board in front of a
// visitor who has no identity yet; every other test leaves it signed in.
const identity = vi.hoisted(() => ({
  userId: "player-1" as string | null,
  identityStatus: "ready" as "loading" | "anonymous" | "ready",
}));
const ensureIdentity = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuthIdentity: () => ({
    userId: identity.userId,
    isGuest: false,
    identityStatus: identity.identityStatus,
    refresh,
    ensureIdentity,
    signOutAndReset: vi.fn(),
  }),
}));

// Stubbed to a plain button: what's under test is the board's own ordering, not
// how a driver gets picked. The real autocomplete has its own suite.
vi.mock("@/components/game/DriverAutocomplete", () => ({
  DriverAutocomplete: ({
    onSelect,
    disabled,
  }: {
    onSelect: (driver: { id: number; fullName: string; nationality: string }) => void;
    disabled?: boolean;
  }) => (
    <button
      disabled={disabled}
      onClick={() => onSelect({ id: 6, fullName: NOW_PLAYING, nationality: "United Kingdom" })}
    >
      guess
    </button>
  ),
}));

// A promise held open on purpose, so assertions can run at the instant the
// board is between "the guess landed" and "the stats write finished".
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function shimmerRows(container: HTMLElement): number {
  // PendingGuessRow is the only thing on a daily board that pulses (it is
  // aria-hidden, so there's no accessible handle to query it by), and it renders
  // six of these -- a code badge plus five tiles.
  return container.querySelectorAll(".animate-pulse").length;
}

function gridRows(container: HTMLElement): number {
  // The column-label row plus one row per rendered slot, pending, real or empty
  // -- i.e. the grid's height, which is the thing that visibly shoved the page.
  // Counted as children of the grid itself (found via its label row) rather than
  // by a document-wide class query: ResultCard's text column is also a `gap-1`
  // flex box, and it only appears once the day is over, which is exactly when
  // this number matters.
  const grid = container.querySelector(".flex.gap-1")?.parentElement;
  return grid ? [...grid.children].filter((el) => el.classList.contains("gap-1")).length : 0;
}

beforeEach(() => {
  fetchDailyState.mockResolvedValue(FIVE_PLAYED);
  recordDailyResult.mockResolvedValue(undefined);
  refresh.mockResolvedValue(undefined);
  identity.userId = "player-1";
  identity.identityStatus = "ready";
  ensureIdentity.mockResolvedValue("player-1");
});

afterEach(() => {
  vi.clearAllMocks();
});

async function setup() {
  const user = userEvent.setup();
  const view = render(<DailyGame eligibleDrivers={[]} puzzleNumber={42} hasPuzzleToday />);
  // Hydration has to land before anything is clickable -- the input is disabled
  // behind the loading gate.
  await screen.findByRole("img", { name: "Driver 5" });
  return { user, ...view };
}

// A day already finished before the page loaded -- the state the archive link
// lives in.
const FINISHED: DailyBoardState = {
  guesses: [1, 2].map((id) => boardGuess(id, `Driver ${id}`)),
  completed: true,
  won: true,
  guessesRemaining: 4,
  target: { driverId: 2, name: "Driver 2", code: "TWO" },
};

// Roadmap Pass 4a. The board is where deferred identity is most dangerous:
// CLAUDE.md's no-replay-flash rule says a PLAYABLE board must never render
// before the day's state is known, and this change deliberately renders one for
// a visitor with no identity. That is only sound because "anonymous" means
// PROVEN no stored session -- nothing to know -- while "loading" still means
// unknown. Collapsing the two would let a returning player whose token refresh
// was slow see an empty board and replay their day.
describe("DailyBoard without an identity", () => {
  it("renders a playable board and asks the server nothing", async () => {
    identity.userId = null;
    identity.identityStatus = "anonymous";

    render(<DailyGame eligibleDrivers={[]} puzzleNumber={42} hasPuzzleToday />);

    // Enabled, not held behind the hydration overlay: a permanent skeleton is
    // what a crawler -- and every first-time visitor -- would otherwise index.
    await waitFor(() => expect(screen.getByRole("button", { name: "guess" })).toBeEnabled());
    expect(screen.getByText("6 guesses left")).toBeInTheDocument();
    // The whole point: no daily_state() for a visitor with nothing stored.
    expect(fetchDailyState).not.toHaveBeenCalled();
    expect(ensureIdentity).not.toHaveBeenCalled();
  });

  it("still holds the skeleton while identity is merely unresolved", async () => {
    identity.userId = null;
    identity.identityStatus = "loading";

    render(<DailyGame eligibleDrivers={[]} puzzleNumber={42} hasPuzzleToday />);

    await waitFor(() => expect(screen.getByRole("button", { name: "guess" })).toBeDisabled());
    expect(fetchDailyState).not.toHaveBeenCalled();
  });

  it("acquires an identity before the first guess, then submits it", async () => {
    identity.userId = null;
    identity.identityStatus = "anonymous";
    submitDailyGuessRpc.mockResolvedValue({
      guess: boardGuess(6, NOW_PLAYING),
      completed: false,
      won: false,
      guessesRemaining: 5,
      target: null,
    });

    const user = userEvent.setup();
    render(<DailyGame eligibleDrivers={[]} puzzleNumber={42} hasPuzzleToday />);
    await waitFor(() => expect(screen.getByRole("button", { name: "guess" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "guess" }));

    await waitFor(() => expect(submitDailyGuessRpc).toHaveBeenCalledWith(6));
    expect(ensureIdentity).toHaveBeenCalled();
    // The guess landed on the empty board rather than being dropped for want of
    // a hydrate -- this is the race a fast typist would otherwise lose.
    await screen.findByRole("img", { name: NOW_PLAYING });
  });

  it("does not submit a guess it could not get an identity for", async () => {
    identity.userId = null;
    identity.identityStatus = "anonymous";
    ensureIdentity.mockResolvedValue(null);

    const user = userEvent.setup();
    render(<DailyGame eligibleDrivers={[]} puzzleNumber={42} hasPuzzleToday />);
    await waitFor(() => expect(screen.getByRole("button", { name: "guess" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "guess" }));

    await waitFor(() => expect(ensureIdentity).toHaveBeenCalled());
    expect(submitDailyGuessRpc).not.toHaveBeenCalled();
  });
});

describe("DailyBoard's archive link", () => {
  // The link points at a date the SERVER said exists. The bug this pins is the
  // tempting alternative -- deriving "yesterday" in the browser -- which links
  // to a 404 on any day no puzzle was pinned for, and derives it from the
  // visitor's clock rather than the one that decides which day it is.
  it("points at the date the server supplied, not at a computed yesterday", async () => {
    fetchDailyState.mockResolvedValue(FINISHED);
    render(
      <DailyGame eligibleDrivers={[]} puzzleNumber={42} hasPuzzleToday latestArchiveDate="2026-07-31" />,
    );

    const link = await screen.findByRole("link", { name: /how everyone did/i });
    expect(link).toHaveAttribute("href", "/archive/2026-07-31");
  });

  it("is absent when there is no archive yet", async () => {
    fetchDailyState.mockResolvedValue(FINISHED);
    render(<DailyGame eligibleDrivers={[]} puzzleNumber={42} hasPuzzleToday latestArchiveDate={null} />);

    await screen.findByText(/Solved/);
    expect(screen.queryByRole("link", { name: /how everyone did/i })).toBeNull();
  });

  it("is absent while the day is still playable", async () => {
    render(
      <DailyGame eligibleDrivers={[]} puzzleNumber={42} hasPuzzleToday latestArchiveDate="2026-07-31" />,
    );

    await screen.findByRole("img", { name: "Driver 5" });
    expect(screen.queryByRole("link", { name: /how everyone did/i })).toBeNull();
  });
});

describe("DailyBoard's pending shimmer", () => {
  it("shows while the guess RPC is in flight", async () => {
    const submit = deferred<DailySubmitResult>();
    submitDailyGuessRpc.mockReturnValue(submit.promise);

    const { user, container } = await setup();
    await user.click(screen.getByRole("button", { name: "guess" }));

    // 6 pulsing elements = one shimmer row. This is the optimistic render the
    // fix must not have thrown away.
    await waitFor(() => expect(shimmerRows(container)).toBe(6));
    // Labels + 5 real rows + the shimmer, which consumes the last empty slot.
    expect(gridRows(container)).toBe(7);

    submit.resolve(WINNING_SUBMIT);
    await screen.findByRole("img", { name: NOW_PLAYING });
  });

  it("is gone the moment the winning row lands, while stats are still writing", async () => {
    submitDailyGuessRpc.mockResolvedValue(WINNING_SUBMIT);
    // The two awaits that used to sit between the append and the clear. Holding
    // the first one open freezes the board exactly where the bug was visible.
    const stats = deferred<void>();
    recordDailyResult.mockReturnValue(stats.promise);

    const { user, container } = await setup();
    await user.click(screen.getByRole("button", { name: "guess" }));

    const winningRow = await screen.findByRole("img", { name: NOW_PLAYING });
    expect(winningRow).toBeInTheDocument();
    expect(recordDailyResult).toHaveBeenCalled();

    // The state the player described: the day is solved and on screen, and the
    // stats write has NOT come back yet.
    expect(shimmerRows(container)).toBe(0);
    // Labels + exactly six guesses. A seventh row here is the grid growing past
    // MAX_GUESSES and shoving the result card down.
    expect(gridRows(container)).toBe(7);

    stats.resolve();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("clears on a guess that does not end the day", async () => {
    submitDailyGuessRpc.mockResolvedValue({
      ...WINNING_SUBMIT,
      guess: boardGuess(6, NOW_PLAYING),
      completed: false,
      won: false,
      guessesRemaining: 0,
      target: null,
    } satisfies DailySubmitResult);

    const { user, container } = await setup();
    await user.click(screen.getByRole("button", { name: "guess" }));

    await screen.findByRole("img", { name: NOW_PLAYING });
    expect(shimmerRows(container)).toBe(0);
    // The path that always worked, kept here so a future "just move the clear
    // back into the finally" fails on both cases rather than only the rare one.
    expect(recordDailyResult).not.toHaveBeenCalled();
  });
});
