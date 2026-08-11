// Which drivers get a page, as a pure predicate rather than a `HAVING` clause.
//
// WHY THIS IS A FUNCTION AND NOT A WHERE CLAUSE. Programmatic pages are the one
// thing in docs/seo-roadmap.md that can actively harm the site: a few hundred
// templated pages on a domain with no authority reads as doorway content and
// drags everything else down with it. So the threshold has to be somewhere a
// person can read it and argue with it, and it has to be the SAME threshold
// everywhere it is applied -- `generateStaticParams`, the page's own 404, the
// sitemap, and the archive page deciding whether to link here. A predicate has
// one definition; four queries have four.
//
// It also keeps the rule out of SQL entirely, which is what avoids a TS<->SQL
// duplication of exactly the kind CLAUDE.md demands a parity suite for. The
// query (lib/db/dailyRecap.ts#listDriverArchiveEvidence) answers a broad,
// obviously-correct question -- "which drivers have ever been an answer, and how
// did those days go" -- and this decides. The evidence set is at most one row
// per finished day, so there is nothing to optimise.
//
// THE RULE, measured against production on 2026-08-08 before it was written:
// the ranked pool is 103 drivers, of whom 47 have a win/podium/pole/title and 14
// have been the daily answer. Publishing on the career record would have shipped
// 47 pages whose every fact is F1DB data that Wikipedia states better -- a name
// substituted into a template, which is the test this pass has to pass. So the
// bar is the other one: a page exists when this site has something to say about
// the driver that no other site can, and the only thing in that category is how
// people actually played the day they were the answer.
//
// That is why an appearance only counts when somebody FINISHED a board on it.
// Eight of the first fourteen finished days had no players at all; "X was the
// answer on 3 August 2026" with nothing behind it is a date and a dead link, not
// content. The career facts still render on the page -- they are the context a
// reader needs -- they are simply not what justifies it existing.

/**
 * One finished day this driver was the answer on. The shape both the evidence
 * query and the full page query return, so the predicate reads the same rows the
 * page renders.
 */
export interface DriverAppearance {
  /** UTC day, `YYYY-MM-DD`. */
  date: string;
  puzzleNumber: number;
  /** Distinct players with a board that day. */
  players: number;
  /** Of those, how many played it out. */
  completed: number;
  /** Of those, how many found the driver. */
  solved: number;
}

/**
 * Finished appearances that carry player data.
 *
 * `completed`, not `players`: a board that was opened and abandoned tells you
 * nothing about the day, and the summary generator has no sentence it can
 * honestly write from one.
 */
export function playedAppearances(appearances: readonly DriverAppearance[]): DriverAppearance[] {
  return appearances.filter((appearance) => appearance.completed > 0);
}

/**
 * How many played appearances a driver needs before their page is worth
 * publishing.
 *
 * One, and the honest reason is that one is already enough to say something no
 * other site can. Raising it would be defensible later -- with a real archive,
 * "the answer four times, solved 61% of the time" is a stronger page than a
 * single day -- but at 14 finished days it would publish nothing at all, and a
 * feature that ships zero pages is a feature nobody maintains.
 */
export const MIN_PLAYED_APPEARANCES = 1;

/**
 * Does this driver get a page?
 *
 * Deliberately takes the appearance rows rather than a count, so the "somebody
 * played it" half of the rule cannot be applied in one caller and forgotten in
 * another. Callers with a single day in hand pass a one-element array — see the
 * archive day page, which uses exactly that to decide whether linking here would
 * land on a 404.
 */
export function isDriverPageEligible(appearances: readonly DriverAppearance[]): boolean {
  return playedAppearances(appearances).length >= MIN_PLAYED_APPEARANCES;
}
