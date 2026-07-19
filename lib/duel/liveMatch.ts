// The reusable "live match" core described in CLAUDE.md's Duel section:
// server-stamped round timing, a channel/event shape, and scoring hooks
// that don't assume exactly 2 participants at the data-model level
// (duel_rounds / duel_round_results are keyed by match+round+user, not by
// "player A/B"). Knockout will reuse duel_rounds-shaped timing and
// duelScoring.ts as-is; its own elimination/lobby logic is out of scope
// here (see CLAUDE.md "Knockout (planned)").

// Keep in sync with drizzle/0013_duel_round_lifecycle.sql, which
// hardcodes the same two durations when it stamps round 0 at match
// creation time.
export const REVEAL_MS = 5_000;
export const ROUND_MS = 45_000;
export const ROUND_TRANSITION_MS = 3_000;
export const MAX_ROUNDS = 3;

export function duelChannelName(matchId: number): string {
  return `duel:${matchId}`;
}

// Top ~10 shown on the closest-guesses board (CLAUDE.md's Duel UI section).
export const CLOSEST_BOARD_SIZE = 10;

export const ROUND_START_EVENT = "round-start";
export const SCORE_UPDATE_EVENT = "score-update";
export const MATCH_END_EVENT = "match-end";
export const OPPONENT_PROGRESS_EVENT = "opponent-progress";
export const REMATCH_READY_EVENT = "rematch-ready";

export interface RoundStartPayload {
  roundIndex: number;
  startedAt: string;
  endsAt: string;
  // Carried here too (not just in a separate ScoreUpdatePayload) because a
  // round can end via DNF timeout with no winning guess at all -- the only
  // moment that score change is known is exactly when the round advances,
  // so it has to ride along on this broadcast for the client that didn't
  // trigger the advance itself to ever see it.
  scoreA: number;
  scoreB: number;
}

export interface ScoreUpdatePayload {
  scoreA: number;
  scoreB: number;
}

export interface MatchEndPayload {
  winnerId: string | null;
  scoreA: number;
  scoreB: number;
}

// The *only* thing ever broadcast about an opponent's guessing -- a 0-1
// temperature (lib/game/duelScoring.ts#guessHeat) and a count, never their
// guessed driver or the per-attribute result. See CLAUDE.md: "never their
// guessed names or the driver."
export interface OpponentProgressPayload {
  roundIndex: number;
  guessCount: number;
  bestHeat: number;
  solved: boolean;
}

export interface RematchReadyPayload {
  newMatchId: number;
}
