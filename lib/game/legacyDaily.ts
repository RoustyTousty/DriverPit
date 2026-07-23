// Pre-server daily progress lived in localStorage at `f1dw:daily:<UTC-date>`
// (no user id) as a `{ guesses: { guessedDriver: { id } }[], status, target }`
// blob written by the old client. The server is the record now; this reads that
// legacy blob so AuthProvider can push it up once (migrateLocalDaily) and then
// clears it, so a migrated board can't be replayed.
//
// The current write-through cache (app/(game)/daily/DailyGame.tsx) uses a
// different key shape -- `f1dw:daily:<userId>:<date>` -- so a bare
// `f1dw:daily:<date>` (a lone date suffix, no user id) is unambiguously the old
// format. That distinction is the whole reason the cache cleanup must leave
// these keys alone (isLegacyDailyKey below): this migration owns their
// lifecycle, and deleting one before it's read would silently drop the
// player's progress.
const LEGACY_DAILY_PREFIX = "f1dw:daily:";
const LEGACY_DAILY_KEY_RE = /^f1dw:daily:\d{4}-\d{2}-\d{2}$/;

export function isLegacyDailyKey(key: string): boolean {
  return LEGACY_DAILY_KEY_RE.test(key);
}

interface LegacyDailyBlob {
  guesses?: { guessedDriver?: { id?: number } }[];
}

function todayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// The ordered guessed driver ids from today's legacy blob, or [] if there's
// none / it can't be parsed. Ids only -- tiles, target, and completion are all
// recomputed server-side and never trusted from this blob.
export function readLegacyDailyGuessIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LEGACY_DAILY_PREFIX + todayUtcKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyDailyBlob;
    if (!Array.isArray(parsed.guesses)) return [];
    return parsed.guesses
      .map((guess) => guess.guessedDriver?.id)
      .filter((id): id is number => typeof id === "number");
  } catch {
    return [];
  }
}

// Removes every legacy daily key (all dates) so a migrated board can't be
// replayed on a later load. Only touches the no-user-id legacy format; the
// write-through cache (`f1dw:daily:<userId>:<date>`) is left alone.
export function clearLegacyDailyKeys(): void {
  if (typeof window === "undefined") return;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isLegacyDailyKey(key)) toRemove.push(key);
  }
  for (const key of toRemove) localStorage.removeItem(key);
}
