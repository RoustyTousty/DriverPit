import { sql } from "drizzle-orm";

import type { DriverAppearance } from "../drivers/pageEligibility";
import { getDailyPuzzleNumber } from "../game/dailySelection";
import type { ArchiveDayEvidence } from "../recap/dayEligibility";
import { isUtcDateString } from "../recap/format";
import { db } from "./index";

// Everything a finished day has to say about itself, assembled from rows that
// already exist -- `daily_progress.guesses` is the ordered int[] of every guess
// every player made that day, and it has been recorded since drizzle/0029.
// Nothing new is written for the recap.
//
// WHY THIS IS A PLAIN QUERY AND NOT AN RPC. Both consumers (the recap image
// route, and Pass 3's archive page) are server-side, so this runs on the
// trusted Drizzle connection, which bypasses RLS. A SECURITY DEFINER function
// would need a grant decision declared in lib/db/schemaGrants.test.ts and would
// then be one PostgREST call away from the browser -- a client-callable
// "everything about a day" endpoint whose only defence against leaking a live
// day would be the date check inside it. A query the browser cannot reach has
// no such surface.
//
// THE DATE CHECK IS STILL THE SECURITY BOUNDARY, and it is in SQL on purpose.
// `t.date < (now() AT TIME ZONE 'utc')::date` compares against the DATABASE
// clock -- the same clock daily_submit_guess resolves the UTC day from. Doing
// it in Node would introduce a second clock, and a server whose time is a few
// minutes fast would publish today's answer to everyone for those minutes. See
// CLAUDE.md "Daily persistence & sync": the day's driver is a secret until the
// day is over, and this is the one code path whose whole job is to hand it out.

// ONE definition of the boundary, embedded by every query in this file. Six
// entry points now publish finished days (the recap, the archive index, the
// sitemap, the prev/next links, and the two driver-page queries) and each one is
// a way to ask about a day; a second spelling of "which days are over" is a
// second thing to get wrong, and the failure mode is publishing today's answer
// rather than an error.
//
// The driver-page queries are the sharpest case in the set: a driver page lists
// the days that driver was the answer, so a missing boundary there would name
// TODAY'S driver on a cached, indexable page — the whole secret, published,
// with nothing erroring.
const UTC_TODAY = sql`(now() AT TIME ZONE 'utc')::date`;

export interface DailyRecapTarget {
  id: number;
  /**
   * `drivers.f1db_id`, so the archive day can link to the driver's own page.
   *
   * Nullable for the same reason the column is: rows imported before
   * drizzle/0043 have no slug, and the slug IS the URL. A null means no link,
   * never a link to `/drivers/null`.
   */
  slug: string | null;
  fullName: string;
  // Nullable, unlike the sketch in docs/seo-roadmap.md: `drivers.driver_code`
  // is nullable and coverage is not guaranteed across the historical roster,
  // so the board's own DriverCodeBadge already renders "—" for it.
  driverCode: string | null;
  nationality: string;
  lastTeam: string | null;
  age: number;
  debutYear: number;
  careerWins: number;
}

export interface DailyRecapGuess {
  driverId: number;
  fullName: string;
  /** Distinct players who guessed this driver at any point in the day. */
  count: number;
  /** `count / players`, i.e. the share of that day's players who guessed them. */
  share: number;
}

export interface DailyRecap {
  /** UTC day, `YYYY-MM-DD`. */
  date: string;
  puzzleNumber: number;
  target: DailyRecapTarget;
  /** Distinct players with a `daily_progress` row, i.e. who made at least one guess. */
  players: number;
  completed: number;
  solved: number;
  /** `solved / completed`, 0 when nobody finished. */
  solveRate: number;
  /** Mean guess count over SOLVED games only; null when nobody solved it. */
  averageGuesses: number | null;
  /** Length 6. Index 0 is "solved in 1". */
  distribution: number[];
  /** Top 5 most-guessed drivers, the answer included if it ranks. */
  topGuesses: DailyRecapGuess[];
  commonOpener: { fullName: string; count: number } | null;
}

