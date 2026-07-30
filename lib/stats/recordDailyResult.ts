import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "../db";
import { dailyProgress, dailyResults, userStats } from "../db/schema";
import { MAX_GUESSES } from "../game/constants";
import { normalizeDistribution } from "./guessDistribution";
import { nextCurrentStreak } from "./streak";

// The core of recordDailyResult (lib/stats/actions.ts), parameterized on an
// explicit user id. Kept in a plain (non-"use server") module on purpose: a
// "use server" export taking a user id would be a client-callable action that
// lets anyone write any user's stats -- so the only way in is the
// cookie-resolved recordDailyResult() action, which supplies the caller's own
// id. /daily invokes that action once, on the guess that ends the day.
//
// NOTHING ABOUT THE OUTCOME IS A PARAMETER. `won`, `guessCount` and the UTC day
// used to be arguments, which meant a "use server" export whose action id ships
// in the /daily bundle would take `(true, 1)` from a devtools console and write
// a win, a 1-guess distribution bucket and an extended streak for a day the
// player never finished (audit 2026-07-27 §3.2). The daily_results PK guard did
// not stop that -- it stops a *replay*, and a forgery is a different threat;
// worse, being first-write-wins, the forged row also SUPPRESSED that day's
// honest result. All three now come off daily_progress, the server-authoritative
// board daily_submit_guess maintains precisely so the client isn't trusted.
// Anyone can still call the action; the worst it can do is re-record a result
// they genuinely earned, which the guard already made a no-op.
//
// The daily_results insert is still the idempotency guard: if it doesn't happen
// (already recorded for this user/date), the user_stats update is skipped
// entirely -- so this is safe to call more than once for the same day (retries,
// a second device, a re-hydration) without inflating the count.
export type RecordDailyResultOutcome =
  | { ok: true; recorded: boolean }
  // No completed board to record. Not an error the player should ever see on
  // the real path -- /daily only calls this on the guess that completed the day.
  | { ok: false; reason: "no-completed-day" | "no-stats-row" };

export async function recordDailyResultForUser(userId: string): Promise<RecordDailyResultOutcome> {
  return db.transaction(async (tx) => {
    // The day is resolved by the DATABASE clock, the same clock
    // daily_submit_guess stamps daily_progress.date with -- never the Next.js
    // server clock, which is a different machine. Skew between the two (or a
    // request straddling 00:00Z) used to write daily_results under date D+-1
    // from the daily_progress row it describes, and nextCurrentStreak then read
    // that as a 0- or 2-day gap and silently reset a live streak
    // (audit §3.10).
    //
    // Yesterday is in range for exactly that straddle: a day completed at
    // 23:59:59Z whose record call lands after midnight still belongs to the day
    // it was played. Nothing older, because recording a stale day would write a
    // last_daily_date that runs BACKWARDS past a newer one and restart a live
    // streak at 1. A daily_progress row can only reach `completed` during its
    // own UTC day (daily_submit_guess only ever touches today's row), so
    // "newest completed row within the last two days" is always the day the
    // caller just finished.
    const [progress] = await tx
      .select({
        date: dailyProgress.date,
        won: dailyProgress.won,
        guesses: dailyProgress.guesses,
      })
      .from(dailyProgress)
      .where(
        and(
          eq(dailyProgress.userId, userId),
          eq(dailyProgress.completed, true),
          gte(dailyProgress.date, sql`((now() AT TIME ZONE 'UTC')::date - 1)`),
        ),
      )
      .orderBy(desc(dailyProgress.date))
      .limit(1);

    if (!progress) return { ok: false, reason: "no-completed-day" };

    const date = progress.date;
    const won = progress.won ?? false;
    const guessCount = progress.guesses.length;

    const inserted = await tx
      .insert(dailyResults)
      .values({ userId, date, won, guessCount })
      .onConflictDoNothing()
      .returning({ userId: dailyResults.userId });

    if (inserted.length === 0) {
      return { ok: true, recorded: false };
    }

    const [current] = await tx.select().from(userStats).where(eq(userStats.userId, userId));
    if (!current) return { ok: false, reason: "no-stats-row" };

    const index = Math.min(Math.max(guessCount, 1), MAX_GUESSES) - 1;
    // normalizeDistribution, not a plain spread: a row created between
    // drizzle/0007 and drizzle/0016 still holds FIVE buckets (0016 moved the
    // default and backfilled nothing). A spread kept it five, so the row only
    // ever healed if the player happened to win in exactly six guesses -- the
    // one index whose write extends the array. Doing it here means every such
    // row self-heals on its next result of any kind, which is a backfill
    // migration's job done without a migration that could miss a row.
    const nextDistribution = normalizeDistribution(current.guessDistribution);
    if (won) nextDistribution[index] += 1;

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

    return { ok: true, recorded: true };
  });
}
