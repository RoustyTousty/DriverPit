import "dotenv/config";

import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../db";
import { drivers } from "../db/schema";
import { compare, type Driver } from "./compare";
import { accuracyFactor, dnfPoints, guessHeat, proximityPoints, solvePoints, speedPoints } from "./duelScoring";
import { GUESS_COOLDOWN_SERVER_MS } from "./duelTiming";

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
  let accuracyExpr = "";
  let dnfPointsExpr = "";
  let submitSrc = "";

  beforeAll(async () => {
    const [submit] = await db.execute<{ src: string }>(
      sql`SELECT pg_get_functiondef('public.duel_submit_guess(integer,integer,integer)'::regprocedure) AS src`,
    );
    const [close] = await db.execute<{ src: string }>(
      sql`SELECT pg_get_functiondef('public.duel_close_round(integer,integer)'::regprocedure) AS src`,
    );
    submitSrc = submit.src;

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
    // The wrong-guess decay (drizzle/0058) -- GUESS_DECAY and FREE_GUESSES
    // live inside this one expression on the SQL side.
    accuracyExpr = assignmentRhs(submit.src, "v_accuracy");

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

  // Runs the live chain of assignments duel_submit_guess performs on a solve,
  // in its own order: wrong guesses -> accuracy, ms -> clamped -> remaining,
  // then the points expression over both. Every piece is the database's, so a
  // weight, a decay base, a free allowance or the ms floor changed in a future
  // migration surfaces here.
  async function sqlSolvePoints(cases: Array<{ ms: number; roundMs: number; wrong: number }>) {
    const values = cases.map((c) => `(${c.ms}::numeric, ${c.roundMs}::numeric, ${c.wrong}::integer)`).join(",");
    const rows = await db.execute<{ key: string; points: number }>(sql`
      WITH input AS (
        SELECT * FROM (VALUES ${sql.raw(values)}) AS t(v_ms_to_solve, v_round_ms, v_wrong_guesses)
      ),
      accuracy AS (SELECT input.*, ${sql.raw(accuracyExpr)} AS v_accuracy FROM input),
      clamped AS (SELECT accuracy.*, ${sql.raw(clampedExpr)} AS v_clamped FROM accuracy),
      remaining AS (SELECT clamped.*, ${sql.raw(remainingExpr)} AS v_remaining FROM clamped)
      SELECT v_ms_to_solve::text || ':' || v_wrong_guesses::text AS key,
             ${sql.raw(speedPointsExpr)} AS points
      FROM remaining`);
    return Object.fromEntries(rows.map((r) => [r.key, r.points]));
  }

  describe("speedPoints -- the solve curve", () => {
    it("matches across the whole round, and clamps outside it", async () => {
      const roundMs = 60_000;
      // Includes both ends and both out-of-range directions: a guess landing
      // before started_at (clock drift, drizzle/0025's grace) and one landing
      // after ends_at both have to clamp the same way on both sides. The low
      // end also covers MIN_SOLVE_MS (drizzle/0058): everything under 2000
      // must come back as 2000 does, on both sides.
      const cases = [-5_000, 0, 1, 250, 1_234, 1_999, 2_000, 2_001, 5_000, 15_000, 29_999, 30_000, 45_678, 59_999, 60_000, 90_000];

      const actual = await sqlSolvePoints(cases.map((ms) => ({ ms, roundMs, wrong: 0 })));
      const expected = Object.fromEntries(cases.map((ms) => [`${ms}:0`, speedPoints(ms, roundMs)]));
      expect(actual).toEqual(expected);
    });

    it("any solve outscores any DNF -- the invariant the weights exist under", async () => {
      // duelScoring.ts's MIN_SPEED_POINTS comment, checked against the live SQL
      // rather than against itself: the slowest possible solve must still beat
      // a perfect-but-not-solving guess. Both numbers come from the database.
      //
      // Since drizzle/0058 the weaker reading of this ("the slowest solve")
      // is not enough: the decay could have been applied to the floor rather
      // than to the bonus, which is exactly the mistake that would put a lucky
      // near miss above someone who found the driver. So the solve tested here
      // is the worst one that can exist -- slowest AND maximally penalised.
      const perfect = await sqlScores(makeDriver(), makeDriver(), TODAY);
      const worst = await sqlSolvePoints([{ ms: 60_000, roundMs: 60_000, wrong: 250 }]);

      expect(worst["60000:250"]).toBeGreaterThan(perfect.points);
    });
  });

  describe("guess discipline -- drizzle/0058", () => {
    it("the wrong-guess decay matches accuracyFactor across the whole range", async () => {
      // GUESS_DECAY and FREE_GUESSES are duplicated into plpgsql as literals
      // inside one expression. Executed rather than string-matched: 0.88 and 3
      // could be spelled a dozen ways in SQL and only the values matter.
      const wrongCounts = [0, 1, 2, 3, 4, 5, 6, 10, 20, 45, 103];
      const values = wrongCounts.map((w) => `(${w}::integer)`).join(",");
      const rows = await db.execute<{ wrong: number; accuracy: string }>(sql`
        SELECT v_wrong_guesses AS wrong, ${sql.raw(accuracyExpr)} AS accuracy
        FROM (VALUES ${sql.raw(values)}) AS t(v_wrong_guesses)`);

      expect(rows).toHaveLength(wrongCounts.length);
      for (const row of rows) {
        expect(Number(row.accuracy)).toBeCloseTo(accuracyFactor(row.wrong), 10);
      }
    });

    it("solvePoints agrees end to end, across time AND guess count together", async () => {
      // The two halves interact multiplicatively, so agreeing on each
      // separately is not the same as agreeing on the product -- this is the
      // grid the tug-of-war bar and the authoritative score both read.
      const cases = [
        { ms: 2_000, roundMs: 60_000, wrong: 0 },
        { ms: 8_500, roundMs: 60_000, wrong: 3 },
        { ms: 18_000, roundMs: 60_000, wrong: 4 },
        { ms: 45_000, roundMs: 60_000, wrong: 44 },
        { ms: 59_999, roundMs: 60_000, wrong: 7 },
        // A custom lobby's 30s and 90s rounds -- round_seconds is per-match
        // (drizzle/0055) and the curve has to follow it on both sides.
        { ms: 12_000, roundMs: 30_000, wrong: 6 },
        { ms: 12_000, roundMs: 90_000, wrong: 6 },
      ];

      const actual = await sqlSolvePoints(cases);
      const expected = Object.fromEntries(
        cases.map((c) => [`${c.ms}:${c.wrong}`, solvePoints(c.ms, c.roundMs, c.wrong)]),
      );
      expect(actual).toEqual(expected);
    });

    it("the DNF payout is the best proximity decayed by the same factor", async () => {
      // duel_close_round is where best_proximity becomes points. Was a plain
      // ROUND() until drizzle/0058; now it carries its own copy of the decay,
      // against guess_count rather than guess_count - 1 (every guess in a DNF
      // round is a wrong one). Executed against the live expression, so the
      // off-by-one is pinned rather than described.
      const cases = [
        { proximity: 0, guesses: 0 },
        { proximity: 60, guesses: 1 },
        { proximity: 60, guesses: 3 },
        { proximity: 60, guesses: 4 },
        { proximity: 75, guesses: 20 },
        { proximity: 41.5, guesses: 9 },
      ];
      const values = cases.map((c) => `(${c.proximity}::numeric, ${c.guesses}::integer)`).join(",");
      const rows = await db.execute<{ key: string; points: number }>(sql`
        SELECT best_proximity::text || ':' || guess_count::text AS key,
               ${sql.raw(dnfPointsExpr.replaceAll("v_a_result.", "r."))} AS points
        FROM (VALUES ${sql.raw(values)}) AS r(best_proximity, guess_count)`);

      const actual = Object.fromEntries(rows.map((r) => [r.key, r.points]));
      const expected = Object.fromEntries(
        cases.map((c) => [`${c.proximity}:${c.guesses}`, dnfPoints(c.proximity, c.guesses)]),
      );
      expect(actual).toEqual(expected);
    });

    it("the server's guess cooldown is the interval duelTiming.ts declares", () => {
      // The one constant here that is a plpgsql literal rather than an
      // expression, so it is matched rather than executed. Read out of the
      // live function source: a migration that widens the cooldown without
      // moving GUESS_COOLDOWN_SERVER_MS would otherwise leave the client
      // waiting less than the server allows, and honest players would start
      // seeing the rejection.
      const match = /interval\s*'(\d+)\s*milliseconds'/i.exec(submitSrc);
      expect(match, `no millisecond interval found in duel_submit_guess -- did the cooldown move?`).not.toBeNull();
      expect(Number(match![1])).toBe(GUESS_COOLDOWN_SERVER_MS);
      // And it must stay under the client's own wait, or an honest client
      // races its own cooldown. (Checked in duelTiming.ts terms, not SQL.)
      expect(GUESS_COOLDOWN_SERVER_MS).toBeLessThan(1_000);
    });
  });
});
