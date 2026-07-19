"use client";

import { useEffect } from "react";

import { applyColorblindAttribute, applyMotionAttribute, readSettings } from "@/lib/settings/store";

// Applies persisted DOM-attribute-driven settings (reduced motion,
// colorblind mode) on first paint, so they take effect even if the user
// never opens Settings this session.
export function SettingsSync() {
  useEffect(() => {
    const settings = readSettings();
    applyMotionAttribute(settings.reducedMotion);
    applyColorblindAttribute(settings.colorblindMode);
  }, []);

  return null;
}
