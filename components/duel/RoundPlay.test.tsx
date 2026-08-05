import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Type-only, so it is erased at build time and this test never pulls
// lib/db/index's raw Postgres connection into jsdom -- the same reason
// lib/duel/submitGuess.ts keeps its own structural copy of this shape.
import type { DriverSummary } from "@/lib/db/queries";
import type { GuessResult } from "@/lib/game/compare";
import { EMPTY_OPPONENT_PROGRESS } from "./duelMatchTypes";
import { RoundPlay } from "./RoundPlay";

// Guess discipline (drizzle/0058), checked where a player meets it: the input
// they cannot use for a beat after each guess, and the number that tells them
// what the round is still worth.
//
// Both are facts about a rendered DOM that tsc cannot see. The cooldown one in
// particular: `cooling` is derived from Date.now() during render rather than
// from a timer, on the argument that the round clock re-renders this component
// 10x a second anyway -- which is either true of the real component or it is a
// permanently stuck input, and only a render can tell the difference.

const ROUND_MS = 60_000;
const NOW = new Date("2026-08-04T12:00:00Z").getTime();

function driverSummary(id: number): DriverSummary {
  return {
    id,
    fullName: `Driver ${id}`,
    driverCode: "DRV",
    nationality: "Italy",
    team: "Ferrari",
    age: 30,
    debutYear: 2015,
    careerWins: 3,
  } as DriverSummary;
}

const COLD_RESULT: GuessResult = {
  nationality: "miss",
  team: "miss",
  age: "higher",
  ageCloseness: 0,
  debutYear: "higher",
  debutYearCloseness: 0,
  careerWins: "higher",
  careerWinsCloseness: 0,
};

function guesses(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    guessedDriver: driverSummary(i + 1),
    result: COLD_RESULT,
  }));
}

function renderRound(overrides: { guessCount?: number; cooldownUntil?: number; remainingMs?: number } = {}) {
  const props = {
    me: {
      handle: "me",
      avatarUrl: "seed-me",
      guesses: guesses(overrides.guessCount ?? 0),
      solved: false,
      roundPoints: null,
      solveMs: null,
    },
    opponent: { handle: "them", avatarUrl: "seed-them", progress: EMPTY_OPPONENT_PROGRESS },
    roundIndex: 0,
    totalRounds: 3,
    remainingMs: overrides.remainingMs ?? 40_000,
    roundMs: ROUND_MS,
    guessCooldownUntil: overrides.cooldownUntil ?? 0,
    confirmedScoreA: 0,
    confirmedScoreB: 0,
    isPlayerA: true,
    completedRounds: [],
    eligibleDrivers: [{ id: 99, fullName: "Ayrton Senna", nationality: "Brazil" }],
    onGuess: vi.fn(),
    pendingGuess: false,
  };
  const view = render(<RoundPlay {...props} />);
  return { ...view, props };
}

// The readout steps in fives, so read the number back rather than pinning a
// literal -- what is under test is that it MOVES the right way, not what the
// curve's constants currently are (duelScoring.test.ts owns those).
function solveNowValue(): number {
  const readout = screen.getByText(/^\+\d+$/);
  return Number(readout.textContent!.replace("+", ""));
}

describe("RoundPlay -- guess discipline", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disables the guess input while the cooldown is live", () => {
    renderRound({ cooldownUntil: NOW + 1_000 });
    expect(screen.getByPlaceholderText("Guess a driver…")).toBeDisabled();
  });

  it("re-enables it on the next round-clock tick after the cooldown lapses", () => {
    // The real re-enable path: nothing schedules a timer for the deadline --
    // the parent re-renders with a fresh remainingMs every COUNTDOWN_TICK_MS
    // and this component re-reads the clock. Simulated exactly that way.
    const { rerender, props } = renderRound({ cooldownUntil: NOW + 1_000 });
    expect(screen.getByPlaceholderText("Guess a driver…")).toBeDisabled();

    vi.setSystemTime(NOW + 1_100);
    rerender(<RoundPlay {...props} remainingMs={38_900} />);

    expect(screen.getByPlaceholderText("Guess a driver…")).toBeEnabled();
  });

  it("leaves the input alone when nothing is cooling", () => {
    renderRound({ cooldownUntil: 0 });
    expect(screen.getByPlaceholderText("Guess a driver…")).toBeEnabled();
  });

  it("gives the guess input its focus back when the cooldown lapses", () => {
    // Disabling a focused element drops focus to <body> -- so without a
    // restore, a keyboard player loses the input after EVERY guess and has to
    // Tab back through the whole page mid-round (the failure audit 2026-07-29
    // §4.7 fixed for the solved panel). The blur below is what the browser
    // does on disable; jsdom does not always reproduce it, so it is performed
    // explicitly rather than relied upon.
    const { rerender, props } = renderRound({ cooldownUntil: NOW + 1_000 });
    const input = screen.getByPlaceholderText("Guess a driver…");
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.body).toHaveFocus();

    vi.setSystemTime(NOW + 1_100);
    rerender(<RoundPlay {...props} remainingMs={38_900} />);

    expect(input).toHaveFocus();
  });

  it("does not steal focus back from wherever the player deliberately moved it", () => {
    const { rerender, props } = renderRound({ cooldownUntil: NOW + 1_000 });
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    vi.setSystemTime(NOW + 1_100);
    rerender(<RoundPlay {...props} remainingMs={38_900} />);

    expect(elsewhere).toHaveFocus();
  });

  it("says nothing about a multiplier while the guesses are still free", () => {
    // Three wrong guesses cost nothing (FREE_GUESSES), and a permanent "x1.00"
    // would read as a penalty the player has not incurred.
    renderRound({ guessCount: 3 });
    expect(screen.getByText("3 guesses")).toBeInTheDocument();
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
  });

  it("shows the multiplier once a guess has actually cost something", () => {
    renderRound({ guessCount: 4 });
    expect(screen.getByText(/^×0\.\d+ on a solve$/)).toBeInTheDocument();
  });

  it("drops what a solve is worth as wrong guesses pile up, at a fixed moment in the round", () => {
    // Same remainingMs in both renders, so the fall is the decay and not the
    // clock -- the distinction the whole mechanic rests on.
    const { unmount } = renderRound({ guessCount: 3, remainingMs: 40_000 });
    const free = solveNowValue();
    unmount();

    renderRound({ guessCount: 12, remainingMs: 40_000 });
    expect(solveNowValue()).toBeLessThan(free);
  });

  it("announces the cost of a wrong guess through a live region", () => {
    // A player who cannot see the number drop is told it instead. The region
    // is mounted empty and filled on the change, which is the only ordering
    // screen readers announce reliably.
    const { rerender, props } = renderRound({ guessCount: 6, remainingMs: 40_000 });
    // Scoped to the readout: DriverAutocomplete keeps a status region of its
    // own (for "already guessed" and the result count), and a bare
    // getByRole("status") would be ambiguous between the two.
    const readout = screen.getByText("Solve now").closest("div")!;
    const status = within(readout).getByRole("status");
    expect(status).toBeEmptyDOMElement();

    rerender(<RoundPlay {...props} me={{ ...props.me, guesses: guesses(7) }} />);

    expect(status).toHaveTextContent(/−\d+ points for that guess/);
  });
});
