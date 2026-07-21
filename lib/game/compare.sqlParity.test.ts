import "dotenv/config";

import { inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "../db";
import { drivers } from "../db/schema";
import { compare, type Driver } from "./compare";

// Parity check for drizzle/0022_duel_submit_guess_rpc.sql#compare_drivers --
// the SQL port of lib/game/compare.ts#compare() that duel_submit_guess uses
// so a guess can be evaluated in one warm hop (CLAUDE.md's "Instant
// guesses"), with no Vercel function in the path. compare.ts stays the
// single source of truth for the *rules*; this proves the SQL port hasn't
// drifted from it, using the exact same fixture values as compare.test.ts
// (deceased-driver ages, historical team, closeness falloff, etc.) run
// through both paths against real inserted driver rows.
//
// Requires a real Postgres connection -- skipped by default so `npm test`
// stays instant/offline, opt in with:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/game/compare.sqlParity.test.ts
// Every driver row this test inserts is deleted in afterAll.
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

const TODAY = new Date("2026-07-17T00:00:00Z");

const baseDriver: Driver = {
  nationality: "Netherlands",
  team: "Red Bull",
  previousTeams: ["Red Bull", "Toro Rosso"],
  dateOfBirth: "1997-09-30",
  dateOfDeath: null,
  debutYear: 2015,
  careerWins: 60,
};

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return { ...baseDriver, ...overrides };
}

interface SqlCompareRow extends Record<string, unknown> {
  nationality: string;
  team: string;
  age: string;
  age_closeness: string | null;
  debut_year: string;
  debut_year_closeness: string | null;
  career_wins: string;
  career_wins_closeness: string | null;
}

