"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ArchiveDayRow, type ArchiveDayRowData } from "./ArchiveDayRow";
import { filterArchiveDays } from "@/lib/recap/archiveSearch";

// Search across the whole archive, over an index that ships with the page.
//
// IT WRAPS THE SERVER-RENDERED LIST RATHER THAN REPLACING IT. `children` is the
// page of rows and its pagination, rendered on the server and present in the
// HTML; this component shows it whenever the box is empty, which is every
// request a crawler ever makes. So the crawlable list is never a client-side
// copy of itself, and search is strictly additive -- turn the JavaScript off and
// the archive is exactly the paginated document it was.
//
// The alternative -- a `?q=` search param -- was rejected for two reasons. It
// would opt every archive index page out of ISR (`searchParams` makes a page
// dynamic), which is the caching these pages exist to benefit from; and it would
// mint an unbounded set of crawlable URLs serving near-identical lists, which is
// the thin-content problem `lib/recap/dayEligibility.ts` was written to undo.

/**
 * Results rendered at once.
 *
 * A query like "2026" legitimately matches every day of a year, and 365 rows is
 * not a result list -- it is the archive again, unpaginated. The count line
 * always states the true total, so the cap narrows what is drawn and never what
 * was found.
 */
const MAX_SEARCH_RESULTS = 24;

const SEARCH_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    className="h-4 w-4"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

const CLEAR_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    className="h-4 w-4"
    aria-hidden="true"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export function ArchiveSearch({
  index,
  children,
}: {
  /** Every finished day, newest first. See lib/db/dailyRecap#listArchiveSearchIndex. */
  index: ArchiveDayRowData[];
  /** The server-rendered page of rows and its pagination. */
  children: React.ReactNode;
}) {
  const t = useTranslations("archive.index.search");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const searching = trimmed !== "";

  // Memoized on the query, so typing does not re-scan the index for a render
  // caused by something else -- and so the row list keeps its identity while the
  // input is merely focused or blurred.
  const results = useMemo(
    () => (searching ? filterArchiveDays(index, trimmed) : []),
    [index, trimmed, searching],
  );

  const shown = results.slice(0, MAX_SEARCH_RESULTS);

  function clear() {
    setQuery("");
    // Focus goes back to the box rather than to <body>. The clear button is
    // about to unmount under the pointer, and dropping focus to the top of the
    // document is how a keyboard user loses their place mid-search.
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="archive-search"
          className="text-xs font-semibold tracking-wide text-text-muted uppercase"
        >
          {t("label")}
        </label>
        <div className="relative">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted"
            aria-hidden="true"
          >
            {SEARCH_ICON}
          </span>
          <input
            id="archive-search"
            ref={inputRef}
            // `text`, not `search`: WebKit draws its own clear affordance inside
            // a search input, which would sit beside ours in a different shape.
            type="text"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Escape clears rather than bubbling. Nothing here closes on
              // Escape today, but this is the key people press to abandon a
              // search and it costs one line to honour.
              if (event.key === "Escape" && query !== "") {
                event.stopPropagation();
                clear();
              }
            }}
            placeholder={t("placeholder")}
            className="w-full rounded-lg border border-border bg-surface-2 py-2.5 pr-10 pl-9 text-sm text-text outline-none transition placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
          />
          {searching && (
            <button
              type="button"
              onClick={clear}
              aria-label={t("clear")}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-text-muted transition hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              {CLEAR_ICON}
            </button>
          )}
        </div>
        {/* The hint is the only place the syntax is stated. It is a caption on
            the input in DriverFilterSummary's idiom -- muted, small, unboxed --
            because a bordered help panel over a search box competes with the box
            it is explaining. */}
        <p className="text-xs text-text-muted">{t("hint")}</p>
      </div>

      {searching ? (
        <div className="flex flex-col gap-3">
          {/* Results appear with no navigation, so the count is announced.
              Persistently mounted rather than rendered on demand: a live region
              that mounts with its message already in it is not reliably read. */}
          <p role="status" aria-live="polite" className="font-mono text-xs tabular-nums text-text-muted">
            {results.length === 0
              ? t("empty", { query: trimmed })
              : results.length > shown.length
                ? t("resultsTruncated", { count: results.length, shown: shown.length })
                : t("results", { count: results.length })}
          </p>
          {shown.length > 0 && (
            <ul className="flex flex-col gap-2">
              {shown.map((day) => (
                <ArchiveDayRow key={day.date} day={day} />
              ))}
            </ul>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
