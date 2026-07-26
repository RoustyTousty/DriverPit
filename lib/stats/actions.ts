"use server";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { userStats } from "@/lib/db/schema";
import { MAX_GUESSES } from "@/lib/game/constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { recordDailyResultForUser } from "./recordDailyResult";
import { todayUtcDateString } from "./streak";
import type { StatsState } from "./store";

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Called once per completed daily round. Resolves the user from cookies and
// the date from the server clock, then hands off to recordDailyResultForUser
// (the shared, idempotency-guarded core in ./recordDailyResult) -- the daily
// board's server-authoritative submit path calls that same core directly with
// the ids it already holds, so both routes flow through one daily_results
// guard and can't double-count.
export async function recordDailyResult(won: boolean, guessCount: number): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };

  return recordDailyResultForUser(userId, won, guessCount, todayUtcDateString());
}

// One-time merge of pre-existing localStorage stats into the caller's real
// user_stats row, called only when a guest becomes a full account (see
// AuthProvider's migration effect). Local data predates any server
// history by construction (the server only started recording once this
// feature shipped), so it can't be a continuation of an in-progress
// server streak once the server has its own -- currentStreak only adopts
// the local value when the server row has no history yet.
//
// The adopted streak is deliberately left UNANCHORED (last_daily_date stays
// null): localStorage stats never stored dates, so there's nothing to anchor it
// to, and inventing one would recreate the immortal streak drizzle/0037 fixes.
// An unanchored streak counts as broken -- it shows as 0 and the next result
// restarts at 1 (lib/stats/streak.ts). Trusting an undatable number forever is
// the exact bug that migration closes.
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
      lastDailyDate: null,
    })
    .where(eq(userStats.userId, userId));

  return { ok: true };
}
