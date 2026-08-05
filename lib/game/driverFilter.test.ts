import { describe, expect, it } from "vitest";

import {
  clampDriverFilter,
  defaultDriverFilter,
  describeDriverFilter,
  FIRST_SEASON,
  isDefaultDriverFilter,
  matchesDriverFilter,
  parseDriverFilter,
  type DriverFilter,
  type FilterableDriver,
} from "./driverFilter";

// The TypeScript half of the Infinite filter. The SQL half lives in
// infinite_start_round (drizzle/0053) and is pinned against these same rules by
// lib/db/infiniteFilter.sqlParity.test.ts -- the two must agree or the mode
// serves a target the board will not autocomplete.

const YEAR = 2026;

function driver(overrides: Partial<FilterableDriver> = {}): FilterableDriver {
  return {
    debutYear: 2015,
    lastActiveYear: 2026,
    nationality: "United Kingdom",
    teams: ["McLaren"],
    careerWins: 0,
    championshipWins: 0,
    podiums: 0,
    polePositions: 0,
    ...overrides,
  };
}

function filter(overrides: Partial<DriverFilter> = {}): DriverFilter {
  return { ...defaultDriverFilter(YEAR), fromYear: FIRST_SEASON, toYear: YEAR, ...overrides };
}

describe("defaultDriverFilter", () => {
  it("opens on the same 20-season span daily and duel use", () => {
    expect(defaultDriverFilter(2026)).toEqual({
      fromYear: 2006,
      toYear: 2026,
      nationality: null,
      team: null,
      achievement: "any",
    });
  });

  it("never proposes a season before the championship existed", () => {
    expect(defaultDriverFilter(1960).fromYear).toBe(FIRST_SEASON);
  });
});

// The year test is the one with a real chance of being written wrong, and the
// wrong version looks right: `last_active_year BETWEEN from AND to` drops
// everyone who was still racing after the span, which for "the 1990s" is most
// of the grid.
describe("matchesDriverFilter — the season span", () => {
  const nineties = filter({ fromYear: 1990, toYear: 1999 });

  it("includes a career that sits inside the span", () => {
    expect(matchesDriverFilter(driver({ debutYear: 1992, lastActiveYear: 1996 }), nineties)).toBe(true);
  });

  it("includes a career that started before it and continued into it", () => {
    expect(matchesDriverFilter(driver({ debutYear: 1984, lastActiveYear: 1993 }), nineties)).toBe(true);
  });

  it("includes a career that started inside it and continued past it", () => {
    // Schumacher's shape: 1991 debut, racing well past 1999. A "last active
    // year in range" test would wrongly drop him from the 90s.
    expect(matchesDriverFilter(driver({ debutYear: 1991, lastActiveYear: 2012 }), nineties)).toBe(true);
  });

  it("includes a career that spans it completely", () => {
    expect(matchesDriverFilter(driver({ debutYear: 1980, lastActiveYear: 2005 }), nineties)).toBe(true);
  });

  it("excludes a career that ended before it", () => {
    expect(matchesDriverFilter(driver({ debutYear: 1975, lastActiveYear: 1989 }), nineties)).toBe(false);
  });

  it("excludes a career that started after it", () => {
    expect(matchesDriverFilter(driver({ debutYear: 2000, lastActiveYear: 2010 }), nineties)).toBe(false);
  });

  it("matches a single-season span on the boundary at both ends", () => {
    const one = filter({ fromYear: 1994, toYear: 1994 });
    expect(matchesDriverFilter(driver({ debutYear: 1994, lastActiveYear: 1994 }), one)).toBe(true);
    expect(matchesDriverFilter(driver({ debutYear: 1990, lastActiveYear: 1994 }), one)).toBe(true);
    expect(matchesDriverFilter(driver({ debutYear: 1994, lastActiveYear: 1999 }), one)).toBe(true);
    expect(matchesDriverFilter(driver({ debutYear: 1995, lastActiveYear: 1999 }), one)).toBe(false);
  });
});

