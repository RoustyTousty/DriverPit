// The Infinite mode driver filter: which drivers can be the answer, and which
// the autocomplete offers.
//
// This replaces the five fixed pool windows (lib/game/poolWindow.ts, still used
// by daily and duel) with something the player composes: any span of seasons,
// optionally narrowed to one nationality, one constructor, or one achievement
// tier. Pure and unit-tested, for the usual reason -- it is duplicated in
// plpgsql, because `infinite_start_round` picks the round's target inside
// Postgres and MUST draw from exactly the set the board autocompletes. A filter
// that disagreed between the two would serve a target the player cannot type,
// which is the same failure the pool-cutoff parity suite exists to prevent.
// lib/db/infiniteFilter.sqlParity.test.ts pins them behaviourally.

/** F1's first world-championship season, and the floor of the year range. */
export const FIRST_SEASON = 1950;

/** How wide the default span is, in seasons back from the current one. */
export const DEFAULT_FILTER_SPAN_YEARS = 20;

export type Achievement = "any" | "race-winner" | "podium" | "pole" | "champion";

// Ordered as the modal renders them: broadest first, so moving along the row
// only ever narrows the pool. `short` is the chip text and `label` is the full
// name -- the chips are a compact row at 384px, but the accessible name and the
// filter summary both use the long form, so nothing is only ever "Poles".
export const ACHIEVEMENTS: { value: Achievement; label: string; short: string }[] = [
  { value: "any", label: "Any driver", short: "Any" },
  { value: "podium", label: "Podium finishers", short: "Podiums" },
  { value: "race-winner", label: "Race winners", short: "Wins" },
  { value: "pole", label: "Pole sitters", short: "Poles" },
  { value: "champion", label: "World champions", short: "Titles" },
];

export interface DriverFilter {
  /** Inclusive. A driver matches if their career overlaps this span at all. */
  fromYear: number;
  /** Inclusive. */
  toYear: number;
  /** Exact match on `drivers.nationality`; null means every nationality. */
  nationality: string | null;
  /** Matches if the driver EVER raced for it; null means every constructor. */
  team: string | null;
  achievement: Achievement;
}

/** The columns the filter reads. Structural so it fits both the client roster
 *  row and any future shape, the same way tileLabel.ts states its input. */
export interface FilterableDriver {
  debutYear: number;
  lastActiveYear: number;
  nationality: string;
  /** Every constructor raced for, current included (`drivers.previous_teams`). */
  teams: readonly string[];
  careerWins: number;
  championshipWins: number;
  podiums: number;
  polePositions: number;
}

export function isAchievement(value: unknown): value is Achievement {
  return typeof value === "string" && ACHIEVEMENTS.some((a) => a.value === value);
}

export function defaultDriverFilter(referenceYear: number): DriverFilter {
  return {
    // The span daily and duel use, so Infinite opens on a familiar pool rather
    // than on all 900-odd drivers ever.
    fromYear: Math.max(FIRST_SEASON, referenceYear - DEFAULT_FILTER_SPAN_YEARS),
    toYear: referenceYear,
    nationality: null,
    team: null,
    achievement: "any",
  };
}

/**
 * Forces a filter into range: years inside [FIRST_SEASON, referenceYear] and in
 * order. Applied on every edit AND on every read from storage, so nothing
 * downstream -- the SQL included -- has to cope with `from > to` (which selects
 * nobody) or a year outside the seasons that exist.
 */
export function clampDriverFilter(filter: DriverFilter, referenceYear: number): DriverFilter {
  const ceiling = Math.max(FIRST_SEASON, referenceYear);
  const bound = (year: number) => Math.min(ceiling, Math.max(FIRST_SEASON, Math.round(year)));
  const a = bound(filter.fromYear);
  const b = bound(filter.toYear);
  return {
    ...filter,
    fromYear: Math.min(a, b),
    toYear: Math.max(a, b),
  };
}

function meetsAchievement(driver: FilterableDriver, achievement: Achievement): boolean {
  switch (achievement) {
    case "any":
      return true;
    case "podium":
      return driver.podiums > 0;
    case "race-winner":
      return driver.careerWins > 0;
    case "pole":
      return driver.polePositions > 0;
    case "champion":
      return driver.championshipWins > 0;
  }
}

