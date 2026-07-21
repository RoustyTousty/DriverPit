import { sql } from "drizzle-orm";

import { db } from "./index";

// Thin wrappers around the round-lifecycle Postgres functions in
// drizzle/0021_duel_lifecycle_rpcs.sql -- called over the same trusted
// Drizzle connection as everything else in lib/db/ (never through
// supabase.rpc(), which is reserved for match_or_queue's client-callable,
// auth.uid()-gated path). Row shapes are exact column names from the SQL
// RETURNS TABLE, mapped to camelCase here -- same convention as
// lib/duel/matchmaking.ts's MatchOrQueueRow (no `supabase gen types` wiring
// in this repo yet).

// Drizzle's postgres-js driver disables the underlying client's automatic
// timestamptz parsing (it wants to control date handling itself, based on
// each column's declared mode) -- that disabling is a mutation of the
// shared client, so it applies to *our* raw db.execute() calls too, not
// just drizzle's own query builder. Timestamp columns from these RPCs
// therefore come back as Postgres's text format (e.g.
// "2026-07-21 11:47:16.419236+00"), not JS Date objects -- normalize
// through `new Date()` to get a real ISO 8601 string for the client.
function toIso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export interface DuelBeginRoundResult {
  roundIndex: number;
  startedAt: string;
  endsAt: string;
  matchStatus: string;
  // Whether *this* call actually stamped the round (false = it already
  // existed, from an earlier or racing call) -- lets a caller distinguish
  // "I just started the clock" from "someone beat me to it" if it matters.
  newlyStarted: boolean;
}

interface DuelBeginRoundRow extends Record<string, unknown> {
  round_index: number;
  started_at: string;
  ends_at: string;
  match_status: string;
  newly_started: boolean;
}

// Ready-gated: call once both clients are ready (or READY_TIMEOUT_MS
// elapses -- lib/game/duelTiming.ts). Idempotent -- a second call for the
// same (matchId, roundIndex) is a no-op that reports back the first call's
// timestamps instead of re-stamping.
export async function duelBeginRound(matchId: number, roundIndex: number): Promise<DuelBeginRoundResult> {
  const rows = await db.execute<DuelBeginRoundRow>(
    sql`SELECT * FROM public.duel_begin_round(${matchId}, ${roundIndex})`,
  );
  const row = rows[0];
  if (!row) throw new Error(`duel_begin_round returned no row for match ${matchId} round ${roundIndex}`);
  return {
    roundIndex: row.round_index,
    startedAt: toIso(row.started_at)!,
    endsAt: toIso(row.ends_at)!,
    matchStatus: row.match_status,
    newlyStarted: row.newly_started,
  };
}

// Same shape as lib/duel/realtimeEvents.ts's DuelPublicDriver -- declared
// separately here (this module is the single source of truth for the RPC
// row shape) rather than importing it, same reasoning as that module's own
// comment on why it doesn't import DuelGuessedDriverSummary either.
export interface DuelRevealedDriver {
  id: number;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
}

export interface DuelCloseRoundResult {
  // Whether this call actually closed the round (false = still waiting on
  // a player, or the round was already closed by an earlier/racing call).
  advanced: boolean;
  matchStatus: string;
  currentRound: number;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  intermissionEndsAt: string | null;
  nextRoundIndex: number | null;
  // This round's earned points for each side (DNF proximity, or the locked
  // value from a solve) -- the intermission's "+N" count-up. Null on a
  // no-op (advanced: false) call, same as every field below.
  pointsA: number | null;
  pointsB: number | null;
  // The round that just closed's target -- safe to reveal now, never
  // before (CLAUDE.md: "disclosed only in the intermission, after the
  // round is closed").
  targetDriver: DuelRevealedDriver | null;
}

interface DuelCloseRoundRow extends Record<string, unknown> {
  advanced: boolean;
  match_status: string;
  current_round: number;
  score_a: number;
  score_b: number;
  winner_id: string | null;
  intermission_ends_at: string | null;
  next_round_index: number | null;
  points_a: number | null;
  points_b: number | null;
  target_driver_id: number | null;
  target_full_name: string | null;
  target_driver_code: string | null;
  target_nationality: string | null;
  target_team: string | null;
  target_age: number | null;
  target_debut_year: number | null;
  target_career_wins: number | null;
}