// The row the query below returns, snake_case as Postgres emits it. Typed
// separately from DailyRecap because the two genuinely differ: this has no
// puzzle number (pure, computed in TS) and its target fields are flat.
//
// A `type` and not an `interface`: db.execute<T> constrains T to
// Record<string, unknown>, and TypeScript hands an implicit index signature to
// an object type alias but never to an interface.
type RecapRow = {
  id: number;
  slug: string | null;
  full_name: string;
  driver_code: string | null;
  nationality: string;
  last_team: string | null;
  age: number;
  debut_year: number;
  career_wins: number;
  players: number;
  completed: number;
  solved: number;
  solve_rate: number;
  average_guesses: number | null;
  distribution: number[];
  top_guesses: DailyRecapGuess[];
  common_opener: { fullName: string; count: number } | null;
};

/**
 * The recap for one finished UTC day, or `null` if there is nothing to publish.
 *
 * `null` covers three cases deliberately, because every one of them is a 404 to
 * the caller and none of them should be distinguishable from outside: the date
 * is malformed, no puzzle was ever pinned for it, or **the day is not over**.
 * Telling those apart would turn this into an oracle for "is there a puzzle
 * today", which is not information worth spending a branch on.
 */
export async function getDailyRecap(date: string): Promise<DailyRecap | null> {
  // Rejected here rather than in SQL because Postgres raises on `'2026-02-31'`
  // instead of returning no rows, and a 500 is the wrong answer to a bad URL.
  if (!isUtcDateString(date)) return null;

  const rows = await db.execute<RecapRow>(sql`
    WITH target AS (
      SELECT
        d.id,
        d.f1db_id AS slug,
        d.full_name,
        d.driver_code,
        d.nationality,
        NULLIF(d.last_team, '') AS last_team,
        -- Age AS OF THE PUZZLE DAY, not today: this is the number the tiles
        -- showed that day, and a recap published later must not quietly
        -- disagree with the board people played. Same expression daily_state
        -- uses (drizzle/0030), with the day substituted for now().
        extract(year FROM age(COALESCE(d.date_of_death, t.date), d.date_of_birth))::int AS age,
        d.debut_year,
        d.career_wins
      FROM public.daily_targets t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.date = ${date}::date
        AND t.date < ${UTC_TODAY}
    ),
    -- Everything below hangs off the target CTE, so the date guard above is the only
    -- place it has to be enforced: an unfinished or unknown day empties this
    -- CTE, the final CROSS JOIN yields no rows, and the function returns null.
    prog AS (
      SELECT
        p.user_id,
        p.guesses,
        p.completed,
        COALESCE(p.won, false) AS won,
        COALESCE(array_length(p.guesses, 1), 0) AS guess_count
      FROM public.daily_progress p
      WHERE p.date = ${date}::date
        AND EXISTS (SELECT 1 FROM target)
    ),
    totals AS (
      SELECT
        count(*)::int AS players,
        (count(*) FILTER (WHERE completed))::int AS completed,
        (count(*) FILTER (WHERE won))::int AS solved,
        avg(guess_count) FILTER (WHERE won) AS avg_guesses
      FROM prog
    ),
    -- generate_series, not a GROUP BY over the data, so the array is always
    -- length 6 with real zeros in the empty buckets rather than a short array
    -- the card would have to pad.
    dist AS (
      SELECT array_agg(COALESCE(c.cnt, 0) ORDER BY n.n) AS d
      FROM generate_series(1, 6) AS n(n)
      LEFT JOIN (
        SELECT guess_count AS gc, count(*)::int AS cnt
        FROM prog WHERE won GROUP BY 1
      ) c ON c.gc = n.n
    ),
    -- DISTINCT (player, driver), so the count means "players who guessed them"
    -- rather than "times guessed". Those are the same number for any row
    -- written since drizzle/0049 made a repeat guess a rejection, but rows
    -- predating it can hold a duplicate, and a share above 100% is the kind of
    -- error nobody would think to look for.
    guess_players AS (
      SELECT DISTINCT p.user_id, g.gid
      FROM prog p, unnest(p.guesses) AS g(gid)
    ),
    -- Ties break on driver id, not arbitrarily. Without it the same finished
    -- day renders two different images on two requests, which is both a
    -- caching bug and a credibility one.
    top_guesses AS (
      SELECT gp.gid, count(*)::int AS cnt
      FROM guess_players gp
      GROUP BY gp.gid
      ORDER BY cnt DESC, gp.gid ASC
      LIMIT 5
    ),
    opener AS (
      SELECT p.guesses[1] AS gid, count(*)::int AS cnt
      FROM prog p
      WHERE p.guesses[1] IS NOT NULL
      GROUP BY 1
      ORDER BY cnt DESC, 1 ASC
      LIMIT 1
    )
    SELECT
      t.id, t.slug, t.full_name, t.driver_code, t.nationality, t.last_team,
      t.age, t.debut_year, t.career_wins,
      tot.players, tot.completed, tot.solved,
      CASE WHEN tot.completed = 0 THEN 0::float8
           ELSE tot.solved::float8 / tot.completed END AS solve_rate,
      CASE WHEN tot.solved = 0 THEN NULL
           ELSE tot.avg_guesses::float8 END AS average_guesses,
      dist.d AS distribution,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'driverId', tg.gid,
                 'fullName', d2.full_name,
                 'count', tg.cnt,
                 'share', CASE WHEN tot.players = 0 THEN 0::float8
                               ELSE tg.cnt::float8 / tot.players END
               ) ORDER BY tg.cnt DESC, tg.gid ASC)
        FROM top_guesses tg
        JOIN public.drivers d2 ON d2.id = tg.gid
      ), '[]'::jsonb) AS top_guesses,
      (
        SELECT jsonb_build_object('fullName', d3.full_name, 'count', o.cnt)
        FROM opener o JOIN public.drivers d3 ON d3.id = o.gid
      ) AS common_opener
    FROM target t
    CROSS JOIN totals tot
    CROSS JOIN dist
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    date,
    // Safe to compute in TypeScript and safe to publish: the puzzle NUMBER says
    // which day it is, never who the driver is. lib/game/dailySelection.ts is
    // the long version of why nothing else about the answer may be derivable.
    puzzleNumber: getDailyPuzzleNumber(date),
    target: {
      id: row.id,
      slug: row.slug,
      fullName: row.full_name,
      driverCode: row.driver_code,
      nationality: row.nationality,
      lastTeam: row.last_team,
      age: row.age,
      debutYear: row.debut_year,
      careerWins: row.career_wins,
    },
    players: row.players,
    completed: row.completed,
    solved: row.solved,
    solveRate: row.solve_rate,
    averageGuesses: row.average_guesses,
    distribution: row.distribution,
    topGuesses: row.top_guesses,
    commonOpener: row.common_opener,
  };
}

// ---------------------------------------------------------------------------
// The archive: the same finished days, listed and cross-linked.
//
// These live beside getDailyRecap rather than in an archive.ts of their own so
// that every query carrying the UTC_TODAY boundary sits under the comment that
// explains it. Splitting the file would put three of the four out of sight of
// the rule they exist to obey.
// ---------------------------------------------------------------------------

export interface ArchiveDaySummary {
  date: string;
  puzzleNumber: number;
  targetName: string;
  targetCode: string | null;
  players: number;
  completed: number;
  solved: number;
}

type ArchiveDayRow = {
  date: string;
  full_name: string;
  driver_code: string | null;
  players: number;
  completed: number;
  solved: number;
};

/** One page of finished days, newest first. */
export async function listArchiveDays(limit: number, offset: number): Promise<ArchiveDaySummary[]> {
  const rows = await db.execute<ArchiveDayRow>(sql`
    WITH days AS (
      SELECT t.date, t.driver_id
      FROM public.daily_targets t
      WHERE t.date < ${UTC_TODAY}
      ORDER BY t.date DESC
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT
      days.date::text AS date,
      d.full_name,
      d.driver_code,
      (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = days.date) AS players,
      (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = days.date AND p.completed) AS completed,
      (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = days.date AND p.won) AS solved
    FROM days
    JOIN public.drivers d ON d.id = days.driver_id
    ORDER BY days.date DESC
  `);

  return rows.map((row) => ({
    date: row.date,
    puzzleNumber: getDailyPuzzleNumber(row.date),
    targetName: row.full_name,
    targetCode: row.driver_code,
    players: row.players,
    completed: row.completed,
    solved: row.solved,
  }));
}

/** How many finished days exist, for the index's pagination. */
export async function countArchiveDays(): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM public.daily_targets WHERE date < ${UTC_TODAY}
  `);
  return row?.n ?? 0;
}

/**
 * Every finished day with the one number that decides whether it is indexable,
 * newest first — the sitemap's archive entries.
 *
 * It returns the count rather than applying the threshold, and that is the same
 * split `listDriverArchiveEvidence` makes for the same reason: the rule lives in
 * `lib/recap/dayEligibility.ts` where a person can read it and argue with it, and
 * it is applied by BOTH callers that need it (this file's consumer in the
 * sitemap, and the day page's own `generateMetadata`). A `HAVING completed > 0`
 * here would be a second definition of the rule, in SQL, that the page could
 * silently disagree with — and the symptom would be a sitemap advertising URLs
 * that serve `noindex`.
 */
export async function listArchiveDayEvidence(): Promise<ArchiveDayEvidence[]> {
  const rows = await db.execute<{ date: string; completed: number }>(sql`
    SELECT
      t.date::text AS date,
      (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = t.date AND p.completed) AS completed
    FROM public.daily_targets t
    WHERE t.date < ${UTC_TODAY}
    ORDER BY t.date DESC
  `);
  return rows.map((row) => ({ date: row.date, completed: row.completed }));
}

/**
 * The newest finished day, or null.
 *
 * Read server-side by the daily page (`/`) so the finished board can link to a recap that
 * is known to exist. Computing "yesterday" on the client instead would link to
 * a 404 on any day nobody played, and would do it from the client's clock.
 */
export async function getLatestArchiveDate(): Promise<string | null> {
  const [row] = await db.execute<{ date: string | null }>(sql`
    SELECT max(date)::text AS date FROM public.daily_targets WHERE date < ${UTC_TODAY}
  `);
  return row?.date ?? null;
}

export interface ArchiveDayContext {
  /** The finished day before this one, for the prev link. */
  previousDate: string | null;
  /** The finished day after it. Null on the newest archived day. */
  nextDate: string | null;
  /**
   * Mean of the per-day solve rates across every OTHER finished day that had at
   * least one completed board.
   *
   * A mean of rates, not a pooled rate: the question the summary asks is "was
   * this day harder than a typical day", and pooling lets one busy day set the
   * baseline for all the others. It excludes the day being described, because
   * comparing a day against an average that contains it flattens exactly the
   * difference being reported — badly so while the archive is small.
   */
  averageSolveRate: number | null;
  /** Days that average is over. Below a handful it is not worth quoting. */
  comparableDays: number;
}

type ArchiveContextRow = {
  previous_date: string | null;
  next_date: string | null;
  average_solve_rate: number | null;
  comparable_days: number;
};

export async function getArchiveDayContext(date: string): Promise<ArchiveDayContext | null> {
  if (!isUtcDateString(date)) return null;

  const rows = await db.execute<ArchiveContextRow>(sql`
    WITH finished AS (
      SELECT date FROM public.daily_targets WHERE date < ${UTC_TODAY}
    ),
    day_rates AS (
      SELECT
        p.date,
        (count(*) FILTER (WHERE p.won))::float8
          / NULLIF((count(*) FILTER (WHERE p.completed))::float8, 0) AS rate
      FROM public.daily_progress p
      JOIN finished f ON f.date = p.date
      WHERE p.date <> ${date}::date
      GROUP BY p.date
    )
    SELECT
      (SELECT max(date)::text FROM finished WHERE date < ${date}::date) AS previous_date,
      (SELECT min(date)::text FROM finished WHERE date > ${date}::date) AS next_date,
      (SELECT avg(rate)::float8 FROM day_rates WHERE rate IS NOT NULL) AS average_solve_rate,
      (SELECT count(*)::int FROM day_rates WHERE rate IS NOT NULL) AS comparable_days
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    previousDate: row.previous_date,
    nextDate: row.next_date,
    averageSolveRate: row.average_solve_rate,
    comparableDays: row.comparable_days,
  };
}

// ---------------------------------------------------------------------------
// Driver pages (roadmap Pass 6).
//
// Same file, same reason as the archive queries above: both of these list the
// finished days a driver was the answer on, so they are two more ways to ask
// "which days are over" and they belong under the comment that defines it.
//
// NEITHER OF THEM DECIDES WHO GETS A PAGE. They report evidence;
// lib/drivers/pageEligibility.ts decides. That split is deliberate — putting the
// threshold in a HAVING clause would put it in four queries at once and out of
// reach of a unit test. See that file's header for the rule and the numbers it
// was chosen against.
// ---------------------------------------------------------------------------

/** A driver's finished appearances, keyed by the slug their page lives at. */
export interface DriverArchiveEvidence {
  /** `drivers.f1db_id` — F1DB's own slug, and the URL segment verbatim. */
  slug: string;
  fullName: string;
  appearances: DriverAppearance[];
}

type DriverAppearanceRow = {
  slug: string;
  full_name: string;
  date: string;
  players: number;
  completed: number;
  solved: number;
};

/**
 * Per-day appearance rows for every driver who has ever been a finished day's
 * answer, newest day first within each driver.
 *
 * `f1db_id IS NOT NULL` is a real filter, not defensive noise: the column is
 * nullable for rows imported before drizzle/0043, and the slug IS the URL, so a
 * null would be a page at `/drivers/null`. The seed adopts those rows on its
 * next run, at which point they appear here on their own.
 *
 * Unbounded on purpose. It is one row per finished day — 14 today, ~365 a year —
 * and both callers (`generateStaticParams` and the sitemap) genuinely need all
 * of them.
 */
export async function listDriverArchiveEvidence(): Promise<DriverArchiveEvidence[]> {
  const rows = await db.execute<DriverAppearanceRow>(sql`
    SELECT
      d.f1db_id AS slug,
      d.full_name,
      t.date::text AS date,
      (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = t.date) AS players,
      (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = t.date AND p.completed) AS completed,
      (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = t.date AND p.won) AS solved
    FROM public.daily_targets t
    JOIN public.drivers d ON d.id = t.driver_id
    WHERE t.date < ${UTC_TODAY}
      AND d.f1db_id IS NOT NULL
    ORDER BY d.f1db_id, t.date DESC
  `);

  const bySlug = new Map<string, DriverArchiveEvidence>();
  for (const row of rows) {
    const existing = bySlug.get(row.slug);
    const appearance: DriverAppearance = {
      date: row.date,
      puzzleNumber: getDailyPuzzleNumber(row.date),
      players: row.players,
      completed: row.completed,
      solved: row.solved,
    };
    if (existing) existing.appearances.push(appearance);
    else bySlug.set(row.slug, { slug: row.slug, fullName: row.full_name, appearances: [appearance] });
  }
  return [...bySlug.values()];
}

export interface DriverPage {
  slug: string;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  /** Age today, or age at death for a driver who has died. */
  age: number;
  /** `YYYY-MM-DD`. The page shows an age; the JSON-LD wants the date, which does not go stale. */
  dateOfBirth: string;
  /** `YYYY-MM-DD`, or null. Non-null is also what makes `age` an age at death. */
  dateOfDeath: string | null;
  debutYear: number;
  lastActiveYear: number;
  careerWins: number;
  podiums: number;
  polePositions: number;
  championshipWins: number;
  lastTeam: string | null;
  /** Every constructor they raced for, current team included. */
  teams: string[];
  /** Finished days they were the answer on, newest first. */
  appearances: DriverAppearance[];
}

type DriverPageRow = {
  slug: string;
  full_name: string;
  driver_code: string | null;
  nationality: string;
  age: number;
  date_of_birth: string;
  date_of_death: string | null;
  debut_year: number;
  last_active_year: number;
  career_wins: number;
  podiums: number;
  pole_positions: number;
  championship_wins: number;
  last_team: string | null;
  teams: string[];
  // No `puzzleNumber`: it is a pure function of the date, so the database is not
  // asked for it and this type must not claim it was.
  appearances: Omit<DriverAppearance, "puzzleNumber">[] | null;
};

/**
 * Everything one driver's page renders, or `null` if the slug names nobody.
 *
 * It does NOT apply the eligibility rule — the caller does, on the appearances
 * this returns, so that "no such driver" and "not worth a page" are one 404 at
 * one call site rather than a rule spread across a query and a component.
 *
 * `age` is computed in SQL against the database clock for the same reason every
 * other date here is: it is the only clock this app treats as authoritative, and
 * an age that disagrees with the board's by a day on somebody's birthday is a
 * small wrong answer on a cached page.
 */
export async function getDriverPage(slug: string): Promise<DriverPage | null> {
  const rows = await db.execute<DriverPageRow>(sql`
    SELECT
      d.f1db_id AS slug,
      d.full_name,
      d.driver_code,
      d.nationality,
      extract(year FROM age(COALESCE(d.date_of_death, ${UTC_TODAY}), d.date_of_birth))::int AS age,
      -- ::text on both, like every other date in this file: postgres.js hands a
      -- date column back as a JS Date, and what the page and the JSON-LD both
      -- want is the calendar day as written, with no timezone to shift it.
      d.date_of_birth::text,
      d.date_of_death::text,
      d.debut_year,
      d.last_active_year,
      d.career_wins,
      d.podiums,
      d.pole_positions,
      d.championship_wins,
      NULLIF(d.last_team, '') AS last_team,
      d.previous_teams AS teams,
      (
        SELECT jsonb_agg(a ORDER BY a.date DESC)
        FROM (
          SELECT
            t.date::text AS date,
            (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = t.date) AS players,
            (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = t.date AND p.completed) AS completed,
            (SELECT count(*)::int FROM public.daily_progress p WHERE p.date = t.date AND p.won) AS solved
          FROM public.daily_targets t
          WHERE t.driver_id = d.id
            AND t.date < ${UTC_TODAY}
        ) a
      ) AS appearances
    FROM public.drivers d
    WHERE d.f1db_id = ${slug}
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    slug: row.slug,
    fullName: row.full_name,
    driverCode: row.driver_code,
    nationality: row.nationality,
    age: row.age,
    dateOfBirth: row.date_of_birth,
    dateOfDeath: row.date_of_death,
    debutYear: row.debut_year,
    lastActiveYear: row.last_active_year,
    careerWins: row.career_wins,
    podiums: row.podiums,
    polePositions: row.pole_positions,
    championshipWins: row.championship_wins,
    lastTeam: row.last_team,
    teams: row.teams,
    // The puzzle number is pure, so it is added here rather than asked of the
    // database — same split as getDailyRecap.
    appearances: (row.appearances ?? []).map((appearance) => ({
      ...appearance,
      puzzleNumber: getDailyPuzzleNumber(appearance.date),
    })),
  };
}
