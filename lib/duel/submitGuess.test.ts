import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../db";
import { duelBeginRound } from "../db/duelRpc";
import { drivers, duelMatches, duelRoundResults, duelRounds } from "../db/schema";

// End-to-end coverage of duel_submit_guess (drizzle/0022_duel_submit_guess_rpc.sql)
// against the real RPC, called exactly the way the client calls it --
// supabase.rpc() from a signed-in guest session -- not through
// lib/duel/submitGuess.ts's wrapper, which depends on @supabase/ssr's
// browser cookie storage and has no meaningful behavior to exercise here
// beyond a field rename (already covered by the type checker).
//
// Requires a real Postgres + Supabase Auth connection -- skipped by default
// so `npm test` stays instant/offline, opt in with:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/duel/submitGuess.test.ts
// Fixture rows/guest accounts are handled the same way as
// lib/db/duelRpc.test.ts (real anonymous sign-in; duel_matches/rounds/
// results deleted in afterAll, guest auth users left behind).
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

interface GuestPlayer {
  id: string;
  client: AnySupabaseClient;
}

async function createGuestPlayer(): Promise<GuestPlayer> {
  const client: AnySupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
  return { id: data.user.id, client };
}

interface DuelSubmitGuessRow {
  solved: boolean;
  points: number | null;
  best_heat: number;
  score_a: number;
  score_b: number;
  guessed_driver_id: number;
  guessed_full_name: string;
  guessed_driver_code: string | null;
  guessed_nationality: string;
  guessed_team: string;
  guessed_age: number;
  guessed_debut_year: number;
  guessed_career_wins: number;
  nationality: string;
  team: string;
  age: string;
  age_closeness: number | null;
  debut_year: string;
  debut_year_closeness: number | null;
  career_wins: string;
  career_wins_closeness: number | null;
}

// duel_submit_guess isn't part of any generated Database type (this repo has
// no `supabase gen types` wiring -- see lib/duel/matchmaking.ts's own
// comment on the same point), so the plain @supabase/supabase-js client
// can't infer an arbitrary RPC name's args/row shape on its own. One cast
// here keeps every call site below fully typed against the real columns.
function submitGuess(
  client: AnySupabaseClient,
  args: { p_match_id: number; p_round_index: number; p_guess_driver_id: number },
): Promise<{ data: DuelSubmitGuessRow | null; error: { message: string } | null }> {
  // Retype the client itself (not a detached `.rpc` reference -- that would
  // lose its `this` binding) so the call below stays a real method call.
  const loose = client as unknown as {
    rpc(fn: string, params: unknown): { single(): Promise<{ data: unknown; error: unknown }> };
  };
  return loose.rpc("duel_submit_guess", args).single() as Promise<{
    data: DuelSubmitGuessRow | null;
    error: { message: string } | null;
  }>;
}

