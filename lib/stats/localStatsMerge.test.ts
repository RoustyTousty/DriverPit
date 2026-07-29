import { describe, expect, it } from "vitest";

import { sanitizeLocalStats } from "./localStatsMerge";

// A plausible legacy player: 9 dailies, 7 won, best run of 5, currently on 3.
function honest() {
  return {
    gamesPlayed: 9,
    gamesWon: 7,
    currentStreak: 3,
    maxStreak: 5,
    guessDistribution: [0, 1, 2, 3, 1, 0],
    lastResult: { won: true, guessCount: 4 },
  };
}

const MAX_GAMES = 40;

describe("sanitizeLocalStats", () => {
  it("accepts an honest payload and returns the merged fields", () => {
    const clean = sanitizeLocalStats(honest(), MAX_GAMES);
    expect(clean).toEqual({
      gamesPlayed: 9,
      gamesWon: 7,
      currentStreak: 3,
      maxStreak: 5,
      guessDistribution: [0, 1, 2, 3, 1, 0],
      // Never merged, so never carried across the boundary.
      lastResult: null,
    });
  });

  // The payload from audit 2026-07-27 §3.7, pinned by value: maxStreak is a
  // public leaderboard column, so this one reached the board.
  it("rejects the audit's forged payload outright", () => {
    expect(
      sanitizeLocalStats(
        {
          gamesPlayed: 99999,
          gamesWon: 99999,
          currentStreak: 9999,
          maxStreak: 9999,
          guessDistribution: [0, 0, 0, 0, 0, 0],
          lastResult: null,
        },
        MAX_GAMES,
      ),
    ).toBeNull();
  });

  it("rejects more games played than daily puzzles have existed", () => {
    expect(sanitizeLocalStats({ ...honest(), gamesPlayed: MAX_GAMES + 1, gamesWon: 0, maxStreak: 0, currentStreak: 0, guessDistribution: [0, 0, 0, 0, 0, 0] }, MAX_GAMES)).toBeNull();
    expect(sanitizeLocalStats({ ...honest(), gamesPlayed: MAX_GAMES, gamesWon: 0, maxStreak: 0, currentStreak: 0, guessDistribution: [0, 0, 0, 0, 0, 0] }, MAX_GAMES)).not.toBeNull();
  });

  it("rejects negative, fractional, NaN and non-numeric counts", () => {
    for (const bad of [-1, 1.5, NaN, Infinity, "7", null, undefined, {}]) {
      expect(sanitizeLocalStats({ ...honest(), gamesWon: bad }, MAX_GAMES)).toBeNull();
    }
  });

  it("rejects numbers past the safe-integer range", () => {
    expect(sanitizeLocalStats({ ...honest(), gamesPlayed: Number.MAX_VALUE }, MAX_GAMES)).toBeNull();
  });

  describe("internal consistency -- facts honest data cannot violate", () => {
    it("rejects more wins than games played", () => {
      expect(sanitizeLocalStats({ ...honest(), gamesWon: 10 }, MAX_GAMES)).toBeNull();
    });

    it("rejects a max streak longer than the win count", () => {
      expect(sanitizeLocalStats({ ...honest(), maxStreak: 8 }, MAX_GAMES)).toBeNull();
    });

    it("rejects a current streak longer than the max streak", () => {
      expect(sanitizeLocalStats({ ...honest(), currentStreak: 6 }, MAX_GAMES)).toBeNull();
    });

    it("rejects a guess distribution summing past the win count", () => {
      expect(sanitizeLocalStats({ ...honest(), guessDistribution: [0, 0, 0, 0, 0, 8] }, MAX_GAMES)).toBeNull();
    });
  });

  describe("guess distribution shape", () => {
    it("rejects a wrong-length array", () => {
      expect(sanitizeLocalStats({ ...honest(), guessDistribution: [0, 1, 2, 3, 1] }, MAX_GAMES)).toBeNull();
    });

    it("rejects a non-array", () => {
      expect(sanitizeLocalStats({ ...honest(), guessDistribution: "0,1,2,3,1,0" }, MAX_GAMES)).toBeNull();
    });

    it("rejects a negative bucket", () => {
      expect(sanitizeLocalStats({ ...honest(), guessDistribution: [0, 1, 2, 3, 2, -1] }, MAX_GAMES)).toBeNull();
    });
  });

  describe("nothing to merge", () => {
    it("returns null for zero games played", () => {
      expect(
        sanitizeLocalStats(
          { gamesPlayed: 0, gamesWon: 0, currentStreak: 0, maxStreak: 0, guessDistribution: [0, 0, 0, 0, 0, 0], lastResult: null },
          MAX_GAMES,
        ),
      ).toBeNull();
    });

    it("returns null for non-objects", () => {
      for (const bad of [null, undefined, 42, "stats", []]) {
        expect(sanitizeLocalStats(bad, MAX_GAMES)).toBeNull();
      }
    });
  });

  // A clock far enough behind that no puzzle has "existed" yet must not turn
  // into an accept-everything bound via a zero or negative maximum.
  it("never lets a degenerate maximum widen the bound", () => {
    expect(sanitizeLocalStats({ ...honest(), gamesPlayed: 2, gamesWon: 1, maxStreak: 1, currentStreak: 1, guessDistribution: [1, 0, 0, 0, 0, 0] }, 0)).toBeNull();
    expect(sanitizeLocalStats({ ...honest(), gamesPlayed: 1, gamesWon: 1, maxStreak: 1, currentStreak: 1, guessDistribution: [1, 0, 0, 0, 0, 0] }, -5)).not.toBeNull();
  });
});
