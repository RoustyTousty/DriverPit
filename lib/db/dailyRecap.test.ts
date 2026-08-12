import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isDriverPageEligible } from "../drivers/pageEligibility";
import { getDailyPuzzleNumber } from "../game/dailySelection";
import { isArchiveDayIndexable } from "../recap/dayEligibility";
import {
  countArchiveDays,
  getArchiveDayContext,
  getDailyRecap,
  getDriverPage,
  getLatestArchiveDate,
  listArchiveDayEvidence,
  listArchiveDays,
  listDriverArchiveEvidence,
} from "./dailyRecap";
import { db } from "./index";
import { dailyProgress, dailyTargets, drivers, profiles } from "./schema";

// Integration coverage for the daily recap query (lib/db/dailyRecap.ts), which
// is what Pass 3's archive pages and the recap image are built on.
//
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/dailyRecap.test.ts
//
// TWO FIXTURE DAYS, both a long way from any day anyone will play, and both
// derived from the DATABASE's own clock rather than Node's -- the thing under
// test is a comparison against that clock, so a suite that decided "today" for
// itself would be testing its own arithmetic.
//
//   PAST   = today - 400: a finished day, fully populated, whose numbers are
//            hand-computed below.
//   FUTURE = today + 400: the same fixture on a day that has NOT finished. It
//            exists so the date guard is pinned by something with real data
//            behind it: remove the `t.date < today` comparison and this day
//            returns a complete recap, target driver included. Asserting only
//            that TODAY returns null would pass on a database where today's
//            target has not been pinned yet, which is most of them.
//
// 400 rather than 1 so that a run whose cleanup fails cannot leave a pinned
// answer on a day a player reaches before someone notices.
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

const PLAYERS_NEEDED = 3;
const FIXTURE_DRIVERS_NEEDED = 7;

async function dbDate(offsetDays: number): Promise<string> {
  const [row] = await db.execute<{ d: string }>(
    sql`SELECT ((now() AT TIME ZONE 'utc')::date + ${offsetDays}::int)::text AS d`,
  );
  return row.d;
}