describe("matchesDriverFilter — nationality, team, achievement", () => {
  it("matches a nationality exactly, and passes everyone when unset", () => {
    const british = filter({ nationality: "United Kingdom" });
    expect(matchesDriverFilter(driver({ nationality: "United Kingdom" }), british)).toBe(true);
    expect(matchesDriverFilter(driver({ nationality: "Germany" }), british)).toBe(false);
    expect(matchesDriverFilter(driver({ nationality: "Germany" }), filter())).toBe(true);
  });

  it("matches a team the driver raced for at ANY point, not just their last", () => {
    // The whole reason the filter reads `previous_teams`: "Ferrari drivers"
    // means everyone who ever drove one, not everyone who finished there.
    const ferrari = filter({ team: "Ferrari" });
    expect(matchesDriverFilter(driver({ teams: ["Mercedes", "Ferrari"] }), ferrari)).toBe(true);
    expect(matchesDriverFilter(driver({ teams: ["Ferrari"] }), ferrari)).toBe(true);
    expect(matchesDriverFilter(driver({ teams: ["McLaren", "Williams"] }), ferrari)).toBe(false);
    expect(matchesDriverFilter(driver({ teams: [] }), ferrari)).toBe(false);
  });

  it("reads each achievement tier off its own column", () => {
    const champion = driver({ careerWins: 3, championshipWins: 1, podiums: 20, polePositions: 5 });
    const winner = driver({ careerWins: 2, championshipWins: 0, podiums: 9, polePositions: 0 });
    const podiumOnly = driver({ careerWins: 0, championshipWins: 0, podiums: 4, polePositions: 0 });
    const poleOnly = driver({ careerWins: 0, championshipWins: 0, podiums: 0, polePositions: 1 });
    const nobody = driver();

    expect(matchesDriverFilter(champion, filter({ achievement: "champion" }))).toBe(true);
    expect(matchesDriverFilter(winner, filter({ achievement: "champion" }))).toBe(false);

    expect(matchesDriverFilter(winner, filter({ achievement: "race-winner" }))).toBe(true);
    expect(matchesDriverFilter(podiumOnly, filter({ achievement: "race-winner" }))).toBe(false);

    expect(matchesDriverFilter(podiumOnly, filter({ achievement: "podium" }))).toBe(true);
    expect(matchesDriverFilter(nobody, filter({ achievement: "podium" }))).toBe(false);

    // Deliberately independent of the podium/win ladder: a pole sitter who
    // never finished on the podium is a real career shape.
    expect(matchesDriverFilter(poleOnly, filter({ achievement: "pole" }))).toBe(true);
    expect(matchesDriverFilter(podiumOnly, filter({ achievement: "pole" }))).toBe(false);

    expect(matchesDriverFilter(nobody, filter({ achievement: "any" }))).toBe(true);
  });

  it("ANDs every criterion", () => {
    const narrow = filter({
      fromYear: 2000,
      toYear: 2010,
      nationality: "Germany",
      team: "Ferrari",
      achievement: "champion",
    });
    const match = driver({
      debutYear: 1991,
      lastActiveYear: 2012,
      nationality: "Germany",
      teams: ["Jordan", "Benetton", "Ferrari", "Mercedes"],
      careerWins: 91,
      championshipWins: 7,
      podiums: 155,
      polePositions: 68,
    });
    expect(matchesDriverFilter(match, narrow)).toBe(true);
    // One criterion off is enough to exclude, in each direction.
    expect(matchesDriverFilter({ ...match, nationality: "Austria" }, narrow)).toBe(false);
    expect(matchesDriverFilter({ ...match, teams: ["Benetton"] }, narrow)).toBe(false);
    expect(matchesDriverFilter({ ...match, championshipWins: 0 }, narrow)).toBe(false);
    expect(matchesDriverFilter({ ...match, debutYear: 2011, lastActiveYear: 2014 }, narrow)).toBe(false);
  });
});

