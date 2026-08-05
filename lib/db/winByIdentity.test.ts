import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DAILY_POOL_WINDOW, poolCutoffYear } from "../game/poolWindow";
import { db } from "./index";
import { dailyProgress, drivers, duelMatches, duelRoundResults, duelRounds, infiniteRounds } from "./schema";

// Regression coverage for audit 2026-07-27 §3.8 and drizzle/0044: a win is
// guessing the target DRIVER, not matching its five attributes.
//
// All three guess RPCs used to re-derive the win from the tiles
// (nationality = 'exact' AND team = 'exact' AND ...), which makes any two
// drivers sharing those five values interchangeable -- guess B while the
// target is A and the server records a win, then the reveal names A. The live
// roster has six such pairs (all pre-1972 privateers), so the shape below is
// not hypothetical; the fixtures just make it deterministic.
//
// Each test builds a "doppelgänger": two driver rows identical on every
// compared attribute. The load-bearing assertion in every case is that the
// tiles all come back exact/correct AND the round is still not won -- if the
// win rule ever goes back to reading tiles, the tile assertions keep passing
// and the outcome assertions fail, which is exactly the signal wanted.
//
// Infinite and duel build theirs out of two inserted fixture rows; daily's has
// to be a rewritten EXISTING pool driver instead, for the reason spelled out at
// that describe block.
//
// Needs a real Postgres + Supabase project. Opt in, same convention as the
// other DB suites (never against production):
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/winByIdentity.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

// 1960 keeps every INSERTED fixture driver out of all but the legacy pool, so
// none of them can be picked as a daily target or by
// infinite_start_round('10-years') while the suite runs -- which also means a
// parallel suite can never take a reference to one and block the cleanup DELETE.
// The daily block cannot use a row like this at all (drizzle/0051: a daily guess
// must be inside the pool); see the comment there.
const FIXTURE_LAST_ACTIVE_YEAR = 1960;

async function makeGuestClient(): Promise<{ supabase: SupabaseClient; userId: string }> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
  return { supabase, userId: data.user.id };
}

interface GuessTiles {
  nationality: string;
  team: string;
  age: string;
  debut_year: string;
  career_wins: string;
}

// Every attribute the comparison engine looks at, matching on all five -- the
// exact input the old rule could not tell apart from the target itself.
function expectAllTilesMatch(row: GuessTiles) {
  expect(row.nationality).toBe("exact");
  expect(row.team).toBe("exact");
  expect(row.age).toBe("correct");
  expect(row.debut_year).toBe("correct");
  expect(row.career_wins).toBe("correct");
}

