import "dotenv/config";

import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../db";
import { drivers } from "../db/schema";
import { compare, type Driver } from "./compare";
import { guessHeat, proximityPoints, speedPoints } from "./duelScoring";

// The parity suite audit 2026-07-27 §2.5 flags as MISSING ENTIRELY: "There is
// no duelScoring.sqlParity.test.ts at all."
//
// compare.ts had one; duelScoring.ts did not, and it is the more dangerous of
// the two, because BOTH SIDES ARE LIVE AT ONCE. The TypeScript drives the
// tug-of-war bar the player watches (guessHeat -> the opponent feed,
// proximityPoints/speedPoints -> the provisional score); the SQL inside
// duel_submit_guess / duel_close_round writes the authoritative result. If the
// five 15-point weights, the 8-point historical weight, the 75 ceiling, or the
// 100/900 speed curve drift apart, the bar does not merely look wrong -- it
// tells the player they are winning a round they are losing.
//
// HOW THIS PINS THE LIVE DEFINITION RATHER THAN A COPY. The obvious version of
// this test -- paste the SQL expression in and check TS agrees with it -- pins
// TypeScript against a transcription, and a future migration could change the
// real function without failing anything. So the arithmetic is EXTRACTED FROM
// pg_get_functiondef() and executed: whatever the live function computes today
// is what these assertions run. A weight changed in drizzle/0051 fails here
// without anyone remembering this file exists.
//
// Requires a real Postgres connection -- skipped by default so `npm test`
// stays instant/offline, opt in with:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/game/duelScoring.sqlParity.test.ts
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

// The right-hand side of a plpgsql assignment, read out of the function's own
// source. `which` disambiguates the branches of an IF (v_points is assigned
// twice in duel_submit_guess: the speed curve, then NULL).
//
// Throws rather than returning null on purpose: an extraction that quietly
// found nothing would turn every assertion below into a no-op, which is the
// failure mode this whole file exists to prevent.
function assignmentRhs(body: string, variable: string, which: (rhs: string) => boolean = () => true): string {
  const pattern = new RegExp(`\\b${variable}\\s*:=\\s*([\\s\\S]*?);`, "g");
  const candidates = [...body.matchAll(pattern)].map((m) => m[1].trim());
  const found = candidates.filter(which);
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one \`${variable} :=\` matching the predicate, found ${found.length}. ` +
        `The live function has been restructured -- update this test rather than deleting it. ` +
        `Candidates: ${JSON.stringify(candidates)}`,
    );
  }
  return found[0];
}

