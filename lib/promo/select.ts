import { calculateAge, compare, type Driver, type GuessResult } from "../game/compare";
import type { DriverSummary } from "../db/queries";

// The pure half of the promo carousel generator (scripts/promo.ts).
//
// It picks the three answer drivers and, for each, the three WRONG guesses the
// board shows. All of it is deterministic under a seed, which is the whole point:
// a promo image nobody can regenerate is one nobody can fix a typo in. Rerunning
// with the same --seed must produce byte-identical boards.
//
// It is NOT a target picker for the game and must never become one. CLAUDE.md's
// "Never reintroduce a TypeScript 'which driver is today' helper" is about
// `daily_targets`, whose answer is a random pick pinned inside Postgres precisely
// so the browser cannot recompute it. Nothing here is keyed on a date, nothing
// here is reachable from a page the player loads, and the drivers it chooses are
// published in a PNG. Keep it that way: no date parameter, no import from
// lib/db/dailyRecap.

export interface PromoDriver {
  id: number;
  // F1DB's own slug ("lewis-hamilton"). The `?driver=` / `?guesses=` params are
  // spelled in these rather than in `id`, so a promo URL survives a re-seed and
  // is readable in a shell history.
  slug: string;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  // "" for a driver with no constructor on record, matching what SQL
  // compare_drivers coalesces `last_team` to. compareTeam() reads that as a
  // miss, never as a match — see lib/game/compare.ts.
  team: string;
  previousTeams: string[];
  dateOfBirth: string;
  dateOfDeath: string | null;
  debutYear: number;
  careerWins: number;
  lastActiveYear: number;
  championshipWins: number;
  podiums: number;
  polePositions: number;
}

// Difficulty is a property of the POOL the answer is drawn from, not of the
// board. A current-era driver is one most viewers can name; a legacy one is a
// driver from before the 20-year window the daily game itself uses.
export const PROMO_TIERS = ["current-era", "mid-era", "legacy"] as const;
export type PromoTier = (typeof PROMO_TIERS)[number];

// What the slide prints top-left. Deliberately the escalation the carousel is
// selling, rather than the tier's internal name.
export const TIER_LABELS: Record<PromoTier, string> = {
  "current-era": "EASY",
  "mid-era": "MEDIUM",
  legacy: "HARD",
};

/**
 * Which tier a driver belongs to, by `last_active_year`.
 *
 * The boundaries are the CURRENT SEASON and the 20-year daily window — the two
 * pools the game itself already speaks in (`POOL_WINDOWS`' `current-season` and
 * `DAILY_POOL_WINDOW`). That is what makes the difficulty ladder mean something
 * a player can check: the EASY answer is someone racing right now, and MEDIUM is
 * exactly the pool the daily game draws from.
 *
 * It was 10 / 10-20 / 20+, which put drivers retired a decade ago in "EASY" and
 * left MEDIUM as a 50-driver sliver between two windows — the weakest-grading
 * tier of the three, measured.
 *
 * Deliberately NOT a call into lib/game/poolWindow.ts even though two of the
 * three boundaries now coincide with real entries there. The tiers are
 * *exclusive* bands and `PoolWindow` values are nested cutoffs, so expressing
 * MEDIUM would still mean subtracting one window from another. That ladder is
 * mirrored in plpgsql and pinned by a parity suite; a promo image is not worth
 * touching it. Answering locally keeps the game's pools untouched — the cost is
 * that a change to DAILY_POOL_WINDOW does not reach this file, which is why the
 * 20 is named once below rather than inlined twice.
 */
const DAILY_WINDOW_YEARS = 20;

export function promoTier(lastActiveYear: number, referenceYear: number): PromoTier {
  if (lastActiveYear >= referenceYear) return "current-era";
  if (lastActiveYear >= referenceYear - DAILY_WINDOW_YEARS) return "mid-era";
  return "legacy";
}

