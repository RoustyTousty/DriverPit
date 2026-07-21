ALTER TABLE "duel_matches" ADD COLUMN "rating_delta_a" integer;--> statement-breakpoint
ALTER TABLE "duel_matches" ADD COLUMN "rating_delta_b" integer;--> statement-breakpoint
ALTER TABLE "duel_rounds" ADD COLUMN "intermission_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "duel_matches" ADD CONSTRAINT "duel_matches_status_check" CHECK ("duel_matches"."status" IN ('lobby', 'countdown', 'active', 'intermission', 'finished', 'abandoned'));--> statement-breakpoint

-- Server-authoritative round lifecycle (CLAUDE.md's "Duel (real-time
-- race)" -> "Match lifecycle" and "Server authority"). These three
-- functions are only ever called from trusted server code over the direct
-- Drizzle connection (lib/db/duelRpc.ts) -- unlike match_or_queue, which is
-- called straight from the client via supabase.rpc() and so needs
-- SECURITY DEFINER + auth.uid(), these take explicit ids/indexes and trust
-- the caller (a server action) to have already verified the requesting
-- user is a match participant. Deliberately never GRANTed to `authenticated`
-- -- Supabase revokes PUBLIC execute by default, so leaving that grant out
-- keeps them unreachable from the anon/authenticated PostgREST roles
-- entirely, the same way gen_guest_username()/handle_new_user() in
-- drizzle/0006_auth_trigger_rls.sql are internal-only.

