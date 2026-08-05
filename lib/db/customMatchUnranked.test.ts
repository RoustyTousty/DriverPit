import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { DriverFilter } from "../game/driverFilter";
import { db } from "./index";
import { duelForfeit } from "./duelRpc";
import { duelMatches, userStats } from "./schema";

// Custom lobbies, phase 1 -- the headline requirement, and the only thing that
// will ever notice it regressing.
//
//   winning, losing or forfeiting an unranked (custom-lobby) duel must not move
//   duel_rating, duel_wins, duel_losses, or any leaderboard position.
//
// "Not affecting stats" is invisible when it breaks. Nothing a player sees
// changes if `ranked` stops being read -- no error, no wrong number on screen;
// the leaderboard just quietly starts absorbing friendly games. So the flag gets
// four layers (drizzle/0054's CHECK, one choke point, this suite, and the
// results UI), and this is the one that runs on every push.
//
// Aimed at applyMatchResult (lib/duel/applyMatchResult.ts) rather than the two
// Server Actions that call it, for the reason serverAuthoritativeWrites.test.ts
// gives: a "use server" export resolves its caller through next/headers, which
// has no meaning outside a request. The rule worth pinning lives below that --
// applyMatchResult is the single writer of all three columns, and there is no
// other writer anywhere in the repo. requestRematch (case 4) has no such layer
// to aim at, so the one thing it needs from a request is stubbed; see below.
//
// Case 3 is a RANKED control and is not optional: every assertion in cases 1 and
// 2 is "this number did not change", which is equally what a writer that had
// stopped working entirely would produce. The control is what makes an inverted
// flag fail rather than pass twice.
//
// Needs a real Postgres + Supabase project. Opt in, same convention as the other
// DB suites (never against production):
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/customMatchUnranked.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

// requestRematch is a "use server" export whose first act is resolving the
// caller out of the request's cookies. Only that hop is replaced -- everything
// after it (the FOR UPDATE lock, the mutual-consent gate, the insert whose
// column list is the thing being tested) runs for real against the real
// database. `caller` is swapped per call by withCaller() below.
const stub = vi.hoisted(() => ({ caller: "" }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: stub.caller } } }) },
  }),
}));

// Imported after the mock is declared -- vi.mock is hoisted above both, so the
// action's own `import { createSupabaseServerClient }` resolves to the stub.
const { requestRematch } = await import("../duel/actions");
const { applyMatchResult } = await import("../duel/applyMatchResult");

async function withCaller<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  stub.caller = userId;
  try {
    return await fn();
  } finally {
    stub.caller = "";
  }
}

async function createGuest(): Promise<string> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
  return data.user.id;
}

interface DuelStats {
  rating: number;
  wins: number;
  losses: number;
}

async function duelStatsOf(userId: string): Promise<DuelStats> {
  const [row] = await db.select().from(userStats).where(eq(userStats.userId, userId));
  if (!row) throw new Error(`no user_stats row for ${userId} -- the signup trigger should have made one`);
  return { rating: row.duelRating, wins: row.duelWins, losses: row.duelLosses };
}

