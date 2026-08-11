"use client";

import { useEffect, useRef, useState } from "react";

// Audit 2026-07-29 §1.2. This used to be a `countdown` state value on
// DailyBoard, so a 1 Hz setState re-rendered the whole completed-board screen
// -- GuessGrid (6 rows x 6 tiles, plus GuessAnnouncer's effect), ResultCard and
// the share Modal -- 60 times a minute to repaint eight characters.
//
// The ticking state now lives in the leaf that renders it, which is the same
// argument (and the same shape) as GuessAnnouncer: nothing above this <p>
// re-renders on a tick. The one thing the board genuinely cares about, the UTC
// day turning over, comes back up as a single `onRollover` call.

// Absolute epoch ms of the first UTC midnight strictly after `from`. Absolute
// rather than a remaining duration on purpose: a suspended laptop that wakes up
// past midnight compares against a fixed deadline and fires the rollover on its
// first tick, where a decremented counter would just resume from a stale value.
function nextUtcMidnight(from: number): number {
  const d = new Date(from);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function NextPuzzleCountdown({ onRollover }: { onRollover: () => void }) {
  const [countdown, setCountdown] = useState("");

  // The latest callback without its identity being an effect dependency: a
  // caller passing an inline arrow would otherwise tear the interval down and
  // rebuild it on every one of its own renders, losing up to a second of tick
  // each time. Same reasoning as Modal's onCloseRef.
  const onRolloverRef = useRef(onRollover);
  useEffect(() => {
    onRolloverRef.current = onRollover;
  });

  // Mounted only while the day is over (the caller renders it behind that
  // condition), so there is nothing to tick against a live board.
  useEffect(() => {
    let deadline = nextUtcMidnight(Date.now());

    function tick() {
      const now = Date.now();
      if (now >= deadline) {
        // The UTC day has rolled over: re-arm for the next one and tell the
        // board, which re-hydrates onto the new day and unmounts this.
        deadline = nextUtcMidnight(now);
        onRolloverRef.current();
      }
      setCountdown(formatCountdown(deadline - now));
    }

    // Paint the real value on the first frame rather than waiting a second for
    // the interval; deliberately not a lazy useState initializer, which would
    // run during a server render too and hydrate against a different second.
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return <p className="text-center text-sm text-text-muted">Next driver in {countdown}</p>;
}
