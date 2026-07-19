const K_FACTOR = 32;

export type DuelOutcome = "a" | "b" | "draw";

export interface RatingUpdate {
  ratingA: number;
  ratingB: number;
}

// Standard Elo update (K=32) applied once per finished match, not per
// round -- `outcome` is who won on aggregate score after all rounds.
// Zero-sum by construction: ratingB's delta is always -ratingA's delta.
export function updateDuelRatings(ratingA: number, ratingB: number, outcome: DuelOutcome): RatingUpdate {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  const actualA = outcome === "a" ? 1 : outcome === "b" ? 0 : 0.5;
  const deltaA = Math.round(K_FACTOR * (actualA - expectedA));

  return {
    ratingA: ratingA + deltaA,
    ratingB: ratingB - deltaA,
  };
}
