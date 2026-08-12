import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ArchiveDayRow, type ArchiveDayRowData } from "./ArchiveDayRow";
import { ArchivePagination } from "./ArchivePagination";
import { ArchiveSearch } from "./ArchiveSearch";
import {
  countArchiveDays,
  listArchiveDays,
  listArchiveSearchIndex,
  type ArchiveDaySummary,
} from "@/lib/db/dailyRecap";
import { formatUtcDate } from "@/lib/i18n/dates";
import type { Locale } from "@/lib/i18n/locales";
import { Link } from "@/lib/i18n/navigation";
import { ARCHIVE_PAGE_SIZE, archivePageCount } from "@/lib/recap/archivePaging";

// The archive index, shared by /archive (page 1) and /archive/page/N.
//
// It exists for one reason above all others: without it every day page is an
// orphan, reachable only from the one before it, and a crawler that has never
// seen /archive/2026-07-31 has no path to /archive/2026-07-30. A paginated
// index is what turns 365 pages into a crawlable structure.
//
// The pagination rules themselves live in lib/recap/archivePaging.ts -- they are
// pure, they are pinned by a suite, and keeping them out of this file keeps a
// postgres client out of the `node` test tier.

/**
 * A query row as the row component wants it: the date already written the way
 * this locale writes it.
 *
 * Done here, once, rather than inside the row -- `formatUtcDate` is a server
 * helper and the row is rendered on both sides of the client boundary (the
 * server-rendered list, and the search results). It is also what the search
 * matches a typed month against, so the string a reader sees and the string
 * their query is tested against are the same string by construction.
 */
function toRow(day: ArchiveDaySummary, locale: Locale): ArchiveDayRowData {
  return {
    date: day.date,
    puzzleNumber: day.puzzleNumber,
    driverName: day.targetName,
    dateLabel: formatUtcDate(day.date, locale),
    players: day.players,
    completed: day.completed,
    solved: day.solved,
  };
}

export async function ArchiveIndex({ page, locale }: { page: number; locale: Locale }) {
  // `getTranslations`, not the hook: this component is async, and
  // `useTranslations` is only available in a synchronous render.
  const t = await getTranslations("archive.index");
  const totalDays = await countArchiveDays();
  const pageCount = archivePageCount(totalDays);
  // A page beyond the end is a 404 and not an empty list: an empty page that
  // returns 200 is a soft 404, which Search Console reports and which lets a
  // crawler wander into /archive/page/900.
  if (page > pageCount) notFound();

  // Two queries in parallel: the page of rows, and the search index. The second
  // is the whole archive, which is why it is worth stating what that costs --
  // one indexed scan of daily_targets per ISR revalidation (hourly), not per
  // request. See lib/recap/archiveSearch.ts for the payload arithmetic.
  const [days, searchIndex] = await Promise.all([
    listArchiveDays(ARCHIVE_PAGE_SIZE, (page - 1) * ARCHIVE_PAGE_SIZE),
    listArchiveSearchIndex(),
  ]);

  const rows = days.map((day) => toRow(day, locale));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-wide text-text-muted uppercase">{t("eyebrow")}</p>
        <h1 className="text-3xl font-bold tracking-tight text-text">{t("heading")}</h1>
        <p className="text-text-muted">{t("intro")}</p>
        {/* Parts left, count right, both mono and muted -- DriverFilterSummary's
            pairing, which is how this site annotates a collection with its size.
            Unboxed on purpose: it is a caption on the list below, not a stat
            panel of its own. */}
        {totalDays > 0 && (
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3 font-mono text-xs tabular-nums text-text-muted">
            <span>{t("total", { count: totalDays })}</span>
            <span>{t("pageOf", { page, total: pageCount })}</span>
          </div>
        )}
      </header>

      {days.length === 0 ? (
        <p className="text-sm text-text-muted">{t("empty")}</p>
      ) : (
        // The search box shows `children` -- this page of rows and its
        // pagination -- until something is typed. Both are server-rendered and
        // in the HTML either way; see ArchiveSearch's header.
        <ArchiveSearch index={searchIndex.map((day) => toRow(day, locale))}>
          <div className="flex flex-col gap-6">
            <ul className="flex flex-col gap-2">
              {rows.map((day) => (
                <ArchiveDayRow key={day.date} day={day} />
              ))}
            </ul>
            <ArchivePagination page={page} pageCount={pageCount} />
          </div>
        </ArchiveSearch>
      )}

      <p className="border-t border-border pt-6 text-sm">
        <Link href="/" className="font-semibold text-accent transition hover:underline">
          {t("playToday")}
        </Link>
      </p>
    </div>
  );
}