describe.skipIf(!RUN)("a win is driver identity, not attribute equality (integration)", () => {
  const fixtureDriverIds: number[] = [];
  let twinA: number;
  let twinB: number;
  // Two guests for the whole suite, not one per mode: Supabase rate-limits
  // anonymous sign-ins per IP, and the DB tier runs every suite in one go.
  // `player` drives all three RPCs (they touch different tables, so there's
  // nothing to isolate); `opponent` exists only because duel_matches has a
  // CHECK (player_a <> player_b).
  let supabase: SupabaseClient;
  let playerId: string;
  let opponentId: string;

  beforeAll(async () => {
    ({ supabase, userId: playerId } = await makeGuestClient());
    ({ userId: opponentId } = await makeGuestClient());

    const rows = await db
      .insert(drivers)
      .values(
        ["A", "B"].map((suffix) => ({
          fullName: `Win-rule doppelganger ${suffix}`,
          driverCode: "DPL",
          nationality: "Doppelganger Republic",
          dateOfBirth: "1940-03-11",
          dateOfDeath: null,
          // Must be <= FIXTURE_LAST_ACTIVE_YEAR: drizzle/0047's
          // drivers_season_order_check rejected the 1961 this used to carry, so
          // the whole suite failed in beforeAll and every case in it went
          // unrun. Both twins share the value either way, which is all the
          // debut-year tile here needs.
          debutYear: 1959,
          careerWins: 0,
          lastTeam: "Doppelganger Racing",
          previousTeams: ["Doppelganger Racing"],
          lastActiveYear: FIXTURE_LAST_ACTIVE_YEAR,
        })),
      )
      .returning({ id: drivers.id });
    [twinA, twinB] = rows.map((r) => r.id);
    fixtureDriverIds.push(twinA, twinB);
  });

  afterAll(async () => {
    if (fixtureDriverIds.length > 0) {
      await db.delete(drivers).where(inArray(drivers.id, fixtureDriverIds));
    }
  });

  describe("infinite_submit_guess", () => {
    beforeAll(async () => {
      // Inserted directly rather than through infinite_start_round, which
      // picks at random -- the round has to target a known twin.
      await db.insert(infiniteRounds).values({
        userId: playerId,
        driverId: twinA,
        guessCount: 0,
      });
    });

    afterAll(async () => {
      await db.delete(infiniteRounds).where(eq(infiniteRounds.userId, playerId));
    });

    it("does not win on a different driver with every attribute identical", async () => {
      const { data, error } = await supabase.rpc("infinite_submit_guess", { p_guess_driver_id: twinB }).single();
      expect(error).toBeNull();

      const row = data as GuessTiles & { status: string; target_driver_id: number | null };
      expectAllTilesMatch(row);
      expect(row.status).toBe("continue");
      // And the round is still live, so the target stays secret.
      expect(row.target_driver_id).toBeNull();

      const [round] = await db.select().from(infiniteRounds).where(eq(infiniteRounds.userId, playerId));
      expect(round.guessCount).toBe(1);
    });

    it("still wins on the actual target driver", async () => {
      const { data, error } = await supabase.rpc("infinite_submit_guess", { p_guess_driver_id: twinA }).single();
      expect(error).toBeNull();

      const row = data as { status: string; target_driver_id: number | null };
      expect(row.status).toBe("won");
      expect(row.target_driver_id).toBe(twinA);
    });
  });

  describe("daily_submit_guess", () => {
    let targetId: number;
    // Daily's doppelgänger is an EXISTING pool driver temporarily rewritten to
    // match the target, not a new row like the other two blocks use -- and that
    // difference is forced by drizzle/0051, which made a daily guess valid only
    // INSIDE the daily pool. A fixture row in that pool is one
    // daily_target_id, infinite_start_round or duel_begin_round can pick at
    // random in a suite running beside this one (vitest runs test files in
    // parallel), and the resulting daily_targets/infinite_rounds/duel_rounds
    // reference would then block this suite's DELETE on a foreign key. Rewriting
    // a driver ALREADY in the pool changes no pool membership at all: nothing is
    // added, nothing is removed, every random pick stays valid, and the undo is
    // an UPDATE, which no reference can block.
    let cloneId: number;
    let cloneBefore: typeof drivers.$inferSelect | undefined;

    beforeAll(async () => {
      // The day's driver is random and pinned by whoever calls first
      // (daily_target_id), so it can't be chosen -- pin it, read it back, and
      // build the doppelgänger from whatever it turned out to be.
      const { error: stateError } = await supabase.rpc("daily_state");
      expect(stateError).toBeNull();

      const pinned = await db.execute<{ driver_id: number }>(sql`
        SELECT driver_id FROM public.daily_targets
        WHERE date = (now() AT TIME ZONE 'UTC')::date`);
      targetId = pinned[0].driver_id;

      // The pool's HIGHEST id, deliberately the opposite end of the roster from
      // the low ids dailyRpc.test.ts guesses, so the two suites can't pick the
      // same driver in a parallel run. Cutoff from the TypeScript constant; the
      // plpgsql copies of it are pinned by lib/game/poolWindow.sqlParity.test.ts.
      const [{ today }] = await db.execute<{ today: string }>(
        sql`SELECT (now() AT TIME ZONE 'UTC')::date::text AS today`,
      );
      const cutoff = poolCutoffYear(DAILY_POOL_WINDOW, Number(today.slice(0, 4)));
      const [victim] = await db.execute<{ id: number }>(sql`
        SELECT id FROM public.drivers
        WHERE id <> ${targetId}
          AND ${cutoff === null ? sql`true` : sql`last_active_year >= ${cutoff}`}
        ORDER BY id DESC LIMIT 1`);
      if (!victim) {
        throw new Error(
          `the ${DAILY_POOL_WINDOW} pool holds no driver besides the day's target, so there is ` +
            `nothing to make a guessable doppelgänger out of -- run \`npm run db:seed\`.`,
        );
      }
      cloneId = victim.id;

      // last_active_year is copied along with the five compared attributes for
      // two reasons: the `debut_year <= last_active_year` check (drizzle/0047)
      // would otherwise reject a target that debuted after this driver last
      // raced, and copying it from a driver who IS in the pool keeps this one in
      // the pool, which is the whole premise above.
      [cloneBefore] = await db.select().from(drivers).where(eq(drivers.id, cloneId));
      await db.execute(sql`
        UPDATE public.drivers d
        SET nationality = t.nationality,
            date_of_birth = t.date_of_birth,
            date_of_death = t.date_of_death,
            debut_year = t.debut_year,
            career_wins = t.career_wins,
            last_team = t.last_team,
            previous_teams = t.previous_teams,
            last_active_year = t.last_active_year
        FROM public.drivers t
        WHERE d.id = ${cloneId} AND t.id = ${targetId}`);
    });

    afterAll(async () => {
      await db.delete(dailyProgress).where(eq(dailyProgress.userId, playerId));
      if (cloneBefore) {
        await db
          .update(drivers)
          .set({
            nationality: cloneBefore.nationality,
            dateOfBirth: cloneBefore.dateOfBirth,
            dateOfDeath: cloneBefore.dateOfDeath,
            debutYear: cloneBefore.debutYear,
            careerWins: cloneBefore.careerWins,
            lastTeam: cloneBefore.lastTeam,
            previousTeams: cloneBefore.previousTeams,
            lastActiveYear: cloneBefore.lastActiveYear,
          })
          .where(eq(drivers.id, cloneId));
      }
    });

    it("does not complete the day on a clone of the day's driver", async () => {
      const { data, error } = await supabase.rpc("daily_submit_guess", { p_guess_driver_id: cloneId }).single();
      expect(error).toBeNull();

      const row = data as GuessTiles & {
        won: boolean;
        completed: boolean;
        guesses_remaining: number;
        target_driver_id: number | null;
      };
      // The team tile is the one attribute a real roster row might not have
      // (a null last_team compares as a miss on both sides since drizzle/0044),
      // so it's asserted separately from the four that always match a clone.
      expect(row.nationality).toBe("exact");
      expect(row.age).toBe("correct");
      expect(row.debut_year).toBe("correct");
      expect(row.career_wins).toBe("correct");

      expect(row.won).toBe(false);
      expect(row.completed).toBe(false);
      expect(row.target_driver_id).toBeNull();
      expect(row.guesses_remaining).toBe(5);

      // The board is server-authoritative: the day must still be playable.
      const [progress] = await db.select().from(dailyProgress).where(eq(dailyProgress.userId, playerId));
      expect(progress.completed).toBe(false);
      expect(progress.won).toBeNull();
      expect(progress.guesses).toEqual([cloneId]);
    });

    it("still completes the day on the actual target driver", async () => {
      const { data, error } = await supabase.rpc("daily_submit_guess", { p_guess_driver_id: targetId }).single();
      expect(error).toBeNull();

      const row = data as { won: boolean; completed: boolean; target_driver_id: number | null };
      expect(row.won).toBe(true);
      expect(row.completed).toBe(true);
      expect(row.target_driver_id).toBe(targetId);
    });
  });

  describe("duel_submit_guess", () => {
    let matchId: number;

    beforeAll(async () => {
      const [match] = await db
        .insert(duelMatches)
        .values({ playerA: playerId, playerB: opponentId, status: "active", currentRound: 0 })
        .returning();
      matchId = match.id;

      // Stamped off the DATABASE clock, which is what duel_submit_guess's
      // started_at/ends_at guards compare against (see duelRpc.test.ts).
      await db.insert(duelRounds).values({
        matchId,
        roundIndex: 0,
        driverId: twinA,
        startedAt: sql`now() - interval '1 second'`,
        endsAt: sql`now() + interval '60 seconds'`,
      });
    });

    afterAll(async () => {
      if (!matchId) return;
      await db.delete(duelRoundResults).where(eq(duelRoundResults.matchId, matchId));
      await db.delete(duelRounds).where(eq(duelRounds.matchId, matchId));
      await db.delete(duelMatches).where(eq(duelMatches.id, matchId));
    });

    it("does not solve the round on a different driver with every attribute identical", async () => {
      const { data, error } = await supabase
        .rpc("duel_submit_guess", { p_match_id: matchId, p_round_index: 0, p_guess_driver_id: twinB })
        .single();
      expect(error).toBeNull();

      const row = data as GuessTiles & { solved: boolean; points: number | null; best_heat: number };
      expectAllTilesMatch(row);
      expect(row.solved).toBe(false);
      expect(row.points).toBeNull();
      // Full heat without solving is now reachable, and that's fine: the
      // proximity ceiling (75) sits below MIN_SPEED_POINTS (100), so "any
      // solve beats any DNF" holds on the ceiling rather than on the old
      // assumption that an unsolved guess must miss something.
      expect(Number(row.best_heat)).toBe(1);

      // No points banked, and the round is still open to be won properly.
      const [match] = await db.select().from(duelMatches).where(eq(duelMatches.id, matchId));
      expect(match.scoreA).toBe(0);
      expect(match.scoreB).toBe(0);
    });

    it("still solves the round on the actual target driver", async () => {
      const { data, error } = await supabase
        .rpc("duel_submit_guess", { p_match_id: matchId, p_round_index: 0, p_guess_driver_id: twinA })
        .single();
      expect(error).toBeNull();

      const row = data as { solved: boolean; points: number | null };
      expect(row.solved).toBe(true);
      expect(row.points).toBeGreaterThan(0);
    });
  });
});
