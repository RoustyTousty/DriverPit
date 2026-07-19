import { DEFAULT_POOL_WINDOW, isPoolWindow, type PoolWindow } from "@/lib/game/poolWindow";

const STORAGE_KEY = "f1dw:infinite:poolWindow";

export function readPoolWindowPreference(): PoolWindow {
  if (typeof window === "undefined") return DEFAULT_POOL_WINDOW;
  const stored = localStorage.getItem(STORAGE_KEY);
  return isPoolWindow(stored) ? stored : DEFAULT_POOL_WINDOW;
}

export function writePoolWindowPreference(poolWindow: PoolWindow) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, poolWindow);
}
