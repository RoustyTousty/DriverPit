"use server";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { dailyResults, userStats } from "@/lib/db/schema";
import { MAX_GUESSES } from "@/lib/game/constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { StatsState } from "./store";

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Called once per completed daily round, from the same two spots in
// DailyGame.tsx that used to call the old localStorage recordResult(). The
// daily_results insert is the idempotency guard: if it doesn't happen
// (already recorded today for this user), the user_stats update is
// skipped entirely -- makes this safe to call more than once for the same
// day (retries, a stray duplicate call) without inflating the count.
export async function recordDailyResult(won: boolean, guessCount: number): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };

  const date = todayUtcDateString();

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(dailyResults)
      .values({ userId, date, won, guessCount })
      .onConflictDoNothing()
      .returning({ userId: dailyResults.userId });

    if (inserted.length === 0) {
      return { ok: true };
    }

    const [current] = await tx.select().from(userStats).where(eq(userStats.userId, userId));
    if (!current) return { ok: false };

    const index = Math.min(Math.max(guessCount, 1), MAX_GUESSES) - 1;
    const nextDistribution = [...current.guessDistribution];
    if (won) nextDistribution[index] = (nextDistribution[index] ?? 0) + 1;

    await tx
      .update(userStats)
      .set({
        gamesPlayed: current.gamesPlayed + 1,
        wins: current.wins + (won ? 1 : 0),
        currentStreak: won ? current.currentStreak + 1 : 0,
        maxStreak: won ? Math.max(current.maxStreak, current.currentStreak + 1) : current.maxStreak,
        guessDistribution: nextDistribution,
        lastResult: { won, guessCount },
      })
      .where(eq(userStats.userId, userId));

    return { ok: true };
  });
}

// One-time merge of pre-existing localStorage stats into the caller's real
// user_stats row, called only when a guest becomes a full account (see
// AuthProvider's migration effect). Local data predates any server
// history by construction (the server only started recording once this
// feature shipped), so it can't be a continuation of an in-progress
// server streak once the server has its own -- currentStreak only adopts
// the local value when the server row has no history yet.
export async function migrateLocalStats(local: StatsState): Promise<{ ok: boolean }> {
  if (local.gamesPlayed <= 0) return { ok: true };

  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(userStats).where(eq(userStats.userId, userId));
    if (!current) return { ok: false };

    const mergedDistribution = current.guessDistribution.map(
      (count, i) => count + (local.guessDistribution[i] ?? 0),
    );
    const hasServerHistory = current.gamesPlayed > 0;

    await tx
      .update(userStats)
      .set({
        gamesPlayed: current.gamesPlayed + local.gamesPlayed,
        wins: current.wins + local.gamesWon,
        guessDistribution: mergedDistribution,
        maxStreak: Math.max(current.maxStreak, local.maxStreak),
        currentStreak: hasServerHistory ? current.currentStreak : local.currentStreak,
      })
      .where(eq(userStats.userId, userId));

    return { ok: true };
  });
}

// Backs SettingsModal's "Reset stats" button.
export async function resetUserStats(): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };

  await db
    .update(userStats)
    .set({
      gamesPlayed: 0,
      wins: 0,
      currentStreak: 0,
      maxStreak: 0,
      guessDistribution: Array(MAX_GUESSES).fill(0),
      lastResult: null,
    })
    .where(eq(userStats.userId, userId));

  return { ok: true };
}
