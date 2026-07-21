"use server";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

// The clock every duel countdown corrects against -- deliberately the
// DATABASE's now(), not this Next.js server's Date.now(). Every timestamp
// a client ever counts down to (duel_rounds.started_at/ends_at,
// intermission_ends_at) is stamped by Postgres, and in any real deployment
// the app server and the database are two different machines whose clocks
// are never guaranteed to agree (a ~1.4s gap was measured between a local
// dev server and this project's Supabase instance -- enough to reject
// perfectly legitimate first guesses as "round not started"). Measuring
// the offset against the same clock that does the stamping removes that
// whole error class; duel_submit_guess's 2s grace (drizzle/0025) stays as
// a safety net for the residual round-trip asymmetry.
export async function getServerTime(): Promise<string> {
  const rows = await db.execute<{ now: string }>(sql`SELECT now() AS now`);
  return new Date(rows[0].now).toISOString();
}
