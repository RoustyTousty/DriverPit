-- Custom SQL migration file, put your code below! --

-- Round length bumped from 45s to 60s (lib/duel/liveMatch.ts's ROUND_MS) --
-- only round 0's ends_at, stamped here at match-creation time, needs a SQL
-- change; rounds 1 and 2 are scheduled by tryAdvanceRound() in application
-- code, which already reads ROUND_MS directly. The 45s *rating-widening*
-- threshold below (how long a queued player waits before matchmaking
-- accepts anyone regardless of rating) is unrelated and untouched.
CREATE OR REPLACE FUNCTION public.match_or_queue(p_pool_window text)
RETURNS TABLE (
  match_id integer,
  opponent_id uuid,
  opponent_username text,
  opponent_display_name text,
  opponent_avatar_url text,
  you_are text,
  match_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_rating int;
  v_existing record;
  v_candidate record;
  v_new_match_id integer;
  v_new_match_created_at timestamptz;
  v_round_started_at timestamptz;
  v_round_ends_at timestamptz;
  v_target_driver_id integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotent fast path: a reconnect, a duplicate tab, or a poll that
  -- landed after another one of our own calls (or the opponent's call)
  -- already created the match. Never re-search or re-queue in that case.
  SELECT
    dm.id AS match_id,
    opp.id AS opponent_id,
    opp.username AS opponent_username,
    opp.display_name AS opponent_display_name,
    opp.avatar_url AS opponent_avatar_url,
    CASE WHEN dm.player_a = v_user_id THEN 'a' ELSE 'b' END AS you_are,
    dm.created_at AS match_created_at
  INTO v_existing
  FROM public.duel_matches dm
  JOIN public.profiles opp
    ON opp.id = (CASE WHEN dm.player_a = v_user_id THEN dm.player_b ELSE dm.player_a END)
  WHERE dm.status = 'active' AND (dm.player_a = v_user_id OR dm.player_b = v_user_id)
  ORDER BY dm.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.match_id, v_existing.opponent_id, v_existing.opponent_username,
      v_existing.opponent_display_name, v_existing.opponent_avatar_url,
      v_existing.you_are, v_existing.match_created_at;
    RETURN;
  END IF;

  SELECT duel_rating INTO v_rating FROM public.user_stats WHERE user_id = v_user_id;
  IF v_rating IS NULL THEN
    v_rating := 1000;
  END IF;

  -- Widen the acceptable rating gap by 50 every 5s a candidate has been
  -- waiting; past 45s, accept anyone in the pool regardless of rating.
  SELECT
    mq.user_id, p.username, p.display_name, p.avatar_url
  INTO v_candidate
  FROM public.matchmaking_queue mq
  JOIN public.profiles p ON p.id = mq.user_id
  WHERE mq.pool_window = p_pool_window
    AND mq.user_id <> v_user_id
    AND mq.status = 'waiting'
    AND (
      now() - mq.queued_at > interval '45 seconds'
      OR abs(mq.rating - v_rating) <= (100 + floor(extract(epoch FROM (now() - mq.queued_at)) / 5) * 50)
    )
  ORDER BY mq.queued_at ASC
  FOR UPDATE OF mq SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    -- Remove the claimed opponent -- and our own stale row, if this call
    -- is itself a re-poll after an earlier enqueue -- before anything else
    -- can see either as available.
    DELETE FROM public.matchmaking_queue WHERE user_id = v_candidate.user_id;
    DELETE FROM public.matchmaking_queue WHERE user_id = v_user_id;

    INSERT INTO public.duel_matches (player_a, player_b, status, current_round)
    VALUES (v_candidate.user_id, v_user_id, 'active', 0)
    RETURNING id, created_at INTO v_new_match_id, v_new_match_created_at;

    v_round_started_at := v_new_match_created_at + interval '5 seconds';
    v_round_ends_at := v_round_started_at + interval '60 seconds';

    SELECT id INTO v_target_driver_id
    FROM public.drivers
    WHERE last_active_year >= extract(year FROM now())::int - 10
    ORDER BY random()
    LIMIT 1;

    INSERT INTO public.duel_rounds (match_id, round_index, driver_id, started_at, ends_at)
    VALUES (v_new_match_id, 0, v_target_driver_id, v_round_started_at, v_round_ends_at);

    RETURN QUERY SELECT
      v_new_match_id, v_candidate.user_id, v_candidate.username,
      v_candidate.display_name, v_candidate.avatar_url,
      'b'::text, v_new_match_created_at;
    RETURN;
  END IF;

  -- No eligible opponent right now -- take our place in line. ON CONFLICT
  -- covers a duplicate call (double tab, a retry) without erroring, and
  -- deliberately never touches queued_at -- resetting it on every poll
  -- would defeat the widening logic above for our own wait.
  INSERT INTO public.matchmaking_queue (user_id, pool_window, rating, status, queued_at)
  VALUES (v_user_id, p_pool_window, v_rating, 'waiting', now())
  ON CONFLICT (user_id) DO UPDATE
    SET pool_window = EXCLUDED.pool_window,
        rating = EXCLUDED.rating;

  RETURN QUERY SELECT
    NULL::integer, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
END;
$$;
