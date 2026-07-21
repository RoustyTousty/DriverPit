import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { duelBeginRound, duelCloseRound, duelForfeit, duelState } from "./duelRpc";
import { db } from "./index";
import { duelMatches, duelRoundResults, duelRounds } from "./schema";

// These exercise the real duel_begin_round / duel_close_round / duel_state
// Postgres functions (drizzle/0021_duel_lifecycle_rpcs.sql) against
// DATABASE_URL -- their idempotency guards live in PL/pgSQL, not TS, so
// there's no meaningful way to unit-test them without a real Postgres
// connection (unlike lib/game/*.test.ts's pure functions).
//
// Skipped by default so `npm test` stays instant and offline -- opt in with:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/duelRpc.test.ts
// against a dev database (never production). Fixture players are created
// via real anonymous sign-in (same as any first-time guest visitor) since
// duel_matches.player_a/b FK to profiles, which FKs to auth.users -- there's
// no way to satisfy that constraint with a fabricated uuid. Everything this
// test creates in duel_matches/duel_rounds/duel_round_results is deleted in
// afterAll; the two guest auth users/profiles are intentionally left behind
// (the anon key can't delete auth.users, and they're indistinguishable from
// any other guest who visited once and never came back).
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

async function createGuestPlayerId(): Promise<string> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
  return data.user.id;
}

describe.skipIf(!RUN)("duel_begin_round / duel_close_round / duel_state (integration)", () => {
  let matchId: number;
  let playerAId: string;
  let playerBId: string;

  beforeAll(async () => {
    [playerAId, playerBId] = await Promise.all([createGuestPlayerId(), createGuestPlayerId()]);

    const [match] = await db
      .insert(duelMatches)
      .values({ playerA: playerAId, playerB: playerBId, status: "countdown", currentRound: 0 })
      .returning();
    matchId = match.id;
  });

  afterAll(async () => {
    if (!matchId) return;
    await db.delete(duelRoundResults).where(eq(duelRoundResults.matchId, matchId));
    await db.delete(duelRounds).where(eq(duelRounds.matchId, matchId));
    await db.delete(duelMatches).where(eq(duelMatches.id, matchId));
  });

  it("duel_begin_round stamps the round once and is a no-op on a repeat call", async () => {
    const first = await duelBeginRound(matchId, 0);
    expect(first.newlyStarted).toBe(true);
    expect(first.matchStatus).toBe("active");
    expect(new Date(first.endsAt).getTime() - new Date(first.startedAt).getTime()).toBe(60_000);

    const second = await duelBeginRound(matchId, 0);
    expect(second.newlyStarted).toBe(false);
    expect(second.startedAt).toBe(first.startedAt);
    expect(second.endsAt).toBe(first.endsAt);
    expect(second.matchStatus).toBe("active");
  });

  it("duel_close_round finalizes DNFs, advances to intermission, and is a no-op on a repeat call", async () => {
    // Force the round to look expired so duel_close_round doesn't have to
    // wait on "both players done" -- neither fixture player ever guessed.
    await db
      .update(duelRounds)
      .set({ endsAt: new Date(Date.now() - 1_000) })
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, 0)));

    const first = await duelCloseRound(matchId, 0);
    expect(first.advanced).toBe(true);
    expect(first.matchStatus).toBe("intermission");
    expect(first.currentRound).toBe(1);
    expect(first.nextRoundIndex).toBe(1);
    // Neither player guessed at all -- zero-proximity DNF on both sides.
    expect(first.scoreA).toBe(0);
    expect(first.scoreB).toBe(0);
    expect(first.intermissionEndsAt).not.toBeNull();

    const second = await duelCloseRound(matchId, 0);
    expect(second.advanced).toBe(false);
    expect(second.matchStatus).toBe("intermission");
    expect(second.currentRound).toBe(1);
    // Must not double-apply DNF points on the replay.
    expect(second.scoreA).toBe(first.scoreA);
    expect(second.scoreB).toBe(first.scoreB);
  });

  it("duel_close_round finishes the match on the last round instead of advancing", async () => {
    await duelBeginRound(matchId, 1);
    await db
      .update(duelRounds)
      .set({ endsAt: new Date(Date.now() - 1_000) })
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, 1)));
    await duelCloseRound(matchId, 1);

    await duelBeginRound(matchId, 2);
    await db
      .update(duelRounds)
      .set({ endsAt: new Date(Date.now() - 1_000) })
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, 2)));

    const closed = await duelCloseRound(matchId, 2);
    expect(closed.advanced).toBe(true);
    expect(closed.matchStatus).toBe("finished");
    expect(closed.winnerId).toBeNull(); // 0-0-0 draw, nobody ever guessed

    const repeat = await duelCloseRound(matchId, 2);
    expect(repeat.advanced).toBe(false);
    expect(repeat.matchStatus).toBe("finished");
  });

  it("duel_state reports the full resume phase, including both players' public profile", async () => {
    const state = await duelState(matchId);
    expect(state).not.toBeNull();
    expect(state!.matchStatus).toBe("finished");
    expect(state!.playerA.id).toBe(playerAId);
    expect(state!.playerB.id).toBe(playerBId);
    expect(state!.playerA.rating).toBeGreaterThan(0);
  });

  it("duel_state returns null for a match that doesn't exist", async () => {
    const state = await duelState(-1);
    expect(state).toBeNull();
  });

  it("duel_forfeit never flips an already-finished match to abandoned", async () => {
    // matchId finished normally in the tests above -- a late forfeit call
    // (e.g. a stale disconnect-grace timer firing after the real finish)
    // must be a pure no-op read.
    const res = await duelForfeit(matchId, playerAId);
    expect(res.advanced).toBe(false);
    expect(res.matchStatus).toBe("finished");
  });
});

