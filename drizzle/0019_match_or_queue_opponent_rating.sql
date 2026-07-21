-- Custom SQL migration file, put your code below! --

-- match_or_queue() now also returns the opponent's duel_rating, so
-- MatchFoundReveal can show both players' ratings side by side. The
-- caller's own rating doesn't need a column here -- it's already available
-- client-side via AuthProvider's `stats.duelRating`, no server round trip
-- needed for that half.
--
-- IMPORTANT: this REPLACEs the whole function body, so it has to carry
-- forward everything 0013 (drizzle/0013_duel_round_lifecycle.sql) added --
-- stamping round 0's duel_rounds row at match-creation time -- not just
-- diff in the opponent_rating column against 0012's older version. An
-- earlier revision of this migration was written against 0012's body and
-- silently dropped that round-0 stamping: every new match got a
-- duel_matches row but zero duel_rounds rows, so getDuelRoundState() 404'd
-- immediately after matchmaking succeeded ("Round not found"), which is
-- what a live match flashing in and instantly ending looks like from the
-- client. Also takes the opportunity to fix round 0's duration, hardcoded
-- here as 45s while every other round uses ROUND_MS (60s, lib/duel/liveMatch.ts)
-- -- an unrelated but adjacent drift, now consistent.
CREATE OR REPLACE FUNCTION public.match_or_queue(p_pool_window text)
RETURNS TABLE (
  match_id integer,
  opponent_id uuid,
  opponent_username text,
  opponent_display_name text,
  opponent_avatar_url text,
  opponent_rating int,
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
    opp_stats.duel_rating AS opponent_rating,
    CASE WHEN dm.player_a = v_user_id THEN 'a' ELSE 'b' END AS you_are,
    dm.created_at AS match_created_at
  INTO v_existing
  FROM public.duel_matches dm
  JOIN public.profiles opp
    ON opp.id = (CASE WHEN dm.player_a = v_user_id THEN dm.player_b ELSE dm.player_a END)
  LEFT JOIN public.user_stats opp_stats ON opp_stats.user_id = opp.id
  WHERE dm.status = 'active' AND (dm.player_a = v_user_id OR dm.player_b = v_user_id)
    -- Never hand back a match with no round row for its current_round --
    -- the exact shape of the matches an earlier, buggy version of this
    -- function created (see comment above), and a match in that state can
    -- never actually be played. Skipping it here lets a caller stuck on
    -- one of those fall through to a fresh pairing/enqueue instead of
    -- reconnecting to the same dead match every time.
    AND EXISTS (
      SELECT 1 FROM public.duel_rounds dr
      WHERE dr.match_id = dm.id AND dr.round_index = dm.current_round
    )
  ORDER BY dm.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.match_id, v_existing.opponent_id, v_existing.opponent_username,
      v_existing.opponent_display_name, v_existing.opponent_avatar_url,
      v_existing.opponent_rating, v_existing.you_are, v_existing.match_created_at;
    RETURN;
  END IF;

  SELECT duel_rating INTO v_rating FROM public.user_stats WHERE user_id = v_user_id;
  IF v_rating IS NULL THEN
    v_rating := 1000;
  END IF;

  -- Widen the acceptable rating gap by 50 every 5s a candidate has been
  -- waiting; past 45s, accept anyone in the pool regardless of rating.
  SELECT
    mq.user_id, p.username, p.display_name, p.avatar_url, mq.rating
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

    -- Round 0 stamped here, server-side, in the same transaction that
    -- creates the match -- see drizzle/0013_duel_round_lifecycle.sql for
    -- why (no separate "start round 1" call, no race over who starts it).
    -- Keep these two durations in sync with REVEAL_MS / ROUND_MS in
    -- lib/duel/liveMatch.ts if either changes.
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
      v_candidate.rating, 'b'::text, v_new_match_created_at;
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
    NULL::integer, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::timestamptz;
END;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.match_or_queue(text) TO authenticated;