describe.skipIf(!RUN)("getDailyRecap (integration)", () => {
  let today: string;
  let past: string;
  let future: string;
  // ids[0] is the answer; ids[1..6] are the wrong drivers the fixture guesses.
  let ids: number[];
  let players: string[];

  beforeAll(async () => {
    today = await dbDate(0);
    past = await dbDate(-400);
    future = await dbDate(400);

    const driverRows = await db
      .select({ id: drivers.id })
      .from(drivers)
      .orderBy(drivers.id)
      .limit(FIXTURE_DRIVERS_NEEDED);
    if (driverRows.length < FIXTURE_DRIVERS_NEEDED) {
      throw new Error(
        `the roster holds ${driverRows.length} drivers, fewer than the ${FIXTURE_DRIVERS_NEEDED} this ` +
          "fixture needs -- run `npm run db:seed` before the database tier.",
      );
    }
    ids = driverRows.map((row) => row.id);

    // Any three accounts will do: the fixture days are 400 days from now, so no
    // real daily_progress row can exist for them under any user. Reusing
    // existing profiles rather than minting guests keeps this suite off the
    // Supabase per-IP anonymous sign-in quota, which a full database-tier run
    // can otherwise exhaust for an hour. Minting is the fallback for a scratch
    // project that has no accounts yet.
    const existing = await db.select({ id: profiles.id }).from(profiles).limit(PLAYERS_NEEDED);
    players = existing.map((row) => row.id);
    while (players.length < PLAYERS_NEEDED) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
      players.push(data.user.id);
    }

    await db.delete(dailyProgress).where(inArray(dailyProgress.date, [past, future]));
    await db.delete(dailyTargets).where(inArray(dailyTargets.date, [past, future]));

    for (const date of [past, future]) {
      await db.insert(dailyTargets).values({ date, driverId: ids[0] });
      await db.insert(dailyProgress).values([
        // Solved in 2.
        { userId: players[0], date, guesses: [ids[1], ids[0]], completed: true, won: true },
        // Solved in 3.
        { userId: players[1], date, guesses: [ids[2], ids[1], ids[0]], completed: true, won: true },
        // Used all six and never found them.
        {
          userId: players[2],
          date,
          guesses: [ids[1], ids[2], ids[3], ids[4], ids[5], ids[6]],
          completed: true,
          won: false,
        },
      ]);
    }
  });

  afterAll(async () => {
    if (!RUN) return;
    await db.delete(dailyProgress).where(inArray(dailyProgress.date, [past, future]));
    await db.delete(dailyTargets).where(inArray(dailyTargets.date, [past, future]));
  });

  it("reports a finished day's numbers", async () => {
    const recap = await getDailyRecap(past);
    if (!recap) throw new Error("expected a recap for the finished fixture day");

    expect(recap.date).toBe(past);
    expect(recap.puzzleNumber).toBe(getDailyPuzzleNumber(past));

    expect(recap.players).toBe(3);
    expect(recap.completed).toBe(3);
    expect(recap.solved).toBe(2);
    expect(recap.solveRate).toBeCloseTo(2 / 3, 10);
    // Over SOLVED games only: (2 + 3) / 2. Folding the six-guess loss in would
    // give 3.67 and quietly mean something else.
    expect(recap.averageGuesses).toBeCloseTo(2.5, 10);
    expect(recap.distribution).toEqual([0, 1, 1, 0, 0, 0]);
  });

  it("describes the target as the board did on that day", async () => {
    const recap = await getDailyRecap(past);
    if (!recap) throw new Error("expected a recap for the finished fixture day");

    const [row] = await db
      .select({
        fullName: drivers.fullName,
        driverCode: drivers.driverCode,
        nationality: drivers.nationality,
        lastTeam: drivers.lastTeam,
        debutYear: drivers.debutYear,
        careerWins: drivers.careerWins,
      })
      .from(drivers)
      .where(eq(drivers.id, ids[0]));

    expect(recap.target.id).toBe(ids[0]);
    expect(recap.target.fullName).toBe(row.fullName);
    expect(recap.target.driverCode).toBe(row.driverCode);
    expect(recap.target.nationality).toBe(row.nationality);
    expect(recap.target.debutYear).toBe(row.debutYear);
    expect(recap.target.careerWins).toBe(row.careerWins);
    // NULLIF('') -- the board renders an absent team as an em dash, and "" is
    // not a team two drivers can share (see compare.ts#compareTeam).
    expect(recap.target.lastTeam).toBe(row.lastTeam === "" ? null : row.lastTeam);

    // Age as of the PUZZLE DAY. A recap published later must not disagree with
    // the tiles people played against.
    const [ageRow] = await db.execute<{ age: number }>(sql`
      SELECT extract(year FROM age(COALESCE(date_of_death, ${past}::date), date_of_birth))::int AS age
      FROM public.drivers WHERE id = ${ids[0]}
    `);
    expect(recap.target.age).toBe(ageRow.age);
  });

  it("ranks the most-guessed drivers, breaking ties on driver id", async () => {
    const recap = await getDailyRecap(past);
    if (!recap) throw new Error("expected a recap for the finished fixture day");

    // Counts across the three players: ids[1] guessed by all three; the answer
    // and ids[2] by two each; ids[3..6] by one each. `ids` is ascending, so the
    // ORDER BY cnt DESC, gid ASC tie-break puts the answer (ids[0]) ahead of
    // ids[2] on their shared count of 2 -- which is the assertion that would
    // fail if the tie-break were dropped and the same day started rendering two
    // different images.
    expect(recap.topGuesses.map((guess) => guess.driverId)).toEqual([
      ids[1],
      ids[0],
      ids[2],
      ids[3],
      ids[4],
    ]);
    expect(recap.topGuesses.map((guess) => guess.count)).toEqual([3, 2, 2, 1, 1]);
    expect(recap.topGuesses[0].share).toBeCloseTo(1, 10);
    expect(recap.topGuesses[1].share).toBeCloseTo(2 / 3, 10);
    expect(recap.topGuesses).toHaveLength(5);
  });

  it("names the most common opening guess", async () => {
    const recap = await getDailyRecap(past);
    if (!recap) throw new Error("expected a recap for the finished fixture day");

    // Two of the three players opened on ids[1]; the third opened on ids[2].
    // The opener is the FIRST guess only, so this is deliberately a different
    // number from ids[1]'s top-guesses count of 3 -- conflating the two would
    // report "most players started with X" from a driver most of them reached
    // on their third try.
    const [opener] = await db
      .select({ fullName: drivers.fullName })
      .from(drivers)
      .where(eq(drivers.id, ids[1]));
    expect(recap.commonOpener).toEqual({ fullName: opener.fullName, count: 2 });
  });

  // THE SECURITY ASSERTION. A day that has not finished must not be publishable
  // through this path, because publishing it publishes the answer.
  it("refuses a day that has not finished, even with a pinned target and full progress", async () => {
    // Same fixture as `past`, on a day the database clock says is still ahead.
    // Delete the `t.date < today` comparison and this comes back populated.
    expect(await getDailyRecap(future)).toBeNull();
  });

  it("refuses today", async () => {
    expect(await getDailyRecap(today)).toBeNull();
  });

  it("returns null for a date with no puzzle, and for a malformed one", async () => {
    expect(await getDailyRecap(await dbDate(-1200))).toBeNull();
    // Well-formed and non-existent: this would raise inside Postgres rather
    // than return no rows, so it has to be refused before the query runs.
    expect(await getDailyRecap("2026-02-31")).toBeNull();
    expect(await getDailyRecap("nonsense")).toBeNull();
  });

  // --- The archive index and its cross-links (Pass 3) ---------------------
  //
  // The date boundary is the reason these are here at all. Four functions now
  // publish finished days, and each one is a way to ask "what was the answer on
  // date X"; a guard that holds in getDailyRecap and not in listArchiveDays
  // would put today's answer on the index page, in the sitemap, and in the
  // prev/next link off yesterday.

  it("keeps the future fixture day out of every archive listing", async () => {
    const [evidence, days, latest] = await Promise.all([
      listArchiveDayEvidence(),
      listArchiveDays(500, 0),
      getLatestArchiveDate(),
    ]);
    const dates = evidence.map((day) => day.date);

    expect(dates).toContain(past);
    expect(dates).not.toContain(future);
    expect(dates).not.toContain(today);

    expect(days.map((day) => day.date)).toContain(past);
    expect(days.map((day) => day.date)).not.toContain(future);

    // max() over the same guarded set, so a boundary that slipped here would
    // point the finished daily board straight at an unfinished day.
    if (latest !== null) expect(latest < today).toBe(true);
  });

  it("lists days newest first, with each day's own numbers", async () => {
    const days = await listArchiveDays(500, 0);
    const dates = days.map((day) => day.date);
    expect([...dates].sort().reverse()).toEqual(dates);

    const fixture = days.find((day) => day.date === past);
    if (!fixture) throw new Error("the finished fixture day is missing from the index");
    expect(fixture.players).toBe(3);
    expect(fixture.completed).toBe(3);
    expect(fixture.solved).toBe(2);
    expect(fixture.puzzleNumber).toBe(getDailyPuzzleNumber(past));
  });

  it("counts the same days it lists", async () => {
    const [total, all] = await Promise.all([countArchiveDays(), listArchiveDayEvidence()]);
    expect(total).toBe(all.length);
  });

  it("pages without dropping or repeating a day", async () => {
    const all = (await listArchiveDayEvidence()).map((day) => day.date);
    if (all.length < 3) throw new Error("needs at least three finished days to page through");

    const [first, second] = await Promise.all([listArchiveDays(2, 0), listArchiveDays(2, 2)]);
    expect(first.map((day) => day.date)).toEqual(all.slice(0, 2));
    expect(second.map((day) => day.date)).toEqual(all.slice(2, 4));
  });

  // The sitemap decides which day pages to advertise from THIS count, and the
  // day page decides its own `noindex` from the same predicate over its own
  // recap. Both readings therefore have to agree about the same day, and this
  // is the query half of that: a `completed` that came back wrong here would
  // advertise a URL that serves noindex, which is the one contradiction the
  // gate exists to avoid. See lib/recap/dayEligibility.ts.
  it("reports each day's completed-board count, which is what decides indexability", async () => {
    const evidence = await listArchiveDayEvidence();

    const fixture = evidence.find((day) => day.date === past);
    if (!fixture) throw new Error("the finished fixture day is missing from the evidence");
    expect(fixture.completed).toBe(3);
    expect(isArchiveDayIndexable(fixture)).toBe(true);

    // The other direction, which is the case that actually removed 13 URLs: a
    // finished day nobody played is real, listed, and not offered to the index.
    expect(isArchiveDayIndexable({ date: past, completed: 0 })).toBe(false);
  });

  it("links a day to its finished neighbours and to nothing beyond them", async () => {
    const context = await getArchiveDayContext(past);
    if (!context) throw new Error("expected a context for the finished fixture day");

    const all = (await listArchiveDayEvidence()).map((day) => day.date);
    const older = all.filter((date) => date < past);
    const newer = all.filter((date) => date > past);

    expect(context.previousDate).toBe(older[0] ?? null);
    // `all` is newest-first, so the nearest newer day is the LAST of that slice.
    expect(context.nextDate).toBe(newer[newer.length - 1] ?? null);
    if (context.nextDate) expect(context.nextDate < today).toBe(true);
  });

  it("averages the other days' solve rates, never its own", async () => {
    const context = await getArchiveDayContext(past);
    if (!context) throw new Error("expected a context for the finished fixture day");

    // The fixture day is 2/3. If it were included in its own average the two
    // would move together; excluding it is what makes "harder than usual"
    // mean anything while the archive is small.
    expect(context.comparableDays).toBeGreaterThanOrEqual(1);
    if (context.averageSolveRate !== null) {
      expect(context.averageSolveRate).toBeGreaterThanOrEqual(0);
      expect(context.averageSolveRate).toBeLessThanOrEqual(1);
    }

    const [pooled] = await db.execute<{ rate: number | null; days: number }>(sql`
      SELECT avg(rate)::float8 AS rate, count(*)::int AS days FROM (
        SELECT (count(*) FILTER (WHERE p.won))::float8
                 / NULLIF((count(*) FILTER (WHERE p.completed))::float8, 0) AS rate
        FROM public.daily_progress p
        JOIN public.daily_targets t ON t.date = p.date
        WHERE p.date <> ${past}::date
          AND p.date < (now() AT TIME ZONE 'utc')::date
        GROUP BY p.date
      ) s WHERE rate IS NOT NULL
    `);
    expect(context.comparableDays).toBe(pooled.days);
    if (pooled.rate === null) expect(context.averageSolveRate).toBeNull();
    else expect(context.averageSolveRate).toBeCloseTo(pooled.rate, 10);
  });

  it("refuses a context for an unfinished or malformed date", async () => {
    // getArchiveDayContext validates the shape but does NOT gate the day
    // itself -- the page never reaches it, because getDailyRecap has already
    // 404'd. What it must not do is leak a neighbour that is not finished.
    expect(await getArchiveDayContext("2026-02-31")).toBeNull();
    const context = await getArchiveDayContext(future);
    if (context?.nextDate) expect(context.nextDate < today).toBe(true);
  });

  it("reports a finished day with no players at all", async () => {
    const empty = await dbDate(-401);
    await db.insert(dailyTargets).values({ date: empty, driverId: ids[0] });
    try {
      const recap = await getDailyRecap(empty);
      if (!recap) throw new Error("a pinned finished day should still have a recap");
      expect(recap.players).toBe(0);
      expect(recap.completed).toBe(0);
      // Not NaN: solveRate divides by `completed`, which is zero here.
      expect(recap.solveRate).toBe(0);
      expect(recap.averageGuesses).toBeNull();
      expect(recap.distribution).toEqual([0, 0, 0, 0, 0, 0]);
      expect(recap.topGuesses).toEqual([]);
      expect(recap.commonOpener).toBeNull();
    } finally {
      await db.delete(dailyTargets).where(and(eq(dailyTargets.date, empty)));
    }
  });

  // ---------------------------------------------------------------------
  // Driver pages (Pass 6). Same two fixture days, and they are exactly the
  // pair this needs: the driver is the answer on both, one has finished and
  // one has not.
  //
  // THE FUTURE-DAY ASSERTION IS THE SECURITY ONE. A driver page lists the days
  // its subject was the answer, so a missing boundary in either query publishes
  // TODAY'S answer on a cached, indexable page under the driver's own name --
  // the worst leak available in this codebase, and one with no symptom. Both
  // entry points are checked against a fully populated future day rather than
  // against "today", for the reason in this file's header.

  async function fixtureSlug(): Promise<string> {
    const [row] = await db
      .select({ slug: drivers.f1dbId })
      .from(drivers)
      .where(eq(drivers.id, ids[0]));
    if (!row?.slug) {
      throw new Error(
        `fixture driver ${ids[0]} has no f1db_id, so it has no driver-page URL -- ` +
          "run `npm run db:seed:commit` against this database before the database tier.",
      );
    }
    return row.slug;
  }

  it("gives a driver their finished appearances and never an unfinished one", async () => {
    const driver = await getDriverPage(await fixtureSlug());
    if (!driver) throw new Error("expected a page for the fixture driver");

    const dates = driver.appearances.map((appearance) => appearance.date);
    expect(dates).toContain(past);
    expect(dates).not.toContain(future);
    expect(dates).not.toContain(today);

    const day = driver.appearances.find((appearance) => appearance.date === past);
    expect(day).toMatchObject({ players: 3, completed: 3, solved: 2 });
    expect(day?.puzzleNumber).toBe(getDailyPuzzleNumber(past));
  });

  it("carries the career fields the page and the JSON-LD render", async () => {
    const slug = await fixtureSlug();
    const driver = await getDriverPage(slug);
    if (!driver) throw new Error("expected a page for the fixture driver");

    const [row] = await db
      .select({
        fullName: drivers.fullName,
        nationality: drivers.nationality,
        debutYear: drivers.debutYear,
        lastActiveYear: drivers.lastActiveYear,
        careerWins: drivers.careerWins,
        podiums: drivers.podiums,
        polePositions: drivers.polePositions,
        championshipWins: drivers.championshipWins,
        previousTeams: drivers.previousTeams,
      })
      .from(drivers)
      .where(eq(drivers.id, ids[0]));

    expect(driver.slug).toBe(slug);
    expect(driver).toMatchObject(row);
    expect(driver.teams).toEqual(row.previousTeams);
    // A `YYYY-MM-DD` string, not a Date: it goes straight into Person JSON-LD's
    // birthDate, where a serialized Date would be an ISO instant in whatever
    // zone the server runs in.
    expect(driver.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns null for a slug that names nobody", async () => {
    expect(await getDriverPage("not-a-real-driver-slug")).toBeNull();
    expect(await getDriverPage("")).toBeNull();
  });

  it("lists the fixture driver as evidence, without the unfinished day", async () => {
    const slug = await fixtureSlug();
    const evidence = await listDriverArchiveEvidence();
    const entry = evidence.find((driver) => driver.slug === slug);
    if (!entry) throw new Error("expected the fixture driver in the evidence list");

    const dates = entry.appearances.map((appearance) => appearance.date);
    expect(dates).toContain(past);
    expect(dates).not.toContain(future);

    // Newest first within a driver, which is the order the page renders and the
    // order the metadata's "most recently" reads off.
    expect([...dates].sort().reverse()).toEqual(dates);

    // Every entry has a usable URL segment: the query filters f1db_id IS NOT
    // NULL, and a null here would be a page at /drivers/null.
    for (const driver of evidence) expect(driver.slug).toBeTruthy();
  });

  it("agrees with the predicate about who gets a page", async () => {
    // The two halves of the gate, checked against each other on real rows: the
    // sitemap and generateStaticParams filter the evidence list with this
    // predicate, and the route 404s on the same predicate over getDriverPage's
    // appearances. If those two ever disagree the sitemap lists a 404.
    const slug = await fixtureSlug();
    const evidence = await listDriverArchiveEvidence();
    const entry = evidence.find((driver) => driver.slug === slug);
    const driver = await getDriverPage(slug);
    if (!entry || !driver) throw new Error("expected the fixture driver from both queries");

    expect(isDriverPageEligible(entry.appearances)).toBe(true);
    expect(isDriverPageEligible(driver.appearances)).toBe(true);
  });
});
