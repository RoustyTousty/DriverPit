// The duel:{matchId} broadcast contract (CLAUDE.md's "Realtime channels"),
// exactly the six events and shapes listed there -- one shared module so the
// client (lib/duel/useDuelChannel.ts) and whichever client is relaying a
// server-authoritative transition (round advance, match finish, forfeit)
// can't drift on event names or payload shape. Opponent data is always
// abstracted here (heat/counts/points), never a driver identifier or name --
// see CLAUDE.md: "never their guessed names or the driver."

export const ROUND_START_EVENT = "round_start";
export const GUESS_EVENT = "guess";
export const SOLVED_EVENT = "solved";
export const ROUND_END_EVENT = "round_end";
export const MATCH_END_EVENT = "match_end";
export const FORFEIT_EVENT = "forfeit";
export const READY_EVENT = "ready";

// Readiness signal -- deliberately a broadcast, not a presence `track()`
// field. Presence has its own, much stricter Supabase rate limit ("Client
// presence rate limit exceeded") that a single match can trip on its own:
// every ready-gate (pre-match hold, then once per round's intermission)
// calls sendReady()/resetReady() at least once, and that's on top of
// whatever the pre-match staging channel already tracked -- a handful of
// rounds is enough to exceed it and get the whole channel force-closed by
// the server (silently, with no reconnect). Broadcast has no such ceiling
// in practice (guess/solved already fire one per keystroke-equivalent all
// match with no issue), so readiness rides on it instead; presence is kept
// for the one thing it's actually needed for -- join/leave membership,
// via a single track() call per subscription, never repeated.
export interface ReadyPayload {
  playerId: string;
  ready: boolean;
}

export interface RoundStartPayload {
  roundIndex: number;
  startedAt: string; // ISO, absolute server timestamp
  endsAt: string;
}

// Opponent guessed again -- abstracted activity, drives the "rival closing
// in" read and the live tug-of-war bar. Never the guessed driver.
export interface GuessPayload {
  playerId: string;
  guessCount: number;
  bestHeat: number; // 0-1, lib/game/duelScoring.ts#guessHeat
  provisionalPoints: number; // locked speed points once solved, else best-guess proximity
}

// Opponent solved the round -- the "+N" burst and bar jump.
export interface SolvedPayload {
  playerId: string;
  points: number;
  solveMs: number;
}

// Same shape as lib/duel/submitGuess.ts's DuelGuessedDriverSummary --
// declared separately here since this module is the single source of truth
// for realtime payload shapes and shouldn't reach into the guess-RPC
// module (or vice versa) just to share a structurally-identical type.
export interface DuelPublicDriver {
  id: number;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
}

// Round closed -- reveals the target (only ever disclosed here, never
// during an active round) and both players' round points/running score, so
// clients can animate the reveal card + point count-up + bar settle.
export interface RoundEndPayload {
  roundIndex: number;
  targetDriverPublic: DuelPublicDriver;
  pointsA: number;
  pointsB: number;
  scoreA: number;
  scoreB: number;
  intermissionEndsAt: string;
}

export interface DuelRoundBreakdownEntry {
  roundIndex: number;
  pointsA: number;
  pointsB: number;
}

export interface MatchEndPayload {
  winnerId: string | null;
  scoreA: number;
  scoreB: number;
  ratingDeltaA: number;
  ratingDeltaB: number;
  breakdown: DuelRoundBreakdownEntry[];
}

// Explicit exit or a disconnect-grace-period timeout on the other client's
// end (CLAUDE.md's "Exit, forfeit & disconnect") -- `playerId` is whoever
// forfeited (or was declared forfeited on behalf of).
export interface ForfeitPayload {
  playerId: string;
}

export const REMATCH_EVENT = "rematch";

// Sent on the OLD match's channel by whichever client's requestRematch
// call actually created the new match (the second requester) -- the only
// way the first requester, sitting on "Waiting for opponent…", learns the
// rematch exists. Both clients then transition and meet on the new
// duel:{newMatchId} channel for the rematch ready-gate.
export interface RematchPayload {
  newMatchId: number;
}
