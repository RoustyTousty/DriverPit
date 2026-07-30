import { describe, expect, it } from "vitest";

import { MAX_GUESSES } from "../game/constants";

import { emptyDistribution, mergeDistributions, normalizeDistribution } from "./guessDistribution";

// The case these tests exist for is the LEGACY FIVE-BUCKET ROW: drizzle/0007
// defaulted guess_distribution to five buckets, drizzle/0016 changed the
// default to six and backfilled nothing, so rows created between them are
// still five long. Every assertion below that mentions a five-element array is
// describing a row that really can be in the database, not a hypothetical.
const LEGACY_FIVE_BUCKET_ROW = [3, 4, 5, 6, 7];

describe("emptyDistribution", () => {
  it("is MAX_GUESSES zeroes", () => {
    expect(emptyDistribution()).toEqual([0, 0, 0, 0, 0, 0]);
    expect(emptyDistribution()).toHaveLength(MAX_GUESSES);
  });

  it("returns a fresh array each call, so a caller can't mutate the next one", () => {
    const first = emptyDistribution();
    first[0] = 99;
    expect(emptyDistribution()[0]).toBe(0);
  });
});

describe("normalizeDistribution", () => {
  it("pads a legacy five-bucket row to MAX_GUESSES", () => {
    expect(normalizeDistribution(LEGACY_FIVE_BUCKET_ROW)).toEqual([3, 4, 5, 6, 7, 0]);
  });

  it("leaves a well-formed row alone", () => {
    expect(normalizeDistribution([1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("truncates anything longer than MAX_GUESSES", () => {
    expect(normalizeDistribution([1, 1, 1, 1, 1, 1, 1, 1])).toEqual([1, 1, 1, 1, 1, 1]);
  });

  // The column is jsonb; the TypeScript type is a claim about what we write,
  // not a guarantee about what is stored. drizzle/0005 really did default it to
  // `'{}'` (an object) before 0008 tidied those rows up, and a `.map` over one
  // throws inside a render rather than degrading.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an object (drizzle/0005's '{}' default)", {}],
    ["a string", "0,1,2"],
  ])("reads %s as all zeroes rather than throwing", (_label, stored) => {
    expect(normalizeDistribution(stored)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it.each([
    ["a negative count", [-1, 0, 0, 0, 0, 0]],
    ["a non-numeric bucket", ["4", 0, 0, 0, 0, 0]],
    ["a NaN bucket", [Number.NaN, 0, 0, 0, 0, 0]],
    ["a hole", [, 0, 0, 0, 0, 0]],
  ])("reads %s as 0 in that bucket only", (_label, stored) => {
    expect(normalizeDistribution(stored)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("mergeDistributions", () => {
  // THE §0.4 REGRESSION TEST. The pre-fix expression was
  // `server.map((count, i) => count + local[i])`, and `.map` preserves the
  // receiver's length -- so against a five-bucket server row this returned five
  // buckets and silently discarded the legacy player's 6-guess wins. Both
  // halves matter: the length AND the surviving count in the last bucket.
  it("keeps the 6-guess bucket when the server row has only five", () => {
    const server = [0, 0, 0, 0, 0];
    const local = [0, 0, 0, 0, 0, 4];

    const merged = mergeDistributions(server, local);

    expect(merged).toHaveLength(MAX_GUESSES);
    expect(merged[MAX_GUESSES - 1]).toBe(4);
    expect(merged).toEqual([0, 0, 0, 0, 0, 4]);
  });

  it("normalises a five-bucket server row's length while summing it", () => {
    expect(mergeDistributions(LEGACY_FIVE_BUCKET_ROW, [1, 1, 1, 1, 1, 1])).toEqual([
      4, 5, 6, 7, 8, 1,
    ]);
  });

  it("sums two well-formed rows index-wise", () => {
    expect(mergeDistributions([1, 0, 2, 0, 3, 0], [0, 4, 0, 5, 0, 6])).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it("is symmetric — neither side's length wins", () => {
    const short = [1, 2, 3, 4, 5];
    const full = [0, 0, 0, 0, 0, 9];
    expect(mergeDistributions(short, full)).toEqual(mergeDistributions(full, short));
  });

  it("treats a missing side as all zeroes", () => {
    expect(mergeDistributions([1, 2, 3, 4, 5, 6], null)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mergeDistributions(undefined, undefined)).toEqual(emptyDistribution());
  });

  it("does not mutate either input", () => {
    const server = [1, 1, 1, 1, 1, 1];
    const local = [2, 2, 2, 2, 2, 2];

    mergeDistributions(server, local);

    expect(server).toEqual([1, 1, 1, 1, 1, 1]);
    expect(local).toEqual([2, 2, 2, 2, 2, 2]);
  });
});
