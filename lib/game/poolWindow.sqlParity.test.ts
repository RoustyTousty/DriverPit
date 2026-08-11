import "dotenv/config";

import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../db";
import { dailyTargets } from "../db/schema";
import { MAX_GUESSES } from "./constants";
import { DAILY_POOL_WINDOW, poolCutoffYear } from "./poolWindow";

// The guard audit 2026-07-29 §2.5 asks for by name, and the last of the four
// TS<->plpgsql duplications to get one.
//
// WHAT GOES WRONG WITHOUT IT. `DAILY_POOL_WINDOW`'s cutoff is a TypeScript
// constant that decides which drivers the browser will autocomplete, and a
// hardcoded year offset (`- 20` since drizzle/0052, `- 10` before it) inside
// three live plpgsql functions -- two that decide which
// driver is the ANSWER (daily_target_id for the day's target, duel_begin_round
// for each duel round's) and one that decides which driver is a legal GUESS
// (daily_submit_guess, drizzle/0051). Change the constant and only the
// autocomplete moves: the target keeps coming from the old window, so the daily page can
// serve a driver the player cannot type, and the guess check refuses one it
// does offer. Nothing errors, nothing looks broken, and it is unreportable as a
// bug. The compare ladder has compare.sqlParity, the scoring weights have
// duelScoring.sqlParity; this had a keep-in-sync comment. MAX_GUESSES
// (lib/game/constants.ts) is the same shape at lower stakes and is covered here
// too, per that finding's second bullet.
//
// TWO TECHNIQUES, PICKED PER SITE:
//
//   * daily_target_id takes the date as a PARAMETER, so its cutoff can be probed
//     BEHAVIOURALLY -- ask it for a far-future day whose pool is, by the
//     TypeScript rule, exactly the newest season on the roster, and then for the
//     day after that window, whose pool must be empty. Those two bracket the
//     cutoff year from both sides with no string matching at all, and they
//     survive any rewrite of the function.
//   * The others read `now()` or a pool window argument, so there is no probe
//     that isolates the constant. They get the duelScoring.sqlParity treatment
//     instead: the expression is EXTRACTED FROM pg_get_functiondef() and
//     EXECUTED, so what these assertions check is the live definition rather
//     than a transcription of it that a future migration could leave behind.
//
// Requires a real Postgres connection -- skipped by default so `npm test` stays
// instant/offline, opt in with:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/game/poolWindow.sqlParity.test.ts
// Writes nothing but two probe rows in daily_targets, both deleted in afterAll.
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

// pg_get_functiondef returns the body as stored, comments included -- and the
// comments at these very sites discuss the literals being matched ("keep the
// '- 10' in sync with lib/game/poolWindow.ts"). Strip line comments first so an
// extraction can never succeed against prose. Safe here because no function in
// this schema has a string literal containing `--` (the empty-team placeholder
// is an em dash, one character).
function withoutComments(src: string): string {
  return src.replace(/--[^\n]*/g, "");
}

// `signature` is spliced in rather than bound: `::regprocedure` needs a literal
// it can resolve at parse time, and these are five constants in this file.
async function functionSource(signature: string): Promise<string> {
  const [row] = await db.execute<{ src: string }>(
    sql.raw(`SELECT pg_get_functiondef('${signature}'::regprocedure) AS src`),
  );
  return withoutComments(row.src);
}

