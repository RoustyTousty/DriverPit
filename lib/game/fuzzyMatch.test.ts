import { describe, expect, it } from "vitest";

import {
  buildSearchIndex,
  fuzzyFilter,
  normalizeSearchText,
  partitionSearchIndex,
  sampleSearchIndex,
} from "./fuzzyMatch";

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

// Backs the duplicate-guess guard (audit 2026-07-29 §4.7): already-guessed
// drivers come out of the suggestions, and stay available as the reason the
// dropdown can then give.
describe("partitionSearchIndex", () => {
  const index = buildSearchIndex(DRIVERS, (d) => d);
  const guessed = new Set(["Lewis Hamilton", "Lando Norris"]);

  it("splits on the predicate and preserves index order in both halves", () => {
    const { included, excluded } = partitionSearchIndex(index, (name) => guessed.has(name));
    expect(included.map((entry) => entry.item)).toEqual(
      DRIVERS.filter((name) => !guessed.has(name)),
    );
    expect(excluded.map((entry) => entry.item)).toEqual(["Lewis Hamilton", "Lando Norris"]);
  });

  it("carries entries over by reference, so nothing is normalized twice", () => {
    // The point of partitioning the *index* rather than filtering the driver
    // list: this runs once per guess, and re-folding ~800 names there would
    // undo audit §1.3's fix.
    const { included } = partitionSearchIndex(index, () => false);
    expect(included).toHaveLength(index.length);
    included.forEach((entry, i) => expect(entry).toBe(index[i]));
  });

  it("hides an excluded driver from suggestions while still naming it", () => {
    const { included, excluded } = partitionSearchIndex(index, (name) => guessed.has(name));
    expect(fuzzyFilter("hamilton", included)).toEqual([]);
    expect(fuzzyFilter("hamilton", excluded, 1)).toEqual(["Lewis Hamilton"]);
  });

  it("puts everything in `included` when nothing is excluded", () => {
    const { included, excluded } = partitionSearchIndex(index, () => false);
    expect(included.map((entry) => entry.item)).toEqual(DRIVERS);
    expect(excluded).toEqual([]);
  });
});

// What an EMPTY query offers. fuzzyFilter's answer to one is the head of the
// pool -- which is alphabetical, so every player opening the box saw the same
// eight A-names before typing anything.
describe("sampleSearchIndex", () => {
  const POOL = Array.from({ length: 40 }, (_, i) => `Driver ${String(i).padStart(2, "0")}`);
  const index = buildSearchIndex(POOL, (d) => d);

  it("draws the asked-for number of drivers, all distinct and all from the pool", () => {
    const drawn = sampleSearchIndex(index, 8, 12345);
    expect(drawn).toHaveLength(8);
    expect(new Set(drawn).size).toBe(8);
    drawn.forEach((name) => expect(POOL).toContain(name));
  });

  it("is pure: the same seed always draws the same list", () => {
    // The property the caller depends on. DriverAutocomplete samples during
    // render and re-renders on the duel's 10Hz round clock -- if this were
    // seeded from Math.random internally, the suggestions would reshuffle under
    // the player's cursor ten times a second.
    expect(sampleSearchIndex(index, 8, 999)).toEqual(sampleSearchIndex(index, 8, 999));
  });

  it("draws differently as the seed changes", () => {
    const lists = Array.from({ length: 20 }, (_, seed) =>
      sampleSearchIndex(index, 8, seed).join("|"),
    );
    // Not "every pair differs" -- that would be asserting the PRNG never
    // collides. One repeated draw across twenty seeds is fine; twenty identical
    // ones would mean the seed isn't reaching the shuffle at all.
    expect(new Set(lists).size).toBeGreaterThan(15);
  });

  it("does not just return the head of the pool", () => {
    // The actual complaint: the box always opened on the top of the alphabet.
    const head = POOL.slice(0, 8);
    const anySeedMatchesHead = Array.from({ length: 20 }, (_, seed) =>
      sampleSearchIndex(index, 8, seed),
    ).some((drawn) => drawn.every((name, i) => name === head[i]));
    expect(anySeedMatchesHead).toBe(false);
  });

  it("covers the whole pool over enough draws, not just its front", () => {
    // A partial Fisher-Yates that swaps wrongly still looks plausible on one
    // draw; what it gets wrong is reach. Every driver must be reachable.
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      for (const name of sampleSearchIndex(index, 8, seed)) seen.add(name);
    }
    expect(seen.size).toBe(POOL.length);
  });

  it("returns the whole pool when it is smaller than the sample", () => {
    const small = buildSearchIndex(["Alpha", "Beta", "Gamma"], (d) => d);
    const drawn = sampleSearchIndex(small, 8, 7);
    expect(drawn).toHaveLength(3);
    expect([...drawn].sort()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("handles an empty pool and a zero count without a throw", () => {
    expect(sampleSearchIndex([], 8, 1)).toEqual([]);
    expect(sampleSearchIndex(index, 0, 1)).toEqual([]);
  });
});
