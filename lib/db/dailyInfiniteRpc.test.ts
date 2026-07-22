import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDailyDriverId } from "./queries";
import { db } from "./index";
import { infiniteRounds } from "./schema";

// Integration tests for drizzle/0028_daily_infinite_fast_guess_rpc.sql's
// client-callable RPCs (daily_submit_guess, infinite_start_round,
// infinite_submit_guess) -- these need a real authenticated session
// (auth.uid()) so they're exercised through supabase.rpc(), the same way
// the actual browser client calls them, not the trusted Drizzle
// connection. Same opt-in convention as lib/db/duelRpc.test.ts:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/dailyInfiniteRpc.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

async function makeGuestClient(): Promise<SupabaseClient> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`fixture guest sign-in failed: ${error.message}`);
  return supabase;
}

describe.skipIf(!RUN)("daily_submit_guess (integration)", () => {
  let supabase: SupabaseClient;
  let targetId: number;

  beforeAll(async () => {
    supabase = await makeGuestClient();
    const todayUtc = new Date().toISOString().slice(0, 10);
    targetId = await getDailyDriverId("10-years", new Date().getUTCFullYear(), todayUtc);
  });

  it("rejects an unknown driver id", async () => {
    const { error } = await supabase.rpc("daily_submit_guess", { p_guess_driver_id: -1 }).single();
    expect(error).not.toBeNull();
  });

  it("scores a guess against today's actual target, consistently across calls", async () => {
    const { data: first, error: e1 } = await supabase
      .rpc("daily_submit_guess", { p_guess_driver_id: targetId })
      .single();
    expect(e1).toBeNull();
    // Guessing the real target must always win.
    expect((first as { won: boolean }).won).toBe(true);

    const [otherDriver] = await db.query.drivers.findMany({ limit: 1 });
    if (otherDriver && otherDriver.id !== targetId) {
      const { data: second, error: e2 } = await supabase
        .rpc("daily_submit_guess", { p_guess_driver_id: otherDriver.id })
        .single();
      expect(e2).toBeNull();
      // Same target both times -- a second call must not re-pick.
      expect((second as { won: boolean }).won).toBe(otherDriver.id === targetId);
    }
  });
});

describe.skipIf(!RUN)("infinite_start_round / infinite_submit_guess (integration)", () => {
  let supabase: SupabaseClient;
  let userId: string;

  beforeAll(async () => {
    supabase = await makeGuestClient();
    const { data } = await supabase.auth.getUser();
    userId = data.user!.id;
  });

  afterAll(async () => {
    if (userId) await db.delete(infiniteRounds).where(eq(infiniteRounds.userId, userId));
  });

  it("submit_guess without a started round is rejected", async () => {
    await db.delete(infiniteRounds).where(eq(infiniteRounds.userId, userId));
    const { error } = await supabase.rpc("infinite_submit_guess", { p_guess_driver_id: 1 }).single();
    expect(error).not.toBeNull();
  });

  it("rejects an invalid pool window", async () => {
    const { error } = await supabase.rpc("infinite_start_round", { p_pool_window: "not-a-real-window" });
    expect(error).not.toBeNull();
  });

  it("start_round then a correct guess wins and reveals the target; row is cleared", async () => {
    const { error: startError } = await supabase.rpc("infinite_start_round", { p_pool_window: "10-years" });
    expect(startError).toBeNull();

    const [round] = await db.select().from(infiniteRounds).where(eq(infiniteRounds.userId, userId));
    expect(round).toBeDefined();

    const { data, error } = await supabase
      .rpc("infinite_submit_guess", { p_guess_driver_id: round.driverId })
      .single();
    expect(error).toBeNull();
    const row = data as { status: string; target_driver_id: number | null };
    expect(row.status).toBe("won");
    expect(row.target_driver_id).toBe(round.driverId);

    const [afterWin] = await db.select().from(infiniteRounds).where(eq(infiniteRounds.userId, userId));
    expect(afterWin).toBeUndefined();
  });

  it("a wrong guess continues and never leaks the target", async () => {
    await supabase.rpc("infinite_start_round", { p_pool_window: "10-years" });
    const [round] = await db.select().from(infiniteRounds).where(eq(infiniteRounds.userId, userId));

    const [wrongDriver] = await db.query.drivers.findMany({
      where: (d, { ne }) => ne(d.id, round.driverId),
      limit: 1,
    });
    const { data, error } = await supabase
      .rpc("infinite_submit_guess", { p_guess_driver_id: wrongDriver.id })
      .single();
    expect(error).toBeNull();
    const row = data as { status: string; target_driver_id: number | null; guessed_driver_id: number };
    expect(row.status).toBe("continue");
    // The whole point: a mid-round response must never carry the target.
    expect(row.target_driver_id).toBeNull();
    expect(row.guessed_driver_id).toBe(wrongDriver.id);

    const [stillGoing] = await db.select().from(infiniteRounds).where(eq(infiniteRounds.userId, userId));
    expect(stillGoing.guessCount).toBe(1);
  });

  it("starting a new round always overwrites the old one", async () => {
    await supabase.rpc("infinite_start_round", { p_pool_window: "10-years" });
    await supabase.rpc("infinite_submit_guess", { p_guess_driver_id: 1 }).single();
    await supabase.rpc("infinite_start_round", { p_pool_window: "legacy" });

    const rows = await db.select().from(infiniteRounds).where(eq(infiniteRounds.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].guessCount).toBe(0);
    expect(rows[0].poolWindow).toBe("legacy");
  });
});