describe.skipIf(!RUN)("duel_forfeit (integration)", () => {
  let matchId: number;
  let playerAId: string;
  let playerBId: string;

  beforeAll(async () => {
    [playerAId, playerBId] = await Promise.all([createGuestPlayerId(), createGuestPlayerId()]);
    const [match] = await db
      .insert(duelMatches)
      .values({ playerA: playerAId, playerB: playerBId, status: "active", currentRound: 0, scoreA: 940, scoreB: 620 })
      .returning();
    matchId = match.id;
  });

  afterAll(async () => {
    if (!matchId) return;
    await db.delete(duelMatches).where(eq(duelMatches.id, matchId));
  });

  it("forfeits once: abandoned, opponent wins, scores untouched", async () => {
    const first = await duelForfeit(matchId, playerAId);
    expect(first.advanced).toBe(true);
    expect(first.matchStatus).toBe("abandoned");
    expect(first.winnerId).toBe(playerBId);
    expect(first.scoreA).toBe(940);
    expect(first.scoreB).toBe(620);
  });

  it("is a no-op called twice (same side)", async () => {
    const repeat = await duelForfeit(matchId, playerAId);
    expect(repeat.advanced).toBe(false);
    expect(repeat.matchStatus).toBe("abandoned");
    expect(repeat.winnerId).toBe(playerBId);
  });

  it("is a no-op called from the other side -- winner never reassigned", async () => {
    // The opposite scenario: B's client (or a stale grace timer on B's
    // side) declares A's opponent -- i.e. B -- forfeited after A's own
    // forfeit already settled the match. Winner must stay B.
    const other = await duelForfeit(matchId, playerBId);
    expect(other.advanced).toBe(false);
    expect(other.matchStatus).toBe("abandoned");
    expect(other.winnerId).toBe(playerBId);
  });

  it("rejects a non-participant and leaves the match untouched", async () => {
    // Drizzle wraps the PG exception ("User ... is not part of match ...")
    // in its own Failed-query error, so just assert the rejection and that
    // nothing about the settled match changed.
    await expect(duelForfeit(matchId, "00000000-0000-0000-0000-000000000000")).rejects.toThrow();
    const [row] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
    expect(row.status).toBe("abandoned");
    expect(row.winnerId).toBe(playerBId);
  });
});
