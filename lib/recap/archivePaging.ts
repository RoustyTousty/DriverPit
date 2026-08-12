// The archive index's pagination rules, and nothing else.
//
// These used to live in `components/archive/ArchiveIndex.tsx`, which imports
// `lib/db/dailyRecap` and therefore drags a postgres client into the `node`
// vitest project for the sake of four pure functions. They are arithmetic over a
// URL and a row count; they belong beside the suite that already tested them.
//
// Every failure in here is silent, which is why it is all pure and all pinned: a
// second URL for page 1 is duplicate content, an off-by-one page count is a soft
// 404 in the sitemap, and a permissive parser lets a crawler wander into
// /archive/page/99999.

/**
 * Days per page.
 *
 * TEN, deliberately small. It was 40, which fitted a comfortable two months on
 * one page and made the pagination almost decorative — but a 40-row list is a
 * wall to a reader looking for one day, and the archive's own job is to be
 * *browsable*. Ten rows is a screen, so a page is something you read rather than
 * scroll past, and the search box above the list is what covers "I know which
 * day I want" without paging at all.
 *
 * The cost is real and worth naming: a year of archive is 37 pages rather than
 * 10, so a crawler needs more hops to walk the list. Two things pay for it —
 * `app/sitemap.ts` lists every day page directly, so the index pages are not the
 * only path inward, and `archivePageWindow` puts numbered links on every page so
 * the deepest page is two clicks from the first rather than 36.
 */
export const ARCHIVE_PAGE_SIZE = 10;

export function archivePagePath(page: number): string {
  return page <= 1 ? "/archive" : `/archive/page/${page}`;
}

/** Total pages, never below 1 — an empty archive still has a page 1 to render. */
export function archivePageCount(totalDays: number): number {
  return Math.max(1, Math.ceil(totalDays / ARCHIVE_PAGE_SIZE));
}

/**
 * A page number from a URL segment. Rejects everything that is not a plain
 * positive integer, INCLUDING "1": `/archive/page/1` would be a second URL
 * serving the same rows as `/archive`, which is the duplicate-content own-goal
 * the canonical exists to prevent. It 404s rather than redirecting, because
 * nothing links to it.
 */
export function parseArchivePage(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 2 && Number.isSafeInteger(page) ? page : null;
}

/** A gap in the page window — rendered as an ellipsis, never as a link. */
export const PAGE_GAP = "gap" as const;
export type ArchivePageSlot = number | typeof PAGE_GAP;

/**
 * The numbered links to render: the first page, the last page, and a window of
 * `span` either side of the current one, with gaps collapsed.
 *
 * `archivePageWindow(5, 37)` → `[1, gap, 4, 5, 6, gap, 37]`.
 *
 * A gap is only emitted for a jump of **more than one** page. A run of exactly
 * one hidden page is rendered as that page's own number instead, because "1 … 3"
 * spends the same width as "1 2 3" to say less — and an ellipsis standing in for
 * a single number reads as a rendering fault rather than as elision.
 */
export function archivePageWindow(
  page: number,
  pageCount: number,
  span = 1,
): ArchivePageSlot[] {
  const total = Math.max(1, Math.trunc(pageCount));
  const current = Math.min(total, Math.max(1, Math.trunc(page)));

  const wanted = new Set<number>([1, total]);
  for (let n = current - span; n <= current + span; n += 1) {
    if (n >= 1 && n <= total) wanted.add(n);
  }

  const pages = [...wanted].sort((a, b) => a - b);
  const slots: ArchivePageSlot[] = [];
  let previous = 0;
  for (const n of pages) {
    const skipped = n - previous - 1;
    // Exactly one missing page is cheaper to print than to elide.
    if (previous > 0 && skipped === 1) slots.push(previous + 1);
    else if (skipped > 1) slots.push(PAGE_GAP);
    slots.push(n);
    previous = n;
  }
  return slots;
}
