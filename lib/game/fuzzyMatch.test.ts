import { describe, expect, it } from "vitest";

import { buildSearchIndex, fuzzyFilter, normalizeSearchText } from "./fuzzyMatch";

const DRIVERS = [
  "Max Verstappen",
  "Lewis Hamilton",
  "Fernando Alonso",
  "Charles Leclerc",
  "Lando Norris",
  "George Russell",
  "Carlos Sainz",
  "Sergio Perez",
];

const ACCENTED = [
  "Nico Hülkenberg",
  "Sergio Pérez",
  "Kimi Räikkönen",
  "Mika Häkkinen",
  "Esteban Gutiérrez",
  "Tom Belsø",
];

/** The real call shape: build the index once, filter many times. */
function filter(query: string, items: readonly string[], limit?: number) {
  return fuzzyFilter(query, buildSearchIndex(items, (d) => d), limit);
}

describe("normalizeSearchText", () => {
  it("lowercases and strips combining diacritics", () => {
    expect(normalizeSearchText("Sergio Pérez")).toBe("sergio perez");
    expect(normalizeSearchText("Kimi Räikkönen")).toBe("kimi raikkonen");
  });

  it("folds Latin letters that NFD does not decompose", () => {
    // These are single codepoints, not base + mark, so the NFD pass alone
    // leaves them and the unaccented spelling would still miss.
    expect(normalizeSearchText("Tom Belsø")).toBe("tom belso");
    expect(normalizeSearchText("Æ Œ ß")).toBe("ae oe ss");
  });

  it("is idempotent, so an already-folded string is unchanged", () => {
    expect(normalizeSearchText(normalizeSearchText("Nico Hülkenberg"))).toBe("nico hulkenberg");
  });
});

describe("fuzzyFilter", () => {
  it("returns all items (up to the limit) for an empty query", () => {
    expect(filter("", DRIVERS, 8)).toEqual(DRIVERS);
  });

  it("matches a contiguous substring case-insensitively", () => {
    expect(filter("verstappen", DRIVERS)).toEqual(["Max Verstappen"]);
  });

  it("matches on a substring anywhere in the string, not just the start", () => {
    expect(filter("hamilton", DRIVERS)).toEqual(["Lewis Hamilton"]);
  });

  it("ranks a match starting earlier in the string above one starting later", () => {
    expect(filter("le", ["xxle", "lexxx"])[0]).toBe("lexxx");
  });

  it("falls back to a typo-tolerant subsequence match", () => {
    expect(filter("vrstpn", DRIVERS)).toContain("Max Verstappen");
  });

  it("excludes items where the query characters are out of order", () => {
    const results = filter("nosalo", DRIVERS); // reversed "alonso"-ish, out of order
    expect(results).not.toContain("Fernando Alonso");
  });

  it("returns no results when nothing matches", () => {
    expect(filter("zzzzz", DRIVERS)).toEqual([]);
  });

  it("respects the limit parameter", () => {
    expect(filter("a", DRIVERS, 2).length).toBeLessThanOrEqual(2);
  });

  it("prefers a contiguous substring match over a scattered subsequence match", () => {
    // "sainz" is a contiguous substring of the first item, but only appears
    // as a scattered subsequence (s...a...i...n...z) in the second.
    const items = ["extra sainz stuff", "sam ainzley"];
    expect(filter("sainz", items)[0]).toBe("extra sainz stuff");
  });

  it("keeps input order among equally-scoring matches", () => {
    // Same score (substring at index 0 for both), so the index's own order --
    // alphabetical, as the pool queries return it -- must survive the
    // bounded-insertion ranking exactly as it survived a stable sort.
    const items = ["ab", "ac", "ad", "ae"];
    expect(filter("a", items)).toEqual(items);
  });

  it("returns nothing for a non-positive limit", () => {
    expect(filter("a", DRIVERS, 0)).toEqual([]);
  });
});

// audit 2026-07-27 §4.2 -- each of these returned *nothing* before the fold,
// silently, which is the worst possible answer for a name a player can see on
// the grid every race weekend.
describe("fuzzyFilter with accented names", () => {
  it("finds a driver by the unaccented spelling", () => {
    expect(filter("hulkenberg", ACCENTED)).toEqual(["Nico Hülkenberg"]);
    expect(filter("perez", ACCENTED)).toEqual(["Sergio Pérez"]);
    expect(filter("raikkonen", ACCENTED)).toEqual(["Kimi Räikkönen"]);
    expect(filter("hakkinen", ACCENTED)).toEqual(["Mika Häkkinen"]);
    expect(filter("gutierrez", ACCENTED)).toEqual(["Esteban Gutiérrez"]);
    expect(filter("belso", ACCENTED)).toEqual(["Tom Belsø"]);
  });

  it("still finds a driver by the accented spelling", () => {
    expect(filter("Pérez", ACCENTED)).toEqual(["Sergio Pérez"]);
    expect(filter("hülkenberg", ACCENTED)).toEqual(["Nico Hülkenberg"]);
  });

  it("matches an unaccented query mid-word, not only at a word boundary", () => {
    expect(filter("kkonen", ACCENTED)).toEqual(["Kimi Räikkönen"]);
  });

  it("still supports the subsequence fallback across a folded character", () => {
    expect(filter("hlknbrg", ACCENTED)).toContain("Nico Hülkenberg");
  });
});

describe("buildSearchIndex", () => {
  it("normalizes once and preserves item order", () => {
    const index = buildSearchIndex(ACCENTED, (d) => d);
    expect(index.map((entry) => entry.item)).toEqual(ACCENTED);
    expect(index[0].key).toBe("nico hulkenberg");
  });
});
