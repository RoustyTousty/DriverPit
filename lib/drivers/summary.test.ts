import { describe, expect, it } from "vitest";

import type { DriverPage } from "../db/dailyRecap";
import { summaryTranslator } from "../i18n/testTranslator";
import { formatRecapDate } from "../recap/format";
import type { DriverAppearance } from "./pageEligibility";
import { writeDriverSummary, type DriverSummaryContext } from "./summary";

// The paragraph is what makes a driver page a document rather than a table, so
// what these pin is the two things a template would get wrong: that the shape
// changes with the data, and that no sentence claims more than the numbers
// support.
//
// Every case below was written after running the generator against the real
// roster (the roadmap's standing instruction for Pass 3's generator, which
// applies to this one too). Four defects were visible in that output and
// invisible in the code: "finished on the podium 1 time", "4 different
// constructors", "and all of them got it" for two players, and present perfect
// on a driver who retired in 2017 — each has a test here.

const CURRENT_YEAR = 2026;
// The real English catalogue, through a real ICU renderer. A stub translator
// returning its own key would keep every assertion below green against a
// catalogue whose plurals are wrong -- and "finished on the podium 1 time" is
// one of the four defects this file exists to have caught.
const CONTEXT: DriverSummaryContext = {
  currentYear: CURRENT_YEAR,
  locale: "en",
  formatDate: formatRecapDate,
  t: summaryTranslator("driverSummary"),
};

function day(overrides: Partial<DriverAppearance> = {}): DriverAppearance {
  return { date: "2026-07-31", puzzleNumber: 14, players: 2, completed: 2, solved: 2, ...overrides };
}

function driver(overrides: Partial<DriverPage> = {}): DriverPage {
  return {
    slug: "test-driver",
    fullName: "Test Driver",
    driverCode: "TST",
    nationality: "Italy",
    age: 40,
    dateOfBirth: "1986-03-01",
    dateOfDeath: null,
    debutYear: 2010,
    lastActiveYear: 2015,
    careerWins: 0,
    podiums: 0,
    polePositions: 0,
    championshipWins: 0,
    lastTeam: "Ferrari",
    teams: ["Ferrari"],
    appearances: [],
    ...overrides,
  };
}

const paragraph = (d: DriverPage) => writeDriverSummary(d, CONTEXT).join(" ");

describe("writeDriverSummary — the career sentence", () => {
  it("leads with titles for a champion", () => {
    const text = paragraph(
      driver({ fullName: "Lewis Hamilton", championshipWins: 7, careerWins: 106, podiums: 207, lastActiveYear: 2026 }),
    );
    expect(text).toContain("has won seven world championships and 106 grands prix");
  });

  it("leads with the win count for a winner who never took a title", () => {
    const text = paragraph(driver({ fullName: "Felipe Massa", careerWins: 11, podiums: 41, lastActiveYear: 2017 }));
    expect(text).toContain("won 11 grands prix");
    expect(text).not.toContain("world championship");
  });

  it("leads with the absence of a win for a podium finisher", () => {
    const text = paragraph(driver({ podiums: 2, lastActiveYear: 2026 }));
    expect(text).toContain("has never won a grand prix, but finished on the podium twice");
  });

  it("says 'once' and 'twice' rather than '1 time' and '2 times'", () => {
    // Straight out of the first real run: "finished on the podium 1 time".
    expect(paragraph(driver({ podiums: 1 }))).toContain("on the podium once");
    expect(paragraph(driver({ podiums: 2 }))).toContain("on the podium twice");
    expect(paragraph(driver({ podiums: 5 }))).toContain("on the podium five times");
  });

  it("never implies podiums contain wins when the two counts disagree", () => {
    // careerWins is computed by the seed from race results; podiums comes from
    // F1DB's own totals, and CLAUDE.md records that the two are deliberately not
    // cross-checked. A roster refresh that made wins exceed podiums must not
    // produce "won 5 grands prix, and stood on the podium 3 times in all".
    const text = paragraph(driver({ careerWins: 5, podiums: 3 }));
    expect(text).toContain("won 5 grands prix");
    expect(text).not.toContain("podium");
  });

  it("still says something about a driver with no results at all", () => {
    expect(paragraph(driver({ debutYear: 2007, lastActiveYear: 2007 }))).toContain(
      "raced in 2007 without a podium finish",
    );
  });
});