/**
 * The drivers a board's WRONG GUESSES may be drawn from, which is a different
 * question from which tier the answer came out of.
 *
 * Conflating the two was the defect this fixes. Difficulty is a property of the
 * ANSWER — how hard is this person to name — while the guess pool decides how
 * well the board GRADES, i.e. whether there is a cold row, a warm row and a hot
 * row to be found. Drawing guesses from the answer's own tier tied those
 * together, and the current season is only 22 drivers: 21 candidates for up to
 * five rows, with three of five heat bands empty, so the escalation collapsed
 * into three samey rows.
 *
 * It is also the more faithful model. In the real game every guess comes from
 * the 20-year daily pool no matter who the answer is — a player hunting today's
 * driver types whoever they like, not only the current grid. So a current-season
 * answer graded against the daily pool is what actually playing looks like.
 *
 * LEGACY IS THE EXCEPTION and keeps its own pool: a 2024 driver guessed against
 * a 1955 target is five grey tiles and a row that tells the reader nothing.
 * Measured bands filled, averaged over each tier's 30 most notable answers:
 * 4.0 / 4.0 / 4.7 out of 5, against 3.0 / 4.0 / 4.7 when guesses were tier-locked.
 */
export function guessPoolFor(
  tier: PromoTier,
  drivers: readonly PromoDriver[],
  referenceYear: number,
): PromoDriver[] {
  if (tier === "legacy") {
    return drivers.filter((d) => promoTier(d.lastActiveYear, referenceYear) === "legacy");
  }
  return drivers.filter((d) => d.lastActiveYear >= referenceYear - DAILY_WINDOW_YEARS);
}

// A 32-bit string hash feeding a mulberry32 PRNG. Small, dependency-free and
// stable across Node versions, which `Math.random()` and any hash imported from
// a library are not.
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickOne<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

/**
 * How much a guess gives away, 0-1. Built from the REAL `compare()` output so
 * the number can never disagree with what the board renders.
 *
 * The weights are the promo generator's own editorial judgement rather than the
 * game's: they say "how solvable does this row LOOK", which is a different
 * question from duel's `bestHeat` (how close the player actually is) and must
 * not be unified with it. A green nationality tile reads as more progress than
 * a mid-shaded age tile even when the age tile narrows the field further.
 */
export function guessHeat(result: GuessResult): number {
  let heat = 0;
  if (result.nationality === "exact") heat += 0.3;
  if (result.team === "exact") heat += 0.3;
  else if (result.team === "historical") heat += 0.15;
  if (result.age === "correct") heat += 0.15;
  else heat += (result.ageCloseness ?? 0) * 0.12;
  if (result.debutYear === "correct") heat += 0.15;
  else heat += (result.debutYearCloseness ?? 0) * 0.12;
  if (result.careerWins === "correct") heat += 0.1;
  else heat += (result.careerWinsCloseness ?? 0) * 0.08;
  return Math.min(1, heat);
}

/**
 * True when every tile in the row comes back exact/correct.
 *
 * Such a guess is excluded even though it is not the answer, and the reason is
 * the same doppelgänger problem CLAUDE.md's "A win is guessing the target
 * driver" documents: this roster holds six pairs matching on all five
 * attributes, so an all-green row on a board still showing empty answer slots
 * looks like a rendering bug to anyone who reads it. The promo is the one place
 * that ambiguity is purely a liability — there is no player to explain it to.
 */
function isFullMatch(result: GuessResult): boolean {
  return (
    result.nationality === "exact" &&
    result.team === "exact" &&
    result.age === "correct" &&
    result.debutYear === "correct" &&
    result.careerWins === "correct"
  );
}

export function toComparable(driver: PromoDriver): Driver {
  return {
    nationality: driver.nationality,
    team: driver.team,
    previousTeams: driver.previousTeams,
    dateOfBirth: driver.dateOfBirth,
    dateOfDeath: driver.dateOfDeath,
    debutYear: driver.debutYear,
    careerWins: driver.careerWins,
  };
}

// The board renders a `DriverSummary`, which carries `age` as a number rather
// than the two dates it is derived from.
export function toDriverSummary(driver: PromoDriver, today: Date): DriverSummary {
  return {
    id: driver.id,
    fullName: driver.fullName,
    driverCode: driver.driverCode,
    nationality: driver.nationality,
    team: driver.team,
    age: calculateAge(driver.dateOfBirth, driver.dateOfDeath, today),
    debutYear: driver.debutYear,
    careerWins: driver.careerWins,
  };
}

/**
 * How recognisable a driver is, as a rough stand-in for "would a viewer scrolling
 * past know this name".
 *
 * Promo images live or die on that: a technically perfect board full of drivers
 * nobody recognises sells nothing. Titles dominate, then podiums, then wins —
 * and `lastActiveYear` breaks ties toward the more recent driver, because
 * recency is most of what recognition actually tracks outside the sport's
 * historians.
 */
