// Relative, not "@/..." -- vitest resolves no path alias, and this module is
// unit-tested (../../vitest.config.ts). Same convention as ./streak.ts.
import { MAX_GUESSES } from "../game/constants";

import type { StatsState } from "./store";

// Validation for the ONE server-side stats write whose input genuinely cannot
// come from the server: the legacy localStorage merge (migrateLocalStats,
// lib/stats/actions.ts). Everything else the client used to assert -- a daily
// result, a duel forfeit -- was already recorded server-side and is now derived
// there. This isn't: pre-accounts stats only ever existed in the player's
// browser, so the payload has to be accepted from them. That is exactly why it
// needs a bound.
//
// Before this, `readStats()` did `{ ...emptyStats(), ...JSON.parse(raw) }` on
// arbitrary localStorage and handed the result straight to a "use server"
// export. `{gamesPlayed: 99999, gamesWon: 99999, maxStreak: 9999}` merged as-is,
// and maxStreak is a PUBLIC leaderboard column (audit 2026-07-27 §3.7).
//
// Pure and unit-tested (./localStatsMerge.test.ts) so the rules can be read and
// checked without a database.

// Rejects rather than clamps. Honest data satisfies every rule below by
// construction, so clamping would only ever change *dishonest* data -- and
// clamping dishonest data still imports the clamped maximum, which on a
// leaderboard column is the whole problem. A payload that can't be true is
// dropped.
//
// `maxGames` is how many daily puzzles have EXISTED (getDailyPuzzleNumber for
// today) -- you cannot have played more dailies than there have been days. That
// is the only externally-anchored bound available, and it's a much tighter one
// than any round number picked by hand.
export function sanitizeLocalStats(local: unknown, maxGames: number): StatsState | null {
  if (typeof local !== "object" || local === null) return null;
  const raw = local as Record<string, unknown>;

  const gamesPlayed = asCount(raw.gamesPlayed);
  const gamesWon = asCount(raw.gamesWon);
  const currentStreak = asCount(raw.currentStreak);
  const maxStreak = asCount(raw.maxStreak);
  if (gamesPlayed === null || gamesWon === null || currentStreak === null || maxStreak === null) {
    return null;
  }

  const guessDistribution = asDistribution(raw.guessDistribution);
  if (guessDistribution === null) return null;

  // Nothing to merge -- not a failure, but not a payload either. The caller
  // treats null as "don't write", which is the right answer for both.
  if (gamesPlayed === 0) return null;
  if (gamesPlayed > Math.max(1, maxGames)) return null;

  // Internal consistency. Each of these is a fact about how the numbers were
  // produced, so real data can't violate one:
  //   - you can't win more days than you played;
  //   - a streak is consecutive WINS, so it can't be longer than the win count;
  //   - the current streak is one particular streak, so max bounds it;
  //   - every guess-distribution entry is a win, so they sum to at most the
  //     win count.
  if (gamesWon > gamesPlayed) return null;
  if (maxStreak > gamesWon) return null;
  if (currentStreak > maxStreak) return null;
  if (guessDistribution.reduce((a, b) => a + b, 0) > gamesWon) return null;

  return {
    gamesPlayed,
    gamesWon,
    currentStreak,
    maxStreak,
    guessDistribution,
    // Deliberately dropped: migrateLocalStats never merges lastResult (it drives
    // the "this bar is your latest win" highlight, which the account's own
    // history owns), so there's no reason to carry an unvalidated blob across
    // the boundary.
    lastResult: null,
  };
}

function asCount(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function asDistribution(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length !== MAX_GUESSES) return null;
  const out: number[] = [];
  for (const entry of value) {
    const count = asCount(entry);
    if (count === null) return null;
    out.push(count);
  }
  return out;
}
