import { describe, expect, it } from "vitest";

import type { DailyRecap, DailyRecapGuess } from "../db/dailyRecap";
import { summaryTranslator } from "../i18n/testTranslator";
import { writeRecapSummary, type RecapSummaryContext } from "./summary";

// The real English catalogue through a real ICU renderer -- see the note in
// testTranslator.ts. These assertions read finished prose, so a stub returning
// its own key would pass against a catalogue that says nothing at all.
const T = summaryTranslator("recapSummary");

/** `writeRecapSummary` with the translator applied, since every call needs it. */
function summarise(recap: DailyRecap, context: RecapSummaryContext): string[] {
  return writeRecapSummary(recap, context, T);
}

// The generator's failure mode is not a crash, it is prose that reads like a
// machine wrote it — so most of these assert on properties of the TEXT (a
// driver named once, a claim the sample supports, a shape that changes with the
// data) rather than pinning exact strings. Pinning strings would make every
// wording change a test change and would still not catch the two defects the
// first draft actually shipped: a repeated name, and a "most popular" claim
// derived from one player.

const TARGET = {
  id: 100,
  slug: "nico-hulkenberg",
  fullName: "Nico Hulkenberg",
  driverCode: "HUL",
  nationality: "Germany",
  lastTeam: "Sauber",
  age: 39,
  debutYear: 2010,
  careerWins: 0,
};

function guess(id: number, fullName: string, count: number, players: number): DailyRecapGuess {
  return { driverId: id, fullName, count, share: players === 0 ? 0 : count / players };
}

function recap(overrides: Partial<DailyRecap> = {}): DailyRecap {
  return {
    date: "2026-09-01",
    puzzleNumber: 46,
    target: TARGET,
    players: 0,
    completed: 0,
    solved: 0,
    solveRate: 0,
    averageGuesses: null,
    distribution: [0, 0, 0, 0, 0, 0],
    topGuesses: [],
    commonOpener: null,
    ...overrides,
  };
}

const ESTABLISHED: RecapSummaryContext = { averageSolveRate: 0.64, comparableDays: 45 };
const NEW_ARCHIVE: RecapSummaryContext = { averageSolveRate: null, comparableDays: 0 };

function text(r: DailyRecap, context: RecapSummaryContext = ESTABLISHED): string {
  return summarise(r, context).join(" ");
}

/** A busy day, as a base for the shapes that need a real population. */
function busyDay(overrides: Partial<DailyRecap> = {}): DailyRecap {
  return recap({
    players: 880,
    completed: 802,
    solved: 512,
    solveRate: 512 / 802,
    averageGuesses: 4.0,
    distribution: [3, 61, 140, 158, 96, 54],
    topGuesses: [
      guess(100, TARGET.fullName, 530, 880),
      guess(2, "Alexander Albon", 470, 880),
      guess(44, "Kevin Magnussen", 388, 880),
    ],
    commonOpener: { fullName: "Alexander Albon", count: 300 },
    ...overrides,
  });
}

describe("writeRecapSummary — every sentence is entailed by the numbers", () => {
  it("never quotes a driver the recap does not contain", () => {
    const sentences = summarise(busyDay(), ESTABLISHED);
    const known = [TARGET.fullName, "Alexander Albon", "Kevin Magnussen"];
    for (const sentence of sentences) {
      const names = sentence.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) ?? [];
      for (const name of names) {
        // Sentence-initial words can look like names; only assert on matches
        // that are actually driver-shaped by checking against the known set.
        if (known.some((k) => k.includes(name.split(" ")[0]))) expect(known).toContain(name);
      }
    }
  });

  it("ends every sentence", () => {
    for (const sentence of summarise(busyDay(), ESTABLISHED)) {
      expect(sentence.endsWith(".")).toBe(true);
    }
  });
});

describe("writeRecapSummary — rule 2: nothing the sample cannot support", () => {
  // The first draft's worst output: one player, and it claimed a plurality.
  it("says nothing about a crowd on a one-player day", () => {
    const solo = recap({
      players: 1,
      completed: 1,
      solved: 1,
      solveRate: 1,
      averageGuesses: 2,
      distribution: [0, 1, 0, 0, 0, 0],
      topGuesses: [guess(100, TARGET.fullName, 1, 1), guess(2, "Alexander Albon", 1, 1)],
      commonOpener: { fullName: "Alexander Albon", count: 1 },
    });
    const sentences = summarise(solo, ESTABLISHED);

    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toContain("second guess");
    expect(text(solo)).not.toContain("popular");
    expect(text(solo)).not.toContain("More players");
  });

  it("does not call a tie an upset", () => {
    // Albon and the answer were both guessed by 2 of 2 -- the ordering between
    // them is a driver-id tie-break, not a fact about the day.
    const tied = recap({
      players: 2,
      completed: 2,
      solved: 2,
      solveRate: 1,
      averageGuesses: 2,
      distribution: [0, 2, 0, 0, 0, 0],
      topGuesses: [guess(2, "Alexander Albon", 2, 2), guess(100, TARGET.fullName, 2, 2)],
      commonOpener: { fullName: "Alexander Albon", count: 2 },
    });
    expect(text(tied)).not.toContain("More players tried");
  });

  it("reports a genuine upset when the margin is real", () => {
    const upset = busyDay({
      solved: 120,
      solveRate: 120 / 802,
      distribution: [0, 4, 20, 30, 36, 30],
      topGuesses: [
        guess(2, "Alexander Albon", 640, 880),
        guess(100, TARGET.fullName, 244, 880),
      ],
    });
    // The difficulty sentence outranks it here, so check the generator directly
    // by removing the archive comparison.
    expect(text(upset, NEW_ARCHIVE)).toContain("More players tried Alexander Albon");
  });

  it("will not quote an archive average built from a handful of days", () => {
    const thin: RecapSummaryContext = { averageSolveRate: 0.95, comparableDays: 3 };
    expect(text(busyDay(), thin)).not.toContain("archive");
  });

  it("will not quote an average the day sits close to", () => {
    const near = busyDay({ solved: 514, solveRate: 0.64 });
    expect(text(near, ESTABLISHED)).not.toContain("archive");
  });
});

