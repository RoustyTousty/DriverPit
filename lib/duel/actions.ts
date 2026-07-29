"use server";

import { and, desc, eq, gt, ne, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { duelForfeit, duelState } from "@/lib/db/duelRpc";
import { duelMatches, duelRoundResults, duelRounds, userStats } from "@/lib/db/schema";
import { updateDuelRatings } from "@/lib/game/duelRating";
import { DISCONNECT_GRACE_MS } from "@/lib/game/duelTiming";
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

// --- applyMatchRatings ---------------------------------------------------
//
// beginRound and closeRound used to live here as Server Actions. They're now
// direct browser->PostgREST calls (lib/duel/roundLifecycle.ts) against the
// duel_begin_round_client / duel_close_round_client wrappers -- see
// drizzle/0034 for why: a serverless invocation plus three sequential Supabase
// round trips sat on the path between one round ending and the next starting,
// and that latency was being deducted from the countdown itself.
//
// This is the one piece that could NOT move. The Elo math is a unit-tested
// TypeScript function (lib/game/duelRating.ts); reimplementing it in plpgsql
// would leave two definitions of the same rules to drift apart. So closing a
// round is a warm RPC, and writing the ratings it produced stays here -- called
// separately, and only when that close actually finished the match, which is
// the one moment in a duel where latency costs nothing (the match is over and
// the results panel has its own loading state).

export type ApplyMatchRatingsResult =
  | { ok: true; ratingDeltaA: number; ratingDeltaB: number }
  | { ok: false; error: string };

// Idempotent, and it has to be: with the close itself now client-side, this is
// a second call rather than the same server-side breath, so it can be reached
// twice (both clients observing the finish, a retry, a reconnecting client) or
// -- if a client dies between the two -- reached late by whoever gets there
// next. The lock plus the rating_delta_a null check inside applyMatchResult
// make every call after the first a read.
export async function applyMatchRatings(matchId: number): Promise<ApplyMatchRatingsResult> {
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

  try {
    const { ratingDeltaA, ratingDeltaB } = await applyMatchResult(
      matchId,
      match.playerA,
      match.playerB,
      match.winnerId,
    );
    return { ok: true, ratingDeltaA, ratingDeltaB };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to record the result." };
  }
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
//
// FORFEITING SOMEONE ELSE NEEDS SERVER-VERIFIED ABSENCE. The checks used to be
// "the caller is a participant" and "the target is a participant" -- both true
// of an attacker forfeiting their live opponent mid-match, which set
// winner_id = attacker and wrote real Elo: a guaranteed win on demand, farming
// the column the leaderboard sorts on (audit 2026-07-27 §3.3). The client-side
// DISCONNECT_GRACE_MS timer was the entire enforcement. Now the absent player's
// own liveness heartbeat (drizzle/0040) has to agree, and the comparison is
// evaluated IN THE DATABASE alongside the row read -- both timestamps then come
// off the same clock, and it costs no extra round trip. Forfeiting *yourself*
// is unconditional, as it must be: it is how Exit and sign-out work.
export async function forfeitMatch(matchId: number, forfeitedPlayerId?: string): Promise<ForfeitMatchResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const graceSeconds = DISCONNECT_GRACE_MS / 1000;
  const [match] = await db
    .select({
      playerA: duelMatches.playerA,
      playerB: duelMatches.playerB,
      absentA: sql<boolean>`now() - ${duelMatches.lastSeenA} > (${graceSeconds}::double precision * interval '1 second')`,
      absentB: sql<boolean>`now() - ${duelMatches.lastSeenB} > (${graceSeconds}::double precision * interval '1 second')`,
    })
    .from(duelMatches)
    .where(eq(duelMatches.id, matchId));
  if (!match) return { ok: false, error: "Match not found." };
  if (match.playerA !== userId && match.playerB !== userId) {
    return { ok: false, error: "You are not part of this match." };
  }

  const forfeited = forfeitedPlayerId ?? userId;
  if (forfeited !== match.playerA && forfeited !== match.playerB) {
    return { ok: false, error: "That player is not part of this match." };
  }

  if (forfeited !== userId && !(forfeited === match.playerA ? match.absentA : match.absentB)) {
    // Not an error state for the honest caller: their grace timer retries, and
    // a still-present opponent means there was nothing to declare. Only a
    // forged call sees this as a dead end.
    return { ok: false, error: "Your opponent is still connected." };
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

// --- declineRematch -------------------------------------------------------

export type DeclineRematchResult = { ok: true } | { ok: false; error: string };

// Clears the pending intent, so a decline is genuinely undone server-side and
// not merely hidden client-side. Without it `rematch_requested_by` stays
// pointing at the asker: if the decliner later changed their mind and pressed
// Rematch, requestRematch would find the other player's id still sitting there
// and create the match on the spot -- yanking someone who was told "declined"
// into a duel they never re-accepted.
//
// The `ne` guard means this only ever clears intent that ISN'T the caller's
// own, so a stale decline click can't cancel a fresh request the opponent made
// afterwards.
export async function declineRematch(matchId: number): Promise<DeclineRematchResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const [match] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
  if (!match) return { ok: false, error: "Match not found." };
  if (match.playerA !== userId && match.playerB !== userId) {
    return { ok: false, error: "You are not part of this match." };
  }

  await db
    .update(duelMatches)
    .set({ rematchRequestedBy: null })
    .where(and(eq(duelMatches.id, matchId), ne(duelMatches.rematchRequestedBy, userId)));

  return { ok: true };
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

// Writes both players' user_stats (rating + W/L) and caches the deltas on
// duel_matches (CLAUDE.md's schema: "stored at finish for the results screen")
// so a reload can read them back via duel_state instead of needing the live
// match_end broadcast.
//
// EXACTLY ONCE PER MATCH, and duel_matches.rating_delta_a is what enforces it.
// This used to lean on the caller for that: it ran inside the same Server
// Action as duel_close_round, so that RPC's own row lock -- which hands
// `advanced: true` to exactly one racing caller -- meant this could only be
// reached once. Closing a round is now a separate client-side RPC, so that
// coupling is gone and the guarantee has to live here. Both players' clients
// observe the same finish and both call in; a forfeit can land on top of a
// finish; a reconnecting client can arrive late.
//
// The null check alone would be a check-then-act race (two callers both read
// null, both apply, ratings move twice). Taking the match row FOR UPDATE first
// serializes them, so the second caller reads the row the first one wrote and
// returns those deltas instead of applying its own.
async function applyMatchResult(
  matchId: number,
  playerA: string,
  playerB: string,
  winnerId: string | null,
): Promise<{ ratingDeltaA: number; ratingDeltaB: number }> {
  return db.transaction(async (tx) => {
    const [match] = await tx.select().from(duelMatches).where(eq(duelMatches.id, matchId)).for("update");
    if (!match) return { ratingDeltaA: 0, ratingDeltaB: 0 };

    // Already settled -- report what was actually written, don't re-apply.
    // Checked on A alone because both are written in the one statement below.
    if (match.ratingDeltaA !== null) {
      return { ratingDeltaA: match.ratingDeltaA, ratingDeltaB: match.ratingDeltaB ?? 0 };
    }

    const [statsA] = await tx.select().from(userStats).where(eq(userStats.userId, playerA));
    const [statsB] = await tx.select().from(userStats).where(eq(userStats.userId, playerB));
    if (!statsA || !statsB) return { ratingDeltaA: 0, ratingDeltaB: 0 };

    const outcome = winnerId === null ? "draw" : winnerId === playerA ? "a" : "b";
    const { ratingA, ratingB } = updateDuelRatings(statsA.duelRating, statsB.duelRating, outcome);
    const ratingDeltaA = ratingA - statsA.duelRating;
    const ratingDeltaB = ratingB - statsB.duelRating;

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

    await tx.update(duelMatches).set({ ratingDeltaA, ratingDeltaB }).where(eq(duelMatches.id, matchId));

    return { ratingDeltaA, ratingDeltaB };
  });
}
