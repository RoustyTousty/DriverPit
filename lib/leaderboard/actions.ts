"use server";

import { count, desc, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db";
import { leaderboard } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BOARD_SIZE = 50;

interface LeaderboardPerson {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string;
}

export interface DuelLeaderboardEntry extends LeaderboardPerson {
  duelRating: number;
  duelWins: number;
  duelLosses: number;
}

export interface StreakLeaderboardEntry extends LeaderboardPerson {
  currentStreak: number;
  maxStreak: number;
}

export interface Leaderboard {
  duelBoard: DuelLeaderboardEntry[];
  streakBoard: StreakLeaderboardEntry[];
  // Populated only when the caller has a ranked (full-account) row that
  // isn't already among the returned rows above -- lets the modal show
  // "you're #N" beneath the top slots instead of the viewer never seeing
  // themselves at all. Undefined, not just a low rank, for "not ranked" /
  // "already visible up top" so the UI doesn't need to re-derive either.
  myDuelRank?: { rank: number; entry: DuelLeaderboardEntry };
  myStreakRank?: { rank: number; entry: StreakLeaderboardEntry };
}

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Backs the Leaderboard modal. Reads the `leaderboard` view (public columns
// only, full accounts only — see drizzle/0009_leaderboard_view.sql) rather
// than profiles/user_stats directly, so this can never accidentally select
// a column that shouldn't be shown to every visitor.
export async function getLeaderboard(): Promise<Leaderboard> {
  const userId = await getCurrentUserId();

  const [duelRows, streakRows] = await Promise.all([
    db.select().from(leaderboard).orderBy(desc(leaderboard.duelRating)).limit(BOARD_SIZE),
    db.select().from(leaderboard).orderBy(desc(leaderboard.currentStreak)).limit(BOARD_SIZE),
  ]);

  const duelBoard: DuelLeaderboardEntry[] = duelRows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    duelRating: row.duelRating,
    duelWins: row.duelWins,
    duelLosses: row.duelLosses,
  }));
  const streakBoard: StreakLeaderboardEntry[] = streakRows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    currentStreak: row.currentStreak,
    maxStreak: row.maxStreak,
  }));

  if (!userId) {
    return { duelBoard, streakBoard };
  }

  const [myDuelRank, myStreakRank] = await Promise.all([
    duelBoard.some((entry) => entry.id === userId) ? undefined : getMyDuelRank(userId),
    streakBoard.some((entry) => entry.id === userId) ? undefined : getMyStreakRank(userId),
  ]);

  return { duelBoard, streakBoard, myDuelRank, myStreakRank };
}

// Not just "position within the fetched BOARD_SIZE rows" -- a plain count
// of everyone with a strictly higher metric, so a caller far outside the
// top BOARD_SIZE (which this app doesn't have yet, but will) still gets
// their real rank rather than an undefined one.
async function getMyDuelRank(userId: string): Promise<{ rank: number; entry: DuelLeaderboardEntry } | undefined> {
  const [me] = await db.select().from(leaderboard).where(eq(leaderboard.id, userId));
  if (!me) return undefined;

  const [{ value: higherCount }] = await db
    .select({ value: count() })
    .from(leaderboard)
    .where(gt(leaderboard.duelRating, me.duelRating));

  return {
    rank: higherCount + 1,
    entry: {
      id: me.id,
      username: me.username,
      displayName: me.displayName,
      avatarUrl: me.avatarUrl,
      duelRating: me.duelRating,
      duelWins: me.duelWins,
      duelLosses: me.duelLosses,
    },
  };
}

async function getMyStreakRank(userId: string): Promise<{ rank: number; entry: StreakLeaderboardEntry } | undefined> {
  const [me] = await db.select().from(leaderboard).where(eq(leaderboard.id, userId));
  if (!me) return undefined;

  const [{ value: higherCount }] = await db
    .select({ value: count() })
    .from(leaderboard)
    .where(gt(leaderboard.currentStreak, me.currentStreak));

  return {
    rank: higherCount + 1,
    entry: {
      id: me.id,
      username: me.username,
      displayName: me.displayName,
      avatarUrl: me.avatarUrl,
      currentStreak: me.currentStreak,
      maxStreak: me.maxStreak,
    },
  };
}
