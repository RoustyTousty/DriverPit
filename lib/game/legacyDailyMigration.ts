import { migrateLocalDaily } from "@/lib/db/dailyProgressActions";

import { clearLegacyDailyKeys, readLegacyDailyGuessIds } from "./legacyDaily";

// Push pre-existing local daily progress onto the current account (server
// precedence + idempotent -- see migrateLocalDaily / migrateLocalDailyFor). The
// server-action orchestration lives here, separate from the pure localStorage
// helpers in ./legacyDaily, so that module stays free of the server import.
//
// Called from BOTH:
//   - AuthProvider (on sign-in / upgrade), so a returning player's local board
//     is carried over regardless of which page they land on; and
//   - DailyGame's hydration, so /daily fetches its board AFTER the migration
//     settles and therefore reflects it.
// The two calls race harmlessly: whichever migrateLocalDaily lands first
// creates the row, the other no-ops (server precedence), and clearing the
// legacy key is idempotent. Throws on a transient failure so callers can decide
// whether to retain the key for a retry.
export async function pushLocalDailyToServer(): Promise<void> {
  const guessIds = readLegacyDailyGuessIds();
  if (guessIds.length === 0) {
    // Nothing for today, but tidy any older legacy keys so they don't linger.
    clearLegacyDailyKeys();
    return;
  }
  await migrateLocalDaily(guessIds);
  clearLegacyDailyKeys();
}
