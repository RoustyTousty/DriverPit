"use client";

import { useEffect, useState } from "react";

import { readSettings, SETTINGS_EVENT, type Settings } from "./store";

// Reactive read of the persisted settings -- re-reads whenever writeSettings
// fires SETTINGS_EVENT (same tab) or a `storage` event lands (another tab),
// so a mid-game toggle (e.g. "Show flags") updates already-open game
// windows immediately instead of needing a reload.
export function useSettings(): Settings {
  const [settings, setSettings] = useState<Settings>(() => readSettings());

  useEffect(() => {
    function sync() {
      setSettings(readSettings());
    }
    window.addEventListener(SETTINGS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return settings;
}
