import { describe, expect, it } from "vitest";

import { countryCode } from "./flags";

// Exact nationality strings currently in the seeded drivers table (pulled
// live from the DB, not guessed) -- every one of these must resolve to a
// real flag, or the "Show flags" setting silently degrades to blank tiles
// for whichever countries were missed.
const KNOWN_NATIONALITIES = [
  "Argentina",
  "Australia",
  "Austria",
  "Belgium",
  "Brazil",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Czechia",
  "Denmark",
  "Finland",
  "France",
  "Germany",
  "Hungary",
  "India",
  "Indonesia",
  "Ireland",
  "Italy",
  "Japan",
  "Liechtenstein",
  "Malaysia",
  "Mexico",
  "Monaco",
  "Morocco",
  "Netherlands",
  "New Zealand",
  "Poland",
  "Portugal",
  "Russia",
  "South Africa",
  "Spain",
  "Sweden",
  "Switzerland",
  "Thailand",
  "United Kingdom",
  "United States of America",
  "Uruguay",
  "Venezuela",
  "Zimbabwe",
];

describe("countryCode", () => {
  it("maps every nationality currently in the driver roster to a 2-letter ISO code", () => {
    for (const nationality of KNOWN_NATIONALITIES) {
      const code = countryCode(nationality);
      expect(code, `expected a code for "${nationality}"`).not.toBeNull();
      expect(code).toMatch(/^[a-z]{2}$/);
    }
  });

  it("returns null for an unmapped or empty string instead of throwing", () => {
    expect(countryCode("Atlantis")).toBeNull();
    expect(countryCode("")).toBeNull();
  });
});
