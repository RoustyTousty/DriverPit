// Which finished days are offered to the index, as a pure predicate.
//
// This is the archive's half of the rule lib/drivers/pageEligibility.ts already
// argues for driver pages, and it was written on 2026-08-12 because the archive
// never got one. Measured against production that day: of 18 finished days, 13
// had NOBODY complete a board, and the best of the remaining 5 had two players.
// So thirteen indexable pages said, in full, "Nobody recorded a guess on puzzle
// #25. The answer was Jules Bianchi", plus a five-cell table of facts F1DB
// states better -- and every one of them was published in six languages.
//
// AdSense rejected the site for "low value content" on that surface, which is
// the outcome docs/seo-roadmap.md's own warning predicted: programmatic pages
// are the one thing in that roadmap that can actively harm the site, because a
// hundred templated pages on a domain with no authority read as doorway content
// and drag down the pages that are actually earning.
//
// THE RULE IS THE SAME ONE, DELIBERATELY: a page is worth indexing when this
// site has something to say that no other site can, and the only thing in that
// category is how people actually played. `playedAppearances` spells that
// `completed > 0` for a driver; this spells it `completed > 0` for a day. Two
// call sites, one idea, and they are cross-referenced rather than shared,
// because they take different row shapes and collapsing them into one generic
// helper would obscure that each is a judgement about a different page type.
//
// WHAT THIS IS NOT. It is not a 404 and not a delisting. An ungated day still
// renders, still sits in the archive index, and still carries prev/next -- so
// nothing a player can reach breaks, no inbound link dies, and the archive does
// not lie about which days exist. It carries `noindex, follow` and stays out of
// the sitemap: crawlers are asked not to index it, and are still free to read
// the site through it. The day it gets a player, it qualifies on its own with no
// code change and no deploy, exactly like a driver page does.

/** The evidence one finished day offers. Both queries that decide return this. */
export interface ArchiveDayEvidence {
  /** UTC day, `YYYY-MM-DD`. */
  date: string;
  /** Distinct players who played the day out. */
  completed: number;
}

/**
 * How many completed boards a day needs before its page is worth indexing.
 *
 * One, matching `MIN_PLAYED_APPEARANCES`, and for the same reason: one is
 * already enough for the page to state something no other site can, and a
 * higher bar would today publish nothing at all. `completed` rather than
 * `players`, also for the same reason -- a board that was opened and abandoned
 * says nothing about the day, and `lib/recap/summary.ts` has no sentence it can
 * honestly write from one.
 */
export const MIN_ARCHIVE_DAY_COMPLETIONS = 1;

/** Is this finished day's page worth offering to the index? */
export function isArchiveDayIndexable(day: ArchiveDayEvidence): boolean {
  return day.completed >= MIN_ARCHIVE_DAY_COMPLETIONS;
}