// Call whenever a client observes both players done (solved or timer
// expired) for the match's current round. Idempotent -- once the round has
// actually closed (match moved to 'intermission' or 'finished'), a repeat
// call is a no-op (`advanced: false`) rather than re-scoring or
// re-advancing.
export async function duelCloseRound(matchId: number, roundIndex: number): Promise<DuelCloseRoundResult> {
  const rows = await db.execute<DuelCloseRoundRow>(
    sql`SELECT * FROM public.duel_close_round(${matchId}, ${roundIndex})`,
  );
  const row = rows[0];
  if (!row) throw new Error(`duel_close_round returned no row for match ${matchId} round ${roundIndex}`);
  return {
    advanced: row.advanced,
    matchStatus: row.match_status,
    currentRound: row.current_round,
    scoreA: row.score_a,
    scoreB: row.score_b,
    winnerId: row.winner_id,
    intermissionEndsAt: toIso(row.intermission_ends_at),
    nextRoundIndex: row.next_round_index,
    pointsA: row.points_a,
    pointsB: row.points_b,
    targetDriver:
      row.target_driver_id === null
        ? null
        : {
            id: row.target_driver_id,
            fullName: row.target_full_name!,
            driverCode: row.target_driver_code,
            nationality: row.target_nationality!,
            team: row.target_team!,
            age: row.target_age!,
            debutYear: row.target_debut_year!,
            careerWins: row.target_career_wins!,
          },
  };
}

export interface DuelForfeitResult {
  // Whether this call actually performed the abandonment (false = the match
  // was already finished/abandoned; the other fields report that settled
  // state). The caller writes ratings (applyMatchResult) only on true, so
  // a repeat call -- from either player -- can never double-write them.
  advanced: boolean;
  matchStatus: string;
  winnerId: string | null;
  scoreA: number;
  scoreB: number;
}

interface DuelForfeitRow extends Record<string, unknown> {
  advanced: boolean;
  match_status: string;
  winner_id: string | null;
  score_a: number;
  score_b: number;
}

// Marks the match abandoned with the other player as winner. Idempotent and
// callable from either side: forfeitedPlayerId is whoever is *leaving* --
// the leaver themselves on explicit exit, or the absent opponent when the
// remaining player declares the forfeit after DISCONNECT_GRACE_MS. The
// calling server action is responsible for verifying the requesting user
// is a participant (same trust model as duelBeginRound/duelCloseRound).
export async function duelForfeit(matchId: number, forfeitedPlayerId: string): Promise<DuelForfeitResult> {
  const rows = await db.execute<DuelForfeitRow>(
    sql`SELECT * FROM public.duel_forfeit(${matchId}, ${forfeitedPlayerId})`,
  );
  const row = rows[0];
  if (!row) throw new Error(`duel_forfeit returned no row for match ${matchId}`);
  return {
    advanced: row.advanced,
    matchStatus: row.match_status,
    winnerId: row.winner_id,
    scoreA: row.score_a,
    scoreB: row.score_b,
  };
}

export interface DuelStatePlayer {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string;
  rating: number;
}

export interface DuelStateResult {
  matchStatus: string;
  currentRound: number;
  roundStartedAt: string | null;
  roundEndsAt: string | null;
  roundIntermissionEndsAt: string | null;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  ratingDeltaA: number | null;
  ratingDeltaB: number | null;
  playerA: DuelStatePlayer;
  playerB: DuelStatePlayer;
  serverNow: string;
}

interface DuelStateRow extends Record<string, unknown> {
  match_status: string;
  current_round: number;
  round_started_at: string | null;
  round_ends_at: string | null;
  round_intermission_ends_at: string | null;
  score_a: number;
  score_b: number;
  winner_id: string | null;
  rating_delta_a: number | null;
  rating_delta_b: number | null;
  player_a_id: string;
  player_a_username: string;
  player_a_display_name: string | null;
  player_a_avatar_url: string;
  player_a_rating: number;
  player_b_id: string;
  player_b_username: string;
  player_b_display_name: string | null;
  player_b_avatar_url: string;
  player_b_rating: number;
  server_now: string;
}

// Full current phase for resume/reconnect -- null if the match doesn't
// exist. Read-only (no idempotency concerns); round_started_at/ends_at/
// intermission_ends_at come back null when the current round hasn't been
// stamped yet (lobby/countdown, or intermission waiting on the next
// duel_begin_round call).
export async function duelState(matchId: number): Promise<DuelStateResult | null> {
  const rows = await db.execute<DuelStateRow>(sql`SELECT * FROM public.duel_state(${matchId})`);
  const row = rows[0];
  if (!row) return null;
  return {
    matchStatus: row.match_status,
    currentRound: row.current_round,
    roundStartedAt: toIso(row.round_started_at),
    roundEndsAt: toIso(row.round_ends_at),
    roundIntermissionEndsAt: toIso(row.round_intermission_ends_at),
    scoreA: row.score_a,
    scoreB: row.score_b,
    winnerId: row.winner_id,
    ratingDeltaA: row.rating_delta_a,
    ratingDeltaB: row.rating_delta_b,
    playerA: {
      id: row.player_a_id,
      username: row.player_a_username,
      displayName: row.player_a_display_name,
      avatarUrl: row.player_a_avatar_url,
      rating: row.player_a_rating,
    },
    playerB: {
      id: row.player_b_id,
      username: row.player_b_username,
      displayName: row.player_b_display_name,
      avatarUrl: row.player_b_avatar_url,
      rating: row.player_b_rating,
    },
    serverNow: toIso(row.server_now)!,
  };
}
