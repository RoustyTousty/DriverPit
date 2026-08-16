"use server";

import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { leaderboard } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LEADERBOARD_TOP_SLOTS } from "./constants";
import { dailyWinsRankSql, duelRankSql, streakRankSql } from "./rank";

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

// Ranked on `maxStreak` -- the lifetime best, not the live streak
// (drizzle/0060). `currentStreak` rides along because the view still carries
// it and it costs nothing; nothing orders or ranks by it.
export interface StreakLeaderboardEntry extends LeaderboardPerson {
  currentStreak: number;
  maxStreak: number;
}

// Daily puzzles won, all-time -- user_stats.wins, exposed on the view as
// `daily_wins` so it can't be mistaken for the duel record.
export interface WinsLeaderboardEntry extends LeaderboardPerson {
  dailyWins: number;
}

export interface Leaderboard {
  duelBoard: DuelLeaderboardEntry[];
  streakBoard: StreakLeaderboardEntry[];
  winsBoard: WinsLeaderboardEntry[];
  // Populated only when the caller has a ranked (full-account) row that
  // isn't already among the returned rows above -- lets the modal show
  // "you're #N" beneath the top slots instead of the viewer never seeing
  // themselves at all. Undefined, not just a low rank, for "not ranked" /
  // "already visible up top" so the UI doesn't need to re-derive either.
  myDuelRank?: { rank: number; entry: DuelLeaderboardEntry };
  myStreakRank?: { rank: number; entry: StreakLeaderboardEntry };
  myWinsRank?: { rank: number; entry: WinsLeaderboardEntry };
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
  // The three boards are public and don't depend on who is asking -- only the
  // "you're #N" row below does -- so the auth hop goes out alongside them
  // rather than in front of them (audit 2026-07-29 §1.6).
  //
  // Each ORDER BY carries `id` as a tie-break. Not cosmetic on these two new
  // boards: max streak and daily wins are small integers, so most accounts tie
  // with several others, and an unordered tie means the same board comes back
  // in a different order on the next fetch -- rows swapping places on reopen,
  // for no reason the player did. Same rule the recap's counts follow.
  const [userId, duelRows, streakRows, winsRows] = await Promise.all([
    getCurrentUserId(),
    db
      .select()
      .from(leaderboard)
      .orderBy(desc(leaderboard.duelRating), asc(leaderboard.id))
      .limit(LEADERBOARD_TOP_SLOTS),
    db
      .select()
      .from(leaderboard)
      .orderBy(desc(leaderboard.maxStreak), asc(leaderboard.id))
      .limit(LEADERBOARD_TOP_SLOTS),
    db
      .select()
      .from(leaderboard)
      .orderBy(desc(leaderboard.dailyWins), asc(leaderboard.id))
      .limit(LEADERBOARD_TOP_SLOTS),
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
  const winsBoard: WinsLeaderboardEntry[] = winsRows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    dailyWins: row.dailyWins,
  }));

  const boards = { duelBoard, streakBoard, winsBoard };

  if (!userId) {
    return boards;
  }

  // Already shown up top on every board: there is no rank row to add, so the
  // rank query is skipped entirely rather than run and discarded.
  const inDuelBoard = duelBoard.some((entry) => entry.id === userId);
  const inStreakBoard = streakBoard.some((entry) => entry.id === userId);
  const inWinsBoard = winsBoard.some((entry) => entry.id === userId);
  if (inDuelBoard && inStreakBoard && inWinsBoard) {
    return boards;
  }

  const me = await getMyRanks(userId);
  if (!me) return boards;

  return {
    ...boards,
    myDuelRank: inDuelBoard
      ? undefined
      : {
          rank: me.duelRank,
          entry: {
            id: me.id,
            username: me.username,
            displayName: me.displayName,
            avatarUrl: me.avatarUrl,
            duelRating: me.duelRating,
            duelWins: me.duelWins,
            duelLosses: me.duelLosses,
          },
        },
    myStreakRank: inStreakBoard
      ? undefined
      : {
          rank: me.streakRank,
          entry: {
            id: me.id,
            username: me.username,
            displayName: me.displayName,
            avatarUrl: me.avatarUrl,
            currentStreak: me.currentStreak,
            maxStreak: me.maxStreak,
          },
        },
    myWinsRank: inWinsBoard
      ? undefined
      : {
          rank: me.dailyWinsRank,
          entry: {
            id: me.id,
            username: me.username,
            displayName: me.displayName,
            avatarUrl: me.avatarUrl,
            dailyWins: me.dailyWins,
          },
        },
  };
}

// The viewer's row and ALL THREE of their ranks in one query.
//
// The ranks themselves mean what they always did; what changed is that saying
// so took four queries, two of which fetched the identical `me` row (audit
// 2026-07-29 §1.6). As correlated subqueries over that same row, the database
// does the counting it was already doing -- once, in one round trip. See
// ./rank.ts for the expressions and why they're written out there.
async function getMyRanks(userId: string) {
  const [me] = await db
    .select({
      id: leaderboard.id,
      username: leaderboard.username,
      displayName: leaderboard.displayName,
      avatarUrl: leaderboard.avatarUrl,
      duelRating: leaderboard.duelRating,
      duelWins: leaderboard.duelWins,
      duelLosses: leaderboard.duelLosses,
      currentStreak: leaderboard.currentStreak,
      maxStreak: leaderboard.maxStreak,
      dailyWins: leaderboard.dailyWins,
      duelRank: duelRankSql,
      streakRank: streakRankSql,
      dailyWinsRank: dailyWinsRankSql,
    })
    .from(leaderboard)
    .where(eq(leaderboard.id, userId));

  return me;
}
