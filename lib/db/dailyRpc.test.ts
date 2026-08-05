import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MAX_GUESSES } from "../game/constants";
import { DAILY_POOL_WINDOW, poolCutoffYear } from "../game/poolWindow";
import { db } from "./index";
import { dailyProgress, dailyResults, dailyTargets, drivers } from "./schema";

// Integration tests for the server-authoritative daily board RPCs
// (daily_state / daily_submit_guess, drizzle/0030). These authenticate via
// auth.uid(), so they're exercised through supabase.rpc() as a real signed-in
// guest -- the same path the browser client uses -- not the trusted Drizzle
// connection (which the daily_submit_guess stateless predecessor used to be
// testable on). The trusted `db` connection is used only to read the RLS-hidden
// pinned target and to clean up the fixture's rows. Same opt-in convention as
// lib/db/duelRpc.test.ts:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/dailyRpc.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

async function utcToday(): Promise<string> {
  const rows = await db.execute<{ today: string }>(
    sql`SELECT (now() AT TIME ZONE 'utc')::date::text AS today`,
  );
  return rows[0].today;
}

// The columns daily_submit_guess returns (drizzle/0030), snake_case as
// PostgREST encodes them -- only the fields these tests assert on are typed.
interface SubmitRow {
  won: boolean;
  completed: boolean;
  guesses_remaining: number;
  guessed_driver_id: number;
  nationality: string;
  team: string;
  age: string;
  debut_year: string;
  career_wins: string;
  target_driver_id: number | null;
}

interface StateGuess {
  driverId: number;
  tiles: { nationality: string; team: string; age: string; debutYear: string; careerWins: string };
}
interface StateBoard {
  guesses: StateGuess[];
  completed: boolean;
  won: boolean;
  guessesRemaining: number;
  target: { driverId: number; name: string; code: string | null } | null;
}

async function submit(supabase: SupabaseClient, driverId: number) {
  return supabase.rpc("daily_submit_guess", { p_guess_driver_id: driverId }).single();
}

