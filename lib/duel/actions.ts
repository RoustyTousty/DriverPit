"use server";

import { and, desc, eq, gt, notInArray, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { duelBeginRound, duelCloseRound, duelForfeit, duelState, type DuelRevealedDriver } from "@/lib/db/duelRpc";
import { duelMatches, duelRoundResults, duelRounds, userStats } from "@/lib/db/schema";
import { updateDuelRatings } from "@/lib/game/duelRating";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { MatchResult } from "./matchmaking";

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

// --- beginRound ------------------------------------------------------------

export type BeginRoundResult =
  | { ok: true; roundIndex: number; startedAt: string; endsAt: string; matchStatus: string }
  | { ok: false; error: string };

// Client-facing wrapper for public.duel_begin_round() (drizzle/0021) --
// that RPC runs over the trusted Drizzle connection (lib/db/duelRpc.ts),
// not supabase.rpc(), so it can't be called straight from the browser the
// way duel_submit_guess can; this Server Action is the one warm-enough hop
// for it (called once per ready-gate, not per guess, so cold start here
// isn't the latency-critical path duel_submit_guess is).
//
// Ready-gated: call once both clients report ready on the duel:{matchId}
// channel (useDuelChannel) or READY_TIMEOUT_MS elapses (CLAUDE.md's Duel
// "Flow" step 4) -- idempotent, so both clients calling it is expected and
// safe; whichever gets there first actually stamps started_at/ends_at, the
// other gets the same values echoed back.
export async function beginRound(matchId: number, roundIndex: number): Promise<BeginRoundResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const [match] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
  if (!match) return { ok: false, error: "Match not found." };
  if (match.playerA !== userId && match.playerB !== userId) {
    return { ok: false, error: "You are not part of this match." };
  }

  try {
    const round = await duelBeginRound(matchId, roundIndex);
    return { ok: true, ...round };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to start the round." };
  }
}

// --- closeRound --------------------------------------------------------
//
// Guess evaluation itself doesn't live here -- it's the
// public.duel_submit_guess() RPC (drizzle/0022_duel_submit_guess_rpc.sql),
// called directly from the client (lib/duel/submitGuess.ts) as one warm hop
// with no Vercel function in the path, per CLAUDE.md's "Instant guesses".
// Closing the round out is also a Postgres function
// (public.duel_close_round, drizzle/0021) over the trusted connection
// (lib/db/duelRpc.ts), so it needs this Server Action wrapper the same way
// beginRound does.

// Reveal fields, common to both the "advance" and "match finished"
// outcomes -- CLAUDE.md's Duel "Intermission" needs the same target
// reveal + per-round points regardless of whether another round follows.
interface CloseRoundReveal {
  roundIndex: number;
  pointsA: number;
  pointsB: number;
  targetDriver: DuelRevealedDriver;
  intermissionEndsAt: string;
}

export type CloseRoundResult =
  | { ok: true; advanced: false }
  | ({ ok: true; advanced: true; matchFinished: false; nextRoundIndex: number; scoreA: number; scoreB: number } & CloseRoundReveal)
  | ({
      ok: true;
      advanced: true;
      matchFinished: true;
      winnerId: string | null;
      scoreA: number;
      scoreB: number;
      ratingDeltaA: number;
      ratingDeltaB: number;
    } & CloseRoundReveal)
  | { ok: false; error: string };

