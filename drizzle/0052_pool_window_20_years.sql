-- The daily/duel pool widens from the last 10 years to the last 20.
--
-- lib/game/poolWindow.ts#DAILY_POOL_WINDOW moves "10-years" -> "20-years", and
-- this migration moves the three live plpgsql copies of that cutoff with it. All
-- four have to land in the same change: the constant alone moves only the
-- BOARD (autocomplete + the pool /daily ships), leaving the answer and the guess
-- check on the old window. That failure is silent in both directions --
-- daily_target_id would keep drawing from the last decade while the box offers
-- two, and daily_submit_guess would refuse a driver the box just suggested with
-- "not in today's pool". lib/game/poolWindow.sqlParity.test.ts (database CI
-- tier) is what catches a half-done version of this; it derives its probes from
-- the TypeScript constant, so it needs no edit here.
--
-- The three sites, and nothing else changes in any of them:
--   * daily_target_id   (drizzle/0038) -- picks the day's answer
--   * duel_begin_round  (drizzle/0036) -- picks each duel round's answer
--   * daily_submit_guess(drizzle/0051) -- the one that uses the cutoff to REJECT
--
-- infinite_start_round (drizzle/0028) is deliberately untouched: it mirrors the
-- whole poolCutoffYear ladder rather than the daily window, and '20-years' was
-- already one of its arms. Infinite's default follows DAILY_POOL_WINDOW through
-- DEFAULT_POOL_WINDOW in TypeScript, which is a client-side preference, not a
-- SQL constant.
--
-- Bodies are reproduced verbatim from the migrations named above (CREATE OR
-- REPLACE FUNCTION has no partial form); the diff in each is the literal 10 ->
-- 20 and the comment beside it. Signatures are unchanged, so ACLs carry over --
-- but the grant decision is restated at the bottom anyway rather than inferred,
-- per CLAUDE.md's "Schema" rule. lib/db/schemaGrants.test.ts pins it either way.

-- Unchanged from drizzle/0038 apart from the cutoff. See that migration's header
-- for why the pick is random and pinned rather than deterministic, and why the
-- ON CONFLICT DO UPDATE is a deliberate no-op write.
--
-- Keep the "- 20" cutoff in sync with lib/game/poolWindow.ts#DAILY_POOL_WINDOW
-- ("20-years").
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
  WHERE d.last_active_year >= extract(year FROM p_date)::int - 20
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

-- Unchanged from drizzle/0036 apart from the cutoff. The countdown/round
-- literals below are still COUNTDOWN_MS / ROUND_MS from lib/game/duelTiming.ts.
--
-- Today's pinned daily targets are NOT re-rolled by this change, and must not be:
-- a widened pool can only ADD drivers, so every already-pinned answer is still
-- inside it, and re-rolling would change the answer under a board someone is
-- midway through. Duel rounds are per-match and pick at begin time, so a live
-- match keeps whatever its rounds already stamped.
CREATE OR REPLACE FUNCTION public.duel_begin_round(p_match_id integer, p_round_index integer)
RETURNS TABLE (
  round_index integer,
  started_at timestamptz,
  ends_at timestamptz,
  match_status text,
  newly_started boolean
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_existing record;
  v_target_driver_id integer;
  v_started_at timestamptz;
  v_ends_at timestamptz;
BEGIN
  SELECT * INTO v_match FROM public.duel_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id;
  END IF;
  IF v_match.status IN ('finished', 'abandoned') THEN
    RAISE EXCEPTION 'Match % has already ended', p_match_id;
  END IF;

  SELECT dr.round_index, dr.started_at, dr.ends_at INTO v_existing
  FROM public.duel_rounds dr
  WHERE dr.match_id = p_match_id AND dr.round_index = p_round_index;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.round_index, v_existing.started_at, v_existing.ends_at, v_match.status, false;
    RETURN;
  END IF;

  -- The same pool the daily answer is drawn from -- keep the "- 20" in sync with
  -- lib/game/poolWindow.ts's DAILY_POOL_WINDOW.
  SELECT id INTO v_target_driver_id
  FROM public.drivers
  WHERE last_active_year >= extract(year FROM now())::int - 20
  ORDER BY random()
  LIMIT 1;

  -- COUNTDOWN_MS, every round. Already includes COUNTDOWN_GO_HOLD_MS -- see
  -- drizzle/0036's header on what started_at means.
  v_started_at := now() + interval '3900 milliseconds';
  v_ends_at := v_started_at + interval '60 seconds';

  INSERT INTO public.duel_rounds (match_id, round_index, driver_id, started_at, ends_at)
  VALUES (p_match_id, p_round_index, v_target_driver_id, v_started_at, v_ends_at);

  UPDATE public.duel_matches
  SET status = 'active', current_round = p_round_index
  WHERE id = p_match_id;

  RETURN QUERY SELECT p_round_index, v_started_at, v_ends_at, 'active'::text, true;
END;
$$;
--> statement-breakpoint

-- Unchanged from drizzle/0051 apart from the cutoff. See that migration's header
-- for why a daily guess is validated against the pool rather than mere
-- existence, and why the check is deliberately not extended to infinite/duel.
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
  -- was drawn from. Keep the "- 20" in sync with
  -- lib/game/poolWindow.ts#DAILY_POOL_WINDOW ("20-years"), the same requirement
  -- daily_target_id and duel_begin_round above carry; pinned by
  -- lib/game/poolWindow.sqlParity.test.ts.
  v_pool_cutoff_year constant integer := extract(year FROM v_today)::int - 20;
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
--> statement-breakpoint

-- The grant decision, restated rather than assumed. CREATE OR REPLACE keeps an
-- existing function's ACL (drizzle/0051 replaced daily_submit_guess without
-- re-granting and lib/db/schemaGrants.test.ts stayed green, which is the proof),
-- so these are no-ops today -- but two of the three functions above are
-- answer-bearing, and "the replace probably kept the revoke" is not a thing to
-- leave a daily answer resting on. Each line is exactly what
-- schemaGrants.test.ts already declares for that function.
REVOKE EXECUTE ON FUNCTION public.daily_target_id(date) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_begin_round(integer, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.daily_submit_guess(integer) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daily_submit_guess(integer) TO authenticated;
