import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  matchesDriverFilter,
  type Achievement,
  type DriverFilter,
} from "../game/driverFilter";
import { duelBeginRound } from "./duelRpc";
import { db } from "./index";
import { listAllDriverOptionsWithActivity } from "./queries";
import { duelMatches, duelRoundResults, duelRounds, infiniteRounds } from "./schema";

// The TS<->SQL parity guard for the driver filter, pinned through BOTH of its
// callers (drizzle/0053, drizzle/0056), and the replacement for the two
// `infinite's pool ladder` assertions that used to live in
// lib/game/poolWindow.sqlParity.test.ts.
//
// Since drizzle/0056 there is exactly ONE SQL copy of the predicate --
// public.pick_filtered_driver -- and two callers of it: infinite_start_round
// picks a round's target from a player-composed filter, and duel_begin_round
// picks each round's target from a custom lobby's. Both blocks below run the
// real caller and hold its picks against matchesDriverFilter, so the shared
// function is pinned through each path rather than only through the one it was
// extracted from.
//
// WHAT GOES WRONG WITHOUT IT. The filter exists twice: once as
// lib/game/driverFilter.ts#matchesDriverFilter, which decides which drivers the
// browser autocompletes, and once as the WHERE clause inside
// infinite_start_round, which decides which driver is the ANSWER. Drift between
// them is silent and unreportable in exactly the way the daily pool cutoff was:
// a round whose target is outside the player's own filter cannot be typed into
// the box, so the mode simply becomes unwinnable for that round with nothing
// erroring anywhere. `last_active_year >= from` instead of the overlap test, an
// `OR` where the TypeScript has `AND`, a forgotten `previous_teams` -- each is a
// one-token difference that no type-checker and no static extraction can see.
//
// WHY BEHAVIOURAL RATHER THAN EXTRACTED. The other parity suites pull an
// expression out of pg_get_functiondef() and execute it, because they pin a
// CONSTANT (a cutoff year, a scoring weight). This pins a PREDICATE over five
// columns, and the SQL spells it with `= ANY(previous_teams)` and a CASE where
// the TypeScript uses `.includes()` and a switch -- textually nothing alike, and
// both correct. So the suite asks the only question that matters instead: over a
// spread of filters, does the function ever pick a driver the TypeScript would
// have withheld?
//
// It runs the real RPC as a real authenticated guest, so it also covers the
// grant, the clamping and the auth check on the way through.
//
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/infiniteFilter.sqlParity.test.ts
//
// Writes only this guest's own infinite_rounds row, deleted in afterAll.
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

// Enough draws per filter that a wrong predicate has to be very lucky to look
// right -- a narrow filter picking from, say, 12 eligible drivers would need
// every one of these to land on the overlap between two different definitions.
const DRAWS_PER_FILTER = 12;

// Every case here is network-bound by construction: one RPC plus one read per
// draw, ~15 probe filters deep, all sequential because each draw overwrites the
// same round row. That is comfortably past vitest.config.ts's 30s DB default --
// which failed this suite on a TIMEOUT, not an assertion, and a safety net that
// times out is not a safety net. Set per-case rather than raising the global:
// nothing else in the DB tier needs minutes, and a suite that quietly takes 60s
// should say so at the point where it does.
const SLOW = 300_000;

function rpcArgs(filter: DriverFilter) {
  return {
    p_from_year: filter.fromYear,
    p_to_year: filter.toYear,
    p_nationality: filter.nationality,
    p_team: filter.team,
    p_achievement: filter.achievement,
  };
}