// Client-triggered, idempotent: call whenever a client observes both
// players done (solved or timer expired) for the match's current round.
// duel_close_round's own `FOR UPDATE` lock on the match row (not this
// action) is what actually serializes concurrent callers -- whichever call
// wins the lock performs the transition; every other call (this client's
// own safety-net poll, the opponent's equivalent call, a retry) re-reads
// the now-updated row and comes back `advanced: false`, so applyMatchResult
// below only ever runs once per match, however many times this is called.
// Doesn't stamp the next round itself -- on `advanced: true, matchFinished:
// false`, the caller (DuelMatch) shows the intermission reveal for
// intermissionEndsAt, then a fresh ready-gate, before its own beginRound
// call -- see CLAUDE.md's Duel "Intermission".
export async function closeRound(matchId: number, roundIndex: number): Promise<CloseRoundResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const [match] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
  if (!match) return { ok: false, error: "Match not found." };
  if (match.playerA !== userId && match.playerB !== userId) {
    return { ok: false, error: "You are not part of this match." };
  }

  let result;
  try {
    result = await duelCloseRound(matchId, roundIndex);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to close the round." };
  }

  if (!result.advanced) return { ok: true, advanced: false };

  // Only the no-op branch omits these -- checked above, so every field
  // below is non-null on both outcomes past this point.
  const reveal: CloseRoundReveal = {
    roundIndex,
    pointsA: result.pointsA!,
    pointsB: result.pointsB!,
    targetDriver: result.targetDriver!,
    intermissionEndsAt: result.intermissionEndsAt!,
  };

  if (result.matchStatus === "finished") {
    const { ratingDeltaA, ratingDeltaB } = await applyMatchResult(
      matchId,
      match.playerA,
      match.playerB,
      result.winnerId,
    );
    return {
      ok: true,
      advanced: true,
      matchFinished: true,
      winnerId: result.winnerId,
      scoreA: result.scoreA,
      scoreB: result.scoreB,
      ratingDeltaA,
      ratingDeltaB,
      ...reveal,
    };
  }

  return {
    ok: true,
    advanced: true,
    matchFinished: false,
    // duel_close_round only omits this when matchStatus is 'finished'
    // (checked above), so it's always a number on this branch.
    nextRoundIndex: result.nextRoundIndex as number,
    scoreA: result.scoreA,
    scoreB: result.scoreB,
    ...reveal,
  };
}

// --- forfeitMatch -------------------------------------------------------

export type ForfeitMatchResult =
  | {
      ok: true;
      // The now-settled match status ('abandoned' when this call performed
      // the forfeit; whatever it already was on a no-op repeat).
      status: string;
      winnerId: string | null;
      // false = the match was already terminal; nothing was written.
      forfeited: boolean;
    }
  | { ok: false; error: string };

// CLAUDE.md "Exit, forfeit & disconnect". `forfeitedPlayerId` is whoever is
// leaving -- omitted on explicit exit (the caller forfeits themselves), or
// the absent opponent's id when the remaining player declares the forfeit
// after DISCONNECT_GRACE_MS. Idempotent through duel_forfeit's own row-lock
// guard (see drizzle/0026): however many times this is called, from either
// side, the status flip and the rating/record write happen exactly once.
export async function forfeitMatch(matchId: number, forfeitedPlayerId?: string): Promise<ForfeitMatchResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const [match] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
  if (!match) return { ok: false, error: "Match not found." };
  if (match.playerA !== userId && match.playerB !== userId) {
    return { ok: false, error: "You are not part of this match." };
  }

  const forfeited = forfeitedPlayerId ?? userId;
  if (forfeited !== match.playerA && forfeited !== match.playerB) {
    return { ok: false, error: "That player is not part of this match." };
  }

  let result;
  try {
    result = await duelForfeit(matchId, forfeited);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to forfeit the match." };
  }

  if (result.advanced) {
    // Ratings + W/L records, written server-side exactly once (advanced is
    // true for exactly one call per match) -- same split as closeRound's
    // normal finish: the RPC settles match state, this writes the stats.
    await applyMatchResult(matchId, match.playerA, match.playerB, result.winnerId);
  }

  return { ok: true, status: result.matchStatus, winnerId: result.winnerId, forfeited: result.advanced };
}

// --- getDuelState (resume/reconnect) ------------------------------------

export interface DuelResumeState {
  ok: true;
  matchStatus: string;
  currentRound: number;
  // Null while the current round isn't stamped yet (lobby, or the
  // intermission gap between duel_close_round and the next
  // duel_begin_round).
  startedAt: string | null;
  endsAt: string | null;
  serverNow: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  mySolved: boolean;
}

export type GetDuelStateResult = DuelResumeState | { ok: false; error: string };

// The duel_state RPC (CLAUDE.md "Server authority": "a reloaded client
// rejoins at the right beat"), auth-scoped to participants. Unlike
// getDuelRoundState this tolerates the round row not existing yet --
// startedAt/endsAt just come back null, telling the caller it landed
// between rounds.
export async function getDuelState(matchId: number): Promise<GetDuelStateResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const state = await duelState(matchId);
  if (!state) return { ok: false, error: "Match not found." };
  if (state.playerA.id !== userId && state.playerB.id !== userId) {
    return { ok: false, error: "You are not part of this match." };
  }

  let mySolved = false;
  if (state.roundStartedAt !== null) {
    const [myResult] = await db
      .select()
      .from(duelRoundResults)
      .where(
        and(
          eq(duelRoundResults.matchId, matchId),
          eq(duelRoundResults.roundIndex, state.currentRound),
          eq(duelRoundResults.userId, userId),
        ),
      );
    mySolved = myResult?.solvedAt != null;
  }

  return {
    ok: true,
    matchStatus: state.matchStatus,
    currentRound: state.currentRound,
    startedAt: state.roundStartedAt,
    endsAt: state.roundEndsAt,
    serverNow: state.serverNow,
    scoreA: state.scoreA,
    scoreB: state.scoreB,
    winnerId: state.winnerId,
    mySolved,
  };
}

