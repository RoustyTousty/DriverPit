import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// The duel round lifecycle, called straight from the browser as one warm
// PostgREST hop -- the same path duel_submit_guess already uses
// (lib/duel/submitGuess.ts), per CLAUDE.md's "one warm hop, no Next.js in it".
//
// These were Next.js Server Actions (lib/duel/actions.ts), which put a
// serverless invocation plus three sequential Supabase round trips on the path
// between one round ending and the next starting. That latency doesn't just
// make the transition slow: a round's clock is stamped when the RPC runs but
// the client only learns when the response arrives, so every millisecond of it
// comes out of the countdown the player was supposed to watch. On a bad
// connection that meant no lights at all, and landing in a round already a
// third gone. See drizzle/0034 for the full write-up and the privilege hole it
// closed on the way.
//
// The RPCs called here are the *_client authorization wrappers, not the inner
// functions -- those are now revoked from every browser-reachable role.
//
// Errors come back as { ok: false, error } rather than throwing, matching the
// Server Actions these replaced and lib/duel/submitGuess.ts's own shape, so
// callers keep one way of handling a failed duel call.

// --- begin round ---------------------------------------------------------

export type BeginRoundResult =
  | {
      ok: true;
      roundIndex: number;
      startedAt: string;
      endsAt: string;
      matchStatus: string;
      // False when this call found the round already stamped -- expected, since
      // both clients' ready-gates fire and only the first one stamps.
      newlyStarted: boolean;
    }
  | { ok: false; error: string };

interface BeginRoundRow {
  round_index: number;
  started_at: string;
  ends_at: string;
  match_status: string;
  newly_started: boolean;
}

// Idempotent: call once the ready-gate passes. Whichever client gets there
// first stamps started_at/ends_at; the other gets the same values echoed back.
export async function beginRound(matchId: number, roundIndex: number): Promise<BeginRoundResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("duel_begin_round_client", { p_match_id: matchId, p_round_index: roundIndex })
    .single();

  if (error) return { ok: false, error: error.message || "Failed to start the round." };

  const row = data as BeginRoundRow;
  return {
    ok: true,
    roundIndex: row.round_index,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    matchStatus: row.match_status,
    newlyStarted: row.newly_started,
  };
}

// --- close round ---------------------------------------------------------

export interface CloseRoundRevealedDriver {
  id: number;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
}

// Reveal fields, common to both the "advance" and "match finished" outcomes --
// CLAUDE.md's Duel "Intermission" needs the same target reveal + per-round
// points regardless of whether another round follows.
interface CloseRoundReveal {
  roundIndex: number;
  pointsA: number;
  pointsB: number;
  targetDriver: CloseRoundRevealedDriver;
  intermissionEndsAt: string;
}

export type CloseRoundResult =
  | { ok: true; advanced: false }
  | ({ ok: true; advanced: true; matchFinished: false; nextRoundIndex: number; scoreA: number; scoreB: number } & CloseRoundReveal)
  // No ratingDelta* here, unlike the Server Action this replaced: ratings are
  // written by applyMatchRatings (lib/duel/actions.ts) in a separate call, so
  // the deltas come back from that, not from closing the round.
  | ({ ok: true; advanced: true; matchFinished: true; winnerId: string | null; scoreA: number; scoreB: number } & CloseRoundReveal)
  | { ok: false; error: string };

interface CloseRoundRow {
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

// Client-triggered, idempotent: call whenever this client observes both players
// done (solved or timer expired) for the match's current round.
// duel_close_round's own FOR UPDATE lock on the match row serializes concurrent
// callers -- whichever wins performs the transition; every other call (this
// client's safety-net poll, the opponent's equivalent call, a retry) re-reads
// the updated row and comes back advanced: false.
//
// Doesn't stamp the next round itself -- on advanced: true, matchFinished:
// false, the caller shows the intermission reveal for intermissionEndsAt, then
// a fresh ready-gate, before its own beginRound call (CLAUDE.md's Duel
// "Intermission").
export async function closeRound(matchId: number, roundIndex: number): Promise<CloseRoundResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("duel_close_round_client", { p_match_id: matchId, p_round_index: roundIndex })
    .single();

  if (error) return { ok: false, error: error.message || "Failed to close the round." };

  const row = data as CloseRoundRow;
  if (!row.advanced) return { ok: true, advanced: false };

  // Only the no-op branch above omits these, so everything below is non-null.
  const reveal: CloseRoundReveal = {
    roundIndex,
    pointsA: row.points_a!,
    pointsB: row.points_b!,
    targetDriver: {
      id: row.target_driver_id!,
      fullName: row.target_full_name!,
      driverCode: row.target_driver_code,
      nationality: row.target_nationality!,
      team: row.target_team!,
      age: row.target_age!,
      debutYear: row.target_debut_year!,
      careerWins: row.target_career_wins!,
    },
    intermissionEndsAt: row.intermission_ends_at!,
  };

  if (row.match_status === "finished") {
    return {
      ok: true,
      advanced: true,
      matchFinished: true,
      winnerId: row.winner_id,
      scoreA: row.score_a,
      scoreB: row.score_b,
      ...reveal,
    };
  }

  return {
    ok: true,
    advanced: true,
    matchFinished: false,
    // duel_close_round only omits this when the match finished (handled above).
    nextRoundIndex: row.next_round_index!,
    scoreA: row.score_a,
    scoreB: row.score_b,
    ...reveal,
  };
}
