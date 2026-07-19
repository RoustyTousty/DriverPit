import { listPoolDriverOptions } from "@/lib/db/queries";
import { getDailyPuzzleNumber } from "@/lib/game/dailySelection";
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

  const eligibleDrivers = await listPoolDriverOptions(DAILY_POOL_WINDOW, now.getUTCFullYear());
  const puzzleNumber = getDailyPuzzleNumber(todayUtc);

  return (
    <DailyGame
      eligibleDrivers={eligibleDrivers}
      puzzleNumber={puzzleNumber}
      hasPuzzleToday={eligibleDrivers.length > 0}
    />
  );
}
