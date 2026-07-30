"use server";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, userStats } from "@/lib/db/schema";
import { getDailyPuzzleNumber } from "@/lib/game/dailySelection";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { emptyDistribution, mergeDistributions } from "./guessDistribution";
import { sanitizeLocalStats } from "./localStatsMerge";
import { recordDailyResultForUser } from "./recordDailyResult";
import { todayUtcDateString } from "./streak";
import type { StatsState } from "./store";

// EVERY export in this file is a "use server" endpoint. Its action id ships in
// the client bundle, so each one is reachable from a devtools console with
// arguments of the caller's choosing -- a plain HTTP endpoint that happens to
// look like a function call. The rule the whole file follows: a parameter is
// for something the server genuinely cannot know. Outcomes ("I won", "in 1
// guess", "my opponent left") are not that; they are already recorded
// server-side, so they are read, not accepted (audit 2026-07-27 §3.2/§3.7).
async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Called once per completed daily round. Resolves the user from cookies, and
// the day and its outcome from daily_progress inside the database -- see
// ./recordDailyResult for why none of that is a parameter any more. Takes no
// arguments at all now, which is the point: there is nothing left to forge.
export async function recordDailyResult(): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };

  const result = await recordDailyResultForUser(userId);
  return { ok: result.ok };
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
//
// THIS IS THE ONE ACTION THAT MUST TAKE CLIENT DATA. Pre-accounts stats exist
// nowhere but the player's own browser, so the payload can only come from them.
// Three defences replace the trust that used to be implicit (audit §3.7), and
// all three are needed -- any one alone leaves the leaderboard reachable:
//
//   1. VALIDATED. sanitizeLocalStats bounds every field against how many daily
//      puzzles have existed and against each other. Unbounded numbers landed
//      directly in max_streak, a public leaderboard column.
//   2. ONCE, SERVER-SIDE. user_stats.local_stats_merged_at is the marker, taken
//      under a row lock. The old "once" was readStats() self-clearing on the
//      client -- which an attacker calling the action in a loop simply doesn't
//      run, and each call ADDED again. The marker lives on user_stats and not
//      on profiles because profiles still carries a table-wide client UPDATE
//      policy (audit §3.6): a marker the client can clear is not a marker.
//   3. FULL ACCOUNTS ONLY. is_guest is read here rather than assumed from the
//      caller being in an upgrade flow, which is a client-side notion.
export async function migrateLocalStats(local: StatsState): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };

  const clean = sanitizeLocalStats(local, getDailyPuzzleNumber(todayUtcDateString()));
  // Nothing mergeable. Reported as success so AuthProvider clears the local
  // blob and stops retrying -- a payload that will never be accepted shouldn't
  // re-run this effect on every profile refresh.
  if (!clean) return { ok: true };

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ isGuest: profiles.isGuest })
      .from(profiles)
      .where(eq(profiles.id, userId));
    if (!profile || profile.isGuest) return { ok: false };

    // FOR UPDATE, not a bare read: two concurrent calls would otherwise both
    // see a null marker and both merge. Same check-then-act trap
    // applyMatchResult (lib/duel/actions.ts) locks the match row for.
    const [current] = await tx.select().from(userStats).where(eq(userStats.userId, userId)).for("update");
    if (!current) return { ok: false };
    if (current.localStatsMergedAt !== null) return { ok: true };

    // Built from MAX_GUESSES, never from either input's length (audit
    // 2026-07-29 §0.4). This was `current.guessDistribution.map(...)`, and
    // `.map` preserves the RECEIVER's length -- so merging into one of the
    // five-bucket rows drizzle/0016 never backfilled dropped exactly the
    // legacy player's 6-guess wins and left the row five buckets forever.
    const mergedDistribution = mergeDistributions(current.guessDistribution, clean.guessDistribution);
    const hasServerHistory = current.gamesPlayed > 0;

    await tx
      .update(userStats)
      .set({
        gamesPlayed: current.gamesPlayed + clean.gamesPlayed,
        wins: current.wins + clean.gamesWon,
        guessDistribution: mergedDistribution,
        maxStreak: Math.max(current.maxStreak, clean.maxStreak),
        currentStreak: hasServerHistory ? current.currentStreak : clean.currentStreak,
        localStatsMergedAt: new Date(),
      })
      // The marker is re-asserted in the predicate as well as set in the SET:
      // belt-and-braces against a future caller that forgets the lock above.
      .where(and(eq(userStats.userId, userId), isNull(userStats.localStatsMergedAt)));

    return { ok: true };
  });
}

// Backs SettingsModal's "Reset stats" button. Deliberately does NOT clear
// local_stats_merged_at: that marker records "this account has already spent
// its one legacy merge", which stays true after a reset. Clearing it would hand
// the merge back a second time.
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
      guessDistribution: emptyDistribution(),
      lastResult: null,
      lastDailyDate: null,
    })
    .where(eq(userStats.userId, userId));

  return { ok: true };
}
