import { describe, expect, it } from "vitest";

import {
  assertColumns,
  assertLookupsResolved,
  assertRosterSanity,
  describeLookupMisses,
  describeWriteMode,
  newLookupTally,
  resolveName,
  resolveRelease,
  resolveWriteMode,
  type SanityDriver,
} from "./releaseGuards";

// Audit 2026-07-29 §5.2. These run in the static CI tier -- the whole point of
// the finding is that the seed's loud failure became a silent one, and an
// untested loud check is not much better than none.

function driver(over: Partial<SanityDriver> = {}): SanityDriver {
  return {
    f1dbId: "someone",
    fullName: "Someone",
    careerWins: 0,
    debutYear: 2010,
    lastActiveYear: 2015,
    ...over,
  };
}

/** A roster that passes both canaries, for tests that break one of them. */
function healthyRoster(currentYear: number): SanityDriver[] {
  return [
    driver({ f1dbId: "lewis-hamilton", fullName: "Lewis Hamilton", careerWins: 105 }),
    driver({ f1dbId: "max-verstappen", fullName: "Max Verstappen", lastActiveYear: currentYear }),
  ];
}

describe("resolveWriteMode", () => {
  // The whole point of the inversion (audit 2026-07-29 §5.1 residual): the
  // accidental production seed happened because the flag that meant "be safe"
  // was the one the shell dropped. An empty argv now means the safe thing.
  it("does not write when told nothing at all", () => {
    expect(resolveWriteMode([])).toEqual({ commit: false });
  });

  // The exact shape of the accident, replayed: PowerShell drops the bare `--`,
  // npm eats `--dry-run` as its own config flag, the script sees []. Before the
  // inversion that committed 792 rows.
  it("does not write when the shell has eaten --dry-run", () => {
    const asPowerShellDeliversIt: string[] = [];
    expect(resolveWriteMode(asPowerShellDeliversIt).commit).toBe(false);
  });

  it("writes only when --commit is present", () => {
    expect(resolveWriteMode(["--commit"])).toEqual({ commit: true });
  });

  it("accepts --dry-run as an explicit spelling of the default", () => {
    expect(resolveWriteMode(["--dry-run"])).toEqual({ commit: false });
  });

  // Failing closed already makes a typo harmless; being loud about it is what
  // stops "the seed stopped working" being diagnosed three runs later.
  it("refuses an unrecognised argument rather than ignoring it", () => {
    expect(() => resolveWriteMode(["--commmit"])).toThrow(/Unrecognised argument/);
    expect(() => resolveWriteMode(["commit"])).toThrow(/Unrecognised argument/);
  });

  it("refuses both flags at once", () => {
    expect(() => resolveWriteMode(["--commit", "--dry-run"])).toThrow(
      /contradict each other/,
    );
  });

  it("names the mode unambiguously in the banner", () => {
    expect(describeWriteMode({ commit: false })).toMatch(/^Mode: DRY RUN/);
    expect(describeWriteMode({ commit: true })).toMatch(/^Mode: REAL WRITE/);
  });
});

describe("resolveRelease", () => {
  it("refuses to seed when the release is not chosen", () => {
    expect(() => resolveRelease({})).toThrow(/F1DB_RELEASE is not set/);
    expect(() => resolveRelease({ F1DB_RELEASE: "   " })).toThrow(/not set/);
  });

  it("builds a tag URL for a pinned release", () => {
    const resolved = resolveRelease({ F1DB_RELEASE: "v2026.11.0" });
    expect(resolved.pinned).toBe(true);
    expect(resolved.release).toBe("v2026.11.0");
    expect(resolved.url).toBe(
      "https://github.com/f1db/f1db/releases/download/v2026.11.0/f1db-csv.zip",
    );
  });

  // `latest` stays available -- the finding is that it must be typed, not that
  // it must be unavailable.
  it("allows latest as an explicit opt-in, and marks it unpinned", () => {
    const resolved = resolveRelease({ F1DB_RELEASE: "latest" });
    expect(resolved.pinned).toBe(false);
    expect(resolved.url).toContain("/releases/latest/download/");
  });

  it("rejects a tag that could rewrite the URL path", () => {
    expect(() => resolveRelease({ F1DB_RELEASE: "../../evil" })).toThrow(
      /not a valid release tag/,
    );
  });
});

