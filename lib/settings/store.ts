const STORAGE_KEY = "f1dw:settings";

// Fired on every write so same-tab consumers (useSettings) can react
// immediately -- the native `storage` event only fires in *other* tabs.
export const SETTINGS_EVENT = "f1dw:settings-changed";

export interface Settings {
  reducedMotion: boolean;
  colorblindMode: boolean;
  // Nationality tiles show a flag instead of the country name when on.
  // Team logos aren't implemented (no asset source for 132 historical
  // constructors) -- this only ever affects the nationality column.
  showFlags: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  reducedMotion: false,
  colorblindMode: false,
  showFlags: false,
};

export function readSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: Settings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  applyMotionAttribute(settings.reducedMotion);
  applyColorblindAttribute(settings.colorblindMode);
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

// Mirrors the setting onto <html> so a single global CSS rule (see
// globals.css) can kill animations app-wide, independent of the OS-level
// `prefers-reduced-motion` media query that `motion-reduce:` utilities read.
export function applyMotionAttribute(reducedMotion: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.reducedMotion = reducedMotion ? "true" : "false";
}

// Same pattern as reduced-motion: a data attribute + a CSS variable
// override (see globals.css) swaps the "correct" green for a blue that
// stays distinguishable from the orange accent under red-green color
// vision deficiencies, the most common kind.
export function applyColorblindAttribute(colorblindMode: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.colorblind = colorblindMode ? "true" : "false";
}
