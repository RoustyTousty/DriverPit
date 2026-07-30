import { describe, expect, it } from "vitest";

import { COUNTRY_CODES, countryCode } from "./flags";

// Audit 2026-07-29 §5.2c. This file used to hold a hand-copied duplicate of
// COUNTRY_CODES' 40 keys and assert that each one resolved -- true by
// construction, and blind to the only thing worth knowing: whether the map
// still covers the nationalities the roster actually contains. A comment
// claimed the list was "pulled live from the DB", which described a one-time
// manual extraction rather than anything the test did.
//
// "Does the map cover the data?" is a question about the data, so it moved to
// the database tier, where it is asked of `SELECT DISTINCT nationality FROM
// drivers`: lib/db/driversRosterIntegrity.test.ts -> "nationality coverage".
//
// What stays here is what can be checked without a database -- the shape of the
// map, and the contract of the accessor.

describe("COUNTRY_CODES", () => {
  it("holds a lowercase 2-letter ISO code for every nationality it maps", () => {
    const entries = Object.entries(COUNTRY_CODES);
    expect(entries.length).toBeGreaterThan(0);

    for (const [nationality, code] of entries) {
      // `flag-icons` keys off `fi-<code>`, so a typo like "gbr" or "GB" renders
      // no icon at all rather than failing -- exactly the silent degradation
      // the "Show flags" setting must not have.
      expect(code, `code for "${nationality}"`).toMatch(/^[a-z]{2}$/);
      // The key is matched against `drivers.nationality` by string equality, so
      // stray whitespace is an entry that can never be hit.
      expect(nationality, "nationality key").toBe(nationality.trim());
      expect(nationality).not.toBe("");
    }
  });

  // Two names for one country is the namespace split §5.2c warns about, caught
  // at its source. `compare_drivers` compares nationality by string equality,
  // so two drivers holding different spellings of the same country report a
  // MISS against each other however well both spellings render a flag.
  it("does not map two nationality strings onto the same country", () => {
    const namesByCode = new Map<string, string[]>();
    for (const [nationality, code] of Object.entries(COUNTRY_CODES)) {
      namesByCode.set(code, [...(namesByCode.get(code) ?? []), nationality]);
    }

    const split = [...namesByCode.entries()].filter(
      ([, names]) => names.length > 1,
    );
    expect(split, "one country under two nationality strings").toEqual([]);
  });
});

describe("countryCode", () => {
  it("resolves a mapped nationality", () => {
    expect(countryCode("United Kingdom")).toBe("gb");
    expect(countryCode("United States of America")).toBe("us");
  });

  it("returns null for an unmapped or empty string instead of throwing", () => {
    expect(countryCode("Atlantis")).toBeNull();
    expect(countryCode("")).toBeNull();
  });

  // The exact shape a seed lookup miss leaves in the column (§5.2b), and the
  // reason a slug nationality is not merely a missing flag.
  it("returns null for an F1DB slug rather than a country name", () => {
    expect(countryCode("united-states-of-america")).toBeNull();
  });

  // A bare index into an object literal reaches Object.prototype, so these
  // would return functions past a `?? null` and break the return type.
  it("returns null for a prototype member name", () => {
    expect(countryCode("constructor")).toBeNull();
    expect(countryCode("toString")).toBeNull();
    expect(countryCode("__proto__")).toBeNull();
  });
});
