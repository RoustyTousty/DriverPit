import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../db";
import { duelBeginRound, duelCloseRound } from "../db/duelRpc";
import { duelMatches, duelRoundResults, duelRounds } from "../db/schema";

// duel_round_reveal (drizzle/0050) is what round_end and match_end re-verify
// against instead of applying their payload (audit 2026-07-30 §3.4 residual),
// so the property that matters is not "it returns the reveal" -- it is WHEN it
// refuses to. A forged round_end mid-round has to come back with nothing to
// apply, or the fix is decorative.
//
// Called the way the client calls it (supabase.rpc() from a signed-in guest,
// via PostgREST) rather than through lib/duel/roundReveal.ts's wrapper, which
// depends on @supabase/ssr's browser storage and does nothing but rename
// fields -- same reasoning as lib/duel/submitGuess.test.ts.
//
// Requires a real Postgres + Supabase Auth connection -- skipped by default so
// `npm test` stays instant/offline, opt in with:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/duel/roundReveal.test.ts
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

interface DuelRoundRevealRow {
  closed: boolean;
  match_status: string;
  current_round: number;
  winner_id: string | null;
  rating_delta_a: number | null;
  rating_delta_b: number | null;
  score_a: number | null;
  score_b: number | null;
  points_a: number | null;
  points_b: number | null;
  intermission_ends_at: string | null;
  target_driver_id: number | null;
  target_full_name: string | null;
  target_driver_code: string | null;
  target_nationality: string | null;
  target_team: string | null;
  target_age: number | null;
  target_debut_year: number | null;
  target_career_wins: number | null;
}

// No `supabase gen types` wiring in this repo (see lib/duel/matchmaking.ts's
// note), so an arbitrary RPC name can't be inferred -- one cast here keeps
// every call site below typed against the real columns.
function roundReveal(
  client: AnySupabaseClient,
  args: { p_match_id: number; p_round_index: number },
): Promise<{ data: DuelRoundRevealRow | null; error: { message: string } | null }> {
  const loose = client as unknown as {
    rpc(fn: string, params: unknown): { single(): Promise<{ data: unknown; error: unknown }> };
  };
  return loose.rpc("duel_round_reveal", args).single() as Promise<{
    data: DuelRoundRevealRow | null;
    error: { message: string } | null;
  }>;
}

// Every column that must stay NULL until the round has actually closed. The
// target is the one that matters (CLAUDE.md: "never send the target driver to a
// client during a round"); the rest are listed because rendering any of them is
// what a forged round_end was for.
const REVEAL_COLUMNS = [
  "score_a",
  "score_b",
  "points_a",
  "points_b",
  "intermission_ends_at",
  "target_driver_id",
  "target_full_name",
  "target_driver_code",
  "target_nationality",
  "target_team",
  "target_age",
  "target_debut_year",
  "target_career_wins",
] as const;

describe.skipIf(!RUN)("duel_round_reveal (integration)", () => {
  let matchId: number;
  let playerA: GuestPlayer;
  let playerB: GuestPlayer;
  let stranger: GuestPlayer;
  let targetDriverId: number;

  beforeAll(async () => {
    [playerA, playerB, stranger] = await Promise.all([
      createGuestPlayer(),
      createGuestPlayer(),
      createGuestPlayer(),
    ]);

    const [match] = await db
      .insert(duelMatches)
      .values({ playerA: playerA.id, playerB: playerB.id, status: "countdown", currentRound: 0 })
      .returning();
    matchId = match.id;

    await duelBeginRound(matchId, 0);
    const [round] = await db
      .select()
      .from(duelRounds)
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, 0)));
    targetDriverId = round.driverId;
  });

  afterAll(async () => {
    if (!matchId) return;
    await db.delete(duelRoundResults).where(eq(duelRoundResults.matchId, matchId));
    await db.delete(duelRounds).where(eq(duelRounds.matchId, matchId));
    await db.delete(duelMatches).where(eq(duelMatches.id, matchId));
  });

  it("withholds the whole reveal while the round is still live", async () => {
    const { data, error } = await roundReveal(playerA.client, { p_match_id: matchId, p_round_index: 0 });
    expect(error).toBeNull();
    if (!data) throw new Error("expected a row back");

    expect(data.closed).toBe(false);
    // Match-level state is still answered -- it's what match_end verifies
    // against, and none of it says anything before the match is over.
    expect(data.match_status).toBe("active");
    expect(data.current_round).toBe(0);
    expect(data.winner_id).toBeNull();
    for (const column of REVEAL_COLUMNS) {
      expect(data[column], `${column} must stay null until the round closes`).toBeNull();
    }
  });

  it("refuses a caller who isn't in the match", async () => {
    const { data, error } = await roundReveal(stranger.client, { p_match_id: matchId, p_round_index: 0 });
    expect(data).toBeNull();
    expect(error?.message).toMatch(/not part of match/i);
  });

  it("returns the round's real target and points once the round has closed", async () => {
    // Expire the round so duel_close_round sees both players done (neither
    // guessed, so both DNF) -- no dependency on real elapsed wall-clock time.
    await db
      .update(duelRounds)
      .set({ startedAt: new Date(Date.now() - 90_000), endsAt: new Date(Date.now() - 30_000) })
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, 0)));

    const close = await duelCloseRound(matchId, 0);
    expect(close.advanced).toBe(true);

    const { data, error } = await roundReveal(playerB.client, { p_match_id: matchId, p_round_index: 0 });
    expect(error).toBeNull();
    if (!data) throw new Error("expected a row back");

    expect(data.closed).toBe(true);
    expect(data.target_driver_id).toBe(targetDriverId);
    expect(data.target_full_name).toBeTruthy();
    expect(data.intermission_ends_at).not.toBeNull();
    // Both DNF'd without guessing: zero round points, and the running score is
    // the sum over rounds 0..0, so also zero.
    expect(data.points_a).toBe(0);
    expect(data.points_b).toBe(0);
    expect(data.score_a).toBe(0);
    expect(data.score_b).toBe(0);
    expect(data.match_status).toBe("intermission");
  });

  it("answers what a second duel_close_round call cannot -- the gap this RPC exists to fill", async () => {
    // The audit's suggested fix was "re-verify against duel_close_round_client".
    // It is idempotent in its EFFECT but not in its RESPONSE: exactly one
    // client's close ever advances, and the already-closed branch returns NULL
    // for every reveal column on the assumption that a repeat caller made the
    // first call itself. The client receiving round_end is precisely the one
    // that didn't. Pinned here so that assumption can't quietly come back.
    const repeat = await duelCloseRound(matchId, 0);
    expect(repeat.advanced).toBe(false);
    expect(repeat.targetDriver).toBeNull();
    expect(repeat.intermissionEndsAt).toBeNull();

    const { data } = await roundReveal(playerA.client, { p_match_id: matchId, p_round_index: 0 });
    expect(data?.target_driver_id).toBe(targetDriverId);
  });
});
