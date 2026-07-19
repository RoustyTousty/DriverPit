const STORAGE_KEY = "f1dw:settings";

export interface Settings {
  hardMode: boolean;
  reducedMotion: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  hardMode: false,
  reducedMotion: false,
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
}

// Mirrors the setting onto <html> so a single global CSS rule (see
// globals.css) can kill animations app-wide, independent of the OS-level
// `prefers-reduced-motion` media query that `motion-reduce:` utilities read.
export function applyMotionAttribute(reducedMotion: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.reducedMotion = reducedMotion ? "true" : "false";
}
