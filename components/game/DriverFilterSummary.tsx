"use client";

import { describeDriverFilter, type DriverFilter } from "@/lib/game/driverFilter";

// THE one way an active driver filter is displayed, everywhere it appears:
// Infinite's caption above the guess input, the custom lobby's create screen,
// the host's waiting screen and the joiner's preview.
//
// It was two transcriptions of the same row -- Infinite's bare caption and a
// bordered box in the custom lobby -- which is how "the same filter" ended up
// looking like two different objects depending on which mode you were in. The
// pairing is deliberate and is the whole content: WHAT the pool is
// (describeDriverFilter, left) and HOW BIG it is (right, mono + tabular-nums
// because it is a number). Both come from the same `filter`, so a caption and a
// count can never describe different pools.
//
// Deliberately unboxed -- no border, no background. It is a caption on the
// control or the pool beneath it, not a field of its own; a bordered row reads
// as another input and competes with the thing it is describing.
export function DriverFilterSummary({
  filter,
  matchCount,
  referenceYear,
}: {
  filter: DriverFilter;
  /** How many drivers the filter admits, from matchesDriverFilter over the roster. */
  matchCount: number;
  referenceYear: number;
}) {
  // No horizontal padding. This carried `px-0.5` (2px), inherited from
  // Infinite's original caption, which indented BOTH ends relative to every
  // other label in whatever container it sits in -- visible on the custom
  // create screen, where "DRIVERS" is flush at 0 and the year underneath it was
  // not. Any nudge toward an input's inner text belongs on that pairing, not
  // baked into a component four screens now share.
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      {/* Same face as the count opposite it -- mono, muted, tabular. The two
          halves are one caption on the pool below, not a label and a value, so
          the left half being brighter and in the UI face made it read as a
          heading over the input rather than as the quiet annotation it is. */}
      <span className="min-w-0 truncate font-mono text-xs tabular-nums text-text-muted">
        {describeDriverFilter(filter, referenceYear)}
      </span>
      <span
        // Red at zero, because an empty pool is the one value that means "this
        // cannot be played" rather than "this is small". Unreachable in Infinite
        // (Apply is disabled on an empty filter) and reachable on the custom
        // create screen, where it is the explanation for the disabled button.
        className={`shrink-0 font-mono text-xs tabular-nums ${
          matchCount === 0 ? "text-red-400" : "text-text-muted"
        }`}
      >
        {/* Singular at one. It read "1 drivers" in Infinite, which is exactly
            the sort of detail that makes the rest of a screen look unconsidered
            -- and is now fixed in both places at once by there being one place. */}
        {matchCount} {matchCount === 1 ? "driver" : "drivers"}
      </span>
    </div>
  );
}