export function notability(driver: PromoDriver): number {
  return (
    driver.championshipWins * 1000 +
    driver.podiums * 10 +
    driver.careerWins * 15 +
    driver.polePositions * 5 +
    driver.lastActiveYear / 100
  );
}

// How many of the most notable candidates a random pick chooses among. Picking
// strictly the top one makes --seed meaningless (every seed yields the same
// carousel); sampling the whole band puts obscure names on the slide.
//
// TWO NUMBERS, because the two draws want different things.
//
// A GUESS only has to be a name the reader recognises when they see it, and it
// is one of several rows, so a short list keeps every row worth printing.
//
// A TARGET is the whole slide, and the shortlist is the entire universe of
// answers the carousel can ever have -- at 10 per tier that was 30 drivers
// total, and two unrelated seeds both produced Niki Lauda for HARD, which is
// what "it always generates the same drivers" looks like once the seed itself
// is fixed. 30 per tier is ~27,000 carousels and still comfortably inside the
// recognisable range: the 30 most notable legacy drivers are champions and
// multiple race winners, not journeymen.
const NOTABILITY_SHORTLIST = 10;
const TARGET_SHORTLIST = 30;

function mostNotable(candidates: readonly PromoDriver[], take: number): PromoDriver[] {
  return [...candidates].sort((a, b) => notability(b) - notability(a)).slice(0, take);
}

/**
 * One answer driver per tier, in escalating difficulty order.
 *
 * Throws rather than silently dropping a tier: three slides is the carousel's
 * whole shape, and a two-slide run that reports success is the failure mode
 * worth being loud about.
 */
export function pickTargets(
  drivers: readonly PromoDriver[],
  referenceYear: number,
  rng: () => number,
): { tier: PromoTier; driver: PromoDriver }[] {
  return PROMO_TIERS.map((tier) => {
    const inTier = drivers.filter((d) => promoTier(d.lastActiveYear, referenceYear) === tier);
    if (inTier.length === 0) {
      throw new Error(`promo: no drivers in tier "${tier}" (reference year ${referenceYear})`);
    }
    return { tier, driver: pickOne(mostNotable(inTier, TARGET_SHORTLIST), rng) };
  });
}

/**
 * How many filled rows a board shows. Varied per board rather than fixed at
 * three, so the three slides do not read as one template with the names swapped
 * — which is what a viewer notices before they notice anything else.
 *
 * Capped below MAX_GUESSES (6): the whole point of the slide is an UNFINISHED
 * board, so at least one empty row must survive. Five filled rows is the most
 * that leaves any.
 */
export const MIN_GUESS_ROWS = 3;
export const MAX_GUESS_ROWS = 5;

// The hottest a shown row may be. Deliberately short of 1: the top of the range
// is where the doppelgangers and near-solves live, and a row that all but names
// the answer makes the empty slots below it look like an error.
const HEAT_CEILING = 0.86;

/**
 * `count` bands spanning [0, HEAT_CEILING], coldest first.
 *
 * A board whose rows are all equally warm reads as noise; one that escalates
 * reads as somebody closing in, which is the thing being advertised. Splitting
 * the range by the row count rather than listing fixed bounds is what lets the
 * count vary — the escalation is a property of the shape, not of three
 * hand-tuned numbers.
 */
function heatBands(count: number): [number, number][] {
  const width = HEAT_CEILING / count;
  return Array.from({ length: count }, (_, i) => [i * width, (i + 1) * width]);
}

/**
 * True when the row hands the player a country or a team.
 *
 * These are the two categorical columns, so they are the only tiles that say
 * something certain rather than something directional — every board in the
 * carousel is required to contain at least one, on its hottest row. Before this
 * it was merely LIKELY: a hot-band guess usually has one, but a heat of 0.6 is
 * reachable from closeness alone, and the boards that came out that way were
 * five columns of orange gradient with nothing a reader could anchor on.
 */
function hasCategoricalHit(result: GuessResult): boolean {
  return (
    result.nationality === "exact" || result.team === "exact" || result.team === "historical"
  );
}

