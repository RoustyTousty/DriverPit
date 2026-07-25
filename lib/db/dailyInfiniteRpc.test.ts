import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_GUESSES } from "../game/constants";
import { db } from "./index";
import { infiniteRounds } from "./schema";

// Integration tests for drizzle/0028_daily_infinite_fast_guess_rpc.sql's
// client-callable Infinite RPCs (infinite_start_round, infinite_submit_guess)
// -- these need a real authenticated session (auth.uid()) so they're exercised
// through supabase.rpc(), the same way the actual browser client calls them,
// not the trusted Drizzle connection. Same opt-in convention as
// lib/db/duelRpc.test.ts:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/dailyInfiniteRpc.test.ts
//
// Daily's RPCs moved to the stateful daily_state / daily_submit_guess
// (drizzle/0030); their coverage lives in lib/db/dailyRpc.test.ts.
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

async function makeGuestClient(): Promise<SupabaseClient> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`fixture guest sign-in failed: ${error.message}`);
  return supabase;
}

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

  it("enforces the guess cap server-side and can't be pushed past it", async () => {
    await supabase.rpc("infinite_start_round", { p_pool_window: "10-years" });
    const [round] = await db.select().from(infiniteRounds).where(eq(infiniteRounds.userId, userId));

    const [wrongDriver] = await db.query.drivers.findMany({
      where: (d, { ne }) => ne(d.id, round.driverId),
      limit: 1,
    });

    // Everything up to the last allowed guess keeps the round alive.
    for (let i = 1; i < MAX_GUESSES; i++) {
      const { data, error } = await supabase
        .rpc("infinite_submit_guess", { p_guess_driver_id: wrongDriver.id })
        .single();
      expect(error).toBeNull();
      expect((data as { status: string }).status).toBe("continue");
    }

    // The last one ends the round as a loss and reveals the target. Uses
    // MAX_GUESSES rather than a literal so a change to the TS constant that
    // isn't mirrored in the RPC's hardcoded cap fails here instead of silently
    // giving Infinite a different guess count than Daily.
    const { data: final, error: finalError } = await supabase
      .rpc("infinite_submit_guess", { p_guess_driver_id: wrongDriver.id })
      .single();
    expect(finalError).toBeNull();
    const lost = final as { status: string; target_driver_id: number | null };
    expect(lost.status).toBe("lost");
    expect(lost.target_driver_id).toBe(round.driverId);

    // The cap is the SERVER's to enforce: the round row is gone, so a client
    // that ignores the returned status can't smuggle in an extra guess.
    const [afterLoss] = await db.select().from(infiniteRounds).where(eq(infiniteRounds.userId, userId));
    expect(afterLoss).toBeUndefined();

    const { error: extra } = await supabase
      .rpc("infinite_submit_guess", { p_guess_driver_id: wrongDriver.id })
      .single();
    expect(extra).not.toBeNull();
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
