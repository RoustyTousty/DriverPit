"use server";

import { getDailyDriverId, getDriverById, toDriverSummary, type DriverSummary } from "@/lib/db/queries";
import { DAILY_POOL_WINDOW } from "@/lib/game/poolWindow";

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// Computed fresh from the live pool, not a precomputed schedule -- same
// pick every time for a given date (see lib/game/dailySelection.ts). Also
// mirrored in SQL (drizzle/0028's pick_daily_driver_id, parity-tested
// against this exact TS implementation in
// lib/game/dailySelection.sqlParity.test.ts) for the hot per-guess path
// (lib/game/submitDailyGuess.ts) -- this Server Action version stays
// exactly as it was, since it's only ever called once per lost game
// (revealDailyTarget below), where a Vercel round trip doesn't matter.
async function todaysDailyTargetId(): Promise<number | undefined> {
  try {
    return await getDailyDriverId(DAILY_POOL_WINDOW, new Date().getUTCFullYear(), todayUtcDateString());
  } catch {
    return undefined;
  }
}

export type RevealDailyTargetResult =
  | { ok: true; target: DriverSummary }
  | { ok: false; error: string };

// Called only once the client has locally exhausted its guesses without a
// win — the target stays server-side for the rest of active play.
export async function revealDailyTarget(): Promise<RevealDailyTargetResult> {
  const today = new Date();
  const targetId = await todaysDailyTargetId();
  if (!targetId) {
    return { ok: false, error: "No puzzle is scheduled for today." };
  }

  const targetRow = await getDriverById(targetId);
  if (!targetRow) {
    return { ok: false, error: "Today's puzzle is unavailable." };
  }

  return { ok: true, target: toDriverSummary(targetRow, today) };
}
