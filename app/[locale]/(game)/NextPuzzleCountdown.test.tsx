import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextPuzzleCountdown } from "./NextPuzzleCountdown";

// Audit 2026-07-29 §1.2. The extraction fixed a latent bug in the code it
// moved: the rollover branch was `msLeft <= 0` against `msUntilNextUtcMidnight()`,
// which computes the next midnight FROM THE CURRENT DATE and so returns a value
// in (0, 86_400_000] -- never 0 or less. The branch was unreachable, so at
// 23:59:59 the display read 00:00:00 for one second, flipped back to 23:59:59,
// and left yesterday's finished board on screen indefinitely with no
// re-hydrate.
//
// That fix closed as "not verified in a browser" (§2.6). It is a fact about a
// timer and a render, which is exactly what this tier can see -- and it is the
// kind of bug that comes back silently, because nothing about the wrong version
// looks wrong.

const DAY_MS = 86_400_000;

function setClock(iso: string) {
  vi.setSystemTime(new Date(iso));
}

/** Advance both the fake clock and the interval that reads it. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("NextPuzzleCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("paints the real remaining time on its first frame", () => {
    setClock("2026-07-30T23:59:50Z");
    render(<NextPuzzleCountdown onRollover={vi.fn()} />);

    // Not an empty string that fills in a second later.
    expect(screen.getByText(/Next driver in/)).toHaveTextContent(
      "Next driver in 00:00:10",
    );
  });

  it("counts down toward UTC midnight", async () => {
    setClock("2026-07-30T21:59:57Z");
    render(<NextPuzzleCountdown onRollover={vi.fn()} />);

    expect(screen.getByText(/Next driver in/)).toHaveTextContent("02:00:03");
    await advance(3000);
    expect(screen.getByText(/Next driver in/)).toHaveTextContent("02:00:00");
  });

  it("does not roll over before the day is actually up", async () => {
    setClock("2026-07-30T23:59:50Z");
    const onRollover = vi.fn();
    render(<NextPuzzleCountdown onRollover={onRollover} />);

    await advance(9000);
    expect(onRollover).not.toHaveBeenCalled();
  });

  // THE regression. Before the fix this never fired at all, at any time.
  it("rolls over when the UTC day turns", async () => {
    setClock("2026-07-30T23:59:50Z");
    const onRollover = vi.fn();
    render(<NextPuzzleCountdown onRollover={onRollover} />);

    await advance(10_000);
    expect(onRollover).toHaveBeenCalledTimes(1);
  });

  it("re-arms for the following day instead of firing every second", async () => {
    setClock("2026-07-30T23:59:59Z");
    const onRollover = vi.fn();
    render(<NextPuzzleCountdown onRollover={onRollover} />);

    await advance(1000);
    expect(onRollover).toHaveBeenCalledTimes(1);

    // A board that stays mounted through midnight must not be told again on
    // every tick of the new day.
    await advance(5000);
    expect(onRollover).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Next driver in/)).toHaveTextContent("23:59:55");
  });

  // The other half of comparing against an absolute deadline rather than
  // decrementing a duration: a suspended laptop wakes up past midnight and its
  // first tick is already on the far side.
  it("rolls over on the first tick after a long sleep", async () => {
    setClock("2026-07-30T12:00:00Z");
    const onRollover = vi.fn();
    render(<NextPuzzleCountdown onRollover={onRollover} />);

    await advance(DAY_MS / 2 + 3_600_000);
    expect(onRollover).toHaveBeenCalled();
  });

  it("survives a caller that re-renders with a fresh callback identity", async () => {
    setClock("2026-07-30T23:59:55Z");
    const onRollover = vi.fn();
    const { rerender } = render(<NextPuzzleCountdown onRollover={() => onRollover()} />);

    // An inline arrow is a new identity every render. If it were an effect
    // dependency the interval would be torn down and rebuilt, losing up to a
    // second of tick each time -- and here, the rollover with it.
    await advance(2000);
    rerender(<NextPuzzleCountdown onRollover={() => onRollover()} />);
    await advance(3000);

    expect(onRollover).toHaveBeenCalledTimes(1);
  });
});
