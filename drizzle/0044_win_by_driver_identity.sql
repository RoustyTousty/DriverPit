-- A win is guessing the RIGHT DRIVER, not five matching attributes.
-- (docs/audit-2026-07-27.md §3.8, and its §3.11 "teamless drivers" contributor.)
--
-- All three guess RPCs decided a win by re-deriving it from the tiles:
--
--   v_won := v_cmp.nationality = 'exact' AND v_cmp.team = 'exact'
--     AND v_cmp.age = 'correct' AND v_cmp.debut_year = 'correct'
--     AND v_cmp.career_wins = 'correct';
--
-- which makes any two drivers sharing all five attributes *interchangeable*:
-- guess B while the target is A and the server records a win, then the reveal
-- names A -- "You won! The driver was Someone Else." Measured against this
-- roster (792 drivers) there are 6 such collision pairs, all pre-1972
-- privateers, e.g. François Mazet / Max Jean (France, March, 83, 1971, 0 wins)
-- and three separate Kurtis Kraft pairs -- so it is unreachable in Daily and
-- Duel (10-year pool, 0 collisions today) but live in Infinite's legacy pool,
-- and one roster refresh is all it takes for the 10-year pool to grow one.
--
-- The fix is the identity the caller already has in hand:
--
--   v_won := p_guess_driver_id = <the round's/day's target id>;
--
-- Faster, not slower (CLAUDE.md's "one warm hop" budget): one integer compare
-- in place of five text compares against a record's fields. compare_drivers is
-- still called exactly once per guess -- the tiles are what the board renders --
-- so the guess path does strictly less work than before.
--
-- Nothing else in these three bodies changes. They are reproduced in full only
-- because CREATE OR REPLACE FUNCTION has no partial form; the diff against
-- drizzle/0025 (duel), 0028 (infinite) and 0031 (daily) is the one assignment
-- in each, plus its comment. Signatures are unchanged, so the existing
-- EXECUTE grants carry over (CREATE OR REPLACE retains an object's ACL) --
-- lib/db/schemaGrants.test.ts pins that.

-- ---------------------------------------------------------------------------
-- compare_drivers: an absent team is not a match.
-- ---------------------------------------------------------------------------
-- Was COALESCE(v_guess.last_team,'') = COALESCE(v_target.last_team,''), so two
-- drivers who both have NO current team compared as 'exact' -- a green tile
-- reading "you found the target's team" for a column that shows '—' on both
-- sides, and (in duel) a free 15 proximity points. Under the old win rule it
-- also handed the five-way condition a free 'exact', which is why §3.8 named it
-- a contributor; that half is now moot, but the false tile and the false
-- proximity are not.
--
-- The rule is now: an empty guess team can never be 'exact' or 'historical',
-- because "no team" says nothing about the target. An empty *target* team is
-- untouched -- a teamless target can still have previous_teams, so a real team
-- guessed against it must still be able to read 'historical'.
--
-- No live row changes: this roster has 0 teamless drivers (verified against the
-- live database before writing this), so the branch is latent. Mirrored in
-- lib/game/compare.ts#compareTeam and pinned by
-- lib/game/compare.sqlParity.test.ts's teamless fixtures.
CREATE OR REPLACE FUNCTION public.compare_drivers(
  p_guess_driver_id integer,
  p_target_driver_id integer,
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
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
STABLE
SET search_path = public
AS $$
DECLARE
  v_guess record;
  v_target record;
  v_as_of_date date := (p_as_of AT TIME ZONE 'UTC')::date;
  v_guess_age integer;
  v_target_age integer;
  v_guess_team text;
BEGIN
  SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver % not found', p_guess_driver_id;
  END IF;

  SELECT * INTO v_target FROM public.drivers WHERE id = p_target_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver % not found', p_target_driver_id;
  END IF;

  v_guess_age := extract(year FROM age(COALESCE(v_guess.date_of_death, v_as_of_date), v_guess.date_of_birth))::int;
  v_target_age := extract(year FROM age(COALESCE(v_target.date_of_death, v_as_of_date), v_target.date_of_birth))::int;

  nationality := CASE WHEN v_guess.nationality = v_target.nationality THEN 'exact' ELSE 'miss' END;

  v_guess_team := COALESCE(v_guess.last_team, '');
  team := CASE
    WHEN v_guess_team = '' THEN 'miss'
    WHEN v_guess_team = COALESCE(v_target.last_team, '') THEN 'exact'
    WHEN v_guess_team = ANY(v_target.previous_teams) THEN 'historical'
    ELSE 'miss'
  END;

  IF v_guess_age = v_target_age THEN
    age := 'correct';
    age_closeness := NULL;
  ELSE
    age := CASE WHEN v_target_age > v_guess_age THEN 'higher' ELSE 'lower' END;
    age_closeness := power(GREATEST(0, 1 - abs(v_guess_age - v_target_age)::numeric / 30), 2);
  END IF;

  IF v_guess.debut_year = v_target.debut_year THEN
    debut_year := 'correct';
    debut_year_closeness := NULL;
  ELSE
    debut_year := CASE WHEN v_target.debut_year > v_guess.debut_year THEN 'higher' ELSE 'lower' END;
    debut_year_closeness := power(GREATEST(0, 1 - abs(v_guess.debut_year - v_target.debut_year)::numeric / 20), 2);
  END IF;

  IF v_guess.career_wins = v_target.career_wins THEN
    career_wins := 'correct';
    career_wins_closeness := NULL;
  ELSE
    career_wins := CASE WHEN v_target.career_wins > v_guess.career_wins THEN 'higher' ELSE 'lower' END;
    career_wins_closeness := power(GREATEST(0, 1 - abs(v_guess.career_wins - v_target.career_wins)::numeric / 70), 2);
  END IF;

  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- daily_submit_guess -- body from drizzle/0031, v_won only.
-- ---------------------------------------------------------------------------
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

  -- The day is won by naming the day's driver -- NOT by matching its five
  -- attributes, which any of this roster's collision pairs would also do (see
  -- this migration's header). v_cmp is still what the board renders; it just no
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

-- ---------------------------------------------------------------------------
-- infinite_submit_guess -- body from drizzle/0028, v_won only.
-- ---------------------------------------------------------------------------
-- This is the mode where §3.8 was actually reachable: the legacy pool holds
-- every collision pair on the roster.
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

  -- Driver identity, not attribute equality -- see this migration's header.
  v_won := p_guess_driver_id = v_round.driver_id;

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

-- ---------------------------------------------------------------------------
-- duel_submit_guess -- body from drizzle/0025, v_solved only.
-- ---------------------------------------------------------------------------
-- Here the old rule was worth real Elo: a doppelgänger guess scored full speed
-- points and locked the round as solved.
CREATE OR REPLACE FUNCTION public.duel_submit_guess(
  p_match_id integer,
  p_round_index integer,
  p_guess_driver_id integer
)
RETURNS TABLE (
  solved boolean,
  points integer,
  best_heat numeric,
  score_a integer,
  score_b integer,
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
  v_match record;
  v_round record;
  v_existing record;
  v_guess record;
  v_now timestamptz := now();
  v_cmp record;
  v_solved boolean;
  v_weighted_proximity numeric;
  v_best_heat numeric;
  v_next_guess_count integer;
  v_next_best_proximity numeric;
  v_points integer;
  v_ms_to_solve numeric;
  v_round_ms numeric;
  v_clamped numeric;
  v_remaining numeric;
  v_score_a integer;
  v_score_b integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_match FROM public.duel_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;
  IF v_match.player_a <> v_user_id AND v_match.player_b <> v_user_id THEN
    RAISE EXCEPTION 'You are not part of this match';
  END IF;
  IF v_match.status <> 'active' OR v_match.current_round <> p_round_index THEN
    RAISE EXCEPTION 'This round is not active';
  END IF;

  SELECT * INTO v_round FROM public.duel_rounds WHERE match_id = p_match_id AND round_index = p_round_index;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found';
  END IF;
  -- duel_begin_round flips the match to 'active' the instant it stamps the
  -- round, but started_at is still COUNTDOWN_MS in the future at that point
  -- (the lights-out countdown) -- the real client UI never lets a guess
  -- through before then (see components/duel/DuelMatch.tsx's isPreRound),
  -- but the server shouldn't trust that alone: a guess submitted well
  -- before the countdown finishes would clamp to msToSolve=0 and score max
  -- speed points for a "solve" that jumped the start. The 2s grace period
  -- below is purely for app-server/db-server clock drift (see drizzle/0025's
  -- header comment), not a loophole for jumping the gun -- it's far short of
  -- COUNTDOWN_MS (4s).
  IF v_now < v_round.started_at - interval '2 seconds' THEN
    RAISE EXCEPTION 'This round has not started yet';
  END IF;
  IF v_now >= v_round.ends_at THEN
    RAISE EXCEPTION 'Time is up for this round';
  END IF;

  SELECT * INTO v_existing FROM public.duel_round_results
  WHERE match_id = p_match_id AND round_index = p_round_index AND user_id = v_user_id
  FOR UPDATE;
  IF FOUND AND v_existing.solved_at IS NOT NULL THEN
    RAISE EXCEPTION 'You already solved this round';
  END IF;

  SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick a driver from the suggestions list';
  END IF;

  SELECT * INTO v_cmp FROM public.compare_drivers(p_guess_driver_id, v_round.driver_id, v_now);

  -- Driver identity, not attribute equality -- see this migration's header.
  v_solved := p_guess_driver_id = v_round.driver_id;

  -- Weighted proximity -- same weights as lib/game/duelScoring.ts's
  -- weightedProximity() (NATIONALITY/TEAM_EXACT/AGE/DEBUT/WINS = 15 each,
  -- TEAM_HISTORICAL = 8) and same MAX_PROXIMITY_WEIGHT ceiling (75, the
  -- five exact/correct weights -- historical is deliberately excluded from
  -- the ceiling there, matching duelScoring.ts's own comment on why). A
  -- doppelgänger guess can now reach the full 75 without solving, which is
  -- fine: 75 is still below MIN_SPEED_POINTS (100), so "any solve beats any
  -- DNF" holds on the ceiling itself rather than on the old assumption that
  -- an unsolved guess must miss something.
  v_weighted_proximity :=
    (CASE WHEN v_cmp.nationality = 'exact' THEN 15 ELSE 0 END) +
    (CASE WHEN v_cmp.team = 'exact' THEN 15 WHEN v_cmp.team = 'historical' THEN 8 ELSE 0 END) +
    (CASE WHEN v_cmp.age = 'correct' THEN 15 ELSE 15 * COALESCE(v_cmp.age_closeness, 0) END) +
    (CASE WHEN v_cmp.debut_year = 'correct' THEN 15 ELSE 15 * COALESCE(v_cmp.debut_year_closeness, 0) END) +
    (CASE WHEN v_cmp.career_wins = 'correct' THEN 15 ELSE 15 * COALESCE(v_cmp.career_wins_closeness, 0) END);

  v_best_heat := GREATEST(COALESCE(v_existing.best_proximity, 0), v_weighted_proximity) / 75.0;
  v_next_guess_count := COALESCE(v_existing.guess_count, 0) + 1;

  IF v_solved THEN
    -- speedPoints(msToSolve, roundMs): 100 + 900 * (remaining/roundMs)^2,
    -- clamped -- lib/game/duelScoring.ts. bestProximity is deliberately
    -- NOT bumped on a win -- it only ever matters as a DNF fallback,
    -- irrelevant once solved.
    v_ms_to_solve := extract(epoch FROM (v_now - v_round.started_at)) * 1000;
    v_round_ms := extract(epoch FROM (v_round.ends_at - v_round.started_at)) * 1000;
    v_clamped := LEAST(GREATEST(v_ms_to_solve, 0), v_round_ms);
    v_remaining := 1 - v_clamped / v_round_ms;
    v_points := round(100 + 900 * v_remaining * v_remaining)::int;
    v_next_best_proximity := COALESCE(v_existing.best_proximity, 0);
  ELSE
    v_points := NULL;
    v_next_best_proximity := GREATEST(COALESCE(v_existing.best_proximity, 0), v_weighted_proximity);
  END IF;

  INSERT INTO public.duel_round_results (match_id, round_index, user_id, guess_count, solved_at, best_proximity, points)
  VALUES (p_match_id, p_round_index, v_user_id, v_next_guess_count, CASE WHEN v_solved THEN v_now ELSE NULL END,
    v_next_best_proximity, COALESCE(v_points, 0))
  ON CONFLICT (match_id, round_index, user_id) DO UPDATE SET
    guess_count = v_next_guess_count,
    solved_at = CASE WHEN v_solved THEN v_now ELSE NULL END,
    best_proximity = v_next_best_proximity,
    points = COALESCE(v_points, 0);

  v_score_a := v_match.score_a;
  v_score_b := v_match.score_b;
  IF v_solved THEN
    IF v_match.player_a = v_user_id THEN
      v_score_a := v_score_a + v_points;
    ELSE
      v_score_b := v_score_b + v_points;
    END IF;
    UPDATE public.duel_matches SET score_a = v_score_a, score_b = v_score_b WHERE id = p_match_id;
  END IF;

  RETURN QUERY SELECT
    v_solved, v_points, v_best_heat, v_score_a, v_score_b,
    v_guess.id, v_guess.full_name, v_guess.driver_code, v_guess.nationality, COALESCE(v_guess.last_team, '—'),
    extract(year FROM age(COALESCE(v_guess.date_of_death, (v_now AT TIME ZONE 'UTC')::date), v_guess.date_of_birth))::int,
    v_guess.debut_year, v_guess.career_wins,
    v_cmp.nationality, v_cmp.team, v_cmp.age, v_cmp.age_closeness, v_cmp.debut_year, v_cmp.debut_year_closeness,
    v_cmp.career_wins, v_cmp.career_wins_closeness;
END;
$$;
