"use server";

import { and, eq } from "drizzle-orm";

import {
  getDriverById,
  getRandomPoolDriverId,
  toDriverSummary,
  toGameDriver,
  type DriverSummary,
} from "@/lib/db/queries";
import { db } from "@/lib/db";
import { duelMatches, duelRoundResults, duelRounds, userStats } from "@/lib/db/schema";
import { compare, isWin, type GuessResult } from "@/lib/game/compare";
import { proximityPoints, speedPoints } from "@/lib/game/duelScoring";
import { updateDuelRatings } from "@/lib/game/duelRating";
import { DAILY_POOL_WINDOW } from "@/lib/game/poolWindow";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { MAX_ROUNDS, REVEAL_MS, ROUND_MS, ROUND_TRANSITION_MS } from "./liveMatch";

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// --- getDuelRoundState ------------------------------------------------

export interface DuelRoundState {
  ok: true;
  matchStatus: string;
  roundIndex: number;
  startedAt: string;
  endsAt: string;
  serverNow: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  mySolved: boolean;
  myGuessCount: number;
}
export type GetDuelRoundStateResult = DuelRoundState | { ok: false; error: string };

// Everything the client needs to render the current round -- deliberately
// never includes duel_rounds.driver_id (the target). Also doubles as the
// clock-offset ping: the client measures its own round-trip around this
// call and compares `serverNow` against local time once, at match/round
// start, per CLAUDE.md's "ping server time once to estimate offset".
export async function getDuelRoundState(matchId: number): Promise<GetDuelRoundStateResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const [match] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
  if (!match) return { ok: false, error: "Match not found." };
  if (match.playerA !== userId && match.playerB !== userId) {
    return { ok: false, error: "You are not part of this match." };
  }

  const [round] = await db
    .select()
    .from(duelRounds)
    .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, match.currentRound)));
  if (!round) return { ok: false, error: "Round not found." };

  const [myResult] = await db
    .select()
    .from(duelRoundResults)
    .where(
      and(
        eq(duelRoundResults.matchId, matchId),
        eq(duelRoundResults.roundIndex, match.currentRound),
        eq(duelRoundResults.userId, userId),
      ),
    );

  return {
    ok: true,
    matchStatus: match.status,
    roundIndex: round.roundIndex,
    startedAt: round.startedAt.toISOString(),
    endsAt: round.endsAt.toISOString(),
    serverNow: new Date().toISOString(),
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    winnerId: match.winnerId,
    mySolved: myResult?.solvedAt != null,
    myGuessCount: myResult?.guessCount ?? 0,
  };
}

// --- submitDuelGuess ----------------------------------------------------

export type SubmitDuelGuessResult =
  | {
      ok: true;
      guessedDriver: DriverSummary;
      result: GuessResult;
      won: boolean;
      points: number | null;
      scoreA: number;
      scoreB: number;
    }
  | { ok: false; error: string };

// Guesses are unlimited within the round timer (unlike daily/infinite's 5
// cap) -- validated and scored here, server-side, exactly like
// app/daily/actions.ts#submitDailyGuess, just against a per-round target
// and with duelScoring's speed points on a win.
export async function submitDuelGuess(
  matchId: number,
  guessedDriverId: number,
): Promise<SubmitDuelGuessResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  return db.transaction(async (tx) => {
    // Locks the match row for the duration of this guess so it can't be
    // finalized (DNF'd) by a concurrent tryAdvanceRound call out from
    // under us mid-submission -- see tryAdvanceRound's matching lock.
    const [match] = await tx.select().from(duelMatches).where(eq(duelMatches.id, matchId)).for("update");
    if (!match) return { ok: false, error: "Match not found." };
    if (match.playerA !== userId && match.playerB !== userId) {
      return { ok: false, error: "You are not part of this match." };
    }
    if (match.status !== "active") return { ok: false, error: "This match has ended." };

    const [round] = await tx
      .select()
      .from(duelRounds)
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, match.currentRound)));
    if (!round) return { ok: false, error: "Round not found." };

    const now = new Date();
    if (now >= round.endsAt) return { ok: false, error: "Time's up for this round." };

    const [existing] = await tx
      .select()
      .from(duelRoundResults)
      .where(
        and(
          eq(duelRoundResults.matchId, matchId),
          eq(duelRoundResults.roundIndex, match.currentRound),
          eq(duelRoundResults.userId, userId),
        ),
      );
    if (existing?.solvedAt) return { ok: false, error: "You already solved this round." };

    const [guessedRow, targetRow] = await Promise.all([
      getDriverById(guessedDriverId),
      getDriverById(round.driverId),
    ]);
    if (!guessedRow) return { ok: false, error: "Pick a driver from the suggestions list." };
    if (!targetRow) return { ok: false, error: "This round's target is unavailable." };

    const result = compare(toGameDriver(guessedRow), toGameDriver(targetRow), now);
    const won = isWin(result);
    const nextGuessCount = (existing?.guessCount ?? 0) + 1;

    let points: number | null = null;
    let nextBestProximity = existing ? Number(existing.bestProximity ?? 0) : 0;

    if (won) {
      const roundMs = round.endsAt.getTime() - round.startedAt.getTime();
      const msToSolve = now.getTime() - round.startedAt.getTime();
      points = speedPoints(msToSolve, roundMs);
    } else {
      nextBestProximity = Math.max(nextBestProximity, proximityPoints(result));
    }

    await tx
      .insert(duelRoundResults)
      .values({
        matchId,
        roundIndex: match.currentRound,
        userId,
        guessCount: nextGuessCount,
        solvedAt: won ? now : null,
        bestProximity: String(nextBestProximity),
        points: points ?? 0,
      })
      .onConflictDoUpdate({
        target: [duelRoundResults.matchId, duelRoundResults.roundIndex, duelRoundResults.userId],
        set: {
          guessCount: nextGuessCount,
          solvedAt: won ? now : null,
          bestProximity: String(nextBestProximity),
          points: points ?? 0,
        },
      });

    let scoreA = match.scoreA;
    let scoreB = match.scoreB;
    if (won && points !== null) {
      if (match.playerA === userId) scoreA += points;
      else scoreB += points;
      await tx.update(duelMatches).set({ scoreA, scoreB }).where(eq(duelMatches.id, matchId));
    }

    return {
      ok: true,
      guessedDriver: toDriverSummary(guessedRow, now),
      result,
      won,
      points,
      scoreA,
      scoreB,
    };
  });
}