/**
 * `count` wrong guesses for `target`, cold to warm.
 *
 * Candidates are scored with the real `compare()`, bucketed into `count` bands,
 * and one is drawn per band from that band's most notable members. The answer
 * itself and any all-green row are excluded outright, and the hottest row is
 * required to carry a country or team hit where the pool allows one.
 *
 * A band with nothing in it falls back to the nearest non-empty band rather
 * than shortening the board, because a board with two rows is a different
 * picture from the one being asked for. Duplicates are refused across bands, so
 * a narrow pool degrades to "less escalation" rather than to "the same driver
 * printed twice".
 */
export function pickWrongGuesses(
  target: PromoDriver,
  candidates: readonly PromoDriver[],
  today: Date,
  rng: () => number,
  count: number = MIN_GUESS_ROWS,
): PromoDriver[] {
  const scored = candidates
    .filter((candidate) => candidate.id !== target.id)
    .map((candidate) => ({
      driver: candidate,
      result: compare(toComparable(candidate), toComparable(target), today),
    }))
    .filter(({ result }) => !isFullMatch(result))
    .map(({ driver, result }) => ({ driver, heat: guessHeat(result), result }));

  const chosen: { driver: PromoDriver; heat: number }[] = [];
  const taken = new Set<number>();

  const bands = heatBands(count);

  for (const [index, [low, high]] of bands.entries()) {
    const isHottest = index === bands.length - 1;
    const band = scored.filter(
      ({ driver, heat }) => heat >= low && heat < high && !taken.has(driver.id),
    );
    // Nearest non-empty band, measured from this band's midpoint, so a missing
    // cold band borrows from the next-coldest rather than from the hottest.
    const banded = band.length > 0
      ? band
      : scored
          .filter(({ driver }) => !taken.has(driver.id))
          .sort(
            (a, b) => Math.abs(a.heat - (low + high) / 2) - Math.abs(b.heat - (low + high) / 2),
          )
          .slice(0, NOTABILITY_SHORTLIST);

    // The hottest row must hand the reader a country or a team. Narrowed only
    // when the narrowing leaves something -- a pool with no categorical hit
    // anywhere still yields a board, because a shorter carousel is worse than a
    // board whose last row is merely close.
    const withHit = isHottest ? banded.filter((entry) => hasCategoricalHit(entry.result)) : [];
    const pool = withHit.length > 0 ? withHit : banded;

    if (pool.length === 0) break;

    const picked = pickOne(mostNotable(pool.map((entry) => entry.driver), NOTABILITY_SHORTLIST), rng);
    chosen.push({ driver: picked, heat: pool.find((entry) => entry.driver.id === picked.id)?.heat ?? 0 });
    taken.add(picked.id);
  }

  // Sorted by heat rather than left in band order, and the difference only shows
  // when a band was EMPTY and borrowed from its neighbour -- a real case on a
  // narrow tier, measured against the live roster (a MEDIUM board came out
  // 0.04 / 0.35 / 0.34). The rows are read top to bottom as somebody closing in,
  // so a last row fractionally colder than the one above it undercuts the only
  // story the slide tells. Sorting cannot change WHICH drivers were picked, so
  // the seed still reproduces the same board.
  return chosen.sort((a, b) => a.heat - b.heat).map((entry) => entry.driver);
}

/** One finished slide: the hidden answer plus the rows the board renders. */
export interface PromoBoard {
  tier: PromoTier;
  label: string;
  target: PromoDriver;
  guesses: PromoDriver[];
}

/**
 * The three board slides, in carousel order.
 *
 * The answer comes from the tier; the guesses come from `guessPoolFor`, which is
 * a wider pool for the two modern tiers. See that function for why those are two
 * questions rather than one.
 */
export function planBoards(
  drivers: readonly PromoDriver[],
  referenceYear: number,
  today: Date,
  rng: () => number,
): PromoBoard[] {
  return pickTargets(drivers, referenceYear, rng).map(({ tier, driver }) => {
    const pool = guessPoolFor(tier, drivers, referenceYear);
    // Drawn per board, so the three slides differ in shape and not only in
    // names. Seeded like everything else, so --seed still reproduces the run.
    const rows = MIN_GUESS_ROWS + Math.floor(rng() * (MAX_GUESS_ROWS - MIN_GUESS_ROWS + 1));
    return {
      tier,
      label: TIER_LABELS[tier],
      target: driver,
      guesses: pickWrongGuesses(driver, pool, today, rng, rows),
    };
  });
}