// Same discipline as duelScoring.sqlParity.test.ts's assignmentRhs: an
// extraction that quietly found nothing would turn the assertion below into a
// no-op, which is the exact failure mode this file exists to prevent. So it
// throws unless it matched once and only once.
function soleMatch(src: string, pattern: RegExp, what: string): string {
  const found = [...src.matchAll(pattern)].map((m) => m[1].trim());
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one ${what} in the live function, found ${found.length}. ` +
        `It has been restructured -- update this test rather than deleting it. ` +
        `Candidates: ${JSON.stringify(found)}`,
    );
  }
  return found[0];
}

// Runs a fragment of plpgsql as a plain expression. `::int` rather than a bare
// select so the 'legacy' arm's NULL comes back as null, not an untyped unknown.
async function evaluate(expression: string): Promise<number | null> {
  const [row] = await db.execute<{ value: number | null }>(
    sql`SELECT (${sql.raw(expression)})::int AS value`,
  );
  return row.value;
}

describe.skipIf(!RUN)("the SQL mirrors of lib/game's pool + guess constants (integration)", () => {
  // The reference year the SQL sites use. Read from the database rather than the
  // test runner's clock: `extract(year FROM now())` is what the functions
  // themselves evaluate, and the thing under test is the offset applied to it.
  let dbYear = 0;
  const pinnedProbes = new Set<string>();

  beforeAll(async () => {
    const [row] = await db.execute<{ year: number }>(
      sql`SELECT extract(year FROM now())::int AS year`,
    );
    dbYear = row.year;
  });

  afterAll(async () => {
    if (pinnedProbes.size > 0) {
      await db.delete(dailyTargets).where(inArray(dailyTargets.date, [...pinnedProbes]));
    }
  });

  // The newest season anyone on the roster raced in. Both probes below are
  // positioned relative to it, and it is re-read per test rather than cached so
  // a suite running beside this one can't leave it stale.
  async function rosterMaxYear(): Promise<number> {
    const [row] = await db.execute<{ max_year: number | null }>(
      sql`SELECT max(last_active_year) AS max_year FROM public.drivers`,
    );
    if (row.max_year === null) {
      throw new Error("`drivers` is empty -- run `npm run db:seed` before the database tier.");
    }
    return row.max_year;
  }

  // The reference year a daily would have to fall in for DAILY_POOL_WINDOW to
  // put its cutoff exactly at `cutoff`. Derived from the TypeScript rule, so the
  // probe days move with the window if it is ever changed.
  function referenceYearFor(cutoff: number): number {
    for (let year = cutoff; year <= cutoff + 200; year += 1) {
      if (poolCutoffYear(DAILY_POOL_WINDOW, year) === cutoff) return year;
    }
    throw new Error(
      `DAILY_POOL_WINDOW is "${DAILY_POOL_WINDOW}", which has no finite cutoff, so ` +
        `"the pool is empty above year N" isn't expressible as a probe. Replace these ` +
        `two tests with whatever the new window's boundary actually is.`,
    );
  }

  // The probe day for a reference year, refused unless it is genuinely in the
  // future. These probes PIN a target and then delete the row, which is a
  // destructive thing to do to a day someone could be playing. Under the current
  // "20-years" window they land two decades out and this never triggers; under a
  // narrower window (say "current-season") referenceYearFor returns the current
  // year, and the probe would aim at a live day. Fail loudly there rather than
  // deleting a real answer out from under a board mid-guess.
  function probeDate(referenceYear: number): string {
    const date = `${referenceYear}-06-15`;
    if (date <= new Date().toISOString().slice(0, 10)) {
      throw new Error(
        `probe day ${date} is not in the future. DAILY_POOL_WINDOW is now ` +
          `"${DAILY_POOL_WINDOW}", whose cutoff is too close to the present for a ` +
          `boundary probe that pins and unpins daily_targets. Rewrite these two tests ` +
          `against a window-appropriate boundary; do NOT let them touch a live day.`,
      );
    }
    return date;
  }

  // daily_target_id is SECURITY DEFINER and pins as a side effect, so calling it
  // over the trusted connection is exactly what daily_state/daily_submit_guess
  // do for a real day.
  async function pinTarget(date: string): Promise<number> {
    pinnedProbes.add(date);
    const [row] = await db.execute<{ id: number }>(
      sql`SELECT public.daily_target_id(${date}::date) AS id`,
    );
    return row.id;
  }

  describe("the daily pool cutoff", () => {
    it("daily_target_id's pool reaches down exactly to poolCutoffYear(DAILY_POOL_WINDOW)", async () => {
      // A far-future day whose cutoff, by the TypeScript rule, lands on the
      // roster's newest season: the eligible set is precisely the drivers of
      // that season. A SQL cutoff even one year LATER than the TypeScript one
      // leaves it empty and daily_target_id raises "No puzzle is scheduled for
      // today" instead of returning.
      const newest = await rosterMaxYear();
      const eligible = await db.execute<{ id: number }>(
        sql`SELECT id FROM public.drivers WHERE last_active_year >= ${newest}`,
      );
      expect(eligible.length).toBeGreaterThan(0);

      // Resolved outside the try: probeDate's own refusal is about the test
      // being unrunnable, not about the cutoff, and must not be restated as one.
      const date = probeDate(referenceYearFor(newest));

      // The raise arrives wrapped as a generic "Failed query", which says
      // nothing about what broke. Restate it as the fact a reader needs -- but
      // only the empty-pool raise, so a dropped connection still reports itself.
      let picked: number;
      try {
        picked = await pinTarget(date);
      } catch (cause) {
        const detail = `${String(cause)} ${String((cause as { cause?: unknown }).cause)}`;
        if (!/No puzzle is scheduled/i.test(detail)) throw cause;
        throw new Error(
          `daily_target_id had no eligible driver for a day whose cutoff is ${newest} by ` +
            `DAILY_POOL_WINDOW, though ${eligible.length} driver(s) sit at or above that ` +
            `season. Its own cutoff (drizzle/0038) is LATER than lib/game/poolWindow.ts's, ` +
            `so the daily answer comes from a NARROWER pool than the board autocompletes.`,
          { cause },
        );
      }
      expect(eligible.map((r) => r.id)).toContain(picked);
    });

    it("...and no further: one year past it, the pool is empty", async () => {
      // The other side of the bracket. No row can carry a last_active_year above
      // the roster's newest season, so this day has no eligible driver at all --
      // unless the SQL cutoff is EARLIER than the TypeScript one, in which case
      // the season below sneaks in and a target comes back.
      const newest = await rosterMaxYear();
      const date = probeDate(referenceYearFor(newest + 1));

      let picked: number | undefined;
      try {
        picked = await pinTarget(date);
      } catch (err) {
        // The pool was empty, as DAILY_POOL_WINDOW says it must be -- but only
        // if that is WHY it threw. Drizzle wraps the raise as a generic "Failed
        // query" and keeps the plpgsql message on `cause`, so a dropped
        // connection would otherwise pass this test silently.
        const detail = `${String(err)} ${String((err as { cause?: unknown }).cause)}`;
        expect(detail).toMatch(/No puzzle is scheduled/i);
        return;
      }
      throw new Error(
        `daily_target_id returned driver ${picked} for a day whose pool is empty by ` +
          `DAILY_POOL_WINDOW (its cutoff, ${newest + 1}, is past the newest season on ` +
          `the roster). Its own cutoff (drizzle/0038) is EARLIER than ` +
          `lib/game/poolWindow.ts's, so the daily answer comes from a WIDER pool than ` +
          `the board autocompletes -- an unguessable answer.`,
      );
    });

    it("duel_begin_round picks each round's target from the same window", async () => {
      // The second live site, and the one with no behavioural probe: it reads
      // now(), so every round it stamps uses the current cutoff and there is no
      // date to aim at. Its `last_active_year >=` bound is executed as written.
      const src = await functionSource("public.duel_begin_round(integer,integer)");
      const bound = soleMatch(src, /last_active_year\s*>=\s*([^\n]+)/g, "`last_active_year >=` bound");

      expect(await evaluate(bound)).toBe(poolCutoffYear(DAILY_POOL_WINDOW, dbYear));
    });

    it("daily_submit_guess validates a guess against that same cutoff", async () => {
      // The third site (drizzle/0051, audit 2026-07-30 §3.9 residual), and the
      // only one that uses the cutoff to REJECT rather than to pick. Drift here
      // is quieter than the other two and points the opposite way: a SQL cutoff
      // stricter than the TypeScript one refuses a driver the board offered, and
      // one looser re-opens the whole roster the check was added to close.
      //
      // Extraction rather than a probe because it resolves its own day from
      // now(), same as duel_begin_round -- v_today is substituted with a literal
      // so the assertion is timezone-proof rather than depending on the database
      // session's zone matching UTC on the day it runs.
      const src = await functionSource("public.daily_submit_guess(integer)");
      const cutoff = soleMatch(
        src,
        /\bv_pool_cutoff_year\s+constant\s+integer\s*:=\s*([^;]+);/g,
        "`v_pool_cutoff_year` declaration",
      );

      expect(await evaluate(cutoff.replaceAll("v_today", `'${dbYear}-06-15'::date`))).toBe(
        poolCutoffYear(DAILY_POOL_WINDOW, dbYear),
      );
    });
  });

  // Infinite used to mirror this whole ladder in infinite_start_round, and had
  // two assertions here to prove it. drizzle/0053 replaced that mode's pool
  // window with a composed filter (year range + nationality + team +
  // achievement), so there is no ladder left in it to pin -- the equivalent
  // TS<->SQL check for its replacement is behavioural and lives in
  // lib/db/infiniteFilter.sqlParity.test.ts, because the filter is a predicate
  // rather than a constant and extracting it as text would prove far less than
  // running it. POOL_WINDOWS itself is still daily/duel's and still pinned above.

  describe("the guess limit", () => {
    it("daily_state and daily_submit_guess both cap the board at MAX_GUESSES", async () => {
      // Both matter and for different reasons: daily_state's copy is what
      // `guessesRemaining` is computed from on hydration, daily_submit_guess's is
      // what actually refuses the extra guess. They disagreeing with
      // lib/game/constants.ts shows up as a board that renders more rows than
      // the server will accept.
      for (const signature of ["public.daily_state()", "public.daily_submit_guess(integer)"]) {
        const src = await functionSource(signature);
        const declared = soleMatch(
          src,
          /\bv_max\s+constant\s+integer\s*:=\s*([^;]+);/g,
          "`v_max` declaration",
        );
        expect(Number(declared)).toBe(MAX_GUESSES);
      }
    });

    it("infinite_submit_guess caps its round at MAX_GUESSES", async () => {
      // Two bare literals rather than a v_max: the "no guesses left" rejection
      // and the won/lost/continue decision. Both, or the round ends at a
      // different count than it refuses new guesses at.
      const src = await functionSource("public.infinite_submit_guess(integer)");
      const caps = [...src.matchAll(/guess_count\s*>=\s*(\d+)/g)].map((m) => Number(m[1]));

      expect(caps).toEqual([MAX_GUESSES, MAX_GUESSES]);
    });
  });
});
