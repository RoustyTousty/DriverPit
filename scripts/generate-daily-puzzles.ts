import "dotenv/config";

import { client, db } from "../lib/db";
import { dailyPuzzles } from "../lib/db/schema";
import { getLatestScheduledDailyDate, listPoolDriverIds } from "../lib/db/queries";
import { DAILY_POOL_WINDOW } from "../lib/game/poolWindow";

const DAYS_TO_GENERATE = 365;

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Cycles through a shuffled copy of the full pool before repeating any
// driver, and never lets a cycle boundary repeat the same driver two days
// in a row. With ~130 eligible drivers and 365 days, some repeats across
// the year are unavoidable — this keeps them as spread out as possible.
function buildSchedule(pool: number[], days: number): number[] {
  if (pool.length === 0) {
    throw new Error("No eligible drivers found. Run the seed script first.");
  }

  const schedule: number[] = [];
  let bag: number[] = [];
  let lastId: number | null = null;

  while (schedule.length < days) {
    if (bag.length === 0) {
      bag = shuffle(pool);
      if (pool.length > 1 && lastId !== null && bag[0] === lastId) {
        const swapIndex = 1 + Math.floor(Math.random() * (bag.length - 1));
        [bag[0], bag[swapIndex]] = [bag[swapIndex], bag[0]];
      }
    }
    const next = bag.shift()!;
    schedule.push(next);
    lastId = next;
  }

  return schedule;
}

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function main() {
  // Evaluated once per run against the current real year — the same
  // pragmatic "computed at generation time" tradeoff the precomputed
  // schedule itself already makes. Re-running this script periodically
  // naturally keeps the window current.
  const pool = await listPoolDriverIds(DAILY_POOL_WINDOW, new Date().getUTCFullYear());
  const latestDate = await getLatestScheduledDailyDate();

  const startDate = latestDate
    ? addDays(new Date(`${latestDate}T00:00:00Z`), 1)
    : new Date(`${toUtcDateString(new Date())}T00:00:00Z`);

  const schedule = buildSchedule(pool, DAYS_TO_GENERATE);
  const values = schedule.map((driverId, index) => ({
    date: toUtcDateString(addDays(startDate, index)),
    driverId,
  }));

  await db.insert(dailyPuzzles).values(values);

  const usageCounts = new Map<number, number>();
  for (const driverId of schedule) {
    usageCounts.set(driverId, (usageCounts.get(driverId) ?? 0) + 1);
  }
  const counts = [...usageCounts.values()];

  console.log(
    `Scheduled ${values.length} days from ${values[0].date} to ${values[values.length - 1].date}.`,
  );
  console.log(`Pool size: ${pool.length} eligible drivers.`);
  console.log(
    `Each driver used ${Math.min(...counts)}-${Math.max(...counts)} times.`,
  );

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  return client.end();
});
