import { describe, expect, it } from "vitest";

import { updateDuelRatings } from "./duelRating";

describe("updateDuelRatings", () => {
  it("is zero-sum: A's gain always equals B's loss", () => {
    const cases: Array<[number, number, "a" | "b" | "draw"]> = [
      [1000, 1000, "a"],
      [1000, 1000, "b"],
      [1200, 900, "b"],
      [900, 1200, "a"],
      [1000, 1000, "draw"],
      [1500, 1500, "draw"],
    ];
    for (const [ratingA, ratingB, outcome] of cases) {
      const result = updateDuelRatings(ratingA, ratingB, outcome);
      const deltaA = result.ratingA - ratingA;
      const deltaB = result.ratingB - ratingB;
      expect(deltaA + deltaB).toBe(0);
    }
  });

  it("leaves equal ratings unchanged on a draw", () => {
    const result = updateDuelRatings(1000, 1000, "draw");
    expect(result).toEqual({ ratingA: 1000, ratingB: 1000 });
  });

  it("rewards an equal-rated winner and penalizes the loser by the same amount", () => {
    const result = updateDuelRatings(1000, 1000, "a");
    expect(result.ratingA).toBeGreaterThan(1000);
    expect(result.ratingB).toBeLessThan(1000);
  });

  it("rewards an upset (lower-rated player winning) more than a favorite's win", () => {
    const upsetGain = updateDuelRatings(900, 1200, "a").ratingA - 900;
    const favoriteGain = updateDuelRatings(1200, 900, "a").ratingA - 1200;
    expect(upsetGain).toBeGreaterThan(favoriteGain);
  });

  it("pulls a draw between mismatched ratings toward the mean (underdog gains, favorite loses)", () => {
    const result = updateDuelRatings(900, 1200, "draw");
    expect(result.ratingA).toBeGreaterThan(900);
    expect(result.ratingB).toBeLessThan(1200);
  });
});