describe.skipIf(!RUN)("duel scoring SQL parity with duelScoring.ts (integration)", () => {
  const createdIds: number[] = [];
  let fixtureCounter = 0;

  // Extracted once in beforeAll: these are the live rules, and every test below
  // is a different way of asking whether TypeScript still agrees with them.
  let weightedProximityExpr = "";
  let heatDivisor = "";
  let clampedExpr = "";
  let remainingExpr = "";
  let speedPointsExpr = "";
  let dnfPointsExpr = "";

  beforeAll(async () => {
    const [submit] = await db.execute<{ src: string }>(
      sql`SELECT pg_get_functiondef('public.duel_submit_guess(integer,integer,integer)'::regprocedure) AS src`,
    );
    const [close] = await db.execute<{ src: string }>(
      sql`SELECT pg_get_functiondef('public.duel_close_round(integer,integer)'::regprocedure) AS src`,
    );

    weightedProximityExpr = assignmentRhs(submit.src, "v_weighted_proximity");

    // `... / 75.0` -- the MAX_PROXIMITY_WEIGHT ceiling, which duelScoring.ts
    // keeps private (it is derived from the weights, so a mismatch here means
    // the two sides disagree about what a "perfect" non-solving guess is).
    const heatExpr = assignmentRhs(submit.src, "v_best_heat");
    const divisor = /\/\s*([\d.]+)\s*$/.exec(heatExpr);
    if (!divisor) throw new Error(`could not read the heat divisor out of: ${heatExpr}`);
    heatDivisor = divisor[1];

    clampedExpr = assignmentRhs(submit.src, "v_clamped");
    remainingExpr = assignmentRhs(submit.src, "v_remaining");
    speedPointsExpr = assignmentRhs(submit.src, "v_points", (rhs) => /round\s*\(/i.test(rhs));

    // The DNF path: duel_close_round turns the round's best_proximity into
    // points. Read player A's -- B's is the same expression on the other row.
    dnfPointsExpr = assignmentRhs(close.src, "v_points_a", (rhs) => /best_proximity/i.test(rhs));
  });

  afterAll(async () => {
    if (createdIds.length === 0) return;
    await db.delete(drivers).where(inArray(drivers.id, createdIds));
  });

  async function insertDriver(driver: Driver): Promise<number> {
    fixtureCounter += 1;
    const [row] = await db
      .insert(drivers)
      .values({
        fullName: `Duel scoring parity fixture ${fixtureCounter}`,
        nationality: driver.nationality,
        lastTeam: driver.team === "" ? null : driver.team,
        previousTeams: driver.previousTeams,
        dateOfBirth: driver.dateOfBirth,
        dateOfDeath: driver.dateOfDeath,
        debutYear: driver.debutYear,
        careerWins: driver.careerWins,
        lastActiveYear: driver.debutYear,
      })
      .returning({ id: drivers.id });
    createdIds.push(row.id);
    return row.id;
  }

  // Runs the live weighted-proximity expression over a real compare_drivers()
  // row -- the same two steps duel_submit_guess performs, in the same order.
  // `v_cmp.` is the alias the function reads the compare row through.
  async function sqlScores(guess: Driver, target: Driver, asOf: Date) {
    const [guessId, targetId] = await Promise.all([insertDriver(guess), insertDriver(target)]);
    const weighted = sql.raw(`(${weightedProximityExpr.replaceAll("v_cmp.", "cmp.")})`);
    const rows = await db.execute<{ points: number; heat: string }>(sql`
      SELECT round(${weighted})::int AS points,
             ${weighted} / ${sql.raw(heatDivisor)} AS heat
      FROM public.compare_drivers(${guessId}, ${targetId}, ${asOf.toISOString()}::timestamptz) cmp`);
    return rows[0];
  }

  async function assertProximityParity(guess: Driver, target: Driver) {
    const tsResult = compare(guess, target, TODAY);
    const row = await sqlScores(guess, target, TODAY);

    expect(row.points).toBe(proximityPoints(tsResult));
    // numeric comes back off the raw postgres.js connection as a string.
    expect(Number(row.heat)).toBeCloseTo(guessHeat(tsResult), 10);
  }

  describe("proximityPoints / guessHeat -- the DNF and tug-of-war weights", () => {
    it("a perfect non-solving guess reaches the ceiling on both sides", async () => {
      // The doppelgänger case drizzle/0044 created: all five attributes match
      // and it is still not a win. Worth the most a DNF can be worth, and both
      // implementations have to agree that the most is the same number.
      await assertProximityParity(makeDriver(), makeDriver());
    });

    it("nothing matches", async () => {
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
      await assertProximityParity(guess, target);
    });

    it("historical team scores less than an exact one, by the same margin", async () => {
      const target = makeDriver({ team: "Mercedes", previousTeams: ["Mercedes", "McLaren"] });
      await assertProximityParity(makeDriver({ team: "McLaren" }), target);
      await assertProximityParity(makeDriver({ team: "Mercedes" }), target);
    });

    it("a teamless guess earns nothing for its missing team", async () => {
      // The absent-value rule (compare.ts): two teamless drivers are a miss,
      // not a free 15 points.
      await assertProximityParity(
        makeDriver({ team: "", previousTeams: [] }),
        makeDriver({ team: "", previousTeams: [] }),
      );
    });

    it("partial closeness on the three numeric columns", async () => {
      const target = makeDriver({ dateOfBirth: "1990-03-15", debutYear: 2010, careerWins: 20 });
      for (const guess of [
        makeDriver({ dateOfBirth: "1991-03-15", debutYear: 2011, careerWins: 21 }),
        makeDriver({ dateOfBirth: "1975-03-15", debutYear: 1995, careerWins: 0 }),
        makeDriver({ dateOfBirth: "1990-03-15", debutYear: 2010, careerWins: 45 }),
      ]) {
        await assertProximityParity(guess, target);
      }
    });

    it("age at death, which the two implementations compute separately", async () => {
      const target = makeDriver({ dateOfBirth: "1929-05-23", dateOfDeath: "1970-09-05" });
      await assertProximityParity(makeDriver({ dateOfBirth: "1937-01-11" }), target);
    });
  });

  describe("speedPoints -- the solve curve", () => {
    it("matches across the whole round, and clamps outside it", async () => {
      const roundMs = 60_000;
      // Includes both ends and both out-of-range directions: a guess landing
      // before started_at (clock drift, drizzle/0025's grace) and one landing
      // after ends_at both have to clamp the same way on both sides.
      const cases = [-5_000, 0, 1, 250, 1_234, 5_000, 15_000, 29_999, 30_000, 45_678, 59_999, 60_000, 90_000];

      const rows = await db.execute<{ ms: string; points: number }>(sql`
        WITH input AS (
          SELECT unnest(${sql.raw(`ARRAY[${cases.join(",")}]::numeric[]`)}) AS v_ms_to_solve,
                 ${roundMs}::numeric AS v_round_ms
        ),
        clamped AS (SELECT input.*, ${sql.raw(clampedExpr)} AS v_clamped FROM input),
        remaining AS (SELECT clamped.*, ${sql.raw(remainingExpr)} AS v_remaining FROM clamped)
        SELECT v_ms_to_solve::text AS ms, ${sql.raw(speedPointsExpr)} AS points FROM remaining`);

      expect(rows).toHaveLength(cases.length);
      const actual = Object.fromEntries(rows.map((r) => [String(Number(r.ms)), r.points]));
      const expected = Object.fromEntries(cases.map((ms) => [String(ms), speedPoints(ms, roundMs)]));
      expect(actual).toEqual(expected);
    });

    it("any solve outscores any DNF -- the invariant the weights exist under", async () => {
      // duelScoring.ts's MIN_SPEED_POINTS comment, checked against the live SQL
      // rather than against itself: the slowest possible solve must still beat
      // a perfect-but-not-solving guess. Both numbers come from the database.
      const perfect = await sqlScores(makeDriver(), makeDriver(), TODAY);
      const [slowest] = await db.execute<{ points: number }>(sql`
        WITH input AS (SELECT 60000::numeric AS v_ms_to_solve, 60000::numeric AS v_round_ms),
        clamped AS (SELECT input.*, ${sql.raw(clampedExpr)} AS v_clamped FROM input),
        remaining AS (SELECT clamped.*, ${sql.raw(remainingExpr)} AS v_remaining FROM clamped)
        SELECT ${sql.raw(speedPointsExpr)} AS points FROM remaining`);

      expect(slowest.points).toBeGreaterThan(perfect.points);
    });
  });

  it("the DNF payout is the rounded best proximity, not some other conversion", () => {
    // duel_close_round is where best_proximity becomes points. proximityPoints()
    // is Math.round(weightedProximity), so the shape has to be a plain round to
    // an integer -- anything else (floor, a multiplier, a cap) would make the
    // intermission's "+N" disagree with what was written.
    expect(dnfPointsExpr.replace(/\s+/g, "")).toMatch(/^ROUND\(COALESCE\(.*best_proximity,0\)\)::int$/i);
  });
});
