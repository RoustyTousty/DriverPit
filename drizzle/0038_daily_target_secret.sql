-- Makes the daily answer an actual secret (audit 2026-07-27 §3.1).
--
-- THE PROBLEM. The day's target was a *pure, deterministic function of public
-- inputs*, and it leaked three independent ways:
--
--   (a) public.daily_target_id(date) is SECURITY DEFINER, so it reads the
--       RLS-denied daily_targets table as its owner -- and Postgres
--       default-grants EXECUTE on a new function to PUBLIC, in the one schema
--       PostgREST exposes. Its own comment in drizzle/0030 claimed it was "NOT
--       granted to authenticated"; nothing in drizzle/*.sql ever revoked it.
--       POST /rest/v1/rpc/daily_target_id with the public anon key returned
--       today's driver id. drizzle/0034 diagnosed this exact trap and fixed it
--       for the four duel functions only.
--
--   (b) public.pick_daily_driver_id(date, int[]) was a second PUBLIC-executable
--       path to the same answer, and the only function in the schema without a
--       pinned SET search_path.
--
--   (c) The design leaked it even with (a) and (b) closed, and this is the part
--       that actually mattered: the pick was FNV-1a(date) mod an id-sorted pool,
--       and /daily ships the entire pool WITH ids to the browser for
--       autocomplete. Four lines in a devtools console reproduced the answer
--       with no network call at all, every day, forever.
--
-- THE FIX. A secret daily needs an *unpredictable* pinned target, not a hidden
-- deterministic one. The pick is now `ORDER BY ... random() LIMIT 1` evaluated
-- once, server-side, and written into daily_targets; the algorithm is gone from
-- the codebase entirely (pick_daily_driver_id dropped below,
-- lib/game/dailySelection.ts#pickDailyDriverId and lib/db/queries.ts#getDailyDriverId
-- deleted, and their parity suite with them) so it cannot be recomputed or
-- accidentally reintroduced.
--
-- WHAT THIS DOES NOT COST. Nothing on the player's path changes. The steady
-- state of daily_target_id is unchanged and is what every call after the day's
-- first one takes: a single indexed PK read of daily_targets, then return. The
-- random pick runs at most once per UTC day, globally, for whoever loads the
-- board first -- exactly where the deterministic pool scan used to run, and
-- with the same shape of work. daily_state()/daily_submit_guess() are untouched
-- byte for byte, so board hydration and guess evaluation are still one warm
-- PostgREST hop (CLAUDE.md "Fast guess evaluation").
--
-- WHY THE POOL CAN STILL SHIP TO THE CLIENT. It has to -- local autocomplete is
-- the reason typing a driver is instant. Once the answer stops being a function
-- of the pool, holding the pool tells you nothing.

-- The only new query cost, and it pays for the cooldown ordering below. One row
-- per day, so this stays tiny; the index just keeps the once-a-day pick from
-- degrading into a seq scan per candidate driver as the table grows.
CREATE INDEX IF NOT EXISTS "daily_targets_driver_id_idx" ON public.daily_targets ("driver_id");
--> statement-breakpoint

