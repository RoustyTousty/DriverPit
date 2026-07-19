-- Custom SQL migration file, put your code below! --

-- RLS: self-only for matchmaking_queue (no client INSERT/UPDATE at all --
-- every write goes through match_or_queue() below, which derives rating
-- server-side so a client can never claim a favorable one). Cancelling out
-- of the queue is low-stakes (you can only ever delete your own row), so
-- that's a plain self-DELETE policy rather than another SECURITY DEFINER
-- function.
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "matchmaking_queue_select_own" ON public.matchmaking_queue
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint
CREATE POLICY "matchmaking_queue_delete_own" ON public.matchmaking_queue
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

GRANT SELECT, DELETE ON public.matchmaking_queue TO authenticated;
--> statement-breakpoint

-- Hot path for match_or_queue()'s candidate scan below.
CREATE INDEX "matchmaking_queue_pool_status_idx" ON public.matchmaking_queue ("pool_window", "status", "queued_at");
--> statement-breakpoint

-- RLS: participants can read their own match (needed for the lobby reveal
-- and, later, round state); no client-facing write policy at all -- every
-- write (create on match, score/round updates once that lands) goes
-- through SECURITY DEFINER functions, same reasoning as user_stats.
ALTER TABLE public.duel_matches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "duel_matches_select_participant" ON public.duel_matches
  FOR SELECT TO authenticated
  USING (auth.uid() = player_a OR auth.uid() = player_b);
--> statement-breakpoint

GRANT SELECT ON public.duel_matches TO authenticated;
--> statement-breakpoint

-- Round gameplay isn't built yet (no reads or writes anywhere in the app
-- reference these two tables), but leaving a table RLS-disabled the moment
-- it exists is a footgun waiting to happen -- lock them down now (deny-all,
-- no policies) rather than remembering to do it once round gameplay lands.
ALTER TABLE public.duel_rounds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.duel_round_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Atomically pairs the calling user with a waiting opponent, or enqueues
-- them if none is eligible yet. SECURITY DEFINER so it can see every
-- waiting row (RLS above restricts the client to its own), and so it can
-- read the caller's authoritative rating from user_stats itself -- never
-- trust a client-supplied rating for matchmaking fairness.
--
-- Double-matching is prevented by `FOR UPDATE OF mq SKIP LOCKED`: this
-- transaction locks whichever candidate row it selects, and any concurrent
-- caller racing for that same row skips it (rather than blocking) and
-- falls through to the next candidate or to enqueueing. The claimed row is
-- deleted before the match is created, all inside this one transaction, so
-- there's never a window where two different callers could both come away
-- with a match against the same waiting player.
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

    INSERT INTO public.duel_matches (player_a, player_b, status)
    VALUES (v_candidate.user_id, v_user_id, 'active')
    RETURNING id, created_at INTO v_new_match_id, v_new_match_created_at;

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
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.match_or_queue(text) TO authenticated;
