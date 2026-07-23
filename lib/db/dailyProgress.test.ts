import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { dailyStateFor, dailySubmitGuessFor } from "./dailyProgress";
import { db } from "./index";
import { getDailyDriverId } from "./queries";
import { dailyProgress, dailyResults, drivers, userStats } from "./schema";

// Integration coverage for the server-authoritative daily board
// (dailyProgress.ts). Needs a real Postgres with migration 0029 applied and a
// real profiles/user_stats row (created by the signup trigger for an anonymous
// guest). The core functions take a user id and use the trusted `db`
// connection, so they're driven directly here -- no Next.js request/cookies
// context. Same opt-in convention as lib/db/dailyInfiniteRpc.test.ts:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/dailyProgress.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

async function utcToday(): Promise<string> {
  const rows = await db.execute<{ today: string }>(
    sql`SELECT (now() AT TIME ZONE 'utc')::date::text AS today`,
  );
  return rows[0].today;
}

describe.skipIf(!RUN)("dailyProgress (integration)", () => {
  let supabase: SupabaseClient;
  let userId: string;
  let today: string;
  let targetId: number;
  let wrongId: number;

  beforeAll(async () => {
    // An anonymous guest is a real auth.users row; the trigger seeds its
    // profiles + user_stats, which daily_progress + recordDailyResult need.
    supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
    userId = data.user.id;

    today = await utcToday();
    targetId = await getDailyDriverId("10-years", Number(today.slice(0, 4)), today);

    const [notTarget] = await db.select({ id: drivers.id }).from(drivers).where(sql`${drivers.id} <> ${targetId}`).limit(1);
    wrongId = notTarget.id;
  });

  // Each test starts from a clean day + stats so counts are deterministic.
  beforeEach(async () => {
    await db.delete(dailyProgress).where(eq(dailyProgress.userId, userId));
    await db.delete(dailyResults).where(eq(dailyResults.userId, userId));
    await db
      .update(userStats)
      .set({ gamesPlayed: 0, wins: 0, currentStreak: 0, maxStreak: 0, guessDistribution: [0, 0, 0, 0, 0, 0], lastResult: null })
      .where(eq(userStats.userId, userId));
  });

  afterAll(async () => {
    if (!userId) return;
    await db.delete(dailyProgress).where(eq(dailyProgress.userId, userId));
    await db.delete(dailyResults).where(eq(dailyResults.userId, userId));
  });

  it("appends guesses in order and persists only the ids", async () => {
    const first = await dailySubmitGuessFor(userId, wrongId);
    expect(first.board.guesses.map((g) => g.driverId)).toEqual([wrongId]);
    expect(first.board.completed).toBe(false);
    expect(first.justCompleted).toBe(false);

    const second = await dailySubmitGuessFor(userId, wrongId);
    expect(second.board.guesses.map((g) => g.driverId)).toEqual([wrongId, wrongId]);

    // The row stores ids only -- never tiles.
    const [row] = await db
      .select()
      .from(dailyProgress)
      .where(and(eq(dailyProgress.userId, userId), eq(dailyProgress.date, today)));
    expect(row.guesses).toEqual([wrongId, wrongId]);
    expect(row.completed).toBe(false);
    expect(row.won).toBeNull();
    // dailyStateFor hydrates the same board (tiles recomputed, not read back).
    const hydrated = await dailyStateFor(userId);
    expect(hydrated.guesses.map((g) => g.driverId)).toEqual([wrongId, wrongId]);
  });

  it("hides the target mid-game and reveals it once solved", async () => {
    const mid = await dailySubmitGuessFor(userId, wrongId);
    expect(mid.board.target).toBeNull();

    const solved = await dailySubmitGuessFor(userId, targetId);
    expect(solved.board.completed).toBe(true);
    expect(solved.board.won).toBe(true);
    expect(solved.justCompleted).toBe(true);
    expect(solved.board.target?.driverId).toBe(targetId);
  });

  it("rejects further guesses on a completed day, returning current state", async () => {
    const solved = await dailySubmitGuessFor(userId, targetId);
    expect(solved.board.completed).toBe(true);
    const guessesAtWin = solved.board.guesses.map((g) => g.driverId);

    const afterWin = await dailySubmitGuessFor(userId, wrongId);
    // No append happened; the board is unchanged and nothing "just completed".
    expect(afterWin.board.guesses.map((g) => g.driverId)).toEqual(guessesAtWin);
    expect(afterWin.justCompleted).toBe(false);

    const [row] = await db
      .select()
      .from(dailyProgress)
      .where(and(eq(dailyProgress.userId, userId), eq(dailyProgress.date, today)));
    expect(row.guesses).toEqual(guessesAtWin);
  });

  it("records stats exactly once even if the completing guess is replayed", async () => {
    const first = await dailySubmitGuessFor(userId, targetId);
    expect(first.justCompleted).toBe(true);

    // Replay the same completing guess -- rejected, so no second stats write.
    const replay = await dailySubmitGuessFor(userId, targetId);
    expect(replay.justCompleted).toBe(false);

    const results = await db.select().from(dailyResults).where(eq(dailyResults.userId, userId));
    expect(results).toHaveLength(1);

    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, userId));
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.currentStreak).toBe(1);
  });
});