// --- tryAdvanceRound ------------------------------------------------------

export type TryAdvanceRoundResult =
  | { ok: true; advanced: false }
  | {
      ok: true;
      advanced: true;
      matchFinished: false;
      round: { roundIndex: number; startedAt: string; endsAt: string };
      scoreA: number;
      scoreB: number;
    }
  | {
      ok: true;
      advanced: true;
      matchFinished: true;
      winnerId: string | null;
      scoreA: number;
      scoreB: number;
    }
  | { ok: false; error: string };

// Client-triggered, idempotent: call whenever a client observes both
// players done (solved or timer expired) for the current round. Whichever
// call actually performs the advance is decided by the `FOR UPDATE` lock
// on the match row below -- the same guarded-transaction pattern
// match_or_queue() uses for pairing, just blocking-and-recheck instead of
// SKIP LOCKED (there's exactly one row of interest here, not a pool of
// candidates). A second, near-simultaneous call re-reads the row only
// after the first commits, sees the round has already moved on (or the
// match has finished), and naturally no-ops.
export async function tryAdvanceRound(matchId: number): Promise<TryAdvanceRoundResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  return db.transaction(async (tx) => {
    const [match] = await tx.select().from(duelMatches).where(eq(duelMatches.id, matchId)).for("update");
    if (!match) return { ok: false, error: "Match not found." };
    if (match.playerA !== userId && match.playerB !== userId) {
      return { ok: false, error: "You are not part of this match." };
    }
    if (match.status !== "active") return { ok: true, advanced: false };

    const [round] = await tx
      .select()
      .from(duelRounds)
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, match.currentRound)));
    if (!round) return { ok: false, error: "Round not found." };

    const results = await tx
      .select()
      .from(duelRoundResults)
      .where(and(eq(duelRoundResults.matchId, matchId), eq(duelRoundResults.roundIndex, match.currentRound)));

    const now = new Date();
    const roundExpired = now >= round.endsAt;
    const aResult = results.find((r) => r.userId === match.playerA);
    const bResult = results.find((r) => r.userId === match.playerB);
    const aDone = aResult?.solvedAt != null || roundExpired;
    const bDone = bResult?.solvedAt != null || roundExpired;

    if (!aDone || !bDone) return { ok: true, advanced: false };

    let scoreA = match.scoreA;
    let scoreB = match.scoreB;

    // Finalize DNF scoring for anyone who ran the clock out without
    // solving -- upsert since a player who never guessed at all this
    // round has no duel_round_results row yet.
    async function finalizeDnf(playerId: string, existingRow: typeof aResult) {
      if (existingRow?.solvedAt != null) return 0;
      const dnfPoints = Math.round(Number(existingRow?.bestProximity ?? 0));
      await tx
        .insert(duelRoundResults)
        .values({
          matchId,
          roundIndex: match.currentRound,
          userId: playerId,
          guessCount: existingRow?.guessCount ?? 0,
          solvedAt: null,
          bestProximity: existingRow?.bestProximity ?? "0",
          points: dnfPoints,
        })
        .onConflictDoUpdate({
          target: [duelRoundResults.matchId, duelRoundResults.roundIndex, duelRoundResults.userId],
          set: { points: dnfPoints },
        });
      return dnfPoints;
    }

    scoreA += await finalizeDnf(match.playerA, aResult);
    scoreB += await finalizeDnf(match.playerB, bResult);

    const isLastRound = match.currentRound >= MAX_ROUNDS - 1;

    if (isLastRound) {
      const winnerId = scoreA === scoreB ? null : scoreA > scoreB ? match.playerA : match.playerB;
      await tx
        .update(duelMatches)
        .set({ status: "finished", scoreA, scoreB, winnerId, finishedAt: now })
        .where(eq(duelMatches.id, matchId));

      await applyMatchResult(tx, match.playerA, match.playerB, winnerId);

      return { ok: true, advanced: true, matchFinished: true, winnerId, scoreA, scoreB };
    }

    const nextRoundIndex = match.currentRound + 1;
    const nextStartedAt = new Date(now.getTime() + ROUND_TRANSITION_MS);
    const nextEndsAt = new Date(nextStartedAt.getTime() + ROUND_MS);
    const targetDriverId = await getRandomPoolDriverId(DAILY_POOL_WINDOW, new Date().getUTCFullYear());

    await tx.insert(duelRounds).values({
      matchId,
      roundIndex: nextRoundIndex,
      driverId: targetDriverId,
      startedAt: nextStartedAt,
      endsAt: nextEndsAt,
    });
    await tx.update(duelMatches).set({ currentRound: nextRoundIndex, scoreA, scoreB }).where(eq(duelMatches.id, matchId));

    return {
      ok: true,
      advanced: true,
      matchFinished: false,
      round: {
        roundIndex: nextRoundIndex,
        startedAt: nextStartedAt.toISOString(),
        endsAt: nextEndsAt.toISOString(),
      },
      scoreA,
      scoreB,
    };
  });
}

