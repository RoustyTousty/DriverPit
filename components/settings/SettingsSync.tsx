"use client";

import { useEffect } from "react";

import { applyColorblindAttribute, readSettings } from "@/lib/settings/store";

// Applies persisted DOM-attribute-driven settings (colorblind mode) on first
// paint, so they take effect even if the user never opens Settings this
// session.
export function SettingsSync() {
  useEffect(() => {
    const settings = readSettings();
    applyColorblindAttribute(settings.colorblindMode);
  }, []);

  return null;
}
