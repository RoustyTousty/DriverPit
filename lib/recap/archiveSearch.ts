import { normalizeSearchText } from "../game/fuzzyMatch";

// Matching a typed query against the archive, as a pure function.
//
// The archive index is a paginated list of finished days, newest first, and
// paging is the wrong tool for "which day was Jules Bianchi" or "show me July".
// This is the other half: the whole index of finished days ships to the client
// once and the query runs locally, which is the same trade the driver
// autocomplete makes and for the same reason -- a per-keystroke round trip to
// answer a question about a few hundred rows is latency spent for nothing.
//
// SIZE CEILING, stated so it can be checked rather than assumed. One entry is a
// date, a number, a driver name and a formatted date -- call it 70 bytes of
// JSON, so a year of archive is ~25KB raw and a fraction of that over the wire.
// That is affordable for years. If the archive ever outgrows it the fix is a
// server-side search endpoint, NOT a silent cutoff on the index: a search that
// quietly cannot see 2027 is worse than a search that is a little slower.
//
// `normalizeSearchText` rather than a bare `toLowerCase`, so "perez" finds
// "Sergio Pérez". It is the same fold the game's own search uses; a second,
// weaker one here would mean the archive could not find a driver the guess input
// can.

/** The fields a query is matched against. The row's own stats are not among them. */
export interface ArchiveSearchable {
  /** UTC day, `YYYY-MM-DD`. Matched as a substring, so "2026-07" finds a month. */
  date: string;
  puzzleNumber: number;
  driverName: string;
  /**
   * The date as the page renders it for this locale ("31 July 2026").
   *
   * Passed in rather than derived, because it is already computed for display
   * and because deriving it here would mean a second date formatter that could
   * disagree with the one on screen -- someone typing the month they can see
   * would then get no results.
   */
  dateLabel: string;
}

/**
 * A query folded once, ready to test many entries against.
 *
 * `digits` is the query with everything but digits removed, which is what makes
 * `31/07/2026`, `31-07-2026` and `31072026` the same search: the fold below
 * turns the separators people actually type into nothing at all rather than
 * trying to guess a date format.
 */
interface PreparedQuery {
  text: string;
  /** True when the query opened with `#`, which means "this is a puzzle number". */
  numberOnly: boolean;
  puzzleNumber: number | null;
}

function prepare(query: string): PreparedQuery | null {
  const trimmed = query.trim();
  if (trimmed === "") return null;

  const numberOnly = trimmed.startsWith("#");
  // Slashes and dots are how dates get typed; folding them to the hyphen the
  // ISO date already uses means "2026/07" matches without a date parser.
  const text = normalizeSearchText(numberOnly ? trimmed.slice(1) : trimmed)
    .replace(/[/.]/g, "-")
    .trim();
  if (text === "") return null;

  const puzzleNumber = /^\d+$/.test(text) ? Number(text) : null;
  return { text, numberOnly, puzzleNumber };
}

function matches(entry: ArchiveSearchable, query: PreparedQuery): boolean {
  // A leading `#` is an unambiguous statement of intent, so it is honoured
  // exactly: `#5` finds puzzle 5 and never the five days whose date contains a
  // 5. Without that, the one precise way to name a day would be the noisiest.
  if (query.numberOnly) return entry.puzzleNumber === query.puzzleNumber;

  // A BARE NUMBER IS NOT A SUBSTRING SEARCH, and this branch is the whole
  // reason the matcher is a function rather than three `includes` calls.
  // Substring-matching "2" against the dates finds every day in 2026, 2025 and
  // every 2nd and 12th and 20th of a month -- which is to say all of them, so
  // the exact puzzle-number hit the reader wanted is drowned by the entire
  // archive. Digits therefore mean a puzzle number, or a year, and nothing else.
  if (query.puzzleNumber !== null) {
    if (entry.puzzleNumber === query.puzzleNumber) return true;
    // Four digits is the one numeric form that is unambiguously a date: a year.
    return query.text.length === 4 && entry.date.startsWith(query.text);
  }

  if (normalizeSearchText(entry.driverName).includes(query.text)) return true;
  // Anything with a letter or a separator in it is safe to match as a
  // substring: "2026-07" and "july" name a real span, and neither can collapse
  // into "every day that happens to contain this digit".
  if (entry.date.includes(query.text)) return true;
  return normalizeSearchText(entry.dateLabel).includes(query.text);
}

/**
 * The entries a query admits, in the order they were given (newest first).
 *
 * An empty query admits everything, which is what "no filter" means. The caller
 * decides what to do with that — the archive index renders its own
 * server-rendered page of rows instead, so the crawlable list is never replaced
 * by a client-side copy of itself.
 */
export function filterArchiveDays<T extends ArchiveSearchable>(
  entries: readonly T[],
  query: string,
): T[] {
  const prepared = prepare(query);
  if (prepared === null) return [...entries];
  return entries.filter((entry) => matches(entry, prepared));
}
