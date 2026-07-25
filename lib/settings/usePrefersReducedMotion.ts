"use client";

import { useEffect, useState } from "react";

// The OS-level reduced-motion signal, and since the in-app "Reduce motion"
// toggle was removed, the ONLY one -- there is no app-level override to OR
// against here anymore.
//
// CSS reads the same media query natively through Tailwind's `motion-reduce:`
// variant, so styles need nothing from this hook. What it exists for is
// JS-driven animation -- a numeric count-up, a requestAnimationFrame loop, an
// auto-advancing carousel timer -- which is neither a CSS transition nor a CSS
// animation, so `motion-reduce:` never touches it. Call this directly wherever
// such an animation needs to snap or switch off.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    function handleChange() {
      setReduced(query.matches);
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}