-- Get-or-pin the day's target, now with an UNPREDICTABLE pick.
--
-- Concurrency changed meaning here and it is load-bearing. Under the old
-- deterministic pick, two racing first-callers computed the identical id and
-- the ON CONFLICT DO NOTHING + re-read was belt-and-suspenders. Random picks
-- DIFFER, so exactly one of them must win and the loser must adopt the winner's
-- row -- a DO NOTHING + separate re-read would depend on isolation-level
-- subtleties to get that right. `ON CONFLICT DO UPDATE SET driver_id =
-- daily_targets.driver_id` is a deliberate no-op write whose only job is to make
-- RETURNING fire on the conflict path too: one statement, row-locked by
-- Postgres, always yields the authoritative id whether we inserted it or someone
-- else did. There is no second read and no window where a caller could see a
-- different answer than the day's.
--
-- The cooldown ordering is a SOFT preference, not a filter: drivers used in the
-- last COOLDOWN days sort last, and within each group the order is uniformly
-- random. Written as an ORDER BY rather than a WHERE precisely so it can never
-- empty the pool -- if every eligible driver has been used recently (a small
-- pool, or a long-lived database), they simply all tie and the pick degrades to
-- plain uniform random instead of raising. The old FNV pick had no repeat
-- avoidance at all; random without it would feel worse than the hash did, since
-- players notice a driver repeating twice in a week.
--
-- Keep the "- 10" cutoff in sync with lib/game/poolWindow.ts#DAILY_POOL_WINDOW
-- ("10-years") -- same requirement the pool query has carried since drizzle/0028.
CREATE OR REPLACE FUNCTION public.daily_target_id(p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_id integer;
  v_pick_id integer;
  -- Days a driver stays out of the running after being the answer.
  v_cooldown_days constant integer := 30;
BEGIN
  -- The hot path: every call but the day's very first one returns here, off one
  -- indexed PK lookup. Nothing below runs for a player loading the board.
  SELECT dt.driver_id INTO v_target_id FROM public.daily_targets dt WHERE dt.date = p_date;
  IF FOUND THEN
    RETURN v_target_id;
  END IF;

  SELECT d.id INTO v_pick_id
  FROM public.drivers d
  WHERE d.last_active_year >= extract(year FROM p_date)::int - 10
  ORDER BY
    EXISTS (
      SELECT 1 FROM public.daily_targets t
      WHERE t.driver_id = d.id AND t.date > p_date - v_cooldown_days
    ),
    random()
  LIMIT 1;

  IF v_pick_id IS NULL THEN
    RAISE EXCEPTION 'No puzzle is scheduled for today.';
  END IF;

  INSERT INTO public.daily_targets (date, driver_id)
  VALUES (p_date, v_pick_id)
  ON CONFLICT (date) DO UPDATE SET driver_id = daily_targets.driver_id
  RETURNING driver_id INTO v_target_id;

  RETURN v_target_id;
END;
$$;
--> statement-breakpoint

-- Re-roll any day whose answer was pinned by the old deterministic algorithm
-- and is therefore already public -- but ONLY where re-rolling changes nothing
-- for a player: no board started, no result recorded. A day someone is midway
-- through must keep its target, or their stored guesses would silently start
-- comparing against a different driver and a completed board would be wrong.
-- In practice this clears at most the current UTC day (daily_target_id only
-- ever pins the date it is asked for, which is always "today"); the next day is
-- the first genuinely secret one either way.
DELETE FROM public.daily_targets t
WHERE t.date >= (now() AT TIME ZONE 'UTC')::date
  AND NOT EXISTS (SELECT 1 FROM public.daily_progress p WHERE p.date = t.date)
  AND NOT EXISTS (SELECT 1 FROM public.daily_results r WHERE r.date = t.date);
--> statement-breakpoint

-- (b): the deterministic picker is deleted outright rather than revoked and
-- left lying around. Nothing calls it -- drizzle/0030 moved daily_submit_guess
-- onto daily_target_id, and the last TypeScript caller (lib/db/queries.ts#getDailyDriverId)
-- was already dead -- and while it exists it is a published, reusable recipe for
-- the answer that some future change could quietly wire back up. Its parity
-- suite (lib/game/dailySelection.sqlParity.test.ts) goes with it: parity tests
-- pin two implementations of one rule to each other, and after this there is no
-- rule and no second implementation.
DROP FUNCTION IF EXISTS public.pick_daily_driver_id(date, integer[]);
--> statement-breakpoint

-- (a): close the default PUBLIC grant. daily_target_id reads (and writes) the
-- day's answer as the table owner, past daily_targets' deny-all RLS -- it is an
-- internal helper for the two RPCs below and must be unreachable over PostgREST,
-- which is what drizzle/0030's comment already claimed. compare_drivers gets the
-- same treatment on principle (it is reached only from SECURITY DEFINER callers,
-- which run as the owner and keep EXECUTE regardless), so the schema's whole
-- guess-evaluation core is off the public API surface rather than relying on
-- each function being individually harmless.
REVOKE EXECUTE ON FUNCTION public.daily_target_id(date) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.compare_drivers(integer, integer, timestamptz) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- The two genuinely client-callable daily RPCs get an EXPLICIT grant decision
-- instead of inheriting the PUBLIC default, same shape as drizzle/0034's
-- wrappers. Both already reject a null auth.uid(), so `anon` (anon key, no user
-- JWT) never had a working call here; this makes that a privilege fact rather
-- than a runtime check, and means "who can execute this" is stated in one place
-- for every daily function.
REVOKE EXECUTE ON FUNCTION public.daily_state() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daily_state() TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.daily_submit_guess(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daily_submit_guess(integer) TO authenticated;
