import { describe, expect, it } from "vitest";

import { fuzzyFilter } from "./fuzzyMatch";

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

describe("fuzzyFilter", () => {
  it("returns all items (up to the limit) for an empty query", () => {
    expect(fuzzyFilter("", DRIVERS, (d) => d, 8)).toEqual(DRIVERS);
  });

  it("matches a contiguous substring case-insensitively", () => {
    const results = fuzzyFilter("verstappen", DRIVERS, (d) => d);
    expect(results).toEqual(["Max Verstappen"]);
  });

  it("matches on a substring anywhere in the string, not just the start", () => {
    const results = fuzzyFilter("hamilton", DRIVERS, (d) => d);
    expect(results).toEqual(["Lewis Hamilton"]);
  });

  it("ranks a match starting earlier in the string above one starting later", () => {
    const results = fuzzyFilter("le", ["xxle", "lexxx"], (d) => d);
    expect(results[0]).toBe("lexxx");
  });

  it("falls back to a typo-tolerant subsequence match", () => {
    const results = fuzzyFilter("vrstpn", DRIVERS, (d) => d);
    expect(results).toContain("Max Verstappen");
  });

  it("excludes items where the query characters are out of order", () => {
    const results = fuzzyFilter("nosalo", DRIVERS, (d) => d); // reversed "alonso"-ish, out of order
    expect(results).not.toContain("Fernando Alonso");
  });

  it("returns no results when nothing matches", () => {
    expect(fuzzyFilter("zzzzz", DRIVERS, (d) => d)).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const results = fuzzyFilter("a", DRIVERS, (d) => d, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("prefers a contiguous substring match over a scattered subsequence match", () => {
    // "sainz" is a contiguous substring of the first item, but only appears
    // as a scattered subsequence (s...a...i...n...z) in the second.
    const items = ["extra sainz stuff", "sam ainzley"];
    const results = fuzzyFilter("sainz", items, (d) => d);
    expect(results[0]).toBe("extra sainz stuff");
  });
});
