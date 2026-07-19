"use server";

import { desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { leaderboard } from "@/lib/db/schema";

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
}

// Backs the Leaderboard modal. Reads the `leaderboard` view (public columns
// only, full accounts only — see drizzle/0009_leaderboard_view.sql) rather
// than profiles/user_stats directly, so this can never accidentally select
// a column that shouldn't be shown to every visitor.
export async function getLeaderboard(): Promise<Leaderboard> {
  const [duelRows, streakRows] = await Promise.all([
    db.select().from(leaderboard).orderBy(desc(leaderboard.duelRating)).limit(BOARD_SIZE),
    db.select().from(leaderboard).orderBy(desc(leaderboard.currentStreak)).limit(BOARD_SIZE),
  ]);

  return {
    duelBoard: duelRows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      duelRating: row.duelRating,
      duelWins: row.duelWins,
      duelLosses: row.duelLosses,
    })),
    streakBoard: streakRows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      currentStreak: row.currentStreak,
      maxStreak: row.maxStreak,
    })),
  };
}
