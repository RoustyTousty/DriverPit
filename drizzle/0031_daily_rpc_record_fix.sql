-- Fixes three bugs shipped in drizzle/0030_daily_state_rpc.sql. Forward-only
-- (0030 is already applied), CREATE OR REPLACE -- both signatures and return
-- types are unchanged, only the bodies.
--
-- 1. PL/pgSQL record variables: 0030 assigned `v_target` only inside
--    `IF <complete> THEN ...`, then referenced `v_target.id` from a CASE arm in
--    the RETURN. A CASE does NOT protect an unassigned record: the expression's
--    tuple structure has to be determinate when it's built, so any day that was
--    NOT complete raised
--      55000  record "v_target" is not assigned yet
--    That made daily_state() fail on every in-progress day (i.e. the normal
--    board load) and daily_submit_guess() fail on every non-completing guess.
--    infinite_submit_guess (drizzle/0028) never hit this because it assigns its
--    target row unconditionally -- the pattern followed here now.
--
-- 2. daily_submit_guess did `SELECT guesses, completed INTO ...`, but
--    `completed` is also one of its RETURNS TABLE output columns, which are
--    plpgsql variables -- an ambiguous column reference. Now table-qualified
--    (dp.completed).
--
-- The "never leak the target mid-day" guarantee is unchanged: the target row is
-- read into memory, but every target_* column is still forced to NULL at the
-- RETURN unless the day is over, exactly as before.

