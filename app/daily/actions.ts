"use server";

import {
  getDailyDriverId,
  getDriverById,
  toDriverSummary,
  toGameDriver,
  type DriverSummary,
} from "@/lib/db/queries";
import { compare, isWin, type GuessResult } from "@/lib/game/compare";
import { DAILY_POOL_WINDOW } from "@/lib/game/poolWindow";

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// Computed fresh from the live pool, not a precomputed schedule -- same
// pick every time for a given date (see lib/game/dailySelection.ts), so
// both calls below independently land on the same target without sharing
// state.
async function todaysDailyTargetId(): Promise<number | undefined> {
  try {
    return await getDailyDriverId(DAILY_POOL_WINDOW, new Date().getUTCFullYear(), todayUtcDateString());
  } catch {
    return undefined;
  }
}

export type SubmitDailyGuessResult =
  | {
      ok: true;
      guessedDriver: DriverSummary;
      result: GuessResult;
      won: boolean;
    }
  | { ok: false; error: string };

export async function submitDailyGuess(
  guessedDriverId: number,
): Promise<SubmitDailyGuessResult> {
  const today = new Date();
  const targetId = await todaysDailyTargetId();

  if (!targetId) {
    return { ok: false, error: "No puzzle is scheduled for today." };
  }

  const [guessedRow, targetRow] = await Promise.all([
    getDriverById(guessedDriverId),
    getDriverById(targetId),
  ]);

  if (!guessedRow) {
    return { ok: false, error: "Pick a driver from the suggestions list." };
  }
  if (!targetRow) {
    return { ok: false, error: "Today's puzzle is unavailable." };
  }

  const result = compare(
    toGameDriver(guessedRow),
    toGameDriver(targetRow),
    today,
  );

  return {
    ok: true,
    guessedDriver: toDriverSummary(guessedRow, today),
    result,
    won: isWin(result),
  };
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
