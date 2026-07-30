// ISO 3166-1 alpha-2 codes, keyed by the exact `drivers.nationality` strings
// this app's data actually contains (F1DB country names -- pulled from the
// live dataset, not a generic ISO country-name list, so this is complete
// for every driver in the roster without over- or under-covering it).
//
// Not emoji: Windows renders regional-indicator flag emoji as two bare
// letters instead of an actual flag glyph (Segoe UI Emoji has no flag
// coverage on most Windows builds) -- unusable cross-platform. Codes here
// back real flag icons instead (see components/ui/Flag.tsx, `flag-icons`).
//
// Whether this map still COVERS the roster is a question about the data, so it
// is asked of the database rather than of a copy of this list: see
// lib/db/driversRosterIntegrity.test.ts -> "nationality coverage" (database CI
// tier). flags.test.ts pins the map's shape, which is all that can be checked
// without a database -- hence the export, which is the spec side of that check
// and not an app-facing accessor. App code calls `countryCode`.
export const COUNTRY_CODES: Record<string, string> = {
  Argentina: "ar",
  Australia: "au",
  Austria: "at",
  Belgium: "be",
  Brazil: "br",
  Canada: "ca",
  Chile: "cl",
  China: "cn",
  Colombia: "co",
  Czechia: "cz",
  Denmark: "dk",
  Finland: "fi",
  France: "fr",
  Germany: "de",
  Hungary: "hu",
  India: "in",
  Indonesia: "id",
  Ireland: "ie",
  Italy: "it",
  Japan: "jp",
  Liechtenstein: "li",
  Malaysia: "my",
  Mexico: "mx",
  Monaco: "mc",
  Morocco: "ma",
  Netherlands: "nl",
  "New Zealand": "nz",
  Poland: "pl",
  Portugal: "pt",
  Russia: "ru",
  "South Africa": "za",
  Spain: "es",
  Sweden: "se",
  Switzerland: "ch",
  Thailand: "th",
  "United Kingdom": "gb",
  "United States of America": "us",
  Uruguay: "uy",
  Venezuela: "ve",
  Zimbabwe: "zw",
};

// Null for anything unmapped (e.g. new nationalities added to the roster
// before this table is updated, or an F1DB slug left by a seed lookup miss --
// see scripts/releaseGuards.ts §5.2b) so callers can fall back to plain text
// instead of rendering a broken flag.
//
// `hasOwn` rather than a bare index: on an object literal, `COUNTRY_CODES.
// constructor` inherits from Object.prototype, so a nationality named after a
// prototype member would return a function past a `?? null` and break the
// `string | null` this signature promises.
export function countryCode(nationality: string): string | null {
  return Object.hasOwn(COUNTRY_CODES, nationality)
    ? COUNTRY_CODES[nationality]
    : null;
}
