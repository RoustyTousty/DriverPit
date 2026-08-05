"use client";

import { describeDriverFilter, type DriverFilter } from "@/lib/game/driverFilter";

// Opens the driver-filter panel. Icon only, and sized to sit beside "New
// driver" in the Infinite header -- the two are the mode's only chrome, so
// they belong together rather than as a full-width bar across the board.
//
// The filter's STATE is not shown here; it is rendered above the guess input,
// where it reads as a caption on the pool being guessed from rather than as a
// label on a button. That split is why the accessible name below carries the
// whole description: with no visible text left on the control, `aria-label` is
// the only name it has, and "button" alone is useless.
export function DriverFilterButton({
  filter,
  matchCount,
  referenceYear,
  onOpen,
  disabled = false,
}: {
  filter: DriverFilter;
  matchCount: number;
  referenceYear: number;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const summary = describeDriverFilter(filter, referenceYear);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label={`Driver filter: ${summary}. ${matchCount} drivers. Change`}
      // For the mouse, which gets no text at all otherwise. Deliberately the
      // control's NAME rather than the summary: the summary is already on
      // screen, and a tooltip repeating it would be noise.
      title="Driver filter"
      // The same filled shell as "New driver" beside it -- border + bg-surface-2
      // + text-text is what a live control looks like here (see the note at that
      // button). p-2 with a 20px icon matches its px-3 py-2 text-sm height
      // exactly, so the two read as one pair rather than as two sizes.
      className="flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 p-2 text-text transition hover:brightness-125 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:hover:brightness-100"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        className="h-5 w-5"
        aria-hidden="true"
      >
        {/* Sliders, not a funnel: this opens a panel of adjustable criteria
            rather than applying one preset. */}
        <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="8" cy="12" r="2" />
        <circle cx="16" cy="18" r="2" />
      </svg>
    </button>
  );
}
