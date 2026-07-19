// Daily's target used to come from a `daily_puzzles` table precomputed a
// year ahead against whatever pool was live at generation time. When the
// pool definition changed (e.g. narrowing to the 10-year window), old rows
// kept pointing at drivers no longer eligible -- today's puzzle could
// reference a driver missing from the guess dropdown entirely, and the only
// fix was manually regenerating the schedule. This replaces the table with a
// pure, deterministic pick computed fresh from *today's* pool on every
// request: nothing to regenerate, ever, and it can never drift from the live
// pool because it always reads the live pool.

// First date the old precomputed schedule covered -- kept as the epoch so
// puzzle numbering stays continuous instead of jumping.
const DAILY_EPOCH = "2026-07-18";

function parseUtcDateMs(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function getDailyPuzzleNumber(date: string): number {
  const days = Math.round((parseUtcDateMs(date) - parseUtcDateMs(DAILY_EPOCH)) / 86_400_000);
  return days + 1;
}

// FNV-1a -- small, dependency-free, and stable across JS engines (no
// Math.random, no locale-sensitive behavior), so every concurrent request
// for "today" agrees on the same index without any shared state.
function hashDateToIndex(date: string, poolSize: number): number {
  let hash = 2166136261;
  for (let i = 0; i < date.length; i++) {
    hash ^= date.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % poolSize;
}

// Deterministic: the same date + pool always picks the same driver. Sorted
// by id first so a caller's query ordering can't silently change which
// driver a date lands on.
export function pickDailyDriverId(date: string, pool: readonly number[]): number {
  if (pool.length === 0) {
    throw new Error("No eligible drivers in the daily pool.");
  }
  const sorted = [...pool].sort((a, b) => a - b);
  return sorted[hashDateToIndex(date, sorted.length)];
}