describe("clampDriverFilter", () => {
  it("pulls years inside the seasons that exist", () => {
    const clamped = clampDriverFilter(filter({ fromYear: 1900, toYear: 3000 }), YEAR);
    expect(clamped.fromYear).toBe(FIRST_SEASON);
    expect(clamped.toYear).toBe(YEAR);
  });

  it("orders a reversed span rather than selecting nobody", () => {
    // Two independent slider thumbs can cross; `from > to` matches no driver at
    // all, which reads as a broken filter rather than as a mistake.
    const clamped = clampDriverFilter(filter({ fromYear: 2010, toYear: 1995 }), YEAR);
    expect(clamped.fromYear).toBe(1995);
    expect(clamped.toYear).toBe(2010);
  });

  it("rounds fractional years", () => {
    expect(clampDriverFilter(filter({ fromYear: 1994.6, toYear: 2000.2 }), YEAR)).toMatchObject({
      fromYear: 1995,
      toYear: 2000,
    });
  });

  it("leaves the other criteria alone", () => {
    const input = filter({ nationality: "Italy", team: "Ferrari", achievement: "pole" });
    expect(clampDriverFilter(input, YEAR)).toMatchObject({
      nationality: "Italy",
      team: "Ferrari",
      achievement: "pole",
    });
  });
});

describe("describeDriverFilter", () => {
  it("says All time rather than spelling out the full range", () => {
    expect(describeDriverFilter(filter(), YEAR)).toBe("All time");
  });

  it("shows a single season as one year", () => {
    expect(describeDriverFilter(filter({ fromYear: 1994, toYear: 1994 }), YEAR)).toBe("1994");
  });

  it("adds each active narrowing", () => {
    expect(
      describeDriverFilter(
        filter({ fromYear: 2000, toYear: 2010, nationality: "Germany", achievement: "champion" }),
        YEAR,
      ),
    ).toBe("2000–2010 · Germany · World champions");
  });

  it("names the team when one is picked", () => {
    expect(describeDriverFilter(filter({ team: "Ferrari" }), YEAR)).toBe("All time · Ferrari");
  });
});

describe("isDefaultDriverFilter", () => {
  it("recognises the untouched filter", () => {
    expect(isDefaultDriverFilter(defaultDriverFilter(YEAR), YEAR)).toBe(true);
  });

  it("rejects one with any criterion changed", () => {
    const base = defaultDriverFilter(YEAR);
    expect(isDefaultDriverFilter({ ...base, fromYear: 1990 }, YEAR)).toBe(false);
    expect(isDefaultDriverFilter({ ...base, nationality: "Italy" }, YEAR)).toBe(false);
    expect(isDefaultDriverFilter({ ...base, achievement: "champion" }, YEAR)).toBe(false);
  });
});

describe("parseDriverFilter", () => {
  it("round-trips a filter it wrote", () => {
    const input = filter({ fromYear: 1990, toYear: 1999, nationality: "Brazil", achievement: "champion" });
    expect(parseDriverFilter(JSON.parse(JSON.stringify(input)), YEAR)).toEqual(input);
  });

  it("clamps what it accepts, so storage cannot smuggle an impossible span", () => {
    expect(
      parseDriverFilter({ fromYear: 3000, toYear: 1800, nationality: null, team: null, achievement: "any" }, YEAR),
    ).toMatchObject({ fromYear: FIRST_SEASON, toYear: YEAR });
  });

  it("treats an empty string as no criterion", () => {
    expect(
      parseDriverFilter({ fromYear: 2000, toYear: 2010, nationality: "  ", team: "", achievement: "any" }, YEAR),
    ).toMatchObject({ nationality: null, team: null });
  });

  it("rejects anything that is not a filter", () => {
    for (const bad of [
      null,
      undefined,
      "20-years", // what the OLD preference stored, which must read as "none"
      42,
      {},
      { fromYear: 2000, toYear: 2010, achievement: "nope" },
      { fromYear: "2000", toYear: 2010, achievement: "any" },
      { fromYear: 2000, toYear: 2010, achievement: "any", nationality: 7 },
      { fromYear: Number.NaN, toYear: 2010, achievement: "any" },
    ]) {
      expect(parseDriverFilter(bad, YEAR)).toBeNull();
    }
  });
});
