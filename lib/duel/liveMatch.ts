// The reusable "live match" core described in CLAUDE.md's Duel section:
// match-shape constants shared by every duel surface. Round/phase timing
// lives in lib/game/duelTiming.ts (single source for all durations);
// realtime event names + payload shapes live in lib/duel/realtimeEvents.ts.
// Data-model-wise nothing here assumes exactly 2 participants
// (duel_rounds / duel_round_results are keyed by match+round+user, not by
// "player A/B") -- Knockout will reuse the same machinery with N players.

// How many rounds a MATCHMADE duel plays -- duel_matches.rounds' DEFAULT,
// mirrored here for the one client caller that needs a value before it has a
// match row (toMatchResult, mapping match_or_queue's fixed return shape).
//
// It is DEFAULT_ROUNDS, not MAX_ROUNDS, and the rename is the point. It used to
// be a maximum the engine enforced: duel_close_round's last-round test was a
// hardcoded `>= 2` and useDuelLifecycle derived isLastRound from `MAX_ROUNDS -
// 1`, so two constants in two languages had to agree for a match to end on the
// right round. drizzle/0055 made the server read duel_matches.rounds and the
// client read the server's answer, so this number no longer decides anything.
//
// THE INVARIANT THAT REPLACED IT: the only remaining consumer of a round COUNT
// on the client is the cosmetic "Round N / M" label. A stale or wrong value
// here can misprint that label and cannot desync a match -- when the match ends
// is duel_close_round's decision, transmitted as match_status. Keep it that
// way; anything that would make a client-side round count load-bearing again
// belongs on the match row instead. Bounds live in
// duel_matches_rounds_check (1..5), not here.
export const DEFAULT_ROUNDS = 3;

export function duelChannelName(matchId: number): string {
  return `duel:${matchId}`;
}

// Top ~10 shown on the closest-guesses board (CLAUDE.md's Duel UI section).
export const CLOSEST_BOARD_SIZE = 10;
