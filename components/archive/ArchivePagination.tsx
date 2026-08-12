import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";
import { PAGE_GAP, archivePagePath, archivePageWindow } from "@/lib/recap/archivePaging";

// Numbered pagination, not a bare prev/next pair.
//
// With ten days to a page a year of archive is 37 pages, and prev/next alone
// makes the oldest of them 36 clicks from the newest -- for a reader, and for a
// crawler walking the only path it has into the older days. The window puts the
// first and last page on every page, so the whole archive is at most two clicks
// deep from anywhere in it.
//
// The current page is `bg-accent-weak text-accent`, which is this site's active
// state everywhere it appears (the mode tabs, the settings tablist) rather than
// a solid accent fill invented here.

const ARROW_CLASS =
  "rounded-lg border border-border px-3 py-2 text-sm text-text transition hover:border-accent/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none";

// A dead arrow keeps its footprint rather than collapsing. Without it the
// numbers slide sideways between page 1 and page 2, which reads as the control
// rearranging itself under the cursor.
const ARROW_DISABLED_CLASS =
  "rounded-lg border border-transparent px-3 py-2 text-sm text-text-muted/40 select-none";

export function ArchivePagination({ page, pageCount }: { page: number; pageCount: number }) {
  const t = useTranslations("archive.index.pagination");
  if (pageCount <= 1) return null;

  const slots = archivePageWindow(page, pageCount);

  return (
    <nav aria-label={t("label")} className="flex items-center justify-between gap-2">
      {page > 1 ? (
        <Link href={archivePagePath(page - 1)} className={ARROW_CLASS} rel="prev">
          {t("newer")}
        </Link>
      ) : (
        <span className={ARROW_DISABLED_CLASS} aria-hidden="true">
          {t("newer")}
        </span>
      )}

      {/* Numbers on a real screen; the position line on a phone, where seven
          tappable numbers between two arrows is a row of targets too small to
          hit and too narrow to read. Same information, sized to the space. */}
      <ol className="hidden items-center gap-1 sm:flex">
        {slots.map((slot, index) =>
          slot === PAGE_GAP ? (
            <li
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 font-mono text-xs text-text-muted"
            >
              …
            </li>
          ) : slot === page ? (
            <li key={slot}>
              <span
                aria-current="page"
                className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-accent-weak px-2 font-mono text-sm font-bold tabular-nums text-accent"
              >
                {slot}
              </span>
            </li>
          ) : (
            <li key={slot}>
              <Link
                href={archivePagePath(slot)}
                aria-label={t("goToPage", { page: slot })}
                className="flex h-9 min-w-9 items-center justify-center rounded-lg px-2 font-mono text-sm tabular-nums text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                {slot}
              </Link>
            </li>
          ),
        )}
      </ol>

      <span className="font-mono text-xs tabular-nums text-text-muted sm:hidden">
        {t("position", { page, total: pageCount })}
      </span>

      {page < pageCount ? (
        <Link href={archivePagePath(page + 1)} className={ARROW_CLASS} rel="next">
          {t("older")}
        </Link>
      ) : (
        <span className={ARROW_DISABLED_CLASS} aria-hidden="true">
          {t("older")}
        </span>
      )}
    </nav>
  );
}
