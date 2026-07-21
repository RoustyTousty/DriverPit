-- Custom SQL migration file, put your code below! --

-- Fixes a real race in match_or_queue() (drizzle/0019_match_or_queue_opponent_rating.sql):
-- `FOR UPDATE OF mq SKIP LOCKED` only guards against two callers claiming
-- the *same* candidate row. It does nothing for the reciprocal case, which
-- is the common one here since both waiting clients poll on the same fixed
-- interval (POLL_INTERVAL_MS in MatchmakingLobby.tsx): user A's call and
-- user B's call running concurrently, each treating the *other's* queue
-- row as its own candidate. Those are two different rows, so there's no
-- lock contention to stop either transaction.
--
-- Depending on exact timing this produces one of two broken outcomes,
-- both matching the reported bug (matched, then instantly ends; stuck
-- doing that forever afterward):
--   - Both transactions commit: two separate duel_matches rows get created
--     for the same pair (once with A as player_a, once as player_b), and
--     the two real players end up subscribed to two different
--     `duel:{matchId}` channels -- each thinks they matched, but their
--     actual opponent is in the other room and never appears.
--   - The two transactions' overlapping SELECT ... FOR UPDATE (each on the
--     other's row) plus the later unconditional DELETEs form a lock cycle
--     Postgres detects as a deadlock and aborts one side entirely mid-
--     function. Either way, nothing here ever stopped it from happening.
--
-- Fix: serialize the whole "read existing match / find candidate / delete
-- both / insert match" decision per pool_window with a session-scoped
-- advisory lock. It auto-releases at transaction end (this function always
-- runs as its own implicit transaction via the RPC call), so it can't be
-- left held on error, and it costs nothing when only one caller is
-- matchmaking for a given pool at a time -- duel volume doesn't call for
-- anything finer-grained than "one pairing decision at a time per pool".
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

  -- Everything below this point -- the idempotent reconnect check, the
  -- candidate scan, and the pairing itself -- has to happen as a single
  -- serialized decision per pool, or two concurrent callers can each walk
  -- through it believing they're the only one. See the migration comment
  -- above for exactly how that goes wrong without this.
  PERFORM pg_advisory_xact_lock(hashtext('match_or_queue:' || p_pool_window)::bigint);

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
  -- The advisory lock above means SKIP LOCKED here never actually has
  -- anything concurrent to skip anymore -- kept anyway since it's still
  -- correct and free, and it's one less thing to unwind if this ever needs
  -- to be relaxed to a narrower per-pair lock later.
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
