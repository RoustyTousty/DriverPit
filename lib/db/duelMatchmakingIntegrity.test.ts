import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "./index";
import { duelMatches, matchmakingQueue, userStats } from "./schema";

// Regression coverage for the matchmaking self-match / rating-farming vector
// (drizzle/0032). The exploit: queue while signed in, sign out -- which leaves
// the queue row behind under the old user id AND immediately mints a new
// anonymous identity -- then queue again. The old `mq.user_id <> v_user_id`
// guard passes (the ids genuinely differ), the player is paired with
// themselves, and real duel_rating is written to both sides.
//
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/duelMatchmakingIntegrity.test.ts
//
// Every test runs in its own randomly-named pool_window, so the candidate scan
// is completely isolated from any real player queued on the live pool -- these
// can never pair a fixture with, or steal a match from, an actual user.
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

const POOL = `test-pool-${crypto.randomUUID()}`;
const MY_DEVICE = `device-${crypto.randomUUID()}`;
const OTHER_DEVICE = `device-${crypto.randomUUID()}`;

interface MatchRow {
  match_id: number | null;
  opponent_id: string | null;
}

describe.skipIf(!RUN)("matchmaking queue integrity (integration)", () => {
  let supabase: SupabaseClient;
  let meId: string;
  // A second, pre-existing profile standing in for "the identity that queued
  // and then signed out". Chosen with no duel_matches of its own so nothing
  // here can disturb real match history.
  let otherId: string;
  const createdMatchIds: number[] = [];

  async function callMatchOrQueue(deviceId: string): Promise<MatchRow> {
    const { data, error } = await supabase
      .rpc("match_or_queue", { p_pool_window: POOL, p_device_id: deviceId })
      .single();
    if (error) throw new Error(`match_or_queue failed: ${error.message}`);
    const row = data as MatchRow;
    if (row.match_id !== null) createdMatchIds.push(row.match_id);
    return row;
  }

  // Puts a row in the queue directly, bypassing the RPC -- this is how a
  // *leaked* row (the signed-out identity's) is simulated, since by definition
  // the client never cleaned it up.
  async function seedQueueRow(userId: string, deviceId: string, secondsStale = 0) {
    await db.insert(matchmakingQueue).values({
      userId,
      poolWindow: POOL,
      rating: 1000,
      status: "waiting",
      deviceId,
      queuedAt: new Date(Date.now() - 1000),
      lastSeenAt: new Date(Date.now() - secondsStale * 1000),
    });
  }

  beforeAll(async () => {
    supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
    meId = data.user.id;

    const [clean] = await db.execute<{ id: string }>(sql`
      SELECT p.id FROM public.profiles p
      WHERE p.id <> ${meId}
        AND NOT EXISTS (
          SELECT 1 FROM public.duel_matches dm
          WHERE dm.player_a = p.id OR dm.player_b = p.id
        )
      LIMIT 1
    `);
    if (!clean) throw new Error("no spare profile available to stand in as the stale identity");
    otherId = clean.id;
  });

  beforeEach(async () => {
    await db.delete(matchmakingQueue).where(inArray(matchmakingQueue.userId, [meId, otherId]));
    if (createdMatchIds.length) {
      await db.delete(duelMatches).where(inArray(duelMatches.id, createdMatchIds));
      createdMatchIds.length = 0;
    }
  });

  afterAll(async () => {
    await db.delete(matchmakingQueue).where(inArray(matchmakingQueue.userId, [meId, otherId]));
    if (createdMatchIds.length) {
      await db.delete(duelMatches).where(inArray(duelMatches.id, createdMatchIds));
    }
  });

  // Positive control. Without this, every "no match was created" assertion
  // below could be passing for some unrelated reason (wrong pool, bad fixture)
  // rather than because a guard actually fired.
  it("CONTROL: pairs normally with a live row from a different user and device", async () => {
    await seedQueueRow(otherId, OTHER_DEVICE);
    const row = await callMatchOrQueue(MY_DEVICE);
    expect(row.match_id).not.toBeNull();
    expect(row.opponent_id).toBe(otherId);
  });

  it("refuses to pair two rows sharing a device_id", async () => {
    // Same browser, different identity -- exactly the post-sign-out shape.
    await seedQueueRow(otherId, MY_DEVICE);
    const row = await callMatchOrQueue(MY_DEVICE);
    expect(row.match_id).toBeNull();

    const matches = await db
      .select()
      .from(duelMatches)
      .where(or(eq(duelMatches.playerA, meId), eq(duelMatches.playerB, meId)));
    expect(matches).toHaveLength(0);
  });

  it("refuses to pair a caller with their own queue row", async () => {
    // First call enqueues me; the second must not then claim my own row.
    const first = await callMatchOrQueue(MY_DEVICE);
    expect(first.match_id).toBeNull();
    const second = await callMatchOrQueue(MY_DEVICE);
    expect(second.match_id).toBeNull();

    const mine = await db.select().from(matchmakingQueue).where(eq(matchmakingQueue.userId, meId));
    expect(mine).toHaveLength(1);
  });

  it("ignores a row past the liveness window, and the sweep deletes it", async () => {
    await seedQueueRow(otherId, OTHER_DEVICE, 60); // 60s since last heartbeat
    const row = await callMatchOrQueue(MY_DEVICE);
    expect(row.match_id).toBeNull();

    // match_or_queue sweeps as part of its own search, so the dead row is
    // already gone by now -- assert that rather than only that it was skipped.
    const stale = await db.select().from(matchmakingQueue).where(eq(matchmakingQueue.userId, otherId));
    expect(stale).toHaveLength(0);
  });

  it("duel_sweep_stale_queue removes stale rows and spares live ones", async () => {
    await seedQueueRow(otherId, OTHER_DEVICE, 60);
    await seedQueueRow(meId, MY_DEVICE, 0);

    const [{ swept }] = await db.execute<{ swept: number }>(
      sql`SELECT public.duel_sweep_stale_queue() AS swept`,
    );
    expect(Number(swept)).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select()
      .from(matchmakingQueue)
      .where(inArray(matchmakingQueue.userId, [meId, otherId]));
    expect(remaining.map((r) => r.userId)).toEqual([meId]);
  });

  it("duel_leave_queue is idempotent and safe when not queued", async () => {
    // Never queued at all.
    expect((await supabase.rpc("duel_leave_queue")).error).toBeNull();

    await callMatchOrQueue(MY_DEVICE);
    expect(await db.select().from(matchmakingQueue).where(eq(matchmakingQueue.userId, meId))).toHaveLength(1);

    expect((await supabase.rpc("duel_leave_queue")).error).toBeNull();
    expect((await supabase.rpc("duel_leave_queue")).error).toBeNull();
    expect(await db.select().from(matchmakingQueue).where(eq(matchmakingQueue.userId, meId))).toHaveLength(0);
  });

  it("duel_queue_heartbeat refreshes last_seen_at and no-ops when not queued", async () => {
    expect((await supabase.rpc("duel_queue_heartbeat")).error).toBeNull();

    await seedQueueRow(meId, MY_DEVICE, 10);
    const [before] = await db.select().from(matchmakingQueue).where(eq(matchmakingQueue.userId, meId));
    expect((await supabase.rpc("duel_queue_heartbeat")).error).toBeNull();
    const [after] = await db.select().from(matchmakingQueue).where(eq(matchmakingQueue.userId, meId));
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
  });

  // THE ORIGINAL BUG, end to end.
  it("a leaked row from a previous identity on this browser can never be matched, and writes no rating", async () => {
    const ratingBefore = await db
      .select()
      .from(userStats)
      .where(inArray(userStats.userId, [meId, otherId]));

    // The signed-out identity's abandoned row: same browser, still "live" so
    // the liveness layer alone would NOT save us -- the device guard must.
    await seedQueueRow(otherId, MY_DEVICE, 0);

    // The fresh anonymous identity queues from that same browser.
    const row = await callMatchOrQueue(MY_DEVICE);
    expect(row.match_id).toBeNull();

    const matches = await db
      .select()
      .from(duelMatches)
      .where(
        or(
          and(eq(duelMatches.playerA, meId), eq(duelMatches.playerB, otherId)),
          and(eq(duelMatches.playerA, otherId), eq(duelMatches.playerB, meId)),
        ),
      );
    expect(matches).toHaveLength(0);

    // And the leaked row is actively cleaned up, not merely skipped -- so it
    // can't sit there waiting to trap a genuine third player either.
    const leaked = await db.select().from(matchmakingQueue).where(eq(matchmakingQueue.userId, otherId));
    expect(leaked).toHaveLength(0);

    const ratingAfter = await db
      .select()
      .from(userStats)
      .where(inArray(userStats.userId, [meId, otherId]));
    expect(ratingAfter.map((r) => [r.userId, r.duelRating, r.duelWins, r.duelLosses])).toEqual(
      ratingBefore.map((r) => [r.userId, r.duelRating, r.duelWins, r.duelLosses]),
    );
  });

  it("the database itself rejects a self-match row", async () => {
    // The backstop invariant: even a future code path that bypassed every
    // guard above cannot represent a player duelling themselves.
    await expect(
      db.insert(duelMatches).values({ playerA: meId, playerB: meId, status: "lobby", currentRound: 0 }),
    ).rejects.toThrow();
  });
});