describe.skipIf(!RUN)("an unranked match writes no duel stats (integration)", () => {
  // TWO guests for the whole file, shared across every block below. Supabase
  // rate-limits anonymous sign-ins per IP per hour and the database CI tier runs
  // every suite in one go, so a fresh pair per case would spend quota the other
  // suites in this directory also draw on. Nothing here needs isolating: each
  // case creates its own match row, and every stats assertion is a before/after
  // delta on whatever the running totals happen to be, never an absolute value.
  let playerA: string;
  let playerB: string;
  const matchIds: number[] = [];

  beforeAll(async () => {
    playerA = await createGuest();
    playerB = await createGuest();
  });

  afterAll(async () => {
    if (matchIds.length > 0) await db.delete(duelMatches).where(inArray(duelMatches.id, matchIds));
    // The guest auth users and their profiles/user_stats rows are left behind on
    // purpose -- the anon key can't delete auth.users, and they are
    // indistinguishable from any other guest who visited once.
  });

  async function newMatch(opts: {
    ranked: boolean;
    status?: string;
    rounds?: number;
    roundSeconds?: number;
    filter?: DriverFilter;
  }): Promise<number> {
    const [match] = await db
      .insert(duelMatches)
      .values({
        playerA,
        playerB,
        status: opts.status ?? "finished",
        currentRound: 0,
        ranked: opts.ranked,
        rounds: opts.rounds ?? 3,
        roundSeconds: opts.roundSeconds ?? 60,
        filter: opts.filter ?? null,
      })
      .returning();
    matchIds.push(match.id);
    return match.id;
  }

  // --- 1. a finished unranked match ----------------------------------------

  it("finishing an unranked match leaves both players' duel stats byte-identical", async () => {
    const before = { a: await duelStatsOf(playerA), b: await duelStatsOf(playerB) };
    const matchId = await newMatch({ ranked: false });

    // A wins -- the case that moves all three columns on both sides if the
    // short-circuit is missing.
    const deltas = await applyMatchResult(matchId, playerA, playerB, playerA);
    expect(deltas).toEqual({ ratingDeltaA: 0, ratingDeltaB: 0 });

    expect(await duelStatsOf(playerA)).toEqual(before.a);
    expect(await duelStatsOf(playerB)).toEqual(before.b);

    // And nothing was cached on the match either -- the state drizzle/0054's
    // CHECK makes the only representable one for an unranked row.
    const [row] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
    expect(row.ratingDeltaA).toBeNull();
    expect(row.ratingDeltaB).toBeNull();
  });

  it("is re-entrant -- a second call still writes nothing", async () => {
    const before = { a: await duelStatsOf(playerA), b: await duelStatsOf(playerB) };
    const matchId = await newMatch({ ranked: false });

    await applyMatchResult(matchId, playerA, playerB, playerA);
    await applyMatchResult(matchId, playerA, playerB, playerA);

    // Worth asserting separately: the ranked path is idempotent through the
    // rating_delta_a null check, and the unranked path returns before it ever
    // reaches that. Both clients observe the same finish and both call in.
    expect(await duelStatsOf(playerA)).toEqual(before.a);
    expect(await duelStatsOf(playerB)).toEqual(before.b);
  });

  // The constraint half of the same requirement, probed directly: a caller that
  // bypasses applyMatchResult entirely still cannot land an unranked match
  // carrying a rating delta. This is what catches someone reordering the
  // function -- an aborted transaction instead of silence.
  it("the database refuses to store a rating delta on an unranked match", async () => {
    const matchId = await newMatch({ ranked: false });

    // Asserted on the constraint NAME, off the driver error Drizzle wraps --
    // `.rejects.toThrow(/name/)` does not work here, because Drizzle's own
    // message is only "Failed query: update ..." and would equally match a
    // typo'd column or a dropped table. Naming the constraint is what makes
    // this a test of drizzle/0054 rather than of "the statement failed
    // somehow".
    let constraint: string | undefined;
    try {
      await db.update(duelMatches).set({ ratingDeltaA: 16, ratingDeltaB: -16 }).where(eq(duelMatches.id, matchId));
    } catch (err) {
      constraint = (err as { cause?: { constraint_name?: string } }).cause?.constraint_name;
    }
    expect(constraint).toBe("duel_matches_unranked_no_rating_check");
  });

  // --- 2. a forfeited unranked match ---------------------------------------

  it("forfeiting an unranked match leaves both players' duel stats byte-identical", async () => {
    const before = { a: await duelStatsOf(playerA), b: await duelStatsOf(playerB) };
    // 'active', not 'finished': duel_forfeit no-ops on an already-terminal
    // match, so a finished row would never reach applyMatchResult and this case
    // would pass while testing nothing.
    const matchId = await newMatch({ ranked: false, status: "active" });

    const result = await duelForfeit(matchId, playerB);
    expect(result.advanced).toBe(true);
    expect(result.winnerId).toBe(playerA);

    // Exactly what forfeitMatch does with `advanced: true`.
    const deltas = await applyMatchResult(matchId, playerA, playerB, result.winnerId);
    expect(deltas).toEqual({ ratingDeltaA: 0, ratingDeltaB: 0 });

    expect(await duelStatsOf(playerA)).toEqual(before.a);
    expect(await duelStatsOf(playerB)).toEqual(before.b);
  });

  // --- 3. the ranked control -----------------------------------------------

  it("a ranked match still moves rating, wins and losses -- so an inverted flag fails", async () => {
    const before = { a: await duelStatsOf(playerA), b: await duelStatsOf(playerB) };
    const matchId = await newMatch({ ranked: true });

    const deltas = await applyMatchResult(matchId, playerA, playerB, playerA);
    // Zero-sum by construction (lib/game/duelRating.ts), and non-zero, which is
    // what gives the two cases above their meaning.
    expect(deltas.ratingDeltaA).toBeGreaterThan(0);
    expect(deltas.ratingDeltaB).toBe(-deltas.ratingDeltaA);

    expect(await duelStatsOf(playerA)).toEqual({
      rating: before.a.rating + deltas.ratingDeltaA,
      wins: before.a.wins + 1,
      losses: before.a.losses,
    });
    expect(await duelStatsOf(playerB)).toEqual({
      rating: before.b.rating + deltas.ratingDeltaB,
      wins: before.b.wins,
      losses: before.b.losses + 1,
    });

    const [row] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
    expect(row.ratingDeltaA).toBe(deltas.ratingDeltaA);
    expect(row.ratingDeltaB).toBe(deltas.ratingDeltaB);
  });

  // --- 4. the rematch carries the config forward ---------------------------
  //
  // The sharp edge. A rematch is a NEW duel_matches row, so every column
  // requestRematch does not name takes its DEFAULT -- ranked = true, 3 rounds,
  // 60 seconds, the 20-year pool. Miss the carry-forward and pressing Rematch on
  // a friendly game silently produces a rated, differently-shaped duel, off a
  // PRIMARY results-screen CTA. Same shape as audit 2026-07-29 §0.1.
  describe("rematch carry-forward", () => {
    const customFilter: DriverFilter = {
      fromYear: 1990,
      toYear: 1999,
      nationality: null,
      team: null,
      achievement: "any",
    };

    // Mutual consent: the first request only records intent, the second finds
    // the other player's id sitting there and creates the row.
    async function rematchOf(matchId: number): Promise<number> {
      await withCaller(playerA, () => requestRematch(matchId));
      const second = await withCaller(playerB, () => requestRematch(matchId));
      if (!second.ok) throw new Error(`requestRematch failed: ${second.error}`);
      if (second.newMatchId === null) throw new Error("the second request should have created the match");
      matchIds.push(second.newMatchId);
      return second.newMatchId;
    }

    it("a rematch of an unranked match is itself unranked and keeps the config", async () => {
      const matchId = await newMatch({ ranked: false, rounds: 5, roundSeconds: 30, filter: customFilter });
      const rematchId = await rematchOf(matchId);

      const [rematch] = await db.select().from(duelMatches).where(eq(duelMatches.id, rematchId));
      expect(rematch.ranked).toBe(false);
      expect(rematch.rounds).toBe(5);
      expect(rematch.roundSeconds).toBe(30);
      expect(rematch.filter).toEqual(customFilter);

      // The consequence, not just the column: finishing the rematch must write
      // nothing either. This is the assertion the pre-fix code fails.
      const before = { a: await duelStatsOf(playerA), b: await duelStatsOf(playerB) };
      await db.update(duelMatches).set({ status: "finished" }).where(eq(duelMatches.id, rematchId));
      await applyMatchResult(rematchId, playerA, playerB, playerA);
      expect(await duelStatsOf(playerA)).toEqual(before.a);
      expect(await duelStatsOf(playerB)).toEqual(before.b);
    });

    it("a rematch of a ranked match stays ranked with the default config", async () => {
      const rematchId = await rematchOf(await newMatch({ ranked: true }));

      const [rematch] = await db.select().from(duelMatches).where(eq(duelMatches.id, rematchId));
      expect(rematch.ranked).toBe(true);
      expect(rematch.rounds).toBe(3);
      expect(rematch.roundSeconds).toBe(60);
      expect(rematch.filter).toBeNull();
    });
  });
});
