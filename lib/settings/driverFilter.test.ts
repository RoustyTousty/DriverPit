// @vitest-environment jsdom
//
// The one file under lib/ that needs a DOM, and the docblock rather than a move
// into the dom project: what is under test is this module's storage behaviour,
// not a rendered component, and `.test.tsx` on a file containing no JSX would be
// a worse lie than a one-line environment override. The rest of the node tier
// stays pure.

import { beforeEach, describe, expect, it } from "vitest";

import { defaultDriverFilter, type DriverFilter } from "@/lib/game/driverFilter";

import { readDriverFilterPreference, writeDriverFilterPreference } from "./driverFilter";

const YEAR = 2026;

const CUSTOM_KEY = "f1dw:custom:driverFilter";
const INFINITE_KEY = "f1dw:infinite:driverFilter";
const LEGACY_KEY = "f1dw:infinite:poolWindow";

function filter(overrides: Partial<DriverFilter> = {}): DriverFilter {
  return { ...defaultDriverFilter(YEAR), ...overrides };
}

describe("driver filter preference", () => {
  beforeEach(() => localStorage.clear());

  it("returns the 20-season default when nothing is stored", () => {
    expect(readDriverFilterPreference("custom", YEAR)).toEqual(defaultDriverFilter(YEAR));
    expect(readDriverFilterPreference("infinite", YEAR)).toEqual(defaultDriverFilter(YEAR));
  });

  it("round-trips what was written, per scope", () => {
    const ferrari = filter({ team: "Ferrari", fromYear: 1994, toYear: 1999 });
    writeDriverFilterPreference("custom", ferrari, YEAR);
    expect(readDriverFilterPreference("custom", YEAR)).toEqual(ferrari);
  });

  // THE POINT OF TWO SCOPES. Infinite's filter is a practice preference; a
  // custom lobby's is the shape of a game you are about to host for someone
  // else. One shared key would mean narrowing Infinite to Ferrari silently
  // re-pooling the next game you invite a friend to -- a change nobody made and
  // nobody would connect to what they did.
  it("keeps the two scopes independent", () => {
    writeDriverFilterPreference("infinite", filter({ nationality: "Italy" }), YEAR);

    expect(readDriverFilterPreference("custom", YEAR)).toEqual(defaultDriverFilter(YEAR));
    expect(localStorage.getItem(CUSTOM_KEY)).toBeNull();
    expect(localStorage.getItem(INFINITE_KEY)).not.toBeNull();
  });

  it("does not let one scope overwrite the other", () => {
    const italians = filter({ nationality: "Italy" });
    const brazilians = filter({ nationality: "Brazil" });
    writeDriverFilterPreference("infinite", italians, YEAR);
    writeDriverFilterPreference("custom", brazilians, YEAR);

    expect(readDriverFilterPreference("infinite", YEAR).nationality).toBe("Italy");
    expect(readDriverFilterPreference("custom", YEAR).nationality).toBe("Brazil");
  });

  // A stored value is one a player can edit by hand, and its SHAPE changes when
  // lib/game/driverFilter.ts does. Neither is a reason for a mode not to start.
  it.each(["not json at all", '{"poolWindow":"10-years"}', "null", '{"fromYear":"x","toYear":2000}'])(
    "falls back to the default on unusable stored data: %s",
    (raw) => {
      localStorage.setItem(CUSTOM_KEY, raw);
      expect(readDriverFilterPreference("custom", YEAR)).toEqual(defaultDriverFilter(YEAR));
    },
  );

  // Re-clamped on READ, not only on write: a filter stored last year ends at a
  // ceiling that is no longer the current season.
  it("clamps a stored filter into this year's seasons", () => {
    localStorage.setItem(
      CUSTOM_KEY,
      JSON.stringify({ fromYear: 1900, toYear: 3000, nationality: null, team: null, achievement: "any" }),
    );
    const read = readDriverFilterPreference("custom", YEAR);
    expect(read.fromYear).toBe(1950);
    expect(read.toYear).toBe(YEAR);
  });

  // The legacy sweep belongs to the scope that had the legacy key. Clearing it
  // from the custom scope would be a write to a value custom never owned.
  it("sweeps the legacy pool-window key only from the infinite scope", () => {
    localStorage.setItem(LEGACY_KEY, "10-years");
    writeDriverFilterPreference("custom", filter(), YEAR);
    expect(localStorage.getItem(LEGACY_KEY)).toBe("10-years");

    writeDriverFilterPreference("infinite", filter(), YEAR);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
