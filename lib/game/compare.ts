export interface Driver {
  nationality: string;
  team: string;
  previousTeams: string[];
  dateOfBirth: string;
  dateOfDeath: string | null;
  debutYear: number;
  careerWins: number;
}

export type ExactFeedback = "exact" | "miss";
export type OrderedFeedback = "correct" | "higher" | "lower";
// "historical" = not their current team, but somewhere in their career.
export type TeamFeedback = "exact" | "historical" | "miss";

export interface GuessResult {
  nationality: ExactFeedback;
  team: TeamFeedback;
  age: OrderedFeedback;
  ageCloseness?: number;
  debutYear: OrderedFeedback;
  debutYearCloseness?: number;
  careerWins: OrderedFeedback;
  careerWinsCloseness?: number;
}

// Age as of `today`, or age at death if deceased — the death date pins the
// age regardless of how far `today` is from it.
export function calculateAge(
  dateOfBirth: string,
  dateOfDeath: string | null,
  today: Date,
): number {
  const birth = new Date(dateOfBirth);
  const asOf = dateOfDeath ? new Date(dateOfDeath) : today;

  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function compareExact(guessValue: string, targetValue: string): ExactFeedback {
  return guessValue === targetValue ? "exact" : "miss";
}

// `team` is "" for a driver with no constructor on record (a null `last_team`;
// SQL compare_drivers coalesces it to "" and the UI shows "—"). That absence is
// never a match: two teamless drivers used to compare as "exact", a green tile
// claiming to have found a team neither of them has — and, in duel, 15 free
// proximity points. An absent team says nothing about the target, so it reads
// as a miss. A teamless *target* is untouched: it can still have a history, so
// a real team guessed against it can still come back "historical".
function compareTeam(guessTeam: string, target: Pick<Driver, "team" | "previousTeams">): TeamFeedback {
  if (guessTeam === "") return "miss";
  if (guessTeam === target.team) return "exact";
  if (target.previousTeams.includes(guessTeam)) return "historical";
  return "miss";
}

// How close a numeric guess was to the target, as a 0-1 hint layered on top
// of "higher"/"lower" — 1 is a near-miss, 0 (or below, clamped) is wildly
// off. `range` is a rough sense of that attribute's typical spread across
// the eligible pool, not a hard bound. Squaring the linear falloff keeps
// the "bright" zone narrow — only a guess that's actually close reads as
// strongly colored, rather than fading gradually across the whole range.
function closeness(guessValue: number, targetValue: number, range: number): number {
  const diff = Math.abs(guessValue - targetValue);
  const linear = Math.max(0, 1 - diff / range);
  return linear * linear;
}

const AGE_CLOSENESS_RANGE = 30;
const DEBUT_YEAR_CLOSENESS_RANGE = 20;
const CAREER_WINS_CLOSENESS_RANGE = 70;

// "higher" means the target's value is higher than the guess.
function compareOrdered(
  guessValue: number,
  targetValue: number,
  range: number,
): { feedback: OrderedFeedback; closeness?: number } {
  if (guessValue === targetValue) return { feedback: "correct" };
  return {
    feedback: targetValue > guessValue ? "higher" : "lower",
    closeness: closeness(guessValue, targetValue, range),
  };
}

export function compare(guess: Driver, target: Driver, today: Date): GuessResult {
  const guessAge = calculateAge(guess.dateOfBirth, guess.dateOfDeath, today);
  const targetAge = calculateAge(target.dateOfBirth, target.dateOfDeath, today);

  const age = compareOrdered(guessAge, targetAge, AGE_CLOSENESS_RANGE);
  const debutYear = compareOrdered(guess.debutYear, target.debutYear, DEBUT_YEAR_CLOSENESS_RANGE);
  const careerWins = compareOrdered(guess.careerWins, target.careerWins, CAREER_WINS_CLOSENESS_RANGE);

  return {
    nationality: compareExact(guess.nationality, target.nationality),
    team: compareTeam(guess.team, target),
    age: age.feedback,
    ageCloseness: age.closeness,
    debutYear: debutYear.feedback,
    debutYearCloseness: debutYear.closeness,
    careerWins: careerWins.feedback,
    careerWinsCloseness: careerWins.closeness,
  };
}

// A win is naming the target *driver* — deliberately not "every tile came back
// exact/correct", which is how all three modes used to decide it. Drivers are
// not uniquely identified by these five attributes: this roster holds six pairs
// that match on all of them (François Mazet / Max Jean, three Kurtis Kraft
// pairs, …), so a tile-derived win let one stand in for the other and then
// revealed the other's name — "You won! The driver was Someone Else."
// docs/audit-2026-07-27.md §3.8; the live rule is the same identity comparison
// in drizzle/0044_win_by_driver_identity.sql, which this specifies.
export function isWin(guessDriverId: number, targetDriverId: number): boolean {
  return guessDriverId === targetDriverId;
}