describe("assertColumns", () => {
  const row = {
    driverId: "x",
    year: "2024",
    round: "1",
    positionText: "1",
    positionNumber: "1",
    constructorId: "y",
  };

  it("passes when every column the seed reads is present", () => {
    expect(() =>
      assertColumns("f1db-races-race-results.csv", [row]),
    ).not.toThrow();
  });

  // The three silent modes the audit tabulates, each of which otherwise reads
  // `undefined` off the row and turns it into plausible-looking data.
  it.each(["positionText", "positionNumber", "round"])(
    "throws when %s is renamed upstream",
    (column) => {
      const renamed: Record<string, string> = { ...row };
      delete renamed[column];
      renamed[`${column}Renamed`] = "1";

      expect(() =>
        assertColumns("f1db-races-race-results.csv", [renamed]),
      ).toThrow(new RegExp(`missing column\\(s\\).*${column}`));
    },
  );

  it("throws on an empty file rather than silently importing nothing", () => {
    expect(() => assertColumns("f1db-drivers.csv", [])).toThrow(/0 rows/);
  });

  // Extra columns are how F1DB grows; only what the seed reads is required.
  it("ignores columns the seed does not read", () => {
    expect(() =>
      assertColumns("f1db-races-race-results.csv", [{ ...row, somethingNew: "" }]),
    ).not.toThrow();
  });
});

describe("assertRosterSanity", () => {
  const currentYear = 2026;

  it("passes a healthy roster", () => {
    expect(() =>
      assertRosterSanity(healthyRoster(currentYear), currentYear),
    ).not.toThrow();
  });

  // What a renamed `positionNumber` looks like after the parse: every header
  // still present, every win gone.
  it("catches a roster where nobody has any wins", () => {
    const roster = healthyRoster(currentYear).map((d) => ({ ...d, careerWins: 0 }));
    expect(() => assertRosterSanity(roster, currentYear)).toThrow(
      /lewis-hamilton to have >= 100 career wins, got 0/,
    );
  });

  it("catches a stale last active year", () => {
    const roster = healthyRoster(currentYear);
    roster[1] = { ...roster[1], lastActiveYear: 2019 };
    expect(() => assertRosterSanity(roster, currentYear)).toThrow(
      /last active year to be >= 2025, got 2019/,
    );
  });

  // A slug that vanished means the driver key scheme moved, and every join in
  // the seed rests on that key. Loud, not skipped.
  it("treats a missing canary as a failure, not a pass", () => {
    expect(() => assertRosterSanity([], currentYear)).toThrow(
      /no such driver in the release/,
    );
  });

  // The seed legitimately runs in January, before the new season has started.
  it("allows the canary to be one season stale", () => {
    const roster = healthyRoster(currentYear);
    roster[1] = { ...roster[1], lastActiveYear: currentYear - 1 };
    expect(() => assertRosterSanity(roster, currentYear)).not.toThrow();
  });
});