describe.skipIf(!RUN)("duel_submit_guess (integration)", () => {
  let matchId: number;
  let playerA: GuestPlayer;
  let playerB: GuestPlayer;
  let wrongGuessDriverId: number;
  let targetDriverId: number;

  beforeAll(async () => {
    [playerA, playerB] = await Promise.all([createGuestPlayer(), createGuestPlayer()]);

    const [match] = await db
      .insert(duelMatches)
      .values({ playerA: playerA.id, playerB: playerB.id, status: "countdown", currentRound: 0 })
      .returning();
    matchId = match.id;

    // Guaranteed to miss on nationality against whatever real target the
    // pool yields -- there's no "Wakanda" in the seeded F1DB roster -- so
    // the "wrong guess" tests below are deterministic, not just probably-right.
    const [wrongGuess] = await db
      .insert(drivers)
      .values({
        fullName: "duel_submit_guess fixture (wrong guess)",
        nationality: "Wakanda",
        lastTeam: "Fixture Team",
        previousTeams: ["Fixture Team"],
        dateOfBirth: "1900-01-01",
        debutYear: 1900,
        careerWins: 0,
        lastActiveYear: 1900,
      })
      .returning({ id: drivers.id });
    wrongGuessDriverId = wrongGuess.id;

    await duelBeginRound(matchId, 0);
    const [round] = await db
      .select()
      .from(duelRounds)
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, 0)));
    targetDriverId = round.driverId;

    // Push well into the future so the "hasn't started yet" test below has
    // no dependency on real elapsed wall-clock time (no race, no flake).
    await db
      .update(duelRounds)
      .set({ startedAt: new Date(Date.now() + 30_000), endsAt: new Date(Date.now() + 90_000) })
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, 0)));
  });

  afterAll(async () => {
    if (!matchId) return;
    await db.delete(duelRoundResults).where(eq(duelRoundResults.matchId, matchId));
    await db.delete(duelRounds).where(eq(duelRounds.matchId, matchId));
    await db.delete(duelMatches).where(eq(duelMatches.id, matchId));
    if (wrongGuessDriverId) await db.delete(drivers).where(eq(drivers.id, wrongGuessDriverId));
  });

  it("rejects a guess submitted before the round's lights-out countdown finishes", async () => {
    const { data, error } = await submitGuess(playerA.client, {
      p_match_id: matchId,
      p_round_index: 0,
      p_guess_driver_id: wrongGuessDriverId,
    });
    expect(data).toBeNull();
    expect(error?.message).toMatch(/not started yet/i);
  });

  it("rejects a guess for a round index that isn't the match's current round", async () => {
    // Pull started_at into the past so only *this* guard (wrong round
    // index) can fire, not the "hasn't started yet" one above.
    await db
      .update(duelRounds)
      .set({ startedAt: new Date(Date.now() - 5_000) })
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, 0)));

    const { data, error } = await submitGuess(playerA.client, {
      p_match_id: matchId,
      p_round_index: 1,
      p_guess_driver_id: wrongGuessDriverId,
    });
    expect(data).toBeNull();
    expect(error?.message).toMatch(/not active/i);
  });

  it("scores a wrong guess as unsolved, with a proximity bestHeat and no leaked target data", async () => {
    const { data, error } = await submitGuess(playerA.client, {
      p_match_id: matchId,
      p_round_index: 0,
      p_guess_driver_id: wrongGuessDriverId,
    });
    expect(error).toBeNull();
    if (!data) throw new Error("expected a row back");
    expect(data.solved).toBe(false);
    expect(data.points).toBeNull();
    expect(data.best_heat).toBeGreaterThanOrEqual(0);
    expect(data.best_heat).toBeLessThan(1);
    expect(data.guessed_driver_id).toBe(wrongGuessDriverId);
    expect(data.nationality).toBe("miss");

    // The only columns this RPC can ever return -- nothing target-shaped
    // (no target_*/driver_id-of-the-round column exists at all). Pinned
    // here so an accidental future column addition breaks loudly.
    expect(Object.keys(data).sort()).toEqual(
      [
        "solved",
        "points",
        "best_heat",
        "score_a",
        "score_b",
        "guessed_driver_id",
        "guessed_full_name",
        "guessed_driver_code",
        "guessed_nationality",
        "guessed_team",
        "guessed_age",
        "guessed_debut_year",
        "guessed_career_wins",
        "nationality",
        "team",
        "age",
        "age_closeness",
        "debut_year",
        "debut_year_closeness",
        "career_wins",
        "career_wins_closeness",
      ].sort(),
    );
  });

  it("solving the round returns real earned points and updates duel_matches' score", async () => {
    const [before] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));

    const { data, error } = await submitGuess(playerB.client, {
      p_match_id: matchId,
      p_round_index: 0,
      p_guess_driver_id: targetDriverId,
    });
    expect(error).toBeNull();
    if (!data) throw new Error("expected a row back");
    expect(data.solved).toBe(true);
    expect(data.points).toBeGreaterThan(0);
    expect(data.best_heat).toBe(1);
    expect(data.guessed_driver_id).toBe(targetDriverId);

    const [after] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
    expect(after.scoreB - before.scoreB).toBe(data.points);
    expect(after.scoreA).toBe(before.scoreA);
  });

  it("rejects a repeat guess once the round is already solved", async () => {
    const { data, error } = await submitGuess(playerB.client, {
      p_match_id: matchId,
      p_round_index: 0,
      p_guess_driver_id: targetDriverId,
    });
    expect(data).toBeNull();
    expect(error?.message).toMatch(/already solved/i);
  });
});
