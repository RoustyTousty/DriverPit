import { gte, sql } from "drizzle-orm";

import { poolCutoffYear, type PoolWindow } from "../game/poolWindow";
import { db } from "./index";
import { drivers } from "./schema";

export interface EligibleDriverOption {
  id: number;
  fullName: string;
  nationality: string;
}

// Every column Infinite's filter reads, for every driver who has ever started a
// race — the full roster, unfiltered. Shipped to the client whole so composing a
// filter is instant and needs no round trip; the SAME predicate then runs in
// infinite_start_round to pick the target (lib/game/driverFilter.ts).
//
// It is the widest payload the site sends, so it is worth knowing what each
// field buys: `teams` is the only non-scalar, and it exists because "Ferrari
// drivers" means everyone who ever drove one, which `lastTeam` cannot answer.
// The three achievement counts ship as plain integers rather than booleans on
// purpose — the modal shows live counts per tier, and a boolean would fix the
// thresholds here instead of in the filter.
export interface DriverWithActivity {
  id: number;
  fullName: string;
  nationality: string;
  debutYear: number;
  lastActiveYear: number;
  teams: string[];
  careerWins: number;
  championshipWins: number;
  podiums: number;
  polePositions: number;
}

export async function listAllDriverOptionsWithActivity(): Promise<DriverWithActivity[]> {
  const rows = await db
    .select({
      id: drivers.id,
      fullName: drivers.fullName,
      nationality: drivers.nationality,
      debutYear: drivers.debutYear,
      lastActiveYear: drivers.lastActiveYear,
      teams: drivers.previousTeams,
      careerWins: drivers.careerWins,
      championshipWins: drivers.championshipWins,
      podiums: drivers.podiums,
      polePositions: drivers.polePositions,
    })
    .from(drivers)
    .orderBy(drivers.fullName);
  // These columns are NOT NULL at the DB level; the select type just can't
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
// leak §3.1 closed -- the daily page ships the whole pool WITH ids to the browser for
// autocomplete, so a reproducible answer is a devtools one-liner. Server code
// that needs the target reads daily_targets over the trusted connection.
