import type { GuessResult, OrderedFeedback } from "./compare";
import { MIN_SOLVE_MS } from "./duelTiming";

// Any solve, no matter how late, must outscore any DNF -- a DNF's
// bestProximity is capped well under this floor (see PROXIMITY weights
// below), so "solved" always beats "didn't solve" regardless of speed.
const MIN_SPEED_POINTS = 100;
const MAX_SPEED_POINTS = 1000;

// --- Guess discipline (drizzle/0058) ----------------------------------------
//
// How many guesses a round pays full value for, and what each one after that
// multiplies the *bonus* by. Duel guesses stay unlimited -- a hard cap would
// lock a player out mid-round and leave them watching a timer in the one mode
// whose whole point is presence -- but they stop being free.
//
// Three free guesses because that is roughly what honest deduction costs before
// the tiles have said anything useful; 0.88 because it is gentle across the
// range a human actually plays (six guesses is still x0.77) and brutal across
// the range only a script reaches (forty is x0.009). Both are tunable: nothing
// derives from them except the SQL copy in drizzle/0058, which the parity suite
// pins by executing it against accuracyFactor below.
export const FREE_GUESSES = 3;
export const GUESS_DECAY = 0.88;

// What a solve's speed bonus is multiplied by, given how many WRONG guesses
// preceded it. The solving guess itself is never counted -- getting it right
// is not a mistake -- so a four-guess solve passes 3 here and pays in full.
//
// Never applied to MIN_SPEED_POINTS. That floor is what makes "any solve beats
// any DNF" true (MAX_PROXIMITY_WEIGHT is 75, well under 100), and decaying it
// would put a heavily-penalised solve underneath a lucky near miss -- so a
// player who eventually found the right driver could score less than one who
// never did. What decays is the 900 points above it.
export function accuracyFactor(wrongGuesses: number): number {
  return GUESS_DECAY ** Math.max(0, wrongGuesses - FREE_GUESSES);
}

// The time half of a solve, on its own: squared falloff (same shape as
// compare.ts's closeness hint) so the reward is heavily front-loaded -- a 5s
// solve is worth far more than a 40s one, not just a little more.
//
// `msToSolve` is floored at MIN_SOLVE_MS before the curve sees it, so a scripted
// sub-second solve scores exactly what the fastest possible human does. Exported
// for the curve's own tests and the parity suite; what a round actually pays is
// solvePoints below, and every caller in the app uses that one.
export function speedPoints(msToSolve: number, roundMs: number): number {
  const clamped = Math.min(Math.max(msToSolve, MIN_SOLVE_MS), roundMs);
  const remaining = 1 - clamped / roundMs;
  const falloff = remaining * remaining;
  return Math.round(MIN_SPEED_POINTS + (MAX_SPEED_POINTS - MIN_SPEED_POINTS) * falloff);
}

// What solving a round is actually worth: the floor, plus the speed bonus
// scaled by how efficiently it was reached. Mirrored in drizzle/0058's
// duel_submit_guess, which is the authoritative one -- this side drives the
// "solve now +N" readout the player watches while deciding whether to guess.
export function solvePoints(msToSolve: number, roundMs: number, wrongGuesses: number): number {
  const clamped = Math.min(Math.max(msToSolve, MIN_SOLVE_MS), roundMs);
  const remaining = 1 - clamped / roundMs;
  const falloff = remaining * remaining;
  return Math.round(MIN_SPEED_POINTS + (MAX_SPEED_POINTS - MIN_SPEED_POINTS) * falloff * accuracyFactor(wrongGuesses));
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

export function weightedProximity(result: GuessResult): number {
  let points = 0;

  if (result.nationality === "exact") points += NATIONALITY_WEIGHT;

  if (result.team === "exact") points += TEAM_EXACT_WEIGHT;
  else if (result.team === "historical") points += TEAM_HISTORICAL_WEIGHT;

  points += orderedFieldScore(result.age, result.ageCloseness, AGE_WEIGHT);
  points += orderedFieldScore(result.debutYear, result.debutYearCloseness, DEBUT_YEAR_WEIGHT);
  points += orderedFieldScore(result.careerWins, result.careerWinsCloseness, CAREER_WINS_WEIGHT);

  return points;
}

// One guess's raw proximity, rounded. This is the per-guess reading the board
// ranks by -- NOT what a DNF pays; that is dnfPoints below, which is this same
// value at its round-best, decayed. Kept separate because the two are pinned
// against different SQL: this against duel_submit_guess's v_weighted_proximity,
// dnfPoints against duel_close_round's v_points_a/b.
export function proximityPoints(bestResult: GuessResult): number {
  return Math.round(weightedProximity(bestResult));
}

// Minor consolation points for a DNF, from the player's single best (closest)
// incorrect guess of the round -- decayed by the same accuracy factor a solve
// pays, so spraying guesses is not a way to farm proximity either. Every guess
// in a DNF round is by definition a wrong one, so the whole count is passed.
//
// Never as much as any solve: the ceiling is MAX_PROXIMITY_WEIGHT (75) at
// factor 1, still under MIN_SPEED_POINTS (100), and the factor only ever
// shrinks it. Mirrored in drizzle/0058's duel_close_round.
export function dnfPoints(bestProximity: number, wrongGuesses: number): number {
  return Math.round(bestProximity * accuracyFactor(wrongGuesses));
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