describe.skipIf(!RUN)("infinite_start_round matches matchesDriverFilter (integration)", () => {
  let supabase: SupabaseClient;
  let userId: string;
  let roster: Awaited<ReturnType<typeof listAllDriverOptionsWithActivity>>;
  let byId: Map<number, (typeof roster)[number]>;
  let currentYear: number;

  beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error(`fixture guest sign-in failed: ${error.message}`);
    const { data } = await supabase.auth.getUser();
    userId = data.user!.id;

    // The same roster read the /infinite page ships to the browser, so the
    // TypeScript side of this comparison is fed exactly what the client filters.
    roster = await listAllDriverOptionsWithActivity();
    byId = new Map(roster.map((d) => [d.id, d]));

    // The database's own clock, not the test runner's: the RPC clamps p_to_year
    // against `extract(year FROM now())`, so a probe built from a machine whose
    // year had already rolled over would ask for a span the function then
    // quietly narrows, and the two sides would disagree for one night a year.
    const [{ year }] = await db.execute<{ year: number }>(
      sql`SELECT extract(year FROM now())::int AS year`,
    );
    currentYear = Number(year);
  });

  afterAll(async () => {
    if (userId) await db.delete(infiniteRounds).where(eq(infiniteRounds.userId, userId));
  });

  // Built from the live roster so they are never vacuous: a filter nothing
  // matches would pass this suite trivially, so each is asserted non-empty
  // before it is used.
  function probeFilters(): { name: string; filter: DriverFilter }[] {
    const year = currentYear;
    const base: DriverFilter = {
      fromYear: 1950,
      toYear: year,
      nationality: null,
      team: null,
      achievement: "any",
    };
    // Whatever the roster actually holds, rather than hardcoded strings that a
    // country rename would quietly turn into an empty probe.
    const nationality = roster[Math.floor(roster.length / 2)].nationality;
    const team = roster.flatMap((d) => d.teams).find(Boolean)!;

    const filters: { name: string; filter: DriverFilter }[] = [
      { name: "everything", filter: base },
      { name: "a single early season", filter: { ...base, fromYear: 1958, toYear: 1958 } },
      { name: "a mid-history decade", filter: { ...base, fromYear: 1990, toYear: 1999 } },
      { name: "the last five seasons", filter: { ...base, fromYear: year - 5, toYear: year } },
      { name: "one nationality", filter: { ...base, nationality } },
      { name: "one team", filter: { ...base, team } },
      {
        name: "a nationality inside a span",
        filter: { ...base, fromYear: 1980, toYear: 2010, nationality },
      },
    ];

    for (const achievement of ["podium", "race-winner", "pole", "champion"] as Achievement[]) {
      filters.push({ name: `achievement: ${achievement}`, filter: { ...base, achievement } });
      filters.push({
        name: `achievement: ${achievement}, last 30 seasons`,
        filter: { ...base, fromYear: year - 30, toYear: year, achievement },
      });
    }
    return filters;
  }

  it("draws only drivers the TypeScript filter admits", { timeout: SLOW }, async () => {
    for (const { name, filter } of probeFilters()) {
      const expected = roster.filter((d) => matchesDriverFilter(d, filter));
      // A probe that matches nobody would pass by accident.
      expect(expected.length, `probe "${name}" matches no driver — it proves nothing`).toBeGreaterThan(0);
      const eligible = new Set(expected.map((d) => d.id));

      for (let draw = 0; draw < DRAWS_PER_FILTER; draw++) {
        const { error } = await supabase.rpc("infinite_start_round", rpcArgs(filter));
        expect(error, `probe "${name}" failed to start: ${error?.message}`).toBeNull();

        const [round] = await db
          .select()
          .from(infiniteRounds)
          .where(eq(infiniteRounds.userId, userId));
        const picked = byId.get(round.driverId);

        expect(
          picked && eligible.has(round.driverId),
          `probe "${name}" picked ${picked?.fullName ?? round.driverId} ` +
            `(debut ${picked?.debutYear}, last active ${picked?.lastActiveYear}, ` +
            `${picked?.nationality}, teams ${picked?.teams.join("/")}, ` +
            `${picked?.careerWins}W ${picked?.championshipWins}C ${picked?.podiums}P ` +
            `${picked?.polePositions}Q), which matchesDriverFilter rejects`,
        ).toBe(true);
      }
    }
  });

  // The other direction. The test above catches SQL that is too PERMISSIVE; a
  // predicate that is too strict (an AND where the TypeScript has an OR, a
  // team test that reads last_team instead of previous_teams) would keep every
  // draw legal while quietly shrinking the pool to a handful of drivers -- so
  // this checks the SQL can actually reach the whole set the client claims.
  it("can reach every driver a narrow filter admits", { timeout: SLOW }, async () => {
    const year = currentYear;
    const nationality = roster[Math.floor(roster.length / 3)].nationality;
    const filter: DriverFilter = {
      fromYear: year - 25,
      toYear: year,
      nationality,
      team: null,
      achievement: "any",
    };
    const expected = roster.filter((d) => matchesDriverFilter(d, filter));
    expect(expected.length).toBeGreaterThan(1);

    const seen = new Set<number>();
    // Coupon-collector with a wide margin: n·ln(n) draws would be the
    // expectation, and this is comfortably past it for the pool sizes here.
    const draws = Math.min(400, expected.length * 12 + 40);
    for (let i = 0; i < draws && seen.size < expected.length; i++) {
      await supabase.rpc("infinite_start_round", rpcArgs(filter));
      const [round] = await db.select().from(infiniteRounds).where(eq(infiniteRounds.userId, userId));
      seen.add(round.driverId);
    }

    const unreachable = expected.filter((d) => !seen.has(d.id));
    // Not "every single one", which would be flaky on a genuinely random pick;
    // a systematic mismatch shows up as a large unreachable set, not one driver.
    expect(
      unreachable.length,
      `${unreachable.length}/${expected.length} eligible drivers were never drawn ` +
        `(e.g. ${unreachable.slice(0, 5).map((d) => d.fullName).join(", ")}) — ` +
        `the SQL predicate is narrower than matchesDriverFilter`,
    ).toBeLessThanOrEqual(Math.ceil(expected.length * 0.25));
  });
});

