-- Custom SQL migration file, put your code below! --

-- Extends duel_close_round to also return what CLAUDE.md's Duel
-- "Intermission" beat needs to render: the round's earned points for each
-- side (points_a/points_b -- previously only the running score_a/score_b
-- cumulative total was returned, not this round's delta), and the target
-- driver's public reveal fields. Revealing the target here is safe and
-- intentional -- this only ever runs once the round has actually closed
-- (both done or expired), matching CLAUDE.md: "the target is disclosed
-- only in the intermission, after the round is closed."
--
-- This is 9 new output columns, which CREATE OR REPLACE can't apply to an
-- existing function's RETURNS TABLE -- drop it first (same reason
-- drizzle/0023's match_or_queue change needed to).
DROP FUNCTION IF EXISTS public.duel_close_round(integer, integer);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.duel_close_round(p_match_id integer, p_round_index integer)
RETURNS TABLE (
  advanced boolean,
  match_status text,
  current_round integer,
  score_a integer,
  score_b integer,
  winner_id uuid,
  intermission_ends_at timestamptz,
  next_round_index integer,
  points_a integer,
  points_b integer,
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
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_round record;
  v_target record;
  v_a_result record;
  v_b_result record;
  v_now timestamptz := now();
  v_round_expired boolean;
  v_a_done boolean;
  v_b_done boolean;
  v_score_a integer;
  v_score_b integer;
  v_points_a integer;
  v_points_b integer;
  v_intermission_ends_at timestamptz;
  v_winner_id uuid;
  v_next_round_index integer;
BEGIN
  SELECT * INTO v_match FROM public.duel_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id;
  END IF;

  -- Idempotency guard: only the match's current round, while still active,
  -- can be closed. Already moved on (intermission/finished, or a different
  -- current_round) -- no-op, report current state. No reveal data on this
  -- branch -- a repeat caller already has it from the first, real call.
  IF v_match.status <> 'active' OR v_match.current_round <> p_round_index THEN
    RETURN QUERY SELECT false, v_match.status, v_match.current_round, v_match.score_a, v_match.score_b,
      v_match.winner_id, NULL::timestamptz, NULL::integer,
      NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_round FROM public.duel_rounds WHERE match_id = p_match_id AND round_index = p_round_index;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round % not found for match %', p_round_index, p_match_id;
  END IF;

  v_round_expired := v_now >= v_round.ends_at;

  SELECT * INTO v_a_result FROM public.duel_round_results
  WHERE match_id = p_match_id AND round_index = p_round_index AND user_id = v_match.player_a;
  SELECT * INTO v_b_result FROM public.duel_round_results
  WHERE match_id = p_match_id AND round_index = p_round_index AND user_id = v_match.player_b;

  v_a_done := (v_a_result.solved_at IS NOT NULL) OR v_round_expired;
  v_b_done := (v_b_result.solved_at IS NOT NULL) OR v_round_expired;

  -- Not a repeat call -- genuinely still in progress. Same no-op shape as
  -- the guard above, just a different reason (nobody's finished yet).
  IF NOT (v_a_done AND v_b_done) THEN
    RETURN QUERY SELECT false, v_match.status, v_match.current_round, v_match.score_a, v_match.score_b,
      v_match.winner_id, NULL::timestamptz, NULL::integer,
      NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  v_score_a := v_match.score_a;
  v_score_b := v_match.score_b;

  -- Finalize DNF scoring -- upsert since a player who never guessed at all
  -- this round has no duel_round_results row yet. v_points_a/b end up
  -- holding this round's earned points either way (DNF proximity here, or
  -- the solved value duel_submit_guess already stored) -- the reveal card's
  -- "+N" count-up for each side.
  IF v_a_result.solved_at IS NULL THEN
    v_points_a := ROUND(COALESCE(v_a_result.best_proximity, 0))::int;
    INSERT INTO public.duel_round_results (match_id, round_index, user_id, guess_count, solved_at, best_proximity, points)
    VALUES (p_match_id, p_round_index, v_match.player_a, COALESCE(v_a_result.guess_count, 0), NULL,
      COALESCE(v_a_result.best_proximity, 0), v_points_a)
    ON CONFLICT (match_id, round_index, user_id) DO UPDATE SET points = v_points_a;
    v_score_a := v_score_a + v_points_a;
  ELSE
    v_points_a := v_a_result.points;
  END IF;

  IF v_b_result.solved_at IS NULL THEN
    v_points_b := ROUND(COALESCE(v_b_result.best_proximity, 0))::int;
    INSERT INTO public.duel_round_results (match_id, round_index, user_id, guess_count, solved_at, best_proximity, points)
    VALUES (p_match_id, p_round_index, v_match.player_b, COALESCE(v_b_result.guess_count, 0), NULL,
      COALESCE(v_b_result.best_proximity, 0), v_points_b)
    ON CONFLICT (match_id, round_index, user_id) DO UPDATE SET points = v_points_b;
    v_score_b := v_score_b + v_points_b;
  ELSE
    v_points_b := v_b_result.points;
  END IF;

  -- Keep in sync with lib/game/duelTiming.ts's INTERMISSION_MS.
  v_intermission_ends_at := v_now + interval '6 seconds';

  UPDATE public.duel_rounds SET intermission_ends_at = v_intermission_ends_at
  WHERE match_id = p_match_id AND round_index = p_round_index;

  SELECT id, full_name, driver_code, nationality, last_team, debut_year, career_wins, date_of_birth, date_of_death
  INTO v_target
  FROM public.drivers WHERE id = v_round.driver_id;

  -- MAX_ROUNDS (lib/duel/liveMatch.ts) is 3, 0-indexed -- round 2 is the last.
  IF p_round_index >= 2 THEN
    v_winner_id := CASE WHEN v_score_a = v_score_b THEN NULL
      WHEN v_score_a > v_score_b THEN v_match.player_a ELSE v_match.player_b END;

    UPDATE public.duel_matches
    SET status = 'finished', score_a = v_score_a, score_b = v_score_b, winner_id = v_winner_id, finished_at = v_now
    WHERE id = p_match_id;

    RETURN QUERY SELECT true, 'finished'::text, v_match.current_round, v_score_a, v_score_b, v_winner_id,
      v_intermission_ends_at, NULL::integer,
      v_points_a, v_points_b, v_target.id, v_target.full_name, v_target.driver_code, v_target.nationality,
      COALESCE(v_target.last_team, '—'),
      extract(year FROM age(COALESCE(v_target.date_of_death, (v_now AT TIME ZONE 'UTC')::date), v_target.date_of_birth))::int,
      v_target.debut_year, v_target.career_wins;
    RETURN;
  END IF;

  v_next_round_index := p_round_index + 1;
  UPDATE public.duel_matches
  SET status = 'intermission', current_round = v_next_round_index, score_a = v_score_a, score_b = v_score_b
  WHERE id = p_match_id;

  RETURN QUERY SELECT true, 'intermission'::text, v_next_round_index, v_score_a, v_score_b, NULL::uuid,
    v_intermission_ends_at, v_next_round_index,
    v_points_a, v_points_b, v_target.id, v_target.full_name, v_target.driver_code, v_target.nationality,
    COALESCE(v_target.last_team, '—'),
    extract(year FROM age(COALESCE(v_target.date_of_death, (v_now AT TIME ZONE 'UTC')::date), v_target.date_of_birth))::int,
    v_target.debut_year, v_target.career_wins;
END;
$$;