-- Ready-gated round timer stamping. Readiness itself is realtime/presence
-- only (never a DB column, see lib/game/duelTiming.ts) -- the caller
-- invokes this once both clients are ready (or READY_TIMEOUT_MS elapses)
-- and this just stamps the clock, picks the round's target driver, and
-- flips the match to 'active'. Idempotent on the (match_id, round_index)
-- pair: the *existence* of the duel_rounds row IS "already stamped", so a
-- second/racing call (both clients' ready-gates firing near-simultaneously)
-- reports back the first call's timestamps rather than re-stamping or
-- erroring. The `FOR UPDATE` lock on duel_matches serializes concurrent
-- calls for the same match so the existence check below can't race.
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

  -- Same 10-year pool as match_or_queue's round-0 pick (drizzle/0013) --
  -- keep the "- 10" in sync with lib/game/poolWindow.ts's DAILY_POOL_WINDOW.
  SELECT id INTO v_target_driver_id
  FROM public.drivers
  WHERE last_active_year >= extract(year FROM now())::int - 10
  ORDER BY random()
  LIMIT 1;

  -- Keep these two in sync with lib/game/duelTiming.ts's COUNTDOWN_MS/ROUND_MS.
  v_started_at := now() + interval '4 seconds';
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

-- Closes the match's *current* round: finalizes DNF points for anyone who
-- ran the clock out without solving, persists duel_round_results.points and
-- duel_matches.score_a/b, stamps intermission_ends_at, and either advances
-- into intermission (current_round moves to the next index) or finishes
-- the match on the last round. Guarded so a double-call -- the client that
-- didn't trigger the advance itself, a stray poll, a retry -- is a no-op:
-- once the match has moved off `active` at this round_index (to
-- 'intermission' or 'finished'), a repeat call just reports the
-- already-settled state back rather than re-scoring or re-advancing.
-- Deliberately does NOT write duel_matches.rating_delta_a/b or user_stats
-- on a normal finish (see CLAUDE.md's RPC list -- only duel_forfeit, not
-- yet built, is documented as writing ratings); a caller that sees
-- match_status = 'finished' here is responsible for that step, same as
-- lib/duel/actions.ts#applyMatchResult does today for the still-live
-- tryAdvanceRound path this will eventually replace.
CREATE OR REPLACE FUNCTION public.duel_close_round(p_match_id integer, p_round_index integer)
RETURNS TABLE (
  advanced boolean,
  match_status text,
  current_round integer,
  score_a integer,
  score_b integer,
  winner_id uuid,
  intermission_ends_at timestamptz,
  next_round_index integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_round record;
  v_a_result record;
  v_b_result record;
  v_now timestamptz := now();
  v_round_expired boolean;
  v_a_done boolean;
  v_b_done boolean;
  v_score_a integer;
  v_score_b integer;
  v_a_dnf_points integer;
  v_b_dnf_points integer;
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
  -- current_round) -- no-op, report current state.
  IF v_match.status <> 'active' OR v_match.current_round <> p_round_index THEN
    RETURN QUERY SELECT false, v_match.status, v_match.current_round, v_match.score_a, v_match.score_b,
      v_match.winner_id, NULL::timestamptz, NULL::integer;
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
      v_match.winner_id, NULL::timestamptz, NULL::integer;
    RETURN;
  END IF;

  v_score_a := v_match.score_a;
  v_score_b := v_match.score_b;

  -- Finalize DNF scoring -- upsert since a player who never guessed at all
  -- this round has no duel_round_results row yet.
  IF v_a_result.solved_at IS NULL THEN
    v_a_dnf_points := ROUND(COALESCE(v_a_result.best_proximity, 0))::int;
    INSERT INTO public.duel_round_results (match_id, round_index, user_id, guess_count, solved_at, best_proximity, points)
    VALUES (p_match_id, p_round_index, v_match.player_a, COALESCE(v_a_result.guess_count, 0), NULL,
      COALESCE(v_a_result.best_proximity, 0), v_a_dnf_points)
    ON CONFLICT (match_id, round_index, user_id) DO UPDATE SET points = v_a_dnf_points;
    v_score_a := v_score_a + v_a_dnf_points;
  END IF;

  IF v_b_result.solved_at IS NULL THEN
    v_b_dnf_points := ROUND(COALESCE(v_b_result.best_proximity, 0))::int;
    INSERT INTO public.duel_round_results (match_id, round_index, user_id, guess_count, solved_at, best_proximity, points)
    VALUES (p_match_id, p_round_index, v_match.player_b, COALESCE(v_b_result.guess_count, 0), NULL,
      COALESCE(v_b_result.best_proximity, 0), v_b_dnf_points)
    ON CONFLICT (match_id, round_index, user_id) DO UPDATE SET points = v_b_dnf_points;
    v_score_b := v_score_b + v_b_dnf_points;
  END IF;

  -- Keep in sync with lib/game/duelTiming.ts's INTERMISSION_MS.
  v_intermission_ends_at := v_now + interval '6 seconds';

  UPDATE public.duel_rounds SET intermission_ends_at = v_intermission_ends_at
  WHERE match_id = p_match_id AND round_index = p_round_index;

  -- MAX_ROUNDS (lib/duel/liveMatch.ts) is 3, 0-indexed -- round 2 is the last.
  IF p_round_index >= 2 THEN
    v_winner_id := CASE WHEN v_score_a = v_score_b THEN NULL
      WHEN v_score_a > v_score_b THEN v_match.player_a ELSE v_match.player_b END;

    UPDATE public.duel_matches
    SET status = 'finished', score_a = v_score_a, score_b = v_score_b, winner_id = v_winner_id, finished_at = v_now
    WHERE id = p_match_id;

    RETURN QUERY SELECT true, 'finished'::text, v_match.current_round, v_score_a, v_score_b, v_winner_id,
      v_intermission_ends_at, NULL::integer;
    RETURN;
  END IF;

  v_next_round_index := p_round_index + 1;
  UPDATE public.duel_matches
  SET status = 'intermission', current_round = v_next_round_index, score_a = v_score_a, score_b = v_score_b
  WHERE id = p_match_id;

  RETURN QUERY SELECT true, 'intermission'::text, v_next_round_index, v_score_a, v_score_b, NULL::uuid,
    v_intermission_ends_at, v_next_round_index;
END;
$$;
--> statement-breakpoint

-- Full current phase for resume/reconnect (CLAUDE.md: "a duel_state(match_id)
-- RPC returns the full current phase ... so a reloaded client rejoins at the
-- right beat"). Read-only, so no idempotency concerns. The duel_rounds join
-- is LEFT because the current round may not be stamped yet (lobby/countdown,
-- or intermission waiting on the next duel_begin_round call) -- those
-- timestamp columns simply come back null, which is the correct signal to
-- the caller that the round hasn't begun.
CREATE OR REPLACE FUNCTION public.duel_state(p_match_id integer)
RETURNS TABLE (
  match_status text,
  current_round integer,
  round_started_at timestamptz,
  round_ends_at timestamptz,
  round_intermission_ends_at timestamptz,
  score_a integer,
  score_b integer,
  winner_id uuid,
  rating_delta_a integer,
  rating_delta_b integer,
  player_a_id uuid,
  player_a_username text,
  player_a_display_name text,
  player_a_avatar_url text,
  player_a_rating integer,
  player_b_id uuid,
  player_b_username text,
  player_b_display_name text,
  player_b_avatar_url text,
  player_b_rating integer,
  server_now timestamptz
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dm.status, dm.current_round,
    dr.started_at, dr.ends_at, dr.intermission_ends_at,
    dm.score_a, dm.score_b, dm.winner_id,
    dm.rating_delta_a, dm.rating_delta_b,
    pa.id, pa.username, pa.display_name, pa.avatar_url, COALESCE(usa.duel_rating, 1000),
    pb.id, pb.username, pb.display_name, pb.avatar_url, COALESCE(usb.duel_rating, 1000),
    now()
  FROM public.duel_matches dm
  JOIN public.profiles pa ON pa.id = dm.player_a
  JOIN public.profiles pb ON pb.id = dm.player_b
  LEFT JOIN public.user_stats usa ON usa.user_id = dm.player_a
  LEFT JOIN public.user_stats usb ON usb.user_id = dm.player_b
  LEFT JOIN public.duel_rounds dr ON dr.match_id = dm.id AND dr.round_index = dm.current_round
  WHERE dm.id = p_match_id;
END;
$$;