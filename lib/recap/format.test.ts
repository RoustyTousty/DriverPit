import { describe, expect, it } from "vitest";

import {
  barWidthPercent,
  fitTextSize,
  formatAverageGuesses,
  formatCount,
  formatPercent,
  formatRecapDate,
  isUtcDateString,
  MONO_ADVANCE,
  parseRecapFormat,
  SANS_ADVANCE,
} from "./format";

describe("isUtcDateString", () => {
  it("accepts a real UTC calendar day", () => {
    expect(isUtcDateString("2026-07-31")).toBe(true);
    expect(isUtcDateString("2024-02-29")).toBe(true);
  });

  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    for (const bad of ["", "2026-7-31", "2026/07/31", "20260731", "nonsense", "2026-07-31T00:00:00Z"]) {
      expect(isUtcDateString(bad)).toBe(false);
    }
  });

  // The round trip, not the regex. These are the shapes that would reach
  // Postgres as `'2026-02-31'::date` and raise -- a 500 where the archive route
  // owes a 404.
  it("rejects a well-formed date that does not exist", () => {
    expect(isUtcDateString("2026-02-31")).toBe(false);
    expect(isUtcDateString("2026-13-01")).toBe(false);
    expect(isUtcDateString("2026-00-10")).toBe(false);
    expect(isUtcDateString("2026-02-29")).toBe(false); // 2026 is not a leap year
  });
});

describe("formatRecapDate", () => {
  it("reads as a date, in UTC, without Intl", () => {
    expect(formatRecapDate("2026-07-31")).toBe("31 July 2026");
    expect(formatRecapDate("2026-01-01")).toBe("1 January 2026");
    expect(formatRecapDate("2026-12-25")).toBe("25 December 2026");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(1049 / 1381)).toBe("76%");
    expect(formatPercent(2 / 3)).toBe("67%");
  });

  it("clamps rather than printing an impossible share", () => {
    expect(formatPercent(1.4)).toBe("100%");
    expect(formatPercent(-1)).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("0%");
  });
});

describe("formatAverageGuesses", () => {
  it("shows one decimal", () => {
    expect(formatAverageGuesses(2)).toBe("2.0");
    expect(formatAverageGuesses(3.75)).toBe("3.8");
  });

  // Not "0.0": nobody solved it is a different fact from everybody solved it in
  // zero guesses, and the second one is impossible.
  it("shows an em dash when nobody solved the day", () => {
    expect(formatAverageGuesses(null)).toBe("—");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1462)).toBe("1,462");
    expect(formatCount(1000000)).toBe("1,000,000");
  });
});

describe("barWidthPercent", () => {
  it("scales against the largest bar in the group", () => {
    expect(barWidthPercent(372, 372)).toBe("100%");
    expect(barWidthPercent(186, 372)).toBe("50%");
  });

  it("gives nothing to a zero and something visible to everything else", () => {
    expect(barWidthPercent(0, 372)).toBe("0%");
    expect(barWidthPercent(1, 100000)).toBe("3%");
  });

  it("survives an all-zero group", () => {
    expect(barWidthPercent(0, 0)).toBe("0%");
  });
});

// The invariants the card actually depends on, re-derived here rather than
// pinning the sizes fitTextSize happens to return today: what matters is that
// the text FITS, not that a particular number comes back.
function longestWord(text: string) {
  return Math.max(...text.split(/\s+/).map((word) => word.length));
}

function linesAt(text: string, size: number, width: number, advance: number) {
  const charsPerLine = Math.floor(width / (size * advance));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    if (used === 0) used = word.length;
    else if (used + 1 + word.length <= charsPerLine) used += 1 + word.length;
    else {
      lines += 1;
      used = word.length;
    }
  }
  return lines;
}

describe("fitTextSize", () => {
  // Every tile the daily pool can produce, at the tightest box the card uses
  // (the solo portrait layout's, 134x92).
  const TILE = { width: 134, height: 92 };

  it("leaves a value that already fits at the base size", () => {
    expect(fitTextSize("41", 36, TILE)).toBe(36);
    expect(fitTextSize("2007", 36, TILE)).toBe(36);
  });

  // The regression: "Ferrari" at 36px needs 156px of a 134px tile. There is
  // room for two lines, so a height-only test accepts it and Satori renders
  // "Ferrar" / "i".
  it("never breaks a word across lines", () => {
    for (const value of ["Ferrari", "Williams", "Ferrari", "Derrington-Francis", "Frank Williams Racing Cars"]) {
      const size = fitTextSize(value, 36, TILE);
      const charsPerLine = Math.floor(TILE.width / (size * MONO_ADVANCE));
      expect(charsPerLine).toBeGreaterThanOrEqual(longestWord(value));
    }
  });

  // The other direction: every word fits on a line, and the four of them still
  // overflow the tile vertically and overprint its label.
  it("keeps a wrapped value inside the box height", () => {
    for (const value of ["United States of America", "Frank Williams Racing Cars", "United Kingdom"]) {
      const size = fitTextSize(value, 36, TILE);
      const lines = linesAt(value, size, TILE.width, MONO_ADVANCE);
      expect(lines * size * 1.15).toBeLessThanOrEqual(TILE.height);
    }
  });

  it("fits the longest driver name on one line at the sans advance", () => {
    const box = { width: 952, height: 88 };
    for (const name of ["Giancarlo Fisichella", "Robin Montgomerie-Charrington", "Jean-Pierre Beltoise"]) {
      const size = fitTextSize(name, 72, box, SANS_ADVANCE);
      expect(linesAt(name, size, box.width, SANS_ADVANCE)).toBe(1);
    }
  });

  it("does not shrink a name that already fits", () => {
    expect(fitTextSize("Lewis Hamilton", 72, { width: 952, height: 88 }, SANS_ADVANCE)).toBe(72);
  });

  it("degrades instead of dividing by zero on a collapsed box", () => {
    expect(fitTextSize("Ferrari", 36, { width: 0, height: 0 })).toBe(36);
  });
});

describe("parseRecapFormat", () => {
  it("defaults to portrait", () => {
    expect(parseRecapFormat(null)).toBe("portrait");
    expect(parseRecapFormat(undefined)).toBe("portrait");
    expect(parseRecapFormat("")).toBe("portrait");
    expect(parseRecapFormat("square")).toBe("portrait");
  });

  it("selects wide when asked", () => {
    expect(parseRecapFormat("wide")).toBe("wide");
  });
});
