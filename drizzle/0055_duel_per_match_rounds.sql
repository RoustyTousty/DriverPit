-- Custom lobbies, phase 2 -- rounds and round length become per-match.
--
-- Two lines of behaviour change, in two functions, and nothing else:
--
--   duel_begin_round   ends_at is now started_at + the match's round_seconds,
--                      not a hardcoded 60.
--   duel_close_round   the last-round test is now p_round_index >=
--                      v_match.rounds - 1, not a hardcoded >= 2.
--
-- Both bodies below are otherwise reproduced VERBATIM from their live
-- definitions (drizzle/0052 and drizzle/0024 respectively, read back with
-- pg_get_functiondef before writing this). CREATE OR REPLACE has no partial
-- form -- it is the whole body or nothing -- so a migration that "only changes
-- one line" still has to restate every other line correctly, and the only safe
-- source for those lines is the database, not the newest migration that
-- happens to mention the function.
--
-- NEITHER RETURN SHAPE MOVES, and that is deliberate: CREATE OR REPLACE cannot
-- change a RETURNS TABLE, so any new column here would mean DROP + CREATE plus
-- a restated grant decision. Nothing needs one. duel_begin_round already
-- reports ends_at, so a per-match length rides out on a column that exists;
-- duel_close_round already reports match_status ('finished' vs 'intermission')
-- and a NULL next_round_index on finish, so "was that the last round?" is
-- already on the wire and the client can stop deriving it from a constant.
--
-- duel_submit_guess is untouched, and this is the finding that makes the whole
-- phase cheap: it derives v_round_ms from (ends_at - started_at) on the round
-- row, so the entire speed-points path follows a per-match round length for
-- free. duelScoring.sqlParity.test.ts pins weights that do not move here.
--
-- Requires drizzle/0054 (the columns). Every existing and matchmade match
-- carries rounds = 3, round_seconds = 60, so both functions behave exactly as
-- they did before -- the hardcoded values became the column defaults.
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
  -- drizzle/0036's header on what started_at means. Still a literal, and still
  -- the same for every round of every match: the countdown is ceremony, not
  -- configuration, and drizzle/0035 made it uniform on purpose.
  v_started_at := now() + interval '3900 milliseconds';
  -- Per-match round length (drizzle/0054). Was `interval '60 seconds'`, the
  -- ROUND_MS literal from lib/game/duelTiming.ts; 60 is now that column's
  -- DEFAULT, so a matchmade duel stamps exactly what it always did.
  --
  -- This one line is the whole server-side cost of a configurable round,
  -- because duel_submit_guess reads the length back off (ends_at - started_at)
  -- rather than carrying its own copy of it.
  v_ends_at := v_started_at + make_interval(secs => v_match.round_seconds);

  INSERT INTO public.duel_rounds (match_id, round_index, driver_id, started_at, ends_at)
  VALUES (p_match_id, p_round_index, v_target_driver_id, v_started_at, v_ends_at);

  UPDATE public.duel_matches
  SET status = 'active', current_round = p_round_index
  WHERE id = p_match_id;

  RETURN QUERY SELECT p_round_index, v_started_at, v_ends_at, 'active'::text, true;
END;
$$;
--> statement-breakpoint

-- Unchanged from drizzle/0024 apart from the last-round test. See that
-- migration's header for the reveal columns and why the already-closed branch
-- returns NULL for every one of them.
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

  -- Per-match round count (drizzle/0054), 0-indexed -- the last round is
  -- rounds - 1. Was `p_round_index >= 2`, a copy of MAX_ROUNDS = 3 from
  -- lib/duel/liveMatch.ts; 3 is now that column's DEFAULT, so a matchmade duel
  -- still finishes after round index 2.
  --
  -- This is also where the client's copy of the same rule goes away:
  -- useDuelLifecycle used to derive isLastRound from MAX_ROUNDS - 1, which
  -- meant two constants had to agree for a match to end on the right round.
  -- The branch below already tells it -- 'finished' vs 'intermission', and a
  -- NULL next_round_index -- so it now reads the answer instead of computing a
  -- second one.
  IF p_round_index >= v_match.rounds - 1 THEN
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
--> statement-breakpoint

-- The grant decision, restated rather than assumed -- same convention as
-- drizzle/0052. CREATE OR REPLACE keeps an existing function's ACL, so both
-- lines below are no-ops today; but these two functions carry no auth check of
-- their own (browsers reach them only through the duel_*_client wrappers,
-- drizzle/0034), so "the replace probably kept the revoke" is not a thing to
-- leave a rated match resting on. Each line is exactly what
-- lib/db/schemaGrants.test.ts already declares: `grantees: []`.
REVOKE EXECUTE ON FUNCTION public.duel_begin_round(integer, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_close_round(integer, integer) FROM PUBLIC, anon, authenticated;