// --- getMyLiveMatch (resume after reload) -------------------------------

// A match old enough that no legitimate play can still be going on (a full
// 3-round match is ~4 minutes end to end) -- keeps a zombie row (e.g. both
// players closed their tabs during staging, so nobody was left to call
// duel_forfeit) from trapping the player in a resume loop forever.
const RESUME_MAX_AGE_MS = 15 * 60 * 1000;

export type GetMyLiveMatchResult =
  | { ok: true; match: MatchResult | null; matchStatus: string | null }
  | { ok: false; error: string };

// On /online mount: is there a live (non-terminal) match this user should be
// back inside? Returns everything DuelRoot needs to rehydrate -- the
// MatchResult shape the normal matchmaking path produces, plus the status
// so it can pick the right phase (lobby -> staging, anything else ->
// straight into the match view, which re-derives its own beat from
// getDuelState). Finished/abandoned matches are deliberately excluded:
// they show their terminal result only if the client was already in them
// when they ended, never by re-entering from a fresh visit.
export async function getMyLiveMatch(): Promise<GetMyLiveMatchResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const [match] = await db
    .select()
    .from(duelMatches)
    .where(
      and(
        or(eq(duelMatches.playerA, userId), eq(duelMatches.playerB, userId)),
        notInArray(duelMatches.status, ["finished", "abandoned"]),
        gt(duelMatches.createdAt, new Date(Date.now() - RESUME_MAX_AGE_MS)),
      ),
    )
    .orderBy(desc(duelMatches.createdAt))
    .limit(1);
  if (!match) return { ok: true, match: null, matchStatus: null };

  const state = await duelState(match.id);
  if (!state) return { ok: true, match: null, matchStatus: null };

  const youAre = match.playerA === userId ? "a" : "b";
  const opponent = youAre === "a" ? state.playerB : state.playerA;
  const [opponentStats] = await db.select().from(userStats).where(eq(userStats.userId, opponent.id));

  return {
    ok: true,
    matchStatus: state.matchStatus,
    match: {
      matchId: match.id,
      opponentId: opponent.id,
      opponentUsername: opponent.username,
      opponentDisplayName: opponent.displayName,
      opponentAvatarUrl: opponent.avatarUrl,
      opponentRating: opponent.rating,
      opponentDuelWins: opponentStats?.duelWins ?? 0,
      opponentDuelLosses: opponentStats?.duelLosses ?? 0,
      youAre,
      matchCreatedAt: match.createdAt.toISOString(),
    },
  };
}

// --- getDuelResults -----------------------------------------------------

export interface DuelRoundBreakdownRow {
  roundIndex: number;
  myPoints: number;
  theirPoints: number;
  // Milliseconds from round start to that player's solve; null = DNF.
  mySolveMs: number | null;
  theirSolveMs: number | null;
}

export interface DuelResultsData {
  ok: true;
  status: string; // finished | abandoned
  winnerId: string | null;
  myScore: number;
  theirScore: number;
  // Read from duel_matches.rating_delta_a/b -- stored server-side at finish
  // (closeRound -> applyMatchResult). The client only ever *reads* these;
  // nothing rating-related is ever computed or written client-side.
  myRatingDelta: number | null;
  rounds: DuelRoundBreakdownRow[];
}

export type GetDuelResultsResult = DuelResultsData | { ok: false; error: string };