CREATE OR REPLACE FUNCTION public.daily_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_target_id integer;
  v_guesses integer[];
  v_completed boolean;
  v_won boolean;
  v_guess_arr jsonb;
  -- A plain jsonb (not a record), NULL until the day is over. Referencing this
  -- in the RETURN is always safe, unlike a possibly-unassigned record.
  v_target_json jsonb := NULL;
  v_len integer;
  v_max constant integer := 6;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_target_id := public.daily_target_id(v_today);

  SELECT dp.guesses, dp.completed, COALESCE(dp.won, false)
    INTO v_guesses, v_completed, v_won
  FROM public.daily_progress dp
  WHERE dp.user_id = v_user_id AND dp.date = v_today;

  IF NOT FOUND THEN
    -- No row yet: a fresh, empty (playable) board for today.
    v_guesses := ARRAY[]::integer[];
    v_completed := false;
    v_won := false;
  END IF;

  -- Rebuild each guess row in stored order: display fields off the driver row,
  -- tiles off compare_drivers against the pinned target. null closeness (an
  -- exact/correct column) is stripped so it maps to GuessResult's optional
  -- fields rather than an explicit null.
  SELECT COALESCE(jsonb_agg(row_json ORDER BY ord), '[]'::jsonb)
    INTO v_guess_arr
  FROM (
    SELECT gi.ord,
      jsonb_build_object(
        'driverId', d.id,
        'name', d.full_name,
        'code', d.driver_code,
        'nationality', d.nationality,
        'team', COALESCE(NULLIF(d.last_team, ''), '—'),
        'age', extract(year FROM age(COALESCE(d.date_of_death, v_today), d.date_of_birth))::int,
        'debutYear', d.debut_year,
        'careerWins', d.career_wins,
        'tiles', jsonb_strip_nulls(jsonb_build_object(
          'nationality', c.nationality,
          'team', c.team,
          'age', c.age,
          'ageCloseness', c.age_closeness,
          'debutYear', c.debut_year,
          'debutYearCloseness', c.debut_year_closeness,
          'careerWins', c.career_wins,
          'careerWinsCloseness', c.career_wins_closeness
        ))
      ) AS row_json
    FROM unnest(v_guesses) WITH ORDINALITY AS gi(gid, ord)
    JOIN public.drivers d ON d.id = gi.gid
    CROSS JOIN LATERAL public.compare_drivers(gi.gid, v_target_id, now()) AS c
  ) sub;

  v_len := COALESCE(array_length(v_guesses, 1), 0);

  IF v_completed THEN
    SELECT jsonb_build_object('driverId', d.id, 'name', d.full_name, 'code', d.driver_code)
      INTO v_target_json
    FROM public.drivers d WHERE d.id = v_target_id;
  END IF;

  RETURN jsonb_build_object(
    'guesses', v_guess_arr,
    'completed', v_completed,
    'won', v_won,
    'guessesRemaining', GREATEST(0, v_max - v_len),
    'target', v_target_json
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.daily_submit_guess(p_guess_driver_id integer)
RETURNS TABLE (
  won boolean,
  completed boolean,
  guesses_remaining integer,
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
  target_driver_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_now timestamptz := now();
  v_target_id integer;
  v_guesses integer[];
  v_row_completed boolean;
  v_guess record;
  v_target record;
  v_cmp record;
  v_won boolean;
  v_new_len integer;
  v_new_completed boolean;
  v_max constant integer := 6;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_target_id := public.daily_target_id(v_today);

  SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick a driver from the suggestions list.';
  END IF;

  -- Ensure the row exists, then lock it -- two devices guessing at once
  -- serialize here and converge instead of forking the board. ON CONFLICT DO
  -- NOTHING is safe under the concurrent-first-guess race.
  INSERT INTO public.daily_progress (user_id, date, guesses)
  VALUES (v_user_id, v_today, ARRAY[]::integer[])
  ON CONFLICT (user_id, date) DO NOTHING;

  -- Table-qualified: `completed` is also a RETURNS TABLE output variable, so a
  -- bare reference here is an ambiguous column reference.
  SELECT dp.guesses, dp.completed INTO v_guesses, v_row_completed
  FROM public.daily_progress dp
  WHERE dp.user_id = v_user_id AND dp.date = v_today
  FOR UPDATE;

  -- Never append onto a finished/exhausted day -- rejected like duel's "already
  -- solved", not a silent no-op. The client's own guard normally prevents this;
  -- a stale second device hitting it surfaces the error and re-hydrates.
  IF v_row_completed OR COALESCE(array_length(v_guesses, 1), 0) >= v_max THEN
    RAISE EXCEPTION 'Today''s puzzle is already complete.';
  END IF;

  SELECT * INTO v_cmp FROM public.compare_drivers(p_guess_driver_id, v_target_id, v_now);
  v_won := v_cmp.nationality = 'exact' AND v_cmp.team = 'exact' AND v_cmp.age = 'correct'
    AND v_cmp.debut_year = 'correct' AND v_cmp.career_wins = 'correct';

  v_guesses := array_append(v_guesses, p_guess_driver_id);
  v_new_len := COALESCE(array_length(v_guesses, 1), 0);
  v_new_completed := v_won OR v_new_len >= v_max;

  UPDATE public.daily_progress
  SET guesses = v_guesses,
      completed = v_new_completed,
      won = CASE WHEN v_new_completed THEN v_won ELSE NULL END,
      updated_at = now()
  WHERE user_id = v_user_id AND date = v_today;

  -- Assigned UNCONDITIONALLY (same as infinite_submit_guess, drizzle/0028): a
  -- record referenced from the CASE arms below must always have a determinate
  -- tuple structure. It's one indexed PK lookup, and the target still never
  -- reaches the client unless the day is over -- the CASEs force NULL otherwise.
  SELECT * INTO v_target FROM public.drivers WHERE id = v_target_id;

  RETURN QUERY SELECT
    v_won,
    v_new_completed,
    GREATEST(0, v_max - v_new_len),
    v_guess.id, v_guess.full_name, v_guess.driver_code, v_guess.nationality,
    COALESCE(NULLIF(v_guess.last_team, ''), '—'),
    extract(year FROM age(COALESCE(v_guess.date_of_death, v_today), v_guess.date_of_birth))::int,
    v_guess.debut_year, v_guess.career_wins,
    v_cmp.nationality, v_cmp.team, v_cmp.age, v_cmp.age_closeness,
    v_cmp.debut_year, v_cmp.debut_year_closeness, v_cmp.career_wins, v_cmp.career_wins_closeness,
    CASE WHEN v_new_completed THEN v_target.id ELSE NULL END,
    CASE WHEN v_new_completed THEN v_target.full_name ELSE NULL END,
    CASE WHEN v_new_completed THEN v_target.driver_code ELSE NULL END;
END;
$$;
