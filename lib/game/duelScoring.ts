import type { GuessResult, OrderedFeedback } from "./compare";

// Any solve, no matter how late, must outscore any DNF -- a DNF's
// bestProximity is capped well under this floor (see PROXIMITY weights
// below), so "solved" always beats "didn't solve" regardless of speed.
const MIN_SPEED_POINTS = 100;
const MAX_SPEED_POINTS = 1000;

// Points for solving a round in `msToSolve`, out of `roundMs` total. Squared
// falloff (same shape as compare.ts's closeness hint) so the reward is
// heavily front-loaded -- a 5s solve is worth far more than a 40s one, not
// just a little more.
export function speedPoints(msToSolve: number, roundMs: number): number {
  const clamped = Math.min(Math.max(msToSolve, 0), roundMs);
  const remaining = 1 - clamped / roundMs;
  const falloff = remaining * remaining;
  return Math.round(MIN_SPEED_POINTS + (MAX_SPEED_POINTS - MIN_SPEED_POINTS) * falloff);
}

// Weights sum to 83 -- deliberately well under MIN_SPEED_POINTS (100), and
// in practice always further under it: a DNF's best guess is by definition
// not a win, so at least one weight below never lands at full credit.
const NATIONALITY_WEIGHT = 15;
const TEAM_EXACT_WEIGHT = 15;
const TEAM_HISTORICAL_WEIGHT = 8;
const AGE_WEIGHT = 15;
const DEBUT_YEAR_WEIGHT = 15;
const CAREER_WINS_WEIGHT = 15;

// "correct" has no closeness value (compare.ts only sets it on a miss), but
// it means an exact match on that attribute -- full credit.
function orderedFieldScore(feedback: OrderedFeedback, closeness: number | undefined, weight: number): number {
  if (feedback === "correct") return weight;
  return weight * (closeness ?? 0);
}

function weightedProximity(result: GuessResult): number {
  let points = 0;

  if (result.nationality === "exact") points += NATIONALITY_WEIGHT;

  if (result.team === "exact") points += TEAM_EXACT_WEIGHT;
  else if (result.team === "historical") points += TEAM_HISTORICAL_WEIGHT;

  points += orderedFieldScore(result.age, result.ageCloseness, AGE_WEIGHT);
  points += orderedFieldScore(result.debutYear, result.debutYearCloseness, DEBUT_YEAR_WEIGHT);
  points += orderedFieldScore(result.careerWins, result.careerWinsCloseness, CAREER_WINS_WEIGHT);

  return points;
}

// Minor consolation points for a DNF, from the player's single best
// (closest) incorrect guess of the round. Never as much as any solve —
// see MIN_SPEED_POINTS above.
export function proximityPoints(bestResult: GuessResult): number {
  return Math.round(weightedProximity(bestResult));
}

// Ceiling a guess could ever reach against weightedProximity -- team maxes
// out at TEAM_EXACT_WEIGHT (not TEAM_HISTORICAL_WEIGHT), so this is the
// sum of every field's exact/correct weight.
const MAX_PROXIMITY_WEIGHT = NATIONALITY_WEIGHT + TEAM_EXACT_WEIGHT + AGE_WEIGHT + DEBUT_YEAR_WEIGHT + CAREER_WINS_WEIGHT;

// 0-1 "how warm is this guess" reading, same weighting as proximityPoints
// but normalized to its own ceiling instead of converted to a point value.
// Backs the duel opponent feed (CLAUDE.md's Duel UI section): the feed only
// ever sends this single number over the wire, never the underlying
// per-attribute result -- so it can't be reverse-engineered into which
// attributes matched, let alone the guessed driver.
export function guessHeat(result: GuessResult): number {
  return weightedProximity(result) / MAX_PROXIMITY_WEIGHT;
}

// Both players start a match at this many points so the tug-of-war bar
// opens centered and never snaps to an end before either has scored
// (CLAUDE.md's Duel "Live standing" section). Not persisted -- confirmed
// round points in duel_matches.score_a/b exclude it; it's added back only
// for display/realtime.
export const DUEL_BASELINE = 100;

// A player's live, moment-to-moment score: the shared baseline, plus
// confirmed points from rounds already closed, plus how the *current*
// round is going so far (provisional). Never persisted per guess -- purely
// a realtime/display value recomputed from whatever the client already has.
export function liveScore({
  baseline,
  confirmedPoints,
  provisional,
}: {
  baseline: number;
  confirmedPoints: number;
  provisional: number;
}): number {
  return baseline + confirmedPoints + provisional;
}

// Tug-of-war fill: my share of the combined live score, in [0, 1] -- 0.5 is
// dead center (a tie), driving the bar toward whoever's ahead. Both players
// share the same DUEL_BASELINE floor, so the denominator is always positive
// and this can't divide by zero.
export function tugFill(liveMine: number, liveOpp: number): number {
  return liveMine / (liveMine + liveOpp);
}