// ---------------------------------------------------------------------------
// The second caller
// ---------------------------------------------------------------------------

// Same predicate, same shared function, reached the other way: duel_begin_round
// draws each round's target from duel_matches.filter when a custom lobby set one
// (drizzle/0056). Pinned separately because the two callers pass different
// things -- Infinite hands pick_filtered_driver a filter it just built and no
// exclusions, duel hands it a filter stored on a row plus the drivers this match
// has already used -- so a break in one is not necessarily a break in the other.
//
// The stakes are higher here than in Infinite. An unwinnable Infinite round
// costs a click to restart; an unwinnable DUEL round is a timed 1v1 where the
// player watches the clock run out on a driver they cannot type, while their
// opponent is on the same board.
describe.skipIf(!RUN)("duel_begin_round matches matchesDriverFilter (integration)", () => {
  let playerA: string;
  let playerB: string;
  let roster: Awaited<ReturnType<typeof listAllDriverOptionsWithActivity>>;
  let currentYear: number;
  const matchIds: number[] = [];

  beforeAll(async () => {
    const guest = async () => {
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
      return data.user.id;
    };
    // Two guests for the whole block, reused by every case: Supabase rate-limits
    // anonymous sign-in per IP per hour and the DB tier runs every suite in one
    // go. Each case gets its own MATCH, which is the thing that needs isolating
    // -- the players never do.
    playerA = await guest();
    playerB = await guest();

    roster = await listAllDriverOptionsWithActivity();
    const [{ year }] = await db.execute<{ year: number }>(sql`SELECT extract(year FROM now())::int AS year`);
    currentYear = Number(year);
  });

  afterAll(async () => {
    if (matchIds.length === 0) return;
    await db.delete(duelRoundResults).where(inArray(duelRoundResults.matchId, matchIds));
    await db.delete(duelRounds).where(inArray(duelRounds.matchId, matchIds));
    await db.delete(duelMatches).where(inArray(duelMatches.id, matchIds));
  });

  async function newMatch(filter: DriverFilter | null, rounds = 3): Promise<number> {
    const [match] = await db
      .insert(duelMatches)
      .values({
        playerA,
        playerB,
        status: "countdown",
        currentRound: 0,
        ranked: filter === null,
        rounds,
        filter,
      })
      .returning();
    matchIds.push(match.id);
    return match.id;
  }

  async function targetOf(matchId: number, roundIndex: number): Promise<number> {
    const [round] = await db
      .select()
      .from(duelRounds)
      .where(and(eq(duelRounds.matchId, matchId), eq(duelRounds.roundIndex, roundIndex)));
    return round.driverId;
  }

  it("draws every round's target from the match's own filter", { timeout: SLOW }, async () => {
    const filter: DriverFilter = {
      fromYear: 1990,
      toYear: 1999,
      nationality: null,
      team: null,
      achievement: "any",
    };
    const eligible = new Set(roster.filter((d) => matchesDriverFilter(d, filter)).map((d) => d.id));
    expect(eligible.size, "probe filter matches no driver -- it proves nothing").toBeGreaterThan(3);

    const matchId = await newMatch(filter);
    for (let roundIndex = 0; roundIndex < 3; roundIndex++) {
      const begun = await duelBeginRound(matchId, roundIndex);
      expect(begun.newlyStarted).toBe(true);
      const driverId = await targetOf(matchId, roundIndex);
      const picked = roster.find((d) => d.id === driverId);
      expect(
        eligible.has(driverId),
        `round ${roundIndex} targeted ${picked?.fullName ?? driverId} ` +
          `(debut ${picked?.debutYear}, last active ${picked?.lastActiveYear}), ` +
          `which matchesDriverFilter rejects -- that round is unwinnable`,
      ).toBe(true);
    }
  });

  // p_exclude WIRED THROUGH duel_begin_round -- that it collects this match's
  // used drivers and passes them down at all. Deliberately sized to TWO
  // eligible drivers and three rounds, which makes both halves deterministic:
  // round 1 can only be the other driver, and round 2 has nothing left and must
  // repeat. The obvious version of this test (a wide filter, "all three
  // distinct") is worth almost nothing -- measured against this roster, a
  // "champions since 1980" filter admits 22 drivers, so three PLAIN RANDOM
  // draws are already all-distinct 87% of the time and the assertion would pass
  // with the exclusion deleted. The deterministic contract of
  // pick_filtered_driver itself is pinned separately below.
  it("passes this match's used drivers down, then degrades", { timeout: SLOW }, async () => {
    const pair = findFilterMatchingExactly(roster, 2);
    expect(pair, "no two-driver filter exists on this roster to force the exclusion").not.toBeNull();

    const matchId = await newMatch(pair!.filter, 3);
    const targets: number[] = [];
    for (let roundIndex = 0; roundIndex < 3; roundIndex++) {
      const begun = await duelBeginRound(matchId, roundIndex);
      expect(begun.newlyStarted).toBe(true);
      targets.push(await targetOf(matchId, roundIndex));
    }

    // Rounds 0 and 1: forced apart by the exclusion. A coin flip without it.
    expect(
      targets[0] === targets[1],
      `rounds 0 and 1 both targeted ${targets[0]} out of a two-driver filter -- ` +
        `duel_begin_round is not passing p_exclude`,
    ).toBe(false);
    expect(new Set(targets.slice(0, 2))).toEqual(new Set(pair!.ids));
    // Round 2: every eligible driver is now excluded, so it must degrade to a
    // repeat rather than raise. Reaching this line at all is most of the point.
    expect(pair!.ids).toContain(targets[2]);
  });

  // p_exclude, second half, and the case that matters most: DEGRADE, DON'T
  // ERROR. A filter admitting fewer drivers than the match has rounds must
  // still deal every round. The exclusion is an ORDER BY rather than a WHERE
  // precisely so this ends in a repeated driver instead of a NULL target and a
  // raised exception mid-match, with two players watching.
  it("falls back to repeating a target when the filter is smaller than the round count", { timeout: SLOW }, async () => {
    const solo = findFilterMatchingExactly(roster, 1);
    expect(solo, "no single-driver filter exists on this roster to force the fallback").not.toBeNull();

    const matchId = await newMatch(solo!.filter, 3);
    for (let roundIndex = 0; roundIndex < 3; roundIndex++) {
      // The assertion IS that this does not throw. With a WHERE instead of an
      // ORDER BY, round 1 finds every eligible driver excluded, gets NULL back
      // and raises -- ending the match on its second round.
      const begun = await duelBeginRound(matchId, roundIndex);
      expect(begun.newlyStarted).toBe(true);
      expect(await targetOf(matchId, roundIndex)).toBe(solo!.ids[0]);
    }
  });

  // The other branch, unchanged by drizzle/0056 and worth holding down: a
  // ranked duel has no filter and must still draw from the 20-year daily pool,
  // never through pick_filtered_driver.
  it("still uses the 20-year pool when the match has no filter", { timeout: SLOW }, async () => {
    const matchId = await newMatch(null);
    await duelBeginRound(matchId, 0);
    const driverId = await targetOf(matchId, 0);
    const picked = roster.find((d) => d.id === driverId);
    expect(picked, `target ${driverId} is not in the roster at all`).toBeDefined();
    expect(
      picked!.lastActiveYear,
      `ranked duel targeted ${picked!.fullName}, last active ${picked!.lastActiveYear} -- ` +
        `outside the ${currentYear - 20}+ daily pool`,
    ).toBeGreaterThanOrEqual(currentYear - 20);
  });
});

