-- Custom SQL migration file, put your code below! --

-- Fixes a real conflict between this function and the ready-gated lifecycle
-- built in drizzle/0021 (duel_begin_round/duel_close_round/duel_state): up
-- to now, match_or_queue created a brand-new match already 'active' with
-- round 0 pre-stamped (started_at = created_at + 5s) -- there was no
-- ready-gate at all for round 0, exactly the "round timer starts before
-- both players are looking at the board" bug CLAUDE.md's lifecycle section
-- exists to fix. Once a UI actually calls duel_begin_round(match, 0) after
-- both clients report ready (see CLAUDE.md's Duel "Flow" steps 3-4), that
-- call would find round 0 already stamped from minutes/longer ago and just
-- echo back an already-expired timer -- the ready-gate would be a no-op.
--
-- Fix: a freshly-paired match is created in 'lobby' status (CLAUDE.md's
-- lifecycle: lobby -> countdown -> active -> ...) with NO duel_rounds row
-- at all. duel_begin_round is now the *only* thing that ever creates round
-- 0 and flips the match to 'active', exactly the same as every later round.
-- Also now returns the opponent's duel win/loss record (their rating was
-- already here) -- the match-found staging screen shows both. That's 2 new
-- output columns, which CREATE OR REPLACE can't apply to an existing
-- function's RETURNS TABLE (Postgres errors "cannot change return type of
-- existing function") -- drop it first.
DROP FUNCTION IF EXISTS public.match_or_queue(text);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.match_or_queue(p_pool_window text)
RETURNS TABLE (
  match_id integer,
  opponent_id uuid,
  opponent_username text,
  opponent_display_name text,
  opponent_avatar_url text,
  opponent_rating integer,
  opponent_duel_wins integer,
  opponent_duel_losses integer,
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Everything below this point -- the idempotent reconnect check, the
  -- candidate scan, and the pairing itself -- has to happen as a single
  -- serialized decision per pool, or two concurrent callers can each walk
  -- through it believing they're the only one.
  PERFORM pg_advisory_xact_lock(hashtext('match_or_queue:' || p_pool_window)::bigint);

  -- Idempotent fast path: a reconnect, a duplicate tab, or a poll that
  -- landed after another of our own calls (or the opponent's) already
  -- created the match. Covers every non-terminal status, not just
  -- 'active' -- a fresh 'lobby' match is exactly as valid a reconnect
  -- target as an already-active one. A 'lobby' match deliberately has no
  -- duel_rounds row yet (that's this migration's whole point), so the
  -- "must have a round for current_round" guard only applies once a match
  -- has moved past 'lobby' -- it exists to skip the dead-match shape an
  -- older, buggy version of this function could produce (see
  -- drizzle/0019's migration comment), never a real 'lobby' match.
  SELECT
    dm.id AS match_id,
    opp.id AS opponent_id,
    opp.username AS opponent_username,
    opp.display_name AS opponent_display_name,
    opp.avatar_url AS opponent_avatar_url,
    opp_stats.duel_rating AS opponent_rating,
    opp_stats.duel_wins AS opponent_duel_wins,
    opp_stats.duel_losses AS opponent_duel_losses,
    CASE WHEN dm.player_a = v_user_id THEN 'a' ELSE 'b' END AS you_are,
    dm.created_at AS match_created_at
  INTO v_existing
  FROM public.duel_matches dm
  JOIN public.profiles opp
    ON opp.id = (CASE WHEN dm.player_a = v_user_id THEN dm.player_b ELSE dm.player_a END)
  LEFT JOIN public.user_stats opp_stats ON opp_stats.user_id = opp.id
  WHERE dm.status NOT IN ('finished', 'abandoned')
    AND (dm.player_a = v_user_id OR dm.player_b = v_user_id)
    AND (
      dm.status = 'lobby'
      OR EXISTS (
        SELECT 1 FROM public.duel_rounds dr
        WHERE dr.match_id = dm.id AND dr.round_index = dm.current_round
      )
    )
  ORDER BY dm.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.match_id, v_existing.opponent_id, v_existing.opponent_username,
      v_existing.opponent_display_name, v_existing.opponent_avatar_url,
      v_existing.opponent_rating, v_existing.opponent_duel_wins, v_existing.opponent_duel_losses,
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
    mq.user_id, p.username, p.display_name, p.avatar_url, mq.rating,
    us.duel_wins, us.duel_losses
  INTO v_candidate
  FROM public.matchmaking_queue mq
  JOIN public.profiles p ON p.id = mq.user_id
  LEFT JOIN public.user_stats us ON us.user_id = mq.user_id
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

    -- 'lobby', no duel_rounds row -- see this migration's header comment.
    -- duel_begin_round(match_id, 0) is what stamps round 0 and flips this
    -- to 'active', once both clients have reported ready (or timed out).
    INSERT INTO public.duel_matches (player_a, player_b, status, current_round)
    VALUES (v_candidate.user_id, v_user_id, 'lobby', 0)
    RETURNING id, created_at INTO v_new_match_id, v_new_match_created_at;

    RETURN QUERY SELECT
      v_new_match_id, v_candidate.user_id, v_candidate.username,
      v_candidate.display_name, v_candidate.avatar_url,
      v_candidate.rating, v_candidate.duel_wins, v_candidate.duel_losses,
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
    NULL::integer, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::timestamptz;
END;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.match_or_queue(text) TO authenticated;
