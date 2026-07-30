import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MAX_GUESSES } from "../game/constants";
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

    // A full board's worth of distinct non-target driver ids (guess validation
    // is existence-only, so pool membership doesn't matter -- these just need to
    // not be the win). MAX_GUESSES rather than a literal, so a change to the TS
    // constant that the RPC's own cap doesn't mirror fails on the assertion
    // below instead of on an undefined array element.
    const others = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(sql`${drivers.id} <> ${targetId}`)
      .orderBy(drivers.id)
      .limit(MAX_GUESSES);
    wrongIds = others.map((r) => r.id);
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
