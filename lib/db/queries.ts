import { desc, eq, gte, lte, sql } from "drizzle-orm";

import { calculateAge, type Driver as GameDriver } from "../game/compare";
import { poolCutoffYear, type PoolWindow } from "../game/poolWindow";
import { db } from "./index";
import { dailyPuzzles, drivers } from "./schema";

export type DriverRow = typeof drivers.$inferSelect;

export interface EligibleDriverOption {
  id: number;
  fullName: string;
  nationality: string;
}

// id + fullName + nationality + lastActiveYear for every driver who's ever
// started a race — the full roster, unfiltered. Small enough (~800 rows, a
// few dozen KB) to ship to the client whole and filter by pool window
// there, so switching windows in Infinite mode is instant with no round
// trip.
export interface DriverWithActivity {
  id: number;
  fullName: string;
  nationality: string;
  lastActiveYear: number;
}

export async function listAllDriverOptionsWithActivity(): Promise<DriverWithActivity[]> {
  const rows = await db
    .select({
      id: drivers.id,
      fullName: drivers.fullName,
      nationality: drivers.nationality,
      lastActiveYear: drivers.lastActiveYear,
    })
    .from(drivers)
    .orderBy(drivers.fullName);
  // lastActiveYear is NOT NULL at the DB level; the select type just can't
  // express that without a manual cast.
  return rows as DriverWithActivity[];
}

function poolCondition(window: PoolWindow, referenceYear: number) {
  const cutoff = poolCutoffYear(window, referenceYear);
  return cutoff === null ? sql`true` : gte(drivers.lastActiveYear, cutoff);
}

export async function listPoolDriverOptions(
  window: PoolWindow,
  referenceYear: number,
): Promise<EligibleDriverOption[]> {
  return db
    .select({ id: drivers.id, fullName: drivers.fullName, nationality: drivers.nationality })
    .from(drivers)
    .where(poolCondition(window, referenceYear))
    .orderBy(drivers.fullName);
}

export async function listPoolDriverIds(window: PoolWindow, referenceYear: number): Promise<number[]> {
  const rows = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(poolCondition(window, referenceYear));
  return rows.map((row) => row.id);
}

export async function getRandomPoolDriverId(window: PoolWindow, referenceYear: number): Promise<number> {
  const [row] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(poolCondition(window, referenceYear))
    .orderBy(sql`random()`)
    .limit(1);

  if (!row) {
    throw new Error(`No drivers found for pool window "${window}". Run the seed script.`);
  }
  return row.id;
}

export async function getDriverById(
  id: number,
): Promise<DriverRow | undefined> {
  const [row] = await db
    .select()
    .from(drivers)
    .where(eq(drivers.id, id))
    .limit(1);
  return row;
}

export function toGameDriver(row: DriverRow): GameDriver {
  return {
    nationality: row.nationality,
    team: row.lastTeam ?? "",
    previousTeams: row.previousTeams,
    dateOfBirth: row.dateOfBirth,
    dateOfDeath: row.dateOfDeath,
    debutYear: row.debutYear,
    careerWins: row.careerWins,
  };
}

export interface DriverSummary {
  id: number;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
}

export function toDriverSummary(row: DriverRow, today: Date): DriverSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    driverCode: row.driverCode,
    nationality: row.nationality,
    team: row.lastTeam ?? "—",
    age: calculateAge(row.dateOfBirth, row.dateOfDeath, today),
    debutYear: row.debutYear,
    careerWins: row.careerWins,
  };
}

export async function getDailyDriverId(
  date: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({ driverId: dailyPuzzles.driverId })
    .from(dailyPuzzles)
    .where(eq(dailyPuzzles.date, date))
    .limit(1);
  return row?.driverId;
}

// Daily puzzles are precomputed with no gaps, so the count of scheduled rows
// up to and including `date` is exactly that date's puzzle number.
export async function getDailyPuzzleNumber(date: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(dailyPuzzles)
    .where(lte(dailyPuzzles.date, date));
  return Number(row?.count ?? 0);
}

export async function getLatestScheduledDailyDate(): Promise<
  string | undefined
> {
  const [row] = await db
    .select({ date: dailyPuzzles.date })
    .from(dailyPuzzles)
    .orderBy(desc(dailyPuzzles.date))
    .limit(1);
  return row?.date;
}

