-- A driver already guessed today cannot be guessed again.
-- (docs/audit-2026-07-29.md §3.9, whose client half is §4.7.)
--
-- daily_submit_guess checked that the driver exists and that the day wasn't
-- finished, then `array_append`ed unconditionally -- so all six turns could be
-- spent on one driver, each returning the identical row the board was already
-- showing. There is no reading of the daily rules under which that is a guess:
-- it carries no information, and the only thing it can do is end the day.
--
-- The client half (components/game/DriverAutocomplete.tsx) withholds guessed
-- drivers from the suggestions, which is what a player will actually meet. This
-- is the half that makes it true: the suggestions are a *list*, and
-- daily_submit_guess is reachable from a devtools console without one. It is
-- also the half that survives a second device -- an open board hydrated before
-- a guess landed elsewhere still holds the stale suggestion list, and the
-- server is the only thing that can see both.
--
-- Deliberately NOT extended to the other two modes here:
--   * infinite_rounds stores guess_count, not the guesses -- there is nothing
--     server-side to compare against, and adding a column to carry it would be
--     a schema change on the hot path for a mode whose duplicate costs the same
--     turn the client already refuses to spend.
--   * duel guesses are unlimited, so a duplicate costs no turn at all (it costs
--     seconds, which is the client's job to save and not a thing the server
--     should reject mid-race).
--
-- Costs nothing measurable: `= ANY(v_guesses)` is a scan of at most five
-- integers already in a local variable, on a row this function has locked
-- anyway. No new query, no new round trip.
--
-- The body is otherwise drizzle/0044's verbatim -- reproduced in full only
-- because CREATE OR REPLACE FUNCTION has no partial form. The signature is
-- unchanged, so the existing EXECUTE grants carry over (CREATE OR REPLACE
-- retains an object's ACL); lib/db/schemaGrants.test.ts pins that.
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
  -- Keep in sync with lib/game/constants.ts#MAX_GUESSES; pinned by
  -- lib/game/poolWindow.sqlParity.test.ts (database CI tier).
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

  -- Read under the same lock as the append, so two devices submitting the same
  -- driver at once can't both pass this and both append. Raised rather than
  -- silently ignored, for the same reason the completed check is: a guess that
  -- didn't happen must not come back looking like one that did.
  IF p_guess_driver_id = ANY(v_guesses) THEN
    RAISE EXCEPTION 'You have already guessed %.', v_guess.full_name;
  END IF;

  SELECT * INTO v_cmp FROM public.compare_drivers(p_guess_driver_id, v_target_id, v_now);

  -- The day is won by naming the day's driver -- NOT by matching its five
  -- attributes, which any of this roster's collision pairs would also do (see
  -- drizzle/0044's header). v_cmp is still what the board renders; it just no
  -- longer decides the outcome.
  v_won := p_guess_driver_id = v_target_id;

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
