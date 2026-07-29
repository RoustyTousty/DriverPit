import "dotenv/config";

import { inArray, sql } from "drizzle-orm";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "./index";
import { dailyTargets } from "./schema";

// The coverage that replaced lib/game/dailySelection.sqlParity.test.ts when the
// day's driver stopped being a deterministic, reproducible pick (drizzle/0038,
// audit 2026-07-27 §3.1). There is no longer a TypeScript implementation to
// assert parity against, so what has to be proven instead is the two properties
// a secret daily actually depends on:
//
//   1. GRANTS -- a browser holding the public anon key cannot ask the database
//      for the answer, by any of the routes that used to work.
//   2. UNPREDICTABILITY -- the pin is a fresh random choice, not a function of
//      the date, and it doesn't hand the same driver out two days running.
//
// Needs a real Postgres + Supabase project. Opt in, same convention as the
// other DB suites:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/dailyTargetSecrecy.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

// Probe days for the unpredictability tests. They must be pinnable, and the
// eligible pool is `last_active_year >= year(date) - 10` -- so a far-future
// date like 2099-01-01 has an EMPTY pool and raises "No puzzle is scheduled".
// Near-future days it is, cleaned up in afterAll. A leaked probe row is
// harmless even so: it pins that day to a random driver from today's pool,
// which is what the day would have got anyway.
const PROBE_OFFSET = 200;

function probeDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + PROBE_OFFSET + offsetDays);
  return d.toISOString().slice(0, 10);
}

// daily_target_id is SECURITY DEFINER and pins as a side effect, so calling it
// over the trusted connection is exactly what the RPCs do for a real day.
async function pinTarget(date: string): Promise<number> {
  const rows = await db.execute<{ id: number }>(
    sql`SELECT public.daily_target_id(${date}::date) AS id`,
  );
  return rows[0].id;
}

async function unpin(date: string): Promise<void> {
  await db.delete(dailyTargets).where(inArray(dailyTargets.date, [date]));
}

describe.skipIf(!RUN)("the daily target is not publicly computable (integration)", () => {
  let supabase: SupabaseClient;
  const pinnedProbes = new Set<string>();

  beforeAll(async () => {
    // A real signed-in guest -- the strongest position a browser can reach, so
    // a rejection here means `anon` (weaker) is closed too.
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error(`fixture guest sign-in failed: ${error.message}`);
  });

  afterAll(async () => {
    if (pinnedProbes.size > 0) {
      await db.delete(dailyTargets).where(inArray(dailyTargets.date, [...pinnedProbes]));
    }
  });

  describe("grants", () => {
    it("daily_target_id is unreachable over PostgREST", async () => {
      const { data, error } = await supabase.rpc("daily_target_id", {
        p_date: new Date().toISOString().slice(0, 10),
      });
      // The load-bearing assertion is that no driver id comes back. A
      // permission error and a "function not found" both satisfy it; quietly
      // returning a number is the regression this exists to catch.
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("pick_daily_driver_id no longer exists at all", async () => {
      const rows = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'pick_daily_driver_id'`,
      );
      expect(rows[0].n).toBe(0);
    });

    it("compare_drivers is unreachable over PostgREST", async () => {
      const { data, error } = await supabase.rpc("compare_drivers", {
        p_guess_driver_id: 1,
        p_target_driver_id: 2,
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("daily_targets itself stays RLS-denied", async () => {
      const { data, error } = await supabase.from("daily_targets").select("*");
      // Deny-all RLS reads as an empty set rather than an error; either way,
      // no row may come back.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    });

    it("the RPC a player DOES need still works for a signed-in guest", async () => {
      // The revokes are only correct if they cost the player nothing -- if this
      // regresses, the daily board is broken for everyone.
      const { error } = await supabase.rpc("daily_state");
      expect(error).toBeNull();
    });
  });

  describe("unpredictability", () => {
    it("picks a different driver each time the same date is pinned afresh", async () => {
      // Pin, unpin, re-pin. A deterministic algorithm returns the identical id
      // every single time here; a random pick over a pool of dozens almost
      // never does. Repeated enough that one coincidence can't pass it.
      const date = probeDate(50);
      const picks = new Set<number>();
      for (let i = 0; i < 12; i++) {
        await unpin(date);
        picks.add(await pinTarget(date));
      }
      await unpin(date);
      expect(picks.size).toBeGreaterThan(1);
    });

    it("re-reads the pinned row rather than re-rolling once a day is set", async () => {
      const date = probeDate(60);
      pinnedProbes.add(date);
      const first = await pinTarget(date);
      for (let i = 0; i < 5; i++) {
        expect(await pinTarget(date)).toBe(first);
      }
    });

    it("keeps a driver out of the running across a run of consecutive days", async () => {
      const [{ n: poolSize }] = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM public.drivers
            WHERE last_active_year >= extract(year FROM now())::int - 10`,
      );
      // The cooldown is a soft ordering, so distinctness is only guaranteed
      // while there are more eligible drivers than days being pinned.
      const days = Math.min(12, poolSize - 1);
      expect(days).toBeGreaterThan(1);

      const picks: number[] = [];
      for (let i = 0; i < days; i++) {
        const date = probeDate(i);
        pinnedProbes.add(date);
        picks.push(await pinTarget(date));
      }
      expect(new Set(picks).size).toBe(days);
    });

    it("still pins something when the cooldown covers the whole pool", async () => {
      // The cooldown is deliberately an ORDER BY and not a WHERE: with every
      // eligible driver recently used it must degrade to plain random, never
      // raise "No puzzle is scheduled for today". Force that by pinning the
      // pool's own size in consecutive days first.
      const [{ n: poolSize }] = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM public.drivers
            WHERE last_active_year >= extract(year FROM now())::int - 10`,
      );
      const saturate = Math.min(poolSize + 2, 30);
      for (let i = 0; i < saturate; i++) {
        const date = probeDate(100 + i);
        pinnedProbes.add(date);
        await pinTarget(date);
      }

      const date = probeDate(100 + saturate);
      pinnedProbes.add(date);
      await expect(pinTarget(date)).resolves.toBeGreaterThan(0);
    });
  });
});
