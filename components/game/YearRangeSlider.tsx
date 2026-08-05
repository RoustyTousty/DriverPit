"use client";

import { useId } from "react";

// A two-thumb range built from two native <input type="range">, stacked over one
// shared track. Deliberately not a custom pointer-driven widget: a native range
// is already keyboard-operable (arrows, Home/End, PageUp/Down), announces itself
// as a slider with its value, and works with touch assistive tech -- all of which
// a div-with-listeners has to reimplement and usually gets half-right. What the
// two-input approach costs is the hit-testing, handled below.
//
// The three rules that make the overlay work:
//   1. The inputs are transparent and absolutely positioned over a drawn track;
//      only their THUMBS are pointer-targets (`pointer-events-none` on the
//      input, `auto` on the thumb via the vendor pseudo-elements in globals.css).
//      Without that the top input would swallow every click meant for the lower.
//   2. Each thumb clamps against the other on change, so they can cross in
//      intent but never in value -- the caller always gets from <= to.
//   3. The one nearer the middle sits on top (z-index), so a pair dragged to the
//      same year can still be pulled apart instead of locking together.
export function YearRangeSlider({
  min,
  max,
  from,
  to,
  onChange,
  disabled = false,
}: {
  min: number;
  max: number;
  from: number;
  to: number;
  onChange: (next: { from: number; to: number }) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const span = Math.max(1, max - min);
  const percent = (year: number) => ((year - min) / span) * 100;
  // With both thumbs past the midpoint the FROM thumb is the one that can get
  // stranded at the far right under its partner, and vice versa.
  const fromOnTop = from > (min + max) / 2;

  return (
    <div className="flex flex-col gap-2.5">
      {/* The two years as one centered statement rather than pinned to the
          edges: they are a range, and mono tabular so the digits don't shift
          under a dragging thumb. */}
      <p className="text-center font-mono text-xl font-bold tabular-nums text-text">
        {from}
        <span className="px-1.5 text-sm font-normal text-text-muted">–</span>
        {to}
      </p>

      <div className="relative h-6">
        {/* The drawn track: full width in --border, with the selected span
            filled in accent. Purely visual -- aria-hidden, since the two real
            inputs below already carry the values. */}
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border">
          <div
            className="absolute h-full rounded-full bg-accent"
            style={{ left: `${percent(from)}%`, right: `${100 - percent(to)}%` }}
          />
        </div>

        <input
          id={`${id}-from`}
          type="range"
          min={min}
          max={max}
          step={1}
          value={from}
          disabled={disabled}
          aria-label="First season"
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange({ from: Math.min(next, to), to });
          }}
          className={`range-thumb absolute inset-x-0 top-1/2 h-6 w-full -translate-y-1/2 appearance-none bg-transparent ${
            fromOnTop ? "z-20" : "z-10"
          }`}
        />
        <input
          id={`${id}-to`}
          type="range"
          min={min}
          max={max}
          step={1}
          value={to}
          disabled={disabled}
          aria-label="Last season"
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange({ from, to: Math.max(next, from) });
          }}
          className={`range-thumb absolute inset-x-0 top-1/2 h-6 w-full -translate-y-1/2 appearance-none bg-transparent ${
            fromOnTop ? "z-10" : "z-20"
          }`}
        />
      </div>

      <div aria-hidden="true" className="flex justify-between font-mono text-[10px] tabular-nums text-text-muted">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