describe.skipIf(!RUN)("compare_drivers SQL parity with compare.ts (integration)", () => {
  const createdIds: number[] = [];
  let fixtureCounter = 0;

  afterAll(async () => {
    if (createdIds.length === 0) return;
    await db.delete(drivers).where(inArray(drivers.id, createdIds));
  });

  async function insertDriver(driver: Driver): Promise<number> {
    fixtureCounter += 1;
    const [row] = await db
      .insert(drivers)
      .values({
        fullName: `SQL parity fixture ${fixtureCounter}`,
        nationality: driver.nationality,
        lastTeam: driver.team,
        previousTeams: driver.previousTeams,
        dateOfBirth: driver.dateOfBirth,
        dateOfDeath: driver.dateOfDeath,
        debutYear: driver.debutYear,
        careerWins: driver.careerWins,
        // Unused by compare_drivers -- last_active_year drives pool
        // membership (lib/game/poolWindow.ts), not comparison.
        lastActiveYear: driver.debutYear,
      })
      .returning({ id: drivers.id });
    createdIds.push(row.id);
    return row.id;
  }

  // db.execute() goes over the raw postgres.js connection, not PostgREST --
  // that connection's `numeric` columns come back as strings (verified
  // directly before writing this), unlike a supabase.rpc() call, which
  // JSON-encodes numeric as a real number. Number()-parse before comparing.
  function expectCloseness(sqlValue: string | null, tsValue: number | undefined) {
    if (tsValue === undefined) {
      expect(sqlValue).toBeNull();
    } else {
      expect(sqlValue).not.toBeNull();
      expect(Number(sqlValue)).toBeCloseTo(tsValue, 10);
    }
  }

  async function assertParity(guess: Driver, target: Driver, asOf: Date) {
    const tsResult = compare(guess, target, asOf);

    const [guessId, targetId] = await Promise.all([insertDriver(guess), insertDriver(target)]);
    const rows = await db.execute<SqlCompareRow>(
      sql`SELECT * FROM public.compare_drivers(${guessId}, ${targetId}, ${asOf.toISOString()}::timestamptz)`,
    );
    const sqlRow = rows[0];

    expect(sqlRow.nationality).toBe(tsResult.nationality);
    expect(sqlRow.team).toBe(tsResult.team);
    expect(sqlRow.age).toBe(tsResult.age);
    expectCloseness(sqlRow.age_closeness, tsResult.ageCloseness);
    expect(sqlRow.debut_year).toBe(tsResult.debutYear);
    expectCloseness(sqlRow.debut_year_closeness, tsResult.debutYearCloseness);
    expect(sqlRow.career_wins).toBe(tsResult.careerWins);
    expectCloseness(sqlRow.career_wins_closeness, tsResult.careerWinsCloseness);
  }

  it("guessing the target itself: exact/correct on all five attributes", async () => {
    await assertParity(makeDriver(), makeDriver(), TODAY);
  });

  it("all-miss: every attribute misses, with matching closeness values", async () => {
    const guess = makeDriver({
      nationality: "Spain",
      team: "Ferrari",
      previousTeams: ["Ferrari"],
      dateOfBirth: "1981-07-29",
      debutYear: 2001,
      careerWins: 32,
    });
    const target = makeDriver({
      nationality: "Germany",
      team: "Mercedes",
      previousTeams: ["Mercedes"],
      dateOfBirth: "1985-01-06",
      debutYear: 2007,
      careerWins: 53,
    });
    await assertParity(guess, target, TODAY);
  });

  it("team: exact match on the target's current team", async () => {
    const target = makeDriver({ team: "Mercedes", previousTeams: ["Mercedes", "McLaren"] });
    const guess = makeDriver({ team: "Mercedes" });
    await assertParity(guess, target, TODAY);
  });

  it("team: historical -- not current, but in the target's history", async () => {
    const target = makeDriver({ team: "Mercedes", previousTeams: ["Mercedes", "McLaren"] });
    const guess = makeDriver({ team: "McLaren" });
    await assertParity(guess, target, TODAY);
  });

  it("team: miss -- no relation to the target's team history", async () => {
    const target = makeDriver({ team: "Mercedes", previousTeams: ["Mercedes", "McLaren"] });
    const guess = makeDriver({ team: "Ferrari" });
    await assertParity(guess, target, TODAY);
  });

  it("closeness: near-miss approaches 1", async () => {
    await assertParity(makeDriver({ careerWins: 59 }), makeDriver({ careerWins: 60 }), TODAY);
  });

  it("closeness: clamped at 0 for a wildly-off guess", async () => {
    await assertParity(makeDriver({ careerWins: 0 }), makeDriver({ careerWins: 105 }), TODAY);
  });

  it("closeness: squared falloff (moderate miss reads well under half-bright)", async () => {
    await assertParity(makeDriver({ debutYear: 2000 }), makeDriver({ debutYear: 2010 }), TODAY);
  });

  it("higher/lower: debutYear in both directions", async () => {
    await assertParity(makeDriver({ debutYear: 2001 }), makeDriver({ debutYear: 2015 }), TODAY);
    await assertParity(makeDriver({ debutYear: 2015 }), makeDriver({ debutYear: 2001 }), TODAY);
  });

  it("higher/lower: careerWins in both directions", async () => {
    await assertParity(makeDriver({ careerWins: 10 }), makeDriver({ careerWins: 60 }), TODAY);
    await assertParity(makeDriver({ careerWins: 60 }), makeDriver({ careerWins: 10 }), TODAY);
  });

  it("higher/lower: age in both directions", async () => {
    await assertParity(makeDriver({ dateOfBirth: "2000-01-01" }), makeDriver({ dateOfBirth: "1990-01-01" }), TODAY);
    await assertParity(makeDriver({ dateOfBirth: "1990-01-01" }), makeDriver({ dateOfBirth: "2000-01-01" }), TODAY);
  });

  it("0 wins: both zero, guess zero vs target some, target zero vs guess some", async () => {
    await assertParity(makeDriver({ careerWins: 0 }), makeDriver({ careerWins: 0 }), TODAY);
    await assertParity(makeDriver({ careerWins: 0 }), makeDriver({ careerWins: 5 }), TODAY);
    await assertParity(makeDriver({ careerWins: 5 }), makeDriver({ careerWins: 0 }), TODAY);
  });

  it("deceased target: age at death used, higher than a living guess's current age", async () => {
    const target = makeDriver({ dateOfBirth: "1936-01-01", dateOfDeath: "2020-01-01" });
    const guess = makeDriver({ dateOfBirth: "1997-09-30", dateOfDeath: null });
    await assertParity(guess, target, TODAY);
  });

  it("deceased target: age at death used even when lower than the living guess's age", async () => {
    const target = makeDriver({ dateOfBirth: "1990-01-01", dateOfDeath: "1995-01-01" });
    const guess = makeDriver({ dateOfBirth: "1997-09-30", dateOfDeath: null });
    await assertParity(guess, target, TODAY);
  });

  it("both guess and target deceased: compares age at death correctly", async () => {
    const guess = makeDriver({ dateOfBirth: "1936-01-01", dateOfDeath: "1970-01-01" });
    const target = makeDriver({ dateOfBirth: "1930-01-01", dateOfDeath: "1980-01-01" });
    await assertParity(guess, target, TODAY);
  });
});
