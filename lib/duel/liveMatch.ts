// The reusable "live match" core described in CLAUDE.md's Duel section:
// match-shape constants shared by every duel surface. Round/phase timing
// lives in lib/game/duelTiming.ts (single source for all durations);
// realtime event names + payload shapes live in lib/duel/realtimeEvents.ts.
// Data-model-wise nothing here assumes exactly 2 participants
// (duel_rounds / duel_round_results are keyed by match+round+user, not by
// "player A/B") -- Knockout will reuse the same machinery with N players.

export const MAX_ROUNDS = 3;

export function duelChannelName(matchId: number): string {
  return `duel:${matchId}`;
}

// Top ~10 shown on the closest-guesses board (CLAUDE.md's Duel UI section).
export const CLOSEST_BOARD_SIZE = 10;
