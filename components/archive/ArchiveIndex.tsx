import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { countArchiveDays, listArchiveDays } from "@/lib/db/dailyRecap";
import { formatPercent, formatRecapDate } from "@/lib/recap/format";
import { Link } from "@/lib/i18n/navigation";

// The archive index, shared by /archive (page 1) and /archive/page/N.
//
// It exists for one reason above all others: without it every day page is an
// orphan, reachable only from the one before it, and a crawler that has never
// seen /archive/2026-07-31 has no path to /archive/2026-07-30. A paginated
// index is what turns 365 pages into a crawlable structure.

/**
 * Days per page. Sized so the first page holds a comfortable two months and a
 * year of archive is three pages — small enough that each page is a real
 * document and large enough that the pagination never becomes the content.
 */
export const ARCHIVE_PAGE_SIZE = 40;

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

function DayRow({
  date,
  puzzleNumber,
  targetName,
  players,
  completed,
  solved,
}: {
  date: string;
  puzzleNumber: number;
  targetName: string;
  players: number;
  completed: number;
  solved: number;
}) {
  const t = useTranslations("archive.index");
  return (
    <li>
      <Link
        href={`/archive/${date}`}
        className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 transition hover:border-accent/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="w-14 shrink-0 font-mono text-sm tabular-nums text-text-muted">
          #{puzzleNumber}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-bold text-text">{targetName}</span>
          <span className="text-xs text-text-muted">{formatRecapDate(date)}</span>
        </span>
        {/* The numbers are what make this an index rather than a list of links:
            a reader scanning it can see which days were hard before opening one.
            Hidden below sm, where the name and date are the whole row. */}
        <span className="hidden shrink-0 text-right font-mono text-xs tabular-nums text-text-muted sm:block">
          {players === 0 ? (
            t("noPlayers")
          ) : (
            <>
              {t("solved", { percent: formatPercent(completed === 0 ? 0 : solved / completed) })}
              <span className="block">{t("players", { count: players })}</span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
}

function Pagination({ page, pageCount }: { page: number; pageCount: number }) {
  const t = useTranslations("archive.index");
  if (pageCount <= 1) return null;

  return (
    <nav className="flex items-center justify-between gap-4" aria-label={t("pagination.label")}>
      {page > 1 ? (
        <Link
          href={archivePagePath(page - 1)}
          className="rounded-lg border border-border px-4 py-2 text-sm text-text transition hover:border-accent/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          rel="prev"
        >
          {t("pagination.newer")}
        </Link>
      ) : (
        <span />
      )}
      <span className="font-mono text-xs tabular-nums text-text-muted">
        {t("pagination.position", { page, total: pageCount })}
      </span>
      {page < pageCount ? (
        <Link
          href={archivePagePath(page + 1)}
          className="rounded-lg border border-border px-4 py-2 text-sm text-text transition hover:border-accent/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          rel="next"
        >
          {t("pagination.older")}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export async function ArchiveIndex({ page }: { page: number }) {
  // `getTranslations`, not the hook: this component is async, and
  // `useTranslations` is only available in a synchronous render.
  const t = await getTranslations("archive.index");
  const totalDays = await countArchiveDays();
  const pageCount = archivePageCount(totalDays);
  // A page beyond the end is a 404 and not an empty list: an empty page that
  // returns 200 is a soft 404, which Search Console reports and which lets a
  // crawler wander into /archive/page/900.
  if (page > pageCount) notFound();

  const days = await listArchiveDays(ARCHIVE_PAGE_SIZE, (page - 1) * ARCHIVE_PAGE_SIZE);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-text">{t("heading")}</h1>
        <p className="text-text-muted">{t("intro")}</p>
      </header>

      {days.length === 0 ? (
        <p className="text-sm text-text-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {days.map((day) => (
            <DayRow key={day.date} {...day} />
          ))}
        </ul>
      )}

      <Pagination page={page} pageCount={pageCount} />

      <p className="text-sm text-text-muted">
        <Link href="/" className="text-accent hover:underline">
          {t("playToday")}
        </Link>
      </p>
    </div>
  );
}
