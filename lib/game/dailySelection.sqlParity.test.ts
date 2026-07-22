import "dotenv/config";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "../db";
import { pickDailyDriverId } from "./dailySelection";

// Parity check for drizzle/0028_daily_infinite_fast_guess_rpc.sql#pick_daily_driver_id
// -- the SQL port of dailySelection.ts#pickDailyDriverId that daily_submit_guess
// uses so a daily guess can be evaluated in one warm hop (no Vercel Server
// Action in the path). pickDailyDriverId stays the source of truth; this
// proves the SQL port (a from-scratch reimplementation of the FNV-1a hash
// using bigint arithmetic, since Postgres integers don't wrap like JS's
// Math.imul) hasn't drifted from it, across a wide range of dates and pool
// shapes. A mismatch here would mean a guess is scored against a different
// driver than dailySelection.ts says today's target is -- see that risk
// before changing either side.
//
// Requires a real Postgres connection -- skipped by default so `npm test`
// stays instant/offline, opt in with:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/game/dailySelection.sqlParity.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

async function sqlPick(date: string, pool: number[]): Promise<number> {
  // postgres.js interpolates a JS array as a parenthesized tuple, not a
  // Postgres array literal -- build the `{1,2,3}` literal text ourselves.
  const poolLiteral = `{${pool.join(",")}}`;
  const rows = await db.execute<{ id: number }>(
    sql`SELECT public.pick_daily_driver_id(${date}::date, ${poolLiteral}::int[]) AS id`,
  );
  return rows[0].id;
}

describe.skipIf(!RUN)("pick_daily_driver_id SQL parity with pickDailyDriverId (integration)", () => {
  const pool = [10, 20, 30, 40, 50];

  it(
    "agrees with the TS pick across a year of dates",
    async () => {
      for (let i = 0; i < 365; i += 7) {
        const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
        const tsPick = pickDailyDriverId(date, pool);
        const dbPick = await sqlPick(date, pool);
        expect(dbPick, `mismatch on ${date}`).toBe(tsPick);
      }
    },
    20_000,
  );

  it("agrees on a realistic ~800-id pool shape", async () => {
    const bigPool = Array.from({ length: 823 }, (_, i) => i + 1);
    for (const date of ["2026-01-01", "2026-07-18", "2026-12-31", "2027-02-28", "2030-11-11"]) {
      expect(await sqlPick(date, bigPool)).toBe(pickDailyDriverId(date, bigPool));
    }
  });

  it("agrees regardless of the pool array's input ordering", async () => {
    const shuffled = [30, 10, 50, 20, 40];
    expect(await sqlPick("2026-07-19", shuffled)).toBe(pickDailyDriverId("2026-07-19", pool));
  });

  it("agrees on a single-driver pool", async () => {
    expect(await sqlPick("2026-07-19", [42])).toBe(pickDailyDriverId("2026-07-19", [42]));
  });

  it("agrees on pool ids well past 32-bit-friendly small numbers", async () => {
    const pool2 = [100003, 200017, 300007, 400009];
    for (const date of ["2026-03-03", "2028-08-08"]) {
      expect(await sqlPick(date, pool2)).toBe(pickDailyDriverId(date, pool2));
    }
  });
});
