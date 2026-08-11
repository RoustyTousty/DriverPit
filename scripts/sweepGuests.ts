import "dotenv/config";

import { sql } from "drizzle-orm";

import { client, db } from "../lib/db";

// Runs public.sweep_abandoned_guests (drizzle/0059) in batches. Called by
// .github/workflows/guest-cleanup.yml once a month; see that file for why the
// garbage exists and why it is worth removing.
//
// CONFIGURATION COMES FROM ENV VARS, NEVER FROM argv. `npm run x -- --flag`
// loses the flag entirely under PowerShell 5.1 -- measured, and it once turned
// a seed dry run into a real 792-row write. A destructive job must not have a
// safe mode that a shell can eat, so there are no flags here at all.

export interface SweepOptions {
  dryRun: boolean;
  olderThanDays: number;
  batchSize: number;
  maxBatches: number;
}

/** How many batches before the job stops of its own accord. */
const DEFAULT_MAX_BATCHES = 40;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_OLDER_THAN_DAYS = 60;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  // Plain digits only, checked BEFORE Number(): `Number("1e3")` is 1000 and
  // `Number(" 12 ")` is 12, so a shape test afterwards would accept two things
  // nobody meant to write. On a job that deletes accounts an unrecognised value
  // is a typo, and the right response to a typo is the default, not a guess.
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * Pure, and exported for the test, because the one thing that must not be got
 * wrong here is which way the default falls.
 *
 * DELETING IS OPT-IN. Anything other than the exact string "false" leaves this
 * a dry run — an unset variable, an empty one, a typo, a YAML boolean that
 * arrived as "False". The failure mode of guessing wrong in the other direction
 * is deleted accounts.
 */
export function resolveSweepOptions(env: Record<string, string | undefined>): SweepOptions {
  return {
    dryRun: env.SWEEP_DRY_RUN !== "false",
    // Clamped to the same floor the SQL applies, so the report cannot describe
    // a window the function would not have used.
    olderThanDays: Math.max(readPositiveInt(env.SWEEP_OLDER_THAN_DAYS, DEFAULT_OLDER_THAN_DAYS), 7),
    batchSize: readPositiveInt(env.SWEEP_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    maxBatches: readPositiveInt(env.SWEEP_MAX_BATCHES, DEFAULT_MAX_BATCHES),
  };
}

async function countCandidates(olderThanDays: number): Promise<number> {
  // The same predicate the function applies, as a count. Duplicated on purpose
  // and deliberately NOT extracted into a shared SQL view: this is the dry
  // run's independent second opinion, and a shared definition would make it
  // agree with the function by construction rather than by observation.
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM public.profiles p
    JOIN public.user_stats s ON s.user_id = p.id
    WHERE p.is_guest
      AND p.created_at < now() - make_interval(days => ${olderThanDays}::int)
      AND NOT EXISTS (SELECT 1 FROM public.daily_results r WHERE r.user_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.daily_progress d WHERE d.user_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.infinite_rounds i WHERE i.user_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.duel_matches m WHERE m.player_a = p.id OR m.player_b = p.id
      )
      AND NOT EXISTS (SELECT 1 FROM public.matchmaking_queue q WHERE q.user_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.duel_lobbies l WHERE l.host_id = p.id)
      AND s.games_played = 0 AND s.wins = 0 AND s.duel_wins = 0 AND s.duel_losses = 0
      AND s.max_streak = 0 AND s.last_daily_date IS NULL
  `);
  return row?.n ?? 0;
}

async function totals(): Promise<{ profiles: number; guests: number }> {
  const [row] = await db.execute<{ profiles: number; guests: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM public.profiles) AS profiles,
      (SELECT count(*)::int FROM public.profiles WHERE is_guest) AS guests
  `);
  return { profiles: row?.profiles ?? 0, guests: row?.guests ?? 0 };
}

async function main() {
  const options = resolveSweepOptions(process.env);

  // The mode goes on screen FIRST, before anything touches the database, for
  // the same reason the seed prints its own: the difference is real rows, and
  // it should be read rather than inferred from a message at the end.
  console.log(`Mode: ${options.dryRun ? "DRY RUN" : "REAL DELETE"}`);
  console.log(
    `Window: guests older than ${options.olderThanDays} days, ` +
      `batches of ${options.batchSize} (max ${options.maxBatches})`,
  );

  const before = await totals();
  console.log(`Before: ${before.profiles} profiles, ${before.guests} guests`);

  const candidates = await countCandidates(options.olderThanDays);
  console.log(`Candidates: ${candidates}`);

  if (options.dryRun) {
    console.log("Dry run — nothing deleted. Set SWEEP_DRY_RUN=false to delete.");
    await client.end();
    return;
  }

  let deleted = 0;
  let batches = 0;
  // Stops on an empty batch OR the batch cap, whichever comes first. The cap is
  // what keeps a bad predicate from running away unattended: it bounds one run
  // at maxBatches * batchSize, and the next scheduled run picks up the rest.
  for (; batches < options.maxBatches; batches++) {
    const [row] = await db.execute<{ deleted: number }>(
      sql`SELECT public.sweep_abandoned_guests(${options.olderThanDays}::int, ${options.batchSize}::int) AS deleted`,
    );
    const n = row?.deleted ?? 0;
    deleted += n;
    if (n === 0) break;
    console.log(`  batch ${batches + 1}: ${n} deleted`);
  }

  const after = await totals();
  console.log(`Deleted ${deleted} abandoned guest account(s) in ${batches} batch(es).`);
  console.log(`After: ${after.profiles} profiles, ${after.guests} guests`);

  if (deleted !== candidates) {
    // Not a failure: rows can age into the window between the two queries, and
    // the batch cap can leave some for next month. Worth saying out loud
    // either way, because a large gap means one of those two things and the
    // log is the only place to notice it.
    console.log(`Note: counted ${candidates} candidate(s) up front, deleted ${deleted}.`);
  }

  await client.end();
}

main().catch(async (error) => {
  console.error(error);
  await client.end();
  process.exit(1);
});
