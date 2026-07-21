-- Custom SQL migration file, put your code below! --

-- Instant guess evaluation (CLAUDE.md's Duel "Instant guesses" section):
-- one warm hop, no Vercel serverless cold start. Called straight from the
-- client via supabase.rpc() -- same pattern as match_or_queue
-- (drizzle/0012_matchmaking_rpc.sql), NOT the trusted-connection-only style
-- of duel_begin_round/duel_close_round/duel_state (drizzle/0021) -- so this
-- one needs SECURITY DEFINER + auth.uid() to authenticate/authorize the
-- caller, and an explicit GRANT EXECUTE below.
--
-- lib/game/compare.ts stays the single source of truth for the comparison
-- *rules*; this ports them into SQL for latency (avoiding a Vercel hop
-- entirely) rather than replacing compare.ts, which still governs
-- daily/infinite. The comparison logic is factored into its own
-- compare_drivers() helper, deliberately separate from duel_submit_guess's
-- auth/match-state/scoring concerns, so lib/game/compare.sqlParity.test.ts
-- can call it directly against real driver fixtures (no match/round/auth
-- setup needed) and assert it produces identical tiles to compare.ts for
-- the same inputs -- see that test before changing either side.

-- Pure comparison of two existing drivers rows, mirroring
-- lib/game/compare.ts#compare() exactly:
--  - age: calendar-based, at death if deceased (Postgres's age() already
--    matches calculateAge()'s year/month/day-borrow semantics -- verified
--    against calculateAge's own test fixtures before writing this).
--  - team: exact (current team) / historical (in previous_teams) / miss.
--    Coalesces a null last_team to '' for the comparison, same as
--    lib/db/queries.ts#toGameDriver -- NOT the '—' placeholder
--    toDriverSummary uses for display; those are two different concerns.
--  - nationality: exact/miss.
--  - debut_year / career_wins: correct/higher/lower + squared-falloff
--    closeness, same ranges as compare.ts (20 and 70).
-- STABLE (not VOLATILE) since it only reads drivers and returns the same
-- result for the same inputs within a single statement -- lets the planner
-- treat repeat calls (e.g. duel_submit_guess's) as cacheable within a call.
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

  team := CASE
    WHEN COALESCE(v_guess.last_team, '') = COALESCE(v_target.last_team, '') THEN 'exact'
    WHEN COALESCE(v_guess.last_team, '') = ANY(v_target.previous_teams) THEN 'historical'
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

-- One-hop guess evaluation + scoring for the active duel round. Mirrors
-- lib/duel/actions.ts#submitDuelGuess's rules exactly (that Server Action
-- becomes dead code once the client is cut over to this RPC -- see
-- components/duel/DuelMatch.tsx), plus lib/game/duelScoring.ts's
-- speedPoints/weighted-proximity math, so a solve returns its real earned
-- points and a DNF's running best-heat in the same round trip. Never
-- selects/returns anything from the target driver row beyond compare_drivers'
-- abstracted feedback -- there is no target_* column in the RETURNS TABLE at
-- all, so there's nothing to leak by omission-of-caution.
--
-- Rejects (RAISE EXCEPTION, not a quiet no-op) a guess for a round that
-- isn't the match's current *active* round, or one already past its
-- ends_at -- these are genuine caller errors (stale client, tampered
-- request), not benign races like duel_begin_round/duel_close_round's
-- idempotency guards.
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
  -- but the server shouldn't trust that: a guess submitted during the
  -- countdown would clamp to msToSolve=0 and score max speed points for a
  -- "solve" that jumped the start.
  IF v_now < v_round.started_at THEN
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
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.duel_submit_guess(integer, integer, integer) TO authenticated;
