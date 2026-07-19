import {
  getDailyDriverId,
  getDailyPuzzleNumber,
  listPoolDriverOptions,
} from "@/lib/db/queries";
import { DAILY_POOL_WINDOW } from "@/lib/game/poolWindow";

import { DailyGame } from "./DailyGame";

// Same data for every visitor at a given moment (never per-user), so this
// doesn't need force-dynamic -- that disabled caching *and* Link
// prefetching entirely, forcing a full DB round trip on every single mode
// switch. ISR instead: cached for a minute, which is an imperceptible
// staleness window for a puzzle that only changes once a day.
export const revalidate = 60;

export default async function DailyPage() {
  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10);

  const [eligibleDrivers, targetId, puzzleNumber] = await Promise.all([
    listPoolDriverOptions(DAILY_POOL_WINDOW, now.getUTCFullYear()),
    getDailyDriverId(todayUtc),
    getDailyPuzzleNumber(todayUtc),
  ]);

  return (
    <DailyGame
      eligibleDrivers={eligibleDrivers}
      puzzleNumber={puzzleNumber}
      hasPuzzleToday={targetId !== undefined}
    />
  );
}
