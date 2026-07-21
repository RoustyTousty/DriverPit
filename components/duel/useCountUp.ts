"use client";

import { useEffect, useRef, useState } from "react";

// Animates 0 -> target over durationMs (eased, front-loaded like the rest
// of this feature's motion), for the intermission's "+140 / +35" round-
// point reveal (CLAUDE.md's Duel "Intermission"). `skip` snaps straight to
// the final value with no animation frames at all -- pass the OS/in-app
// reduced-motion signal here; this is a JS-driven number, not a CSS
// transition, so neither of the app's usual reduced-motion mechanisms
// (globals.css's data-attribute rule, Tailwind's motion-reduce: variant)
// touches it on their own.
export function useCountUp(target: number, durationMs: number, skip: boolean): number {
  const [value, setValue] = useState(skip ? target : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (skip) {
      setValue(target);
      return;
    }

    setValue(0);
    const start = performance.now();

    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setValue(Math.round(target * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, skip]);

  return value;
}
