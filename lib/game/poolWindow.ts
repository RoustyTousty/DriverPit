export type PoolWindow = "current-season" | "10-years" | "20-years" | "30-years" | "legacy";

// Daily always uses this window — fixed, not user-selectable. Infinite
// mode defaults to the same value but the player can change it.
export const DAILY_POOL_WINDOW: PoolWindow = "10-years";
export const DEFAULT_POOL_WINDOW: PoolWindow = DAILY_POOL_WINDOW;

// `tier` is the short display name for the window; `label` is the longer
// description shown alongside it (dropdown captions, marketing copy).
export const POOL_WINDOWS: { value: PoolWindow; tier: string; label: string }[] = [
  { value: "current-season", tier: "Amateur", label: "Current season only" },
  { value: "10-years", tier: "Regular", label: "Last 10 years" },
  { value: "20-years", tier: "Professional", label: "Last 20 years" },
  { value: "30-years", tier: "Veteran", label: "Last 30 years" },
  { value: "legacy", tier: "Legend", label: "Every driver, ever" },
];

export function isPoolWindow(value: unknown): value is PoolWindow {
  return typeof value === "string" && POOL_WINDOWS.some((w) => w.value === value);
}

// null = no cutoff, every driver who's ever started a race is in the pool.
export function poolCutoffYear(window: PoolWindow, referenceYear: number): number | null {
  switch (window) {
    case "current-season":
      return referenceYear;
    case "10-years":
      return referenceYear - 10;
    case "20-years":
      return referenceYear - 20;
    case "30-years":
      return referenceYear - 30;
    case "legacy":
      return null;
  }
}

export function isInPool(lastActiveYear: number, window: PoolWindow, referenceYear: number): boolean {
  const cutoff = poolCutoffYear(window, referenceYear);
  return cutoff === null || lastActiveYear >= cutoff;
}