// Audit 2026-07-29 §5.2b. The seed's `?? id` fallbacks were silent, so a roster
// could hold "united-states-of-america" beside "United States of America" -- and
// compare_drivers compares nationality and team by string equality, so those two
// report a MISS against each other despite being the same country.
describe("reference-table lookups", () => {
  const countries = new Map([
    ["united-states-of-america", "United States of America"],
    ["italy", "Italy"],
  ]);

  function tally() {
    return newLookupTally("nationality", "f1db-countries.csv");
  }

  describe("resolveName", () => {
    it("returns the name and records no miss when the id resolves", () => {
      const t = tally();
      expect(resolveName(t, countries, "italy")).toBe("Italy");
      expect(t.referenced).toEqual(new Set(["italy"]));
      expect(t.misses.size).toBe(0);
    });

    // The fallback is kept deliberately -- one bad id must not cost the other
    // 791 drivers their refreshed wins and teams. It just stops being silent.
    it("falls back to the raw id and counts the miss", () => {
      const t = tally();
      expect(resolveName(t, countries, "atlantis")).toBe("atlantis");
      expect(t.misses.get("atlantis")).toBe(1);
    });

    it("counts each failed lookup of the same id", () => {
      const t = tally();
      resolveName(t, countries, "atlantis");
      resolveName(t, countries, "atlantis");
      resolveName(t, countries, "elbonia");
      expect(t.misses.get("atlantis")).toBe(2);
      expect(t.misses.size).toBe(2);
      expect(t.referenced.size).toBe(2);
    });

    // `drivers.nationality` is NOT NULL, so a blank name would import as an
    // empty string -- strictly worse than the id it replaced.
    it("treats a blank name as a miss", () => {
      const blank = new Map([["nowhere", "   "]]);
      const t = tally();
      expect(resolveName(t, blank, "nowhere")).toBe("nowhere");
      expect(t.misses.get("nowhere")).toBe(1);
    });

    // A resolved name is stored byte-for-byte: trimming here would rewrite 792
    // live rows as a side effect of a guard.
    it("does not alter a name that resolves", () => {
      const padded = new Map([["x", " Spaced Name "]]);
      const t = tally();
      expect(resolveName(t, padded, "x")).toBe(" Spaced Name ");
      expect(t.misses.size).toBe(0);
    });
  });

  describe("describeLookupMisses", () => {
    // The healthy case, measured against v2026.11.0: 40 country ids and 176
    // constructor ids, zero misses. The report has to cost nothing then.
    it("says nothing when everything resolved", () => {
      const t = tally();
      resolveName(t, countries, "italy");
      expect(describeLookupMisses([t], 10)).toEqual([]);
    });

    it("names the unresolved ids, worst first, and why it matters", () => {
      const t = tally();
      resolveName(t, countries, "italy");
      resolveName(t, countries, "elbonia");
      resolveName(t, countries, "atlantis");
      resolveName(t, countries, "atlantis");

      const lines = describeLookupMisses([t], 10);
      expect(lines[0]).toContain("2 of 3 nationality id(s)");
      expect(lines[0]).toContain("3 failed lookup(s)");
      expect(lines[0]).toContain("string equality");
      expect(lines[1]).toContain('"atlantis" (2 lookup(s))');
      expect(lines[2]).toContain('"elbonia" (1 lookup(s))');
    });

    it("caps the list rather than printing hundreds of ids", () => {
      const t = tally();
      for (const id of ["a", "b", "c"]) resolveName(t, countries, id);
      const lines = describeLookupMisses([t], 2);
      expect(lines).toHaveLength(4); // summary + 2 ids + the "...and N more"
      expect(lines[3]).toContain("...and 1 more");
    });
  });

  describe("assertLookupsResolved", () => {
    it("passes when at least one id resolved", () => {
      const t = tally();
      resolveName(t, countries, "italy");
      resolveName(t, countries, "atlantis");
      expect(() => assertLookupsResolved([t])).not.toThrow();
    });

    // What a moved id space looks like after the parse: every header present,
    // every row present, every name a slug. MIN_ROSTER_RATIO and the header
    // assertion both miss this by construction.
    it("throws when the whole join resolved nothing", () => {
      const t = tally();
      for (const id of ["usa", "ita"]) resolveName(t, countries, id);
      expect(() => assertLookupsResolved([t])).toThrow(
        /not one of the 2 nationality id\(s\)[\s\S]*id space moved/,
      );
    });

    it("ignores a lookup that was never used", () => {
      expect(() => assertLookupsResolved([tally()])).not.toThrow();
    });
  });
});