// --- requestRematch -------------------------------------------------------

export type RequestRematchResult =
  | { ok: true; newMatchId: number | null } // null = requested, waiting on the other player
  | { ok: false; error: string };

// Mutual-consent rematch: the first participant to call this just marks
// intent (rematch_requested_by) and waits. The second participant's call
// sees the *other* player's id already sitting there and creates the new
// match itself, right there, in the same transaction -- so exactly one of
// the two calls ever actually creates it, no matter how the timing lands.
// Whichever client gets a real newMatchId back is responsible for
// broadcasting it on the old match's channel so the still-waiting side
// (which only sees `newMatchId: null` from its own call) finds out.
export async function requestRematch(oldMatchId: number): Promise<RequestRematchResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  return db.transaction(async (tx) => {
    const [oldMatch] = await tx.select().from(duelMatches).where(eq(duelMatches.id, oldMatchId)).for("update");
    if (!oldMatch) return { ok: false, error: "Match not found." };
    if (oldMatch.playerA !== userId && oldMatch.playerB !== userId) {
      return { ok: false, error: "You are not part of this match." };
    }
    if (oldMatch.status !== "finished") return { ok: false, error: "Match hasn't finished yet." };

    if (oldMatch.rematchRequestedBy === null || oldMatch.rematchRequestedBy === userId) {
      await tx.update(duelMatches).set({ rematchRequestedBy: userId }).where(eq(duelMatches.id, oldMatchId));
      return { ok: true, newMatchId: null };
    }

    const targetDriverId = await getRandomPoolDriverId(DAILY_POOL_WINDOW, new Date().getUTCFullYear());
    const [newMatch] = await tx
      .insert(duelMatches)
      .values({ playerA: oldMatch.playerA, playerB: oldMatch.playerB, status: "active", currentRound: 0 })
      .returning();

    const startedAt = new Date(newMatch.createdAt.getTime() + REVEAL_MS);
    const endsAt = new Date(startedAt.getTime() + ROUND_MS);
    await tx.insert(duelRounds).values({
      matchId: newMatch.id,
      roundIndex: 0,
      driverId: targetDriverId,
      startedAt,
      endsAt,
    });

    return { ok: true, newMatchId: newMatch.id };
  });
}

// tx is a Drizzle transaction handle (same shape as `db`, scoped to the
// enclosing transaction) -- typed structurally via the query methods used
// rather than importing postgres-js's internal transaction type.
async function applyMatchResult(
  tx: { select: typeof db.select; update: typeof db.update },
  playerA: string,
  playerB: string,
  winnerId: string | null,
) {
  const [statsA] = await tx.select().from(userStats).where(eq(userStats.userId, playerA));
  const [statsB] = await tx.select().from(userStats).where(eq(userStats.userId, playerB));
  if (!statsA || !statsB) return;

  const outcome = winnerId === null ? "draw" : winnerId === playerA ? "a" : "b";
  const { ratingA, ratingB } = updateDuelRatings(statsA.duelRating, statsB.duelRating, outcome);

  await tx
    .update(userStats)
    .set({
      duelRating: ratingA,
      duelWins: statsA.duelWins + (outcome === "a" ? 1 : 0),
      duelLosses: statsA.duelLosses + (outcome === "b" ? 1 : 0),
    })
    .where(eq(userStats.userId, playerA));

  await tx
    .update(userStats)
    .set({
      duelRating: ratingB,
      duelWins: statsB.duelWins + (outcome === "b" ? 1 : 0),
      duelLosses: statsB.duelLosses + (outcome === "a" ? 1 : 0),
    })
    .where(eq(userStats.userId, playerB));
}
