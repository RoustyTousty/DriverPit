import { describe, expect, it } from "vitest";

import {
  MIN_PLAYED_APPEARANCES,
  isDriverPageEligible,
  playedAppearances,
  type DriverAppearance,
} from "./pageEligibility";

// The gate on programmatic pages, which is the one thing in the SEO roadmap that
// can do net harm. What these pin is the threshold itself -- the number and the
// "somebody actually played it" clause -- because both are judgement calls that
// a later change would otherwise move silently, and the symptom (a few dozen
// thin pages) is invisible from inside the repo.

function day(overrides: Partial<DriverAppearance> = {}): DriverAppearance {
  return { date: "2026-07-31", puzzleNumber: 12, players: 2, completed: 2, solved: 1, ...overrides };
}

describe("isDriverPageEligible", () => {
  it("publishes a driver who was the answer on a day someone finished", () => {
    expect(isDriverPageEligible([day()])).toBe(true);
  });

  it("refuses a driver with no appearances at all", () => {
    // The 89 of 103 ranked-pool drivers in this state on 2026-08-08. Their
    // career facts are real, and they are also entirely F1DB's -- a page of them
    // is a name in a template.
    expect(isDriverPageEligible([])).toBe(false);
  });

  it("refuses an appearance nobody played", () => {
    // Eight of the first fourteen finished days. The driver WAS the answer, so a
    // count-only rule would publish them; the page would carry a date and a link
    // to an equally empty archive day.
    expect(isDriverPageEligible([day({ players: 0, completed: 0, solved: 0 })])).toBe(false);
  });

  it("refuses an appearance that was opened and abandoned", () => {
    // `players` moved and `completed` did not: somebody loaded the board and
    // never played it out, which supports no sentence about how the day went.
    expect(isDriverPageEligible([day({ players: 3, completed: 0, solved: 0 })])).toBe(false);
  });

  it("counts a played day even when nobody solved it", () => {
    // A day everyone failed is a real and interesting result, not a missing one.
    expect(isDriverPageEligible([day({ players: 4, completed: 4, solved: 0 })])).toBe(true);
  });

  it("lets one played day carry a driver whose other appearances were empty", () => {
    expect(
      isDriverPageEligible([
        day({ date: "2026-07-01", players: 0, completed: 0, solved: 0 }),
        day({ date: "2026-08-01", players: 1, completed: 1, solved: 1 }),
      ]),
    ).toBe(true);
  });

  it("refuses a driver whose every appearance was empty", () => {
    expect(
      isDriverPageEligible([
        day({ date: "2026-07-01", players: 0, completed: 0, solved: 0 }),
        day({ date: "2026-08-01", players: 2, completed: 0, solved: 0 }),
      ]),
    ).toBe(false);
  });
});

describe("playedAppearances", () => {
  it("keeps only the days with a finished board, in the order given", () => {
    const kept = playedAppearances([
      day({ date: "2026-08-03", completed: 0 }),
      day({ date: "2026-08-02", completed: 1 }),
      day({ date: "2026-08-01", completed: 5 }),
    ]);
    expect(kept.map((appearance) => appearance.date)).toEqual(["2026-08-02", "2026-08-01"]);
  });

  it("agrees with the predicate's threshold", () => {
    // The two are one rule spelled twice -- the page renders the filtered list,
    // the predicate counts it -- so a change to either that does not move the
    // other is a page that exists with nothing on it, or the reverse.
    const evidence = [day({ completed: 0 }), day({ completed: 2 })];
    expect(isDriverPageEligible(evidence)).toBe(
      playedAppearances(evidence).length >= MIN_PLAYED_APPEARANCES,
    );
  });
});
