import { eq } from "drizzle-orm";

import { db } from "../db";
import { dailyResults, userStats } from "../db/schema";
import { MAX_GUESSES } from "../game/constants";

// The core of recordDailyResult (lib/stats/actions.ts), parameterized on an
// explicit user id + UTC date. Kept in a plain (non-"use server") module on
// purpose: a "use server" export taking a user id would be a client-callable
// action that lets anyone write any user's stats -- so the only way in is the
// cookie-resolved recordDailyResult() action, which supplies the caller's own
// id. /daily invokes that action once, on the guess that ends the day.
//
// The daily_results insert is the idempotency guard: if it doesn't happen
// (already recorded for this user/date), the user_stats update is skipped
// entirely -- so this is safe to call more than once for the same day (retries,
// a second device, a re-hydration) without inflating the count.
export async function recordDailyResultForUser(
  userId: string,
  won: boolean,
  guessCount: number,
  date: string,
): Promise<{ ok: boolean }> {
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
