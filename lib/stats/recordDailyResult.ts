import { eq } from "drizzle-orm";

import { db } from "../db";
import { dailyResults, userStats } from "../db/schema";
import { MAX_GUESSES } from "../game/constants";
import { nextCurrentStreak } from "./streak";

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

    // A win only EXTENDS the streak when it lands the day after the last
    // recorded result; any gap restarts it at 1 (lib/stats/streak.ts). This
    // used to be a flat `streak + 1`, which is why skipping days and then
    // winning kept the old streak. lastDailyDate is written on losses too, so
    // the column always means "the day of the last result" -- that's what lets
    // readers decide whether a streak is still alive.
    const streak = nextCurrentStreak({
      previousStreak: current.currentStreak,
      lastDailyDate: current.lastDailyDate,
      date,
      won,
    });

    await tx
      .update(userStats)
      .set({
        gamesPlayed: current.gamesPlayed + 1,
        wins: current.wins + (won ? 1 : 0),
        currentStreak: streak,
        maxStreak: Math.max(current.maxStreak, streak),
        guessDistribution: nextDistribution,
        lastResult: { won, guessCount },
        lastDailyDate: date,
      })
      .where(eq(userStats.userId, userId));

    return { ok: true };
  });
}
