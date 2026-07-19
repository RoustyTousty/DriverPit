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

export const ROUND_START_EVENT = "round-start";
export const SCORE_UPDATE_EVENT = "score-update";
export const MATCH_END_EVENT = "match-end";

export interface RoundStartPayload {
  roundIndex: number;
  startedAt: string;
  endsAt: string;
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