describe.skipIf(!RUN)("daily_state / daily_submit_guess (integration)", () => {
  let supabase: SupabaseClient;
  let userId: string;
  let today: string;
  let targetId: number;
  let wrongIds: number[];
  let outOfPoolId: number;

  beforeAll(async () => {
    // An anonymous guest is a real auth.users row; the signup trigger seeds its
    // profiles + user_stats, which daily_progress FKs to.
    supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
    userId = data.user.id;
    today = await utcToday();

    // Hydrating once lazily pins today's target; read it back over the trusted
    // connection (daily_targets is RLS-hidden from the client).
    const { error: stateErr } = await supabase.rpc("daily_state");
    if (stateErr) throw new Error(`daily_state failed: ${stateErr.message}`);
    const [pin] = await db
      .select({ driverId: dailyTargets.driverId })
      .from(dailyTargets)
      .where(eq(dailyTargets.date, today));
    if (!pin) throw new Error("target was not pinned by daily_state");
    targetId = pin.driverId;

    // A full board's worth of distinct non-target driver ids, all IN THE DAILY
    // POOL. That last part stopped being incidental with drizzle/0051: a guess
    // is now validated against the same DAILY_POOL_WINDOW the target is drawn
    // from, so the lowest ids on the roster -- 1950s privateers, which is what
    // an unfiltered `ORDER BY id` returns -- are a rejection rather than a miss.
    // The cutoff is computed from the TypeScript constant and the DATABASE's
    // own UTC day; the SQL copy of it is pinned separately by
    // lib/game/poolWindow.sqlParity.test.ts.
    //
    // MAX_GUESSES rather than a literal, so a change to the TS constant that
    // the RPC's own cap doesn't mirror fails on the assertion below instead of
    // on an undefined array element.
    const cutoff = poolCutoffYear(DAILY_POOL_WINDOW, Number(today.slice(0, 4)));
    const inPool = cutoff === null ? sql`true` : sql`${drivers.lastActiveYear} >= ${cutoff}`;
    const others = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(sql`${drivers.id} <> ${targetId} AND ${inPool}`)
      .orderBy(drivers.id)
      .limit(MAX_GUESSES);
    wrongIds = others.map((r) => r.id);
    if (wrongIds.length < MAX_GUESSES) {
      throw new Error(
        `the ${DAILY_POOL_WINDOW} pool holds ${wrongIds.length} non-target driver(s), fewer than ` +
          `the ${MAX_GUESSES} a full board needs -- run \`npm run db:seed\` before the database tier.`,
      );
    }

    // One driver below the cutoff, for the rejection case. Ascending id like
    // `wrongIds` above, which keeps both of this file's picks at the low end of
    // the roster -- winByIdentity.test.ts borrows the pool's HIGHEST id, so
    // neither suite can rewrite a driver the other is guessing in a parallel run.
    const [outside] = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(cutoff === null ? sql`false` : sql`${drivers.lastActiveYear} < ${cutoff}`)
      .orderBy(drivers.id)
      .limit(1);
    if (!outside) {
      throw new Error(
        `no driver sits below the ${DAILY_POOL_WINDOW} cutoff, so "a guess outside the pool" ` +
          `isn't expressible against this roster. Re-seed, or rewrite that test for the window ` +
          `DAILY_POOL_WINDOW now names.`,
      );
    }
    outOfPoolId = outside.id;
  });

  // Each test starts from a clean day so counts/lengths are deterministic. The
  // pinned daily_targets row is intentionally left in place across tests -- it's
  // the stable, shared target for the day.
  beforeEach(async () => {
    await db.delete(dailyProgress).where(eq(dailyProgress.userId, userId));
    await db.delete(dailyResults).where(eq(dailyResults.userId, userId));
  });

  afterAll(async () => {
    if (!userId) return;
    await db.delete(dailyProgress).where(eq(dailyProgress.userId, userId));
    await db.delete(dailyResults).where(eq(dailyResults.userId, userId));
    // daily_targets for today is deliberately left behind: deterministic and
    // shared with real traffic, like the guest auth.users this test can't delete.
  });

  it("rejects an unknown driver id", async () => {
    const { error } = await submit(supabase, -1);
    expect(error).not.toBeNull();
  });

  // drizzle/0051 (audit 2026-07-30 §3.9 residual). Existence was the whole
  // check, so every driver who ever started a race was accepted while /daily
  // only ever autocompletes DAILY_POOL_WINDOW -- the rejection message ("pick a
  // driver from the suggestions list") was a promise the function didn't keep,
  // and the day's stored guess list could hold rows the board would never have
  // offered. This is the behavioural half of the guard; poolWindow.sqlParity
  // pins the cutoff itself, and neither test alone would notice the other's
  // failure mode.
  it("rejects a driver outside the daily pool, without costing a turn", async () => {
    const { error } = await submit(supabase, outOfPoolId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not in today's pool/i);

    // Refused before daily_progress is touched at all -- no row, no turn spent,
    // nothing for a second device to hydrate.
    const { data } = await supabase.rpc("daily_state");
    const board = data as StateBoard;
    expect(board.guesses).toEqual([]);
    expect(board.guessesRemaining).toBe(MAX_GUESSES);
    expect(board.completed).toBe(false);

    // ...and the pool driver beside it is still accepted, so what was added is
    // a filter and not a blanket refusal.
    const { error: accepted } = await submit(supabase, wrongIds[0]);
    expect(accepted).toBeNull();
  });

  it("a miss scores the guess, keeps the day live, and never reveals the target", async () => {
    const { data, error } = await submit(supabase, wrongIds[0]);
    expect(error).toBeNull();
    const row = data as SubmitRow;
    expect(row.won).toBe(false);
    expect(row.completed).toBe(false);
    expect(row.guesses_remaining).toBe(MAX_GUESSES - 1);
    expect(row.guessed_driver_id).toBe(wrongIds[0]);
    expect(row.target_driver_id).toBeNull();

    // Hydration mid-game is likewise target-free.
    const { data: state } = await supabase.rpc("daily_state");
    expect((state as StateBoard).target).toBeNull();
    expect((state as StateBoard).completed).toBe(false);
  });

  it("guessing the target wins, completes the day, and reveals it", async () => {
    const { data, error } = await submit(supabase, targetId);
    expect(error).toBeNull();
    const row = data as SubmitRow;
    expect(row.won).toBe(true);
    expect(row.completed).toBe(true);
    expect(row.nationality).toBe("exact");
    expect(row.team).toBe("exact");
    expect(row.target_driver_id).toBe(targetId);
  });

  it("completes as a loss on the sixth miss (revealing the target) and rejects a seventh guess", async () => {
    let last: SubmitRow | undefined;
    for (let i = 0; i < MAX_GUESSES; i++) {
      const { data, error } = await submit(supabase, wrongIds[i]);
      expect(error).toBeNull();
      last = data as SubmitRow;
    }
    expect(last!.completed).toBe(true);
    expect(last!.won).toBe(false);
    expect(last!.guesses_remaining).toBe(0);
    expect(last!.target_driver_id).toBe(targetId);

    // The anti-second-attempt guard: no seventh guess onto a finished day.
    const { error: seventh } = await submit(supabase, wrongIds[0]);
    expect(seventh).not.toBeNull();
  });

  // drizzle/0049 (audit 2026-07-29 §3.9). The client half withholds guessed
  // drivers from the suggestions; this is the half a devtools console or a
  // second device with a stale board meets.
  it("rejects a driver already guessed today, without ending or advancing the day", async () => {
    const { error: first } = await submit(supabase, wrongIds[0]);
    expect(first).toBeNull();

    const { error: repeat } = await submit(supabase, wrongIds[0]);
    expect(repeat).not.toBeNull();
    expect(repeat!.message).toMatch(/already guessed/i);

    // The rejection must cost nothing: the board still holds exactly the one
    // real guess, and a different driver is still accepted afterwards.
    const { data } = await supabase.rpc("daily_state");
    const board = data as StateBoard;
    expect(board.guesses.map((g) => g.driverId)).toEqual([wrongIds[0]]);
    expect(board.guessesRemaining).toBe(MAX_GUESSES - 1);
    expect(board.completed).toBe(false);

    const { data: next, error: nextErr } = await submit(supabase, wrongIds[1]);
    expect(nextErr).toBeNull();
    expect((next as SubmitRow).guesses_remaining).toBe(MAX_GUESSES - 2);
  });

  it("pins the day's target exactly once and never moves it across calls", async () => {
    await supabase.rpc("daily_state");
    await submit(supabase, wrongIds[0]);
    await supabase.rpc("daily_state");

    const pins = await db.select().from(dailyTargets).where(eq(dailyTargets.date, today));
    expect(pins).toHaveLength(1);
    expect(pins[0].driverId).toBe(targetId);
  });

  it("daily_state reconstructs the same tiles the guesses produced", async () => {
    const g1 = (await submit(supabase, wrongIds[0])).data as SubmitRow;
    const g2 = (await submit(supabase, wrongIds[1])).data as SubmitRow;

    const { data } = await supabase.rpc("daily_state");
    const board = data as StateBoard;

    expect(board.guesses.map((g) => g.driverId)).toEqual([wrongIds[0], wrongIds[1]]);
    // Recomputed tiles on hydration must equal the tiles the submit returned.
    expect(board.guesses[0].tiles.nationality).toBe(g1.nationality);
    expect(board.guesses[0].tiles.team).toBe(g1.team);
    expect(board.guesses[0].tiles.age).toBe(g1.age);
    expect(board.guesses[0].tiles.debutYear).toBe(g1.debut_year);
    expect(board.guesses[0].tiles.careerWins).toBe(g1.career_wins);
    expect(board.guesses[1].tiles.nationality).toBe(g2.nationality);
    expect(board.guesses[1].tiles.team).toBe(g2.team);
    expect(board.guesses[1].tiles.age).toBe(g2.age);
    expect(board.guesses[1].tiles.debutYear).toBe(g2.debut_year);
    expect(board.guesses[1].tiles.careerWins).toBe(g2.career_wins);
  });
});
