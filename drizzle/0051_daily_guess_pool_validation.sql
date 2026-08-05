-- A daily guess must come from the daily pool, not merely exist.
-- (docs/audit-2026-07-30-open.md, §3.9 residual.)
--
-- daily_submit_guess validated the guess by EXISTENCE alone:
--
--   SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Pick a driver from the suggestions list.';
--   END IF;
--
-- Every one of the ~800 rows in `drivers` passed that, while the board
-- autocompletes -- and daily_target_id (drizzle/0038) draws the answer from --
-- only the 10-year window. So the error message was a promise the function did
-- not keep: a driver who last raced in 1954 is not in the suggestions list, and
-- it was accepted.
--
-- NOT a security fix, and it is not being sold as one. Win-by-identity
-- (drizzle/0044) means an out-of-pool guess can never win, and the guess costs
-- the caller their own turn. What it corrupts is the RECORD of the day: a
-- persisted guess history and a shareable emoji grid (lib/game/emojiGrid.ts)
-- built from rows the game's own rules say are unreachable. The pattern is
-- already in the codebase one function over -- infinite_start_round validates
-- p_pool_window against an allow-list rather than trusting it -- and this is the
-- same `last_active_year >= cutoff` predicate daily_target_id already contains.
--
-- WHY THE CUTOFF IS A NAMED CONSTANT rather than an inline literal: it is the
-- fourth plpgsql copy of lib/game/poolWindow.ts#DAILY_POOL_WINDOW, and
-- CLAUDE.md's rule is that a new duplicated constant gets a parity assertion in
-- the same change that creates it. lib/game/poolWindow.sqlParity.test.ts now
-- extracts this declaration from pg_get_functiondef() and executes it, so the
-- live definition is what is pinned. The two halves of the check are covered by
-- different things on purpose: the parity suite pins the CUTOFF, and
-- lib/db/dailyRpc.test.ts pins the PREDICATE behaviourally (an out-of-pool
-- driver is refused, an in-pool one is not) -- an extraction alone would not
-- notice `<` becoming `>`.
--
-- Deliberately NOT extended to the other two modes, same as drizzle/0049:
--   * infinite's window is per-round (infinite_rounds.pool_window) and
--     player-chosen, so the check would need the whole poolCutoffYear ladder
--     duplicated a second time inside infinite_submit_guess -- a fourth site to
--     keep in sync for a mode that persists nothing and has no shareable grid.
--   * duel guesses are unlimited, so an out-of-pool guess there costs the player
--     seconds of a live race and nothing else; the round record is per-round
--     points, not a guess list.
--
-- Costs nothing measurable: one integer comparison against a column already
-- read by the SELECT above, before daily_progress is touched at all -- so a
-- rejected guess takes no row lock.
--
-- The body is otherwise drizzle/0049's verbatim -- reproduced in full only
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
  -- The daily pool's lower bound, from the SAME day this call resolved for --
  -- so the set a guess is checked against is exactly the set the day's answer
  -- was drawn from. Keep the "- 10" in sync with
  -- lib/game/poolWindow.ts#DAILY_POOL_WINDOW ("10-years"), the same requirement
  -- daily_target_id (drizzle/0038) and duel_begin_round (drizzle/0036) carry;
  -- pinned by lib/game/poolWindow.sqlParity.test.ts.
  v_pool_cutoff_year constant integer := extract(year FROM v_today)::int - 10;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_target_id := public.daily_target_id(v_today);

  SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick a driver from the suggestions list.';
  END IF;

  -- The half the old existence check left open. `last_active_year` is NOT NULL
  -- on every row (lib/db/schema.ts: every driver in the table has raced at
  -- least once), so this comparison is total and needs no null arm.
  IF v_guess.last_active_year < v_pool_cutoff_year THEN
    RAISE EXCEPTION '% is not in today''s pool. Pick a driver from the suggestions list.',
      v_guess.full_name;
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