// Everything the post-match results panel shows, in one fetch -- works the
// same whether this client just watched the match finish or reloaded onto a
// finished match cold. Per-round solve times come from duel_round_results'
// server-stamped solved_at against duel_rounds' started_at, so both
// players' times are comparable (same clock stamped both).
export async function getDuelResults(matchId: number): Promise<GetDuelResultsResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const [match] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
  if (!match) return { ok: false, error: "Match not found." };
  if (match.playerA !== userId && match.playerB !== userId) {
    return { ok: false, error: "You are not part of this match." };
  }
  if (match.status !== "finished" && match.status !== "abandoned") {
    return { ok: false, error: "Match hasn't finished yet." };
  }

  const iAmA = match.playerA === userId;

  const rounds = await db.select().from(duelRounds).where(eq(duelRounds.matchId, matchId));
  const results = await db.select().from(duelRoundResults).where(eq(duelRoundResults.matchId, matchId));

  const breakdown: DuelRoundBreakdownRow[] = rounds
    .sort((a, b) => a.roundIndex - b.roundIndex)
    .map((round) => {
      const mine = results.find((r) => r.roundIndex === round.roundIndex && r.userId === userId);
      const theirs = results.find((r) => r.roundIndex === round.roundIndex && r.userId !== userId);
      // Clamped at 0: duel_submit_guess accepts a solve up to 2s before
      // started_at (clock-drift grace, drizzle/0025) and scores it as
      // msToSolve=0 -- mirror that here rather than showing "-1.2s".
      const solveMs = (result: typeof mine) =>
        result?.solvedAt ? Math.max(0, result.solvedAt.getTime() - round.startedAt.getTime()) : null;
      return {
        roundIndex: round.roundIndex,
        myPoints: mine?.points ?? 0,
        theirPoints: theirs?.points ?? 0,
        mySolveMs: solveMs(mine),
        theirSolveMs: solveMs(theirs),
      };
    });

  return {
    ok: true,
    status: match.status,
    winnerId: match.winnerId,
    myScore: iAmA ? match.scoreA : match.scoreB,
    theirScore: iAmA ? match.scoreB : match.scoreA,
    myRatingDelta: iAmA ? match.ratingDeltaA : match.ratingDeltaB,
    rounds: breakdown,
  };
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
// broadcasting it (REMATCH_EVENT on the old match's channel) so the
// still-waiting side (which only saw `newMatchId: null` from its own
// call) transitions too.
//
// The new match is created as status 'lobby' with NO round row -- round 0
// is stamped by duel_begin_round only after both clients pass the rematch
// ready-gate in DuelMatch, exactly like a fresh match. (This used to
// pre-stamp round 0 at creation, the same timer-running-before-both-loaded
// bug class the whole lifecycle exists to prevent.)
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

    const [newMatch] = await tx
      .insert(duelMatches)
      .values({ playerA: oldMatch.playerA, playerB: oldMatch.playerB, status: "lobby", currentRound: 0 })
      .returning();

    return { ok: true, newMatchId: newMatch.id };
  });
}

// Called at most once per match -- see closeRound's comment on why
// duel_close_round's row lock guarantees that regardless of how many
// clients/times call it. Writes both players' user_stats (rating + W/L)
// and caches the deltas on duel_matches (CLAUDE.md's schema: "stored at
// finish for the results screen") so a reload can read them back via
// duel_state instead of needing the live match_end broadcast.
async function applyMatchResult(
  matchId: number,
  playerA: string,
  playerB: string,
  winnerId: string | null,
): Promise<{ ratingDeltaA: number; ratingDeltaB: number }> {
  const [statsA] = await db.select().from(userStats).where(eq(userStats.userId, playerA));
  const [statsB] = await db.select().from(userStats).where(eq(userStats.userId, playerB));
  if (!statsA || !statsB) return { ratingDeltaA: 0, ratingDeltaB: 0 };

  const outcome = winnerId === null ? "draw" : winnerId === playerA ? "a" : "b";
  const { ratingA, ratingB } = updateDuelRatings(statsA.duelRating, statsB.duelRating, outcome);
  const ratingDeltaA = ratingA - statsA.duelRating;
  const ratingDeltaB = ratingB - statsB.duelRating;

  await db
    .update(userStats)
    .set({
      duelRating: ratingA,
      duelWins: statsA.duelWins + (outcome === "a" ? 1 : 0),
      duelLosses: statsA.duelLosses + (outcome === "b" ? 1 : 0),
    })
    .where(eq(userStats.userId, playerA));

  await db
    .update(userStats)
    .set({
      duelRating: ratingB,
      duelWins: statsB.duelWins + (outcome === "b" ? 1 : 0),
      duelLosses: statsB.duelLosses + (outcome === "a" ? 1 : 0),
    })
    .where(eq(userStats.userId, playerB));

  await db.update(duelMatches).set({ ratingDeltaA, ratingDeltaB }).where(eq(duelMatches.id, matchId));

  return { ratingDeltaA, ratingDeltaB };
}