/**
 * The whole predicate, and the TypeScript half of the TS<->SQL pair.
 *
 * The year test is an OVERLAP, not `last_active_year BETWEEN`: "drivers from
 * 1990 to 2000" means everyone who raced at any point in those seasons, so a
 * driver who debuted in 1988 and retired in 1994 belongs. Testing only the last
 * active year would drop them, and testing only the debut year would drop
 * anyone who started before the span and raced through it.
 */
export function matchesDriverFilter(driver: FilterableDriver, filter: DriverFilter): boolean {
  if (driver.debutYear > filter.toYear) return false;
  if (driver.lastActiveYear < filter.fromYear) return false;
  if (filter.nationality !== null && driver.nationality !== filter.nationality) return false;
  if (filter.team !== null && !driver.teams.includes(filter.team)) return false;
  return meetsAchievement(driver, filter.achievement);
}

export function isDefaultDriverFilter(filter: DriverFilter, referenceYear: number): boolean {
  const base = defaultDriverFilter(referenceYear);
  return (
    filter.fromYear === base.fromYear &&
    filter.toYear === base.toYear &&
    filter.nationality === base.nationality &&
    filter.team === base.team &&
    filter.achievement === base.achievement
  );
}

/**
 * The filter's active criteria, one string each, in a fixed order: the span
 * (always present -- it is the one criterion that is always set), then each
 * narrowing that is actually on. "All time" rather than "1950-2026" when the
 * span is everything, because that is what it means.
 *
 * Returned as PARTS rather than only as a joined string because the two places
 * an active filter is shown want different shapes of the same content: a caption
 * joins them with " · ", and the custom lobby renders one chip each, so a person
 * composing a game can see the criteria as the separate things they are. Both
 * come from here, so the words can never drift between them.
 */
export function driverFilterParts(filter: DriverFilter, referenceYear: number): string[] {
  const spansEverything = filter.fromYear <= FIRST_SEASON && filter.toYear >= referenceYear;
  const era = spansEverything
    ? "All time"
    : filter.fromYear === filter.toYear
      ? `${filter.fromYear}`
      : `${filter.fromYear}–${filter.toYear}`;

  const parts = [era];
  if (filter.nationality !== null) parts.push(filter.nationality);
  if (filter.team !== null) parts.push(filter.team);
  if (filter.achievement !== "any") {
    parts.push(ACHIEVEMENTS.find((a) => a.value === filter.achievement)!.label);
  }
  return parts;
}

/** The trigger button's label and the caption's text: the parts, joined. */
export function describeDriverFilter(filter: DriverFilter, referenceYear: number): string {
  return driverFilterParts(filter, referenceYear).join(" · ");
}

/**
 * A stable string identity for a filter, for the places that need to ask "is
 * this the same filter?" without a deep compare -- the round prefetch keyed on
 * one (lib/game/infiniteRoundPrefetch.ts), and React deps. Field order is fixed
 * here rather than left to JSON.stringify's key order, which follows insertion.
 */
export function driverFilterKey(filter: DriverFilter): string {
  return [
    filter.fromYear,
    filter.toYear,
    filter.nationality ?? "",
    filter.team ?? "",
    filter.achievement,
  ].join("|");
}

/**
 * Validates whatever came back from localStorage. Returns null rather than a
 * partially-trusted object: a stored filter is a value the player can edit in
 * devtools, and more usefully it is a value whose SHAPE changes when this
 * module does -- an old `{poolWindow: "10-years"}` from before this existed
 * must read as "no preference", not as a filter with undefined years.
 */
export function parseDriverFilter(value: unknown, referenceYear: number): DriverFilter | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (!Number.isFinite(raw.fromYear) || !Number.isFinite(raw.toYear)) return null;
  if (!isAchievement(raw.achievement)) return null;

  const optionalText = (input: unknown): string | null | undefined => {
    if (input === null || input === undefined) return null;
    if (typeof input !== "string") return undefined; // signals invalid
    const trimmed = input.trim();
    return trimmed === "" ? null : trimmed;
  };

  const nationality = optionalText(raw.nationality);
  const team = optionalText(raw.team);
  if (nationality === undefined || team === undefined) return null;

  return clampDriverFilter(
    {
      fromYear: raw.fromYear as number,
      toYear: raw.toYear as number,
      nationality,
      team,
      achievement: raw.achievement,
    },
    referenceYear,
  );
}