describe("writeDriverSummary — tense and span", () => {
  it("uses 'since' and the present perfect for a driver still racing", () => {
    const text = paragraph(driver({ debutYear: 2001, lastActiveYear: CURRENT_YEAR, careerWins: 32 }));
    expect(text).toContain("has won 32 grands prix since 2001");
  });

  it("uses a closed span and the simple past for a retired driver", () => {
    // "has won 11 grands prix between 2002 and 2017" was in the first real run.
    const text = paragraph(driver({ debutYear: 2002, lastActiveYear: 2017, careerWins: 11 }));
    expect(text).toContain("won 11 grands prix between 2002 and 2017");
    expect(text).not.toContain("has won");
  });

  it("qualifies a single-team career as 'so far' only while it is still running", () => {
    expect(paragraph(driver({ teams: ["Haas"], lastActiveYear: CURRENT_YEAR }))).toContain(
      "their whole career so far with Haas",
    );
    expect(paragraph(driver({ teams: ["Haas"], lastActiveYear: 2022 }))).toContain(
      "Their whole career was spent with Haas",
    );
  });
});

describe("writeDriverSummary — the teams sentence", () => {
  it("lists the constructors, oxford-comma-free", () => {
    expect(paragraph(driver({ teams: ["McLaren", "Mercedes", "Ferrari"] }))).toContain(
      "raced for McLaren, Mercedes and Ferrari",
    );
  });

  it("counts them in words when a career churned through teams", () => {
    // "They drove for 4 different constructors" in the first real run.
    const text = paragraph(
      driver({ teams: ["AlphaTauri", "RB", "Racing Bulls", "Red Bull"], debutYear: 2021, lastActiveYear: 2025 }),
    );
    expect(text).toContain("four different constructors");
  });

  it("says nothing at all when the roster has no teams for them", () => {
    const sentences = writeDriverSummary(driver({ teams: [] }), CONTEXT);
    expect(sentences.every((sentence) => !sentence.includes("raced for"))).toBe(true);
  });
});

describe("writeDriverSummary — the archive sentence", () => {
  it("is absent when no appearance had a finished board", () => {
    // The page would not exist in this state, but the generator must not invent
    // a sentence for it either — a driver can reach here from a day nobody
    // played alongside one somebody did.
    const sentences = writeDriverSummary(driver({ appearances: [day({ players: 0, completed: 0, solved: 0 })] }), CONTEXT);
    expect(sentences.some((sentence) => sentence.includes("DriverPit answer"))).toBe(false);
  });

  it("names the date, not the puzzle number", () => {
    // The number is a label on the list below; a sentence needs a date a reader
    // can place.
    const text = paragraph(driver({ appearances: [day({ date: "2026-07-31", puzzleNumber: 14 })] }));
    expect(text).toContain("on 31 July 2026");
    expect(text).not.toContain("#14");
  });

  it("says 'both' for two finished boards rather than 'all of them'", () => {
    expect(paragraph(driver({ appearances: [day({ completed: 2, solved: 2 })] }))).toContain(
      "both players who finished it found them",
    );
  });

  it("reports a split day as a count of people, not a percentage", () => {
    expect(paragraph(driver({ appearances: [day({ completed: 2, solved: 1 })] }))).toContain(
      "one of the two players who finished it found them",
    );
  });

  it("reports a day nobody solved without dressing it up", () => {
    expect(paragraph(driver({ appearances: [day({ completed: 1, solved: 0 })] }))).toContain(
      "the one player who finished it did not",
    );
  });

  it("withholds a solve rate until enough boards are behind it", () => {
    // Two appearances, three finished boards. A percentage off three boards is
    // false precision, which is the rule lib/recap/summary.ts learned first.
    const text = paragraph(
      driver({
        appearances: [day({ date: "2026-08-01", completed: 2, solved: 1 }), day({ date: "2026-07-01", completed: 1, solved: 1 })],
      }),
    );
    expect(text).toContain("come up as the answer twice");
    expect(text).toContain("two of the three boards finished on those days found them");
    expect(text).not.toMatch(/\d+%/);
  });

  it("quotes a solve rate once the sample supports one", () => {
    const text = paragraph(
      driver({
        appearances: [
          day({ date: "2026-08-01", completed: 30, solved: 20 }),
          day({ date: "2026-07-01", completed: 30, solved: 10 }),
        ],
      }),
    );
    expect(text).toContain("50% of the 60 boards");
  });
});

describe("writeDriverSummary — shape", () => {
  it("does not pad a driver with little to report", () => {
    // Two sentences is the correct length for one team and no results. Padding
    // is how a page with nothing to say starts sounding like one with something.
    expect(writeDriverSummary(driver(), CONTEXT)).toHaveLength(2);
  });

  it("gives two drivers with different records visibly different paragraphs", () => {
    // The whole point of sentence shapes over one template: a champion's page
    // and a backmarker's must not read as the same document with the nouns
    // swapped.
    const champion = paragraph(driver({ fullName: "A", championshipWins: 4, careerWins: 53, lastActiveYear: 2022 }));
    const backmarker = paragraph(driver({ fullName: "B", debutYear: 2013, lastActiveYear: 2013 }));
    expect(champion.replace("A", "")).not.toBe(backmarker.replace("B", ""));
  });
});
