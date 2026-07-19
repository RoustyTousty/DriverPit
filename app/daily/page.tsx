import {
  getDailyDriverId,
  getDailyPuzzleNumber,
  listPoolDriverOptions,
} from "@/lib/db/queries";
import { DAILY_POOL_WINDOW } from "@/lib/game/poolWindow";

import { DailyGame } from "./DailyGame";

// Depends on live DB data (today's scheduled puzzle, the eligible driver
// pool) so it must never be statically prerendered at build time.
export const dynamic = "force-dynamic";

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
