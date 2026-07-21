-- Custom SQL migration file, put your code below! --

-- Adds a small grace period to the "round hasn't started yet" guard.
-- Discovered live while building the Intermission beat: the Next.js app
-- server (where clockOffsetMs is measured, lib/duel/useServerClock.ts) and
-- the Supabase Postgres server (whose now() this function checks against)
-- are always two different machines, and their clocks are never perfectly
-- identical -- a measured ~1.4s gap between a local dev server and this
-- project's Supabase instance was enough to make a guess submitted right
-- at a round's start (immediately after the ready-gate passes) get
-- rejected as "not started yet", even though the client's own corrected
-- clock genuinely believed the round had begun. Vercel and Supabase in
-- production should be much closer than that, but "much closer" isn't
-- "zero" -- a couple of seconds of tolerance costs nothing (a guess this
-- early still can't have seen the target any sooner) and absorbs whatever
-- real-world drift exists between two independently-managed servers.
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
  -- below is purely for app-server/db-server clock drift (see this
  -- migration's header comment), not a loophole for jumping the gun --
  -- it's far short of COUNTDOWN_MS (4s).
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

  v_solved := v_cmp.nationality = 'exact' AND v_cmp.team = 'exact' AND v_cmp.age = 'correct'
    AND v_cmp.debut_year = 'correct' AND v_cmp.career_wins = 'correct';

  -- Weighted proximity -- same weights as lib/game/duelScoring.ts's
  -- weightedProximity() (NATIONALITY/TEAM_EXACT/AGE/DEBUT/WINS = 15 each,
  -- TEAM_HISTORICAL = 8) and same MAX_PROXIMITY_WEIGHT ceiling (75, the
  -- five exact/correct weights -- historical is deliberately excluded from
  -- the ceiling there, matching duelScoring.ts's own comment on why).
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
    -- NOT bumped on a win, matching lib/duel/actions.ts#submitDuelGuess --
    -- it only ever matters as a DNF fallback, irrelevant once solved.
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