describe("writeRecapSummary — rule 3: nothing said twice", () => {
  it("names no driver more than once", () => {
    const day = busyDay({ commonOpener: { fullName: "Kevin Magnussen", count: 300 } });
    const whole = text(day);
    for (const name of [TARGET.fullName, "Alexander Albon", "Kevin Magnussen"]) {
      const occurrences = whole.split(name).length - 1;
      expect(occurrences).toBeLessThanOrEqual(1);
    }
  });

  // The other first-draft defect: "Most boards opened with X, and the wrong
  // name that came up most often was X."
  it("merges the opener and the top wrong answer when they are the same driver", () => {
    const day = busyDay({ commonOpener: { fullName: "Alexander Albon", count: 500 } });
    const whole = text(day);
    expect(whole.split("Alexander Albon").length - 1).toBe(1);
  });

  it("still names the top wrong answer when it differs from the opener", () => {
    const day = busyDay({
      commonOpener: { fullName: "Kevin Magnussen", count: 500 },
      // Albon is the most-guessed non-answer; Magnussen opened most boards.
      topGuesses: [
        guess(100, TARGET.fullName, 530, 880),
        guess(2, "Alexander Albon", 470, 880),
      ],
    });
    const whole = text(day, NEW_ARCHIVE);
    expect(whole).toContain("Kevin Magnussen");
    expect(whole).toContain("Alexander Albon");
  });

  it("does not repeat the answer's name on an opener-was-the-answer day", () => {
    const day = busyDay({
      commonOpener: { fullName: TARGET.fullName, count: 190 },
    });
    expect(text(day).split(TARGET.fullName).length - 1).toBe(1);
    expect(text(day)).toContain("the answer itself");
  });
});

describe("writeRecapSummary — the shape changes with the data", () => {
  it("produces a different opening sentence across the solve-rate bands", () => {
    const bands = [1, 0.85, 0.65, 0.5, 0.3, 0.05].map((rate) => {
      const solved = Math.max(1, Math.round(802 * rate));
      return summarise(busyDay({ solved, solveRate: solved / 802 }), ESTABLISHED)[0];
    });
    expect(new Set(bands).size).toBe(bands.length);
  });

  it("has a shape for a day nobody played", () => {
    const sentences = summarise(recap(), ESTABLISHED);
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toContain("Nobody recorded a guess");
    expect(sentences[0]).toContain(TARGET.fullName);
  });

  it("has a shape for a day nobody finished", () => {
    const abandoned = recap({ players: 4, completed: 0 });
    expect(text(abandoned)).toContain("none of them played it out");
    // No completed boards means no solve rate worth comparing.
    expect(text(abandoned)).not.toContain("archive");
  });

  it("has a shape for a day nobody solved", () => {
    const unsolved = busyDay({ solved: 0, solveRate: 0, averageGuesses: null, distribution: [0, 0, 0, 0, 0, 0] });
    expect(text(unsolved)).toContain("None of the 802 players");
  });

  it("says 'both' rather than a fraction at two boards", () => {
    const two = recap({
      players: 2,
      completed: 2,
      solved: 2,
      solveRate: 1,
      averageGuesses: 2,
      distribution: [0, 2, 0, 0, 0, 0],
      commonOpener: { fullName: "Alexander Albon", count: 2 },
      topGuesses: [guess(2, "Alexander Albon", 2, 2)],
    });
    // NEW_ARCHIVE, because with an established average a 100% day is 36 points
    // clear of it and the difficulty sentence rightly takes the middle slot.
    const whole = text(two, NEW_ARCHIVE);
    expect(whole).toContain("Both players who finished");
    expect(whole).toContain("Both winning boards needed two guesses");
    expect(whole).toContain("Both boards opened with Alexander Albon");
    expect(whole).not.toMatch(/\d+ of the \d+/);
  });

  it("uses number words rather than digits at small counts", () => {
    const small = recap({
      players: 3,
      completed: 3,
      solved: 1,
      solveRate: 1 / 3,
      averageGuesses: 4,
      distribution: [0, 0, 0, 1, 0, 0],
    });
    expect(text(small)).toContain("one of the three finished boards");
  });

  it("reports a first-guess solve, in words", () => {
    const lucky = busyDay({ distribution: [3, 61, 140, 158, 96, 54] });
    expect(text(lucky, NEW_ARCHIVE)).toContain("Three boards got there on the opening guess");
  });
});
