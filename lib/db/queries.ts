import { gte, sql } from "drizzle-orm";

import { poolCutoffYear, type PoolWindow } from "../game/poolWindow";
import { db } from "./index";
import { drivers } from "./schema";

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

// A guessed driver as the board renders it: the five compared attributes plus
// identity. Produced in SQL now (compare_drivers / the three guess RPCs), so
// there is no toDriverSummary() here to build one from a `drivers` row -- see
// the note at the bottom of this file.
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

// WHAT IS DELIBERATELY NOT HERE, and why (audit 2026-07-27 §2.1, §3.1).
//
// This file is down to the two roster reads a page still does server-side. The
// selection and comparison helpers that used to live beside them --
// listPoolDriverIds, getRandomPoolDriverId, getDriverById, toGameDriver,
// toDriverSummary -- were orphaned by the Server-Action -> RPC migration and are
// gone. Every mode now picks its target and evaluates its guess inside Postgres
// (compare_drivers, daily_target_id, the three *_submit_guess RPCs), so a TS
// helper doing the same work is a second implementation with no callers.
//
// getDailyDriverId() specifically must never come back. The day's target is a
// RANDOM pick made once inside public.daily_target_id (drizzle/0038) and pinned
// in daily_targets. A TypeScript helper that could recompute it is exactly the
// leak §3.1 closed -- /daily ships the whole pool WITH ids to the browser for
// autocomplete, so a reproducible answer is a devtools one-liner. Server code
// that needs the target reads daily_targets over the trusted connection.
