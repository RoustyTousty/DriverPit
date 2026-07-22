-- Custom SQL migration file, put your code below! --

-- Instant guess evaluation for Daily and Infinite, the same fix duel got
-- (drizzle/0022): evaluate a guess in one warm hop straight to Supabase's
-- PostgREST layer via supabase.rpc(), no Vercel Server Action (and its
-- serverless cold start) in the path. lib/game/compare.ts stays the single
-- source of truth for comparison *rules* -- these RPCs reuse the existing
-- compare_drivers() SQL port (drizzle/0022) rather than duplicating it.

-- Pure port of lib/game/dailySelection.ts#pickDailyDriverId -- same FNV-1a
-- hash over the date string, same "sort the pool by id, then hash mod pool
-- size" pick. Deliberately NOT a precomputed/pinned value in a table: that
-- was tried before (see dailySelection.ts's header comment) and could
-- drift from a pool that changes intra-day; this recomputes from the exact
-- pool handed to it on every call, so it can never drift, at a cost of a
-- trivial loop over ~10 characters plus one array sort -- negligible next
-- to the Vercel round trip this whole migration removes.
--
-- All arithmetic done in bigint, kept masked to the low 32 bits after
-- every step, to emulate JS's 32-bit `hash ^= code; hash = Math.imul(hash,
-- 16777619)` exactly: Postgres integer literals bigger than int4's range
-- parse as `numeric`, which has no bitwise operators, so the 0xFFFFFFFF
-- mask is written with an explicit ::bigint cast. Parity with the TS
-- implementation is asserted for a range of real dates against a real
-- pool in lib/game/dailySelection.sqlParity.test.ts -- see that test
-- before changing either side.
CREATE OR REPLACE FUNCTION public.pick_daily_driver_id(p_date date, p_pool_ids integer[])
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_date_str text := to_char(p_date, 'YYYY-MM-DD');
  v_hash bigint := 2166136261;
  v_sorted integer[];
  v_len integer := coalesce(array_length(p_pool_ids, 1), 0);
  i integer;
BEGIN
  IF v_len = 0 THEN
    RAISE EXCEPTION 'Empty daily pool';
  END IF;

  FOR i IN 1..length(v_date_str) LOOP
    v_hash := (v_hash # ascii(substr(v_date_str, i, 1))::bigint) & 4294967295::bigint;
    v_hash := (v_hash * 16777619) & 4294967295::bigint;
  END LOOP;

  SELECT array_agg(x ORDER BY x) INTO v_sorted FROM unnest(p_pool_ids) AS x;
  RETURN v_sorted[(v_hash % v_len) + 1];
END;
$$;
--> statement-breakpoint

-- Mirrors app/(game)/daily/actions.ts#submitDailyGuess exactly (that
-- Server Action becomes dead code once DailyGame.tsx is cut over to this
-- RPC -- see lib/game/submitDailyGuess.ts). Never returns the target
-- driver at all -- reveal stays a separate, one-time call
-- (revealDailyTarget, untouched, still fine as a Server Action since it's
-- called once per lost game, not once per guess).
--
-- Keep the "- 10" cutoff below in sync with
-- lib/game/poolWindow.ts#DAILY_POOL_WINDOW ("10-years") -- same
-- requirement duel_begin_round's own inline pool query already has
-- (drizzle/0021).
CREATE OR REPLACE FUNCTION public.daily_submit_guess(p_guess_driver_id integer)
RETURNS TABLE (
  won boolean,
  guessed_driver_id integer,
  guessed_full_name text,
  guessed_driver_code text,
  guessed_nationality text,
  guessed_team text,
  guessed_age integer,
  guessed_debut_year integer,
  guessed_career_wins integer,
  nationality text,
  team text,
  age text,
  age_closeness numeric,
  debut_year text,
  debut_year_closeness numeric,
  career_wins text,
  career_wins_closeness numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_pool_ids integer[];
  v_target_id integer;
  v_guess record;
  v_cmp record;
  v_now timestamptz := now();
  v_won boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT array_agg(id) INTO v_pool_ids FROM public.drivers
  WHERE last_active_year >= extract(year FROM v_today)::int - 10;

  IF v_pool_ids IS NULL OR array_length(v_pool_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No puzzle is scheduled for today.';
  END IF;

  v_target_id := public.pick_daily_driver_id(v_today, v_pool_ids);

  SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick a driver from the suggestions list.';
  END IF;

  SELECT * INTO v_cmp FROM public.compare_drivers(p_guess_driver_id, v_target_id, v_now);

  v_won := v_cmp.nationality = 'exact' AND v_cmp.team = 'exact' AND v_cmp.age = 'correct'
    AND v_cmp.debut_year = 'correct' AND v_cmp.career_wins = 'correct';

  RETURN QUERY SELECT
    v_won,
    v_guess.id, v_guess.full_name, v_guess.driver_code, v_guess.nationality, COALESCE(v_guess.last_team, '—'),
    extract(year FROM age(COALESCE(v_guess.date_of_death, v_today), v_guess.date_of_birth))::int,
    v_guess.debut_year, v_guess.career_wins,
    v_cmp.nationality, v_cmp.team, v_cmp.age, v_cmp.age_closeness, v_cmp.debut_year, v_cmp.debut_year_closeness,
    v_cmp.career_wins, v_cmp.career_wins_closeness;
END;
$$;
--> statement-breakpoint

-- Only enable RLS with no policies -- same "default deny" treatment as
-- duel_rounds (drizzle/0011): infinite_rounds.driver_id is a live secret
-- target, must never be directly SELECTable via PostgREST. The only way in
-- is through the SECURITY DEFINER RPCs below.
ALTER TABLE public.infinite_rounds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Mirrors app/(game)/infinite/actions.ts#startInfiniteRound. Always
-- overwrites any existing round for this user (ON CONFLICT DO UPDATE) --
-- "New driver" and switching the pool window both mean "clobber whatever
-- was there," matching the old cookie's behavior of just being replaced.
CREATE OR REPLACE FUNCTION public.infinite_start_round(p_pool_window text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_year integer := extract(year FROM now())::int;
  v_cutoff integer;
  v_driver_id integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_pool_window NOT IN ('current-season', '10-years', '20-years', '30-years', 'legacy') THEN
    RAISE EXCEPTION 'Invalid pool window: %', p_pool_window;
  END IF;

  -- Same cutoffs as lib/game/poolWindow.ts#poolCutoffYear.
  v_cutoff := CASE p_pool_window
    WHEN 'current-season' THEN v_year
    WHEN '10-years' THEN v_year - 10
    WHEN '20-years' THEN v_year - 20
    WHEN '30-years' THEN v_year - 30
    ELSE NULL -- 'legacy', already validated above
  END;

  SELECT id INTO v_driver_id FROM public.drivers
  WHERE v_cutoff IS NULL OR last_active_year >= v_cutoff
  ORDER BY random() LIMIT 1;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'No drivers found for pool window %', p_pool_window;
  END IF;

  INSERT INTO public.infinite_rounds (user_id, driver_id, pool_window, guess_count, started_at)
  VALUES (v_user_id, v_driver_id, p_pool_window, 0, now())
  ON CONFLICT (user_id) DO UPDATE SET
    driver_id = EXCLUDED.driver_id,
    pool_window = EXCLUDED.pool_window,
    guess_count = 0,
    started_at = now();
END;
$$;
--> statement-breakpoint

-- Mirrors app/(game)/infinite/actions.ts#submitGuess. Unlike daily, this
-- DOES return the target -- but only once the round is actually over
-- (status won/lost), matching the existing contract exactly. The target_*
-- columns are forced to NULL at the RETURN QUERY itself (not just skipped
-- upstream) whenever status = 'continue', so there's no path where a
-- mid-round guess response can carry the real target over the wire --
-- CLAUDE.md's "never send the target during a round" rule, same as duel.
--
-- Keep the guess-limit literal (6) below in sync with
-- lib/game/constants.ts#MAX_GUESSES.
CREATE OR REPLACE FUNCTION public.infinite_submit_guess(p_guess_driver_id integer)
RETURNS TABLE (
  status text,
  guessed_driver_id integer,
  guessed_full_name text,
  guessed_driver_code text,
  guessed_nationality text,
  guessed_team text,
  guessed_age integer,
  guessed_debut_year integer,
  guessed_career_wins integer,
  nationality text,
  team text,
  age text,
  age_closeness numeric,
  debut_year text,
  debut_year_closeness numeric,
  career_wins text,
  career_wins_closeness numeric,
  target_driver_id integer,
  target_full_name text,
  target_driver_code text,
  target_nationality text,
  target_team text,
  target_age integer,
  target_debut_year integer,
  target_career_wins integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_round record;
  v_guess record;
  v_target record;
  v_cmp record;
  v_won boolean;
  v_next_guess_count integer;
  v_status text;
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_round FROM public.infinite_rounds WHERE user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your round expired. Start a new driver to keep playing.';
  END IF;
  IF v_round.guess_count >= 6 THEN
    RAISE EXCEPTION 'No guesses left.';
  END IF;

  SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick a driver from the suggestions list.';
  END IF;

  SELECT * INTO v_cmp FROM public.compare_drivers(p_guess_driver_id, v_round.driver_id, v_now);

  v_won := v_cmp.nationality = 'exact' AND v_cmp.team = 'exact' AND v_cmp.age = 'correct'
    AND v_cmp.debut_year = 'correct' AND v_cmp.career_wins = 'correct';

  v_next_guess_count := v_round.guess_count + 1;
  v_status := CASE WHEN v_won THEN 'won' WHEN v_next_guess_count >= 6 THEN 'lost' ELSE 'continue' END;

  IF v_status = 'continue' THEN
    UPDATE public.infinite_rounds SET guess_count = v_next_guess_count WHERE user_id = v_user_id;
  ELSE
    DELETE FROM public.infinite_rounds WHERE user_id = v_user_id;
  END IF;

  SELECT * INTO v_target FROM public.drivers WHERE id = v_round.driver_id;

  RETURN QUERY SELECT
    v_status,
    v_guess.id, v_guess.full_name, v_guess.driver_code, v_guess.nationality, COALESCE(v_guess.last_team, '—'),
    extract(year FROM age(COALESCE(v_guess.date_of_death, (v_now AT TIME ZONE 'UTC')::date), v_guess.date_of_birth))::int,
    v_guess.debut_year, v_guess.career_wins,
    v_cmp.nationality, v_cmp.team, v_cmp.age, v_cmp.age_closeness, v_cmp.debut_year, v_cmp.debut_year_closeness,
    v_cmp.career_wins, v_cmp.career_wins_closeness,
    CASE WHEN v_status = 'continue' THEN NULL ELSE v_target.id END,
    CASE WHEN v_status = 'continue' THEN NULL ELSE v_target.full_name END,
    CASE WHEN v_status = 'continue' THEN NULL ELSE v_target.driver_code END,
    CASE WHEN v_status = 'continue' THEN NULL ELSE v_target.nationality END,
    CASE WHEN v_status = 'continue' THEN NULL ELSE COALESCE(v_target.last_team, '—') END,
    CASE WHEN v_status = 'continue' THEN NULL ELSE extract(year FROM age(COALESCE(v_target.date_of_death, (v_now AT TIME ZONE 'UTC')::date), v_target.date_of_birth))::int END,
    CASE WHEN v_status = 'continue' THEN NULL ELSE v_target.debut_year END,
    CASE WHEN v_status = 'continue' THEN NULL ELSE v_target.career_wins END;
END;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.daily_submit_guess(integer) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.infinite_start_round(text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.infinite_submit_guess(integer) TO authenticated;
