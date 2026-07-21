"use client";

import { useEffect, useState } from "react";

// The OS-level reduced-motion signal, independent of this app's own
// in-app setting (useSettings().reducedMotion) -- CSS already reads both
// (globals.css's `[data-reduced-motion="true"]` rule for the in-app
// toggle, Tailwind's `motion-reduce:` variant for this one natively), but
// a JS-driven animation (a numeric count-up, a requestAnimationFrame loop)
// isn't a CSS transition/animation, so neither mechanism touches it --
// call this directly wherever such an animation needs to snap instead.
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