// A filter the TypeScript admits exactly `size` drivers for, found in the live
// roster rather than hardcoded -- a hardcoded one goes stale the first time the
// seed runs. Small filters are what make the exclusion tests deterministic:
// with exactly as many eligible drivers as there are rounds to fill, "was a
// repeat avoided" and "did it degrade instead of erroring" both have single
// correct answers rather than probable ones.
function findFilterMatchingExactly(
  roster: Awaited<ReturnType<typeof listAllDriverOptionsWithActivity>>,
  size: number,
): { filter: DriverFilter; ids: number[] } | null {
  for (const candidate of roster) {
    const filter: DriverFilter = {
      fromYear: candidate.debutYear,
      toYear: candidate.debutYear,
      nationality: candidate.nationality,
      team: null,
      achievement: "any",
    };
    const matched = roster.filter((d) => matchesDriverFilter(d, filter));
    if (matched.length === size) return { filter, ids: matched.map((d) => d.id) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The shared function's own contract
// ---------------------------------------------------------------------------

// p_exclude, pinned directly and deterministically. The two duel cases above
// prove the WIRING (that duel_begin_round collects this match's used drivers
// and hands them down); these prove the CONTRACT, without a random draw in the
// way of the assertion.
//
// Called on the trusted connection because that is the only thing that can:
// EXECUTE is revoked from PUBLIC, anon and authenticated (drizzle/0056), which
// lib/db/schemaGrants.test.ts is what actually pins.
describe.skipIf(!RUN)("pick_filtered_driver's exclusion contract (integration)", () => {
  let roster: Awaited<ReturnType<typeof listAllDriverOptionsWithActivity>>;
  let currentYear: number;

  beforeAll(async () => {
    roster = await listAllDriverOptionsWithActivity();
    const [{ year }] = await db.execute<{ year: number }>(sql`SELECT extract(year FROM now())::int AS year`);
    currentYear = Number(year);
  });

  async function pick(filter: DriverFilter, exclude: number[] | null): Promise<number | null> {
    // The exclusion goes over as ONE text parameter holding a Postgres array
    // literal, not as `${exclude}`: drizzle's sql template expands a JS array
    // into a parameter list, so `${[5, 707]}::integer[]` compiles to
    // `($1, $2)::integer[]` and fails with "cannot cast type record to
    // integer[]". The ids come from the roster read above, so there is nothing
    // to escape.
    const asArray = exclude === null ? null : `{${exclude.join(",")}}`;
    const rows = await db.execute<{ id: number | null }>(sql`
      SELECT public.pick_filtered_driver(
        ${JSON.stringify(filter)}::jsonb,
        ${asArray}::integer[]
      ) AS id`);
    return rows[0].id;
  }

  it("never returns an excluded driver while an unexcluded one exists", async () => {
    const pair = findFilterMatchingExactly(roster, 2);
    expect(pair, "no two-driver filter exists on this roster").not.toBeNull();
    const [keep, drop] = pair!.ids;

    // 20 consecutive draws. Excluding one of two, a predicate that ignored
    // p_exclude entirely would have to win 20 coin flips to look correct here;
    // the same assertion phrased over a wide pool passes by luck most runs.
    for (let i = 0; i < 20; i++) {
      expect(await pick(pair!.filter, [drop])).toBe(keep);
    }
  });

  // THE degrade-don't-error requirement, at its source. Every eligible driver
  // excluded is exactly what a 5-round match on a 2-driver filter reaches by
  // round 3, and the answer has to be a driver, not NULL -- duel_begin_round
  // raises on NULL, which would end a live match mid-play.
  it("degrades to a repeat rather than NULL when every match is excluded", async () => {
    const pair = findFilterMatchingExactly(roster, 2);
    expect(pair).not.toBeNull();

    for (let i = 0; i < 10; i++) {
      const picked = await pick(pair!.filter, pair!.ids);
      expect(picked, "every eligible driver was excluded and the pick returned NULL").not.toBeNull();
      expect(pair!.ids).toContain(picked!);
    }
  });

  // The other end: NULL is still the answer when the filter genuinely matches
  // nobody, since that is what both callers key their "no drivers match" error
  // off. The degradation above must not have turned this into a driver.
  it("returns NULL when the filter matches nobody at all", async () => {
    // A nationality no roster can hold, rather than a narrow slice of history.
    // The first attempt here was "champions in 1950-51", which is empty only if
    // you forget that Farina and Fangio won exactly then -- it matched three
    // drivers. Anything built out of real history is a fact about the seed that
    // can change under the test; an invented country cannot.
    const impossible: DriverFilter = {
      fromYear: 1950,
      toYear: currentYear,
      nationality: "Nowhereland",
      team: null,
      achievement: "any",
    };
    // Only meaningful if the TypeScript agrees nobody matches -- otherwise this
    // would pass for the wrong reason.
    expect(roster.filter((d) => matchesDriverFilter(d, impossible))).toHaveLength(0);
    expect(await pick(impossible, null)).toBeNull();
  });
});
