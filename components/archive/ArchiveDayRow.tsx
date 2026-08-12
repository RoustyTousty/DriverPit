import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";
import { formatPercent } from "@/lib/recap/format";

// One finished day, as a row.
//
// THE SAME COMPONENT in both places a day is listed: the server-rendered page of
// rows, and the client-side search results above it. That is deliberate and is
// the reason it takes a preformatted `dateLabel` rather than a locale --
// `formatUtcDate` is a server helper, and duplicating the row so the client
// could have its own would make the same day look like two different objects
// depending on how the reader reached it.
//
// It carries no `"use client"` of its own. Imported from a server component it
// renders on the server; imported from the search box it is compiled into that
// client bundle. Nothing in here needs to know which happened.
//
// The numbers on the right are what make this an index rather than a list of
// links -- a reader scanning it can see which days were hard before opening one.
// They used to be `hidden sm:block`, which meant a phone, where most of this
// site is read, got the least informative version of the page.

export interface ArchiveDayRowData {
  /** UTC day, `YYYY-MM-DD` — the href, and the row's identity. */
  date: string;
  puzzleNumber: number;
  driverName: string;
  /** The date as this locale writes it. Display AND the search's date match. */
  dateLabel: string;
  players: number;
  completed: number;
  solved: number;
}

const CHEVRON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    className="hidden h-4 w-4 shrink-0 text-text-muted transition group-hover:text-text sm:block"
    aria-hidden="true"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export function ArchiveDayRow({ day }: { day: ArchiveDayRowData }) {
  const t = useTranslations("archive.index");
  // The puzzle number is drawn as a bare "#25" in the well, which is a shorthand
  // a screen reader would read as punctuation. `archive.puzzleNumber` is the
  // same string the day page's own header uses, so the two cannot say the number
  // two different ways.
  const tDay = useTranslations("archive");

  return (
    <li>
      <Link
        href={`/archive/${day.date}`}
        className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-3 transition hover:border-accent/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none sm:gap-4 sm:px-4"
      >
        {/* A raised well on the row's surface, which is the depth model this
            site uses everywhere: --surface is the window, --surface-2 is what
            sits on it. Not an accent well -- ten of those down a page is the
            "more than ~10% of a screen is orange" failure, and a puzzle number
            is a label rather than an action. */}
        <span
          className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 font-mono text-xs font-bold tabular-nums text-text-muted transition group-hover:text-text sm:w-14 sm:text-sm"
          aria-hidden="true"
        >
          #{day.puzzleNumber}
        </span>
        <span className="sr-only">{tDay("puzzleNumber", { number: day.puzzleNumber })}</span>

        <span className="flex min-w-0 flex-1 flex-col">
          {/* The driver leads. The date is the row's identity for a crawler, but
              the answer is what a reader is scanning for -- and the date is
              immediately below it either way. */}
          <span className="truncate text-sm font-bold text-text">{day.driverName}</span>
          <span className="truncate font-mono text-xs tabular-nums text-text-muted">
            {day.dateLabel}
          </span>
        </span>

        <span className="shrink-0 text-right font-mono text-xs tabular-nums">
          {day.players === 0 ? (
            <span className="text-text-muted">{t("noPlayers")}</span>
          ) : (
            <>
              <span className="block text-text">
                {t("solved", {
                  percent: formatPercent(day.completed === 0 ? 0 : day.solved / day.completed),
                })}
              </span>
              <span className="block text-text-muted">{t("players", { count: day.players })}</span>
            </>
          )}
        </span>

        {CHEVRON}
      </Link>
    </li>
  );
}
