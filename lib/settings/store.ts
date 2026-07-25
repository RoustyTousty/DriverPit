const STORAGE_KEY = "f1dw:settings";

// Fired on every write so same-tab consumers (useSettings) can react
// immediately -- the native `storage` event only fires in *other* tabs.
export const SETTINGS_EVENT = "f1dw:settings-changed";

export interface Settings {
  colorblindMode: boolean;
  // Nationality tiles show a flag instead of the country name when on.
  // Team logos aren't implemented (no asset source for 132 historical
  // constructors) -- this only ever affects the nationality column.
  showFlags: boolean;
}

const DEFAULT_SETTINGS: Settings = {
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
  applyColorblindAttribute(settings.colorblindMode);
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

// A data attribute on <html> + a CSS variable override (see globals.css) swaps
// the "correct" green for a blue that stays distinguishable from the orange
// accent under red-green color vision deficiencies, the most common kind.
//
// (There used to be an applyMotionAttribute alongside this, backing an in-app
// "Reduce motion" toggle. Motion now follows the OS `prefers-reduced-motion`
// setting alone, via Tailwind's `motion-reduce:` variant and
// usePrefersReducedMotion for JS-driven animation -- no app-level override.)
export function applyColorblindAttribute(colorblindMode: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.colorblind = colorblindMode ? "true" : "false";
}
