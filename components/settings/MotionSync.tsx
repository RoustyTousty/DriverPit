"use client";

import { useEffect } from "react";

import { applyMotionAttribute, readSettings } from "@/lib/settings/store";

// Applies the persisted reduced-motion override on first paint, so it takes
// effect even if the user never opens Settings this session.
export function MotionSync() {
  useEffect(() => {
    applyMotionAttribute(readSettings().reducedMotion);
  }, []);

  return null;
}
