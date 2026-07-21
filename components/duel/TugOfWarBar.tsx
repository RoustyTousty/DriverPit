"use client";

import { useEffect, useRef, useState } from "react";

import { tugFill } from "@/lib/game/duelScoring";

// The one deliberate exception to both "orange stays minimal" *and* "no
// ambient loops" (CLAUDE.md's design system section) -- driven live by
// tugFill(liveMine, liveOpponent) (lib/game/duelScoring.ts), where each
// live score already folds in the 100-point baseline, confirmed round
// points, and the current round's provisional (best-guess-so-far, or
// locked speed points once solved) -- so this moves on every new best
// guess and jumps on a solve, not only when a round actually closes. A
// striped texture on each fill and a sliding "pull point" marker (which
// briefly pulses whenever the balance actually shifts) read as active
// back-and-forth pressure rather than a single static gauge. Smooth
// transitions; snaps under reduced motion instead of easing, and the pulse
// is skipped outright.
export function TugOfWarBar({ liveMine, liveOpponent }: { liveMine: number; liveOpponent: number }) {
  const fill = tugFill(liveMine, liveOpponent);
  const myPct = Math.round(fill * 100);

  const [pulsing, setPulsing] = useState(false);
  const prevFillRef = useRef(fill);

  useEffect(() => {
    if (Math.abs(fill - prevFillRef.current) < 0.001) return;
    prevFillRef.current = fill;
    setPulsing(true);
    const timeout = setTimeout(() => setPulsing(false), 400);
    return () => clearTimeout(timeout);
  }, [fill]);

  return (
    <div
      className="relative h-5 w-full rounded-full bg-surface-2 shadow-inner"
      role="img"
      aria-label={`Score balance: you ${Math.round(liveMine)}, opponent ${Math.round(liveOpponent)}`}
    >
      <div className="absolute inset-0 overflow-hidden rounded-full">
        <div
          className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{
            width: `${myPct}%`,
            backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 8px, transparent 8px 16px)",
          }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-text-muted/40 transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{
            width: `${100 - myPct}%`,
            backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.1) 0 8px, transparent 8px 16px)",
          }}
        />
      </div>

      {/* Pull-point marker -- slides with the balance, briefly scales up on a change. */}
      <div
        aria-hidden="true"
        className={`absolute top-1/2 z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-accent bg-bg shadow-[0_0_10px_rgba(255,106,0,0.55)] transition-all duration-300 ease-out motion-reduce:transition-none motion-reduce:scale-100 ${
          pulsing ? "scale-110" : "scale-100"
        }`}
        style={{ left: `${myPct}%` }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 text-accent">
          <path d="M8 8 4 12l4 4M16 8l4 4-4 4" />
        </svg>
      </div>
    </div>
  );
}
