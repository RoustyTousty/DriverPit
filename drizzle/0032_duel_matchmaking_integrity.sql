-- Matchmaking queue integrity: closes a rating-farming self-match vector.
--
-- THE BUG: a player queues while signed in, then signs out. Nothing ever
-- removed their matchmaking_queue row, and sign-out immediately establishes a
-- NEW anonymous identity. match_or_queue's only self-match guard was
-- `mq.user_id <> v_user_id` -- which the stale row passes, because it belongs to
-- the *previous* user id. The same person is paired with themselves and
-- duel_forfeit/close_round write real duel_rating to both sides.
--
-- Four independent layers, so no single failure can produce a self-match. Two
-- live here; the other two are client-side (explicit dequeue on every exit from
-- searching including before signOut(); aborting the search on identity change
-- rather than re-queueing) -- see lib/duel/matchmaking.ts and
-- components/duel/DuelSearching.tsx.
--
--   L3 LIVENESS   last_seen_at, refreshed by the searching client. A row not
--                 refreshed inside the stale window is ignored by the candidate
--                 scan AND deleted by the sweep -- so a leaked row (crash, lost
--                 tab, failed dequeue) becomes inert on its own.
--   L4 DEVICE     device_id, stable per browser profile and SURVIVING an
--                 identity swap (localStorage, not the session). The scan
--                 refuses any row sharing our device_id, and separately any row
--                 sharing our user_id. This is the layer that specifically
--                 defeats the reported bug, since the one thing the attacker
--                 cannot change by signing out is which browser they are in.
--
-- Both guards live INSIDE the single locked SELECT ... FOR UPDATE SKIP LOCKED
-- that claims the opponent -- never a read-then-check afterwards, which would
-- just trade this bug for a race.
--
-- Plus a hard database invariant (a CHECK on duel_matches) that makes a
-- self-match row unrepresentable no matter what any future code path does.

-- The queue is ephemeral by construction -- every searching client re-enqueues
-- on its next poll (MATCHMAKE_POLL_INTERVAL_MS). Clearing it lets the new
-- columns be NOT NULL with no backfill guesswork, and purges any row currently
-- leaked by the bug above.
DELETE FROM public.matchmaking_queue;
--> statement-breakpoint

ALTER TABLE public.matchmaking_queue
  ADD COLUMN "last_seen_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint

-- Nullable would silently opt a row out of the device guard
-- (`IS DISTINCT FROM` against NULL never matches), which is exactly the hole
-- this column exists to close -- so it is NOT NULL and every write stamps it.
ALTER TABLE public.matchmaking_queue
  ADD COLUMN "device_id" text NOT NULL;
--> statement-breakpoint

CREATE INDEX "matchmaking_queue_last_seen_idx" ON public.matchmaking_queue ("last_seen_at");
--> statement-breakpoint
CREATE INDEX "matchmaking_queue_device_idx" ON public.matchmaking_queue ("device_id");
--> statement-breakpoint

-- Any self-match already created by the exploit. Cascades to duel_rounds /
-- duel_round_results. NOTE: this removes the match rows, but does NOT undo
-- duel_rating/duel_wins already written into user_stats by such a match --
-- those are aggregates with no per-match audit trail to reverse. Any rating
-- correction is a separate, manual decision.
DELETE FROM public.duel_matches WHERE player_a = player_b;
--> statement-breakpoint

-- The invariant, enforced by the database rather than by whoever writes the
-- next matchmaking path. Nothing legitimate ever needs a match against oneself.
ALTER TABLE public.duel_matches
  ADD CONSTRAINT "duel_matches_distinct_players_check" CHECK (player_a <> player_b);
--> statement-breakpoint

-- L1: explicit dequeue. Idempotent by construction -- deleting zero rows is a
-- success, so this is safe to call twice, safe when never queued, and safe to
-- fire from an unmount that races the poll. SECURITY DEFINER + auth.uid() so a
-- caller can only ever remove their OWN row (a plain client DELETE could
-- previously be aimed at any row the RLS policy allowed).
CREATE OR REPLACE FUNCTION public.duel_leave_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM public.matchmaking_queue WHERE user_id = v_user_id;
END;
$$;
--> statement-breakpoint

-- L3: the heartbeat the searching client calls on an interval. A no-op when the
-- caller is not queued (0 rows updated), so it never resurrects a row that a
-- dequeue or a pairing already removed.
-- Keep the client cadence (QUEUE_HEARTBEAT_MS, lib/game/duelTiming.ts)
-- comfortably under the stale window below.
CREATE OR REPLACE FUNCTION public.duel_queue_heartbeat()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE public.matchmaking_queue SET last_seen_at = now() WHERE user_id = v_user_id;
END;
$$;
--> statement-breakpoint

-- L3: the sweep. Called at the top of every real match_or_queue search (below),
-- so it needs no cron to stay effective; exposed separately so a pg_cron job or
-- a test can drive it directly. Returns how many rows it removed.
-- The 15s window must stay in sync with QUEUE_STALE_MS in
-- lib/game/duelTiming.ts and with the candidate scan's own filter below.
CREATE OR REPLACE FUNCTION public.duel_sweep_stale_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.matchmaking_queue
  WHERE last_seen_at < now() - interval '15 seconds';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
--> statement-breakpoint

-- match_or_queue gains p_device_id, so the signature changes -- CREATE OR
-- REPLACE cannot do that, and the old single-argument overload must be dropped
-- or PostgREST would happily keep resolving calls to the unguarded version.
DROP FUNCTION IF EXISTS public.match_or_queue(text);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.match_or_queue(p_pool_window text, p_device_id text)
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
  -- A missing/blank device id would opt this caller out of the device guard.
  -- Refuse rather than degrade to the vulnerable behaviour.
  IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'A device id is required to matchmake';
  END IF;

  -- Everything below -- the idempotent reconnect check, the candidate scan, and
  -- the pairing itself -- has to happen as a single serialized decision per
  -- pool, or two concurrent callers can each walk through it believing they're
  -- the only one. See drizzle/0020's comment for exactly how that goes wrong.
  PERFORM pg_advisory_xact_lock(hashtext('match_or_queue:' || p_pool_window)::bigint);

  -- Idempotent fast path: a reconnect, a duplicate tab, or a poll that landed
  -- after another of our own calls (or the opponent's) already created the
  -- match. Covers every non-terminal status; a 'lobby' match deliberately has
  -- no duel_rounds row yet, so the "must have a round for current_round" guard
  -- only applies once a match has moved past 'lobby' (see drizzle/0023).
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

  -- L3: drop everything that stopped heart-beating before it can be considered.
  PERFORM public.duel_sweep_stale_queue();

  -- L4, remediation half: this browser's own rows under any OTHER identity.
  -- That is precisely the row the sign-out bug leaves behind, and clearing it
  -- here means even a client that never called duel_leave_queue converges the
  -- moment it searches again under its new identity.
  DELETE FROM public.matchmaking_queue
  WHERE device_id = p_device_id AND user_id <> v_user_id;

  SELECT duel_rating INTO v_rating FROM public.user_stats WHERE user_id = v_user_id;
  IF v_rating IS NULL THEN
    v_rating := 1000;
  END IF;

  -- Widen the acceptable rating gap by 50 every 5s a candidate has been
  -- waiting; past 45s, accept anyone in the pool regardless of rating.
  --
  -- The three integrity guards are part of THIS statement's WHERE clause, so a
  -- row that fails any of them is never even claimed by the FOR UPDATE -- there
  -- is no window between checking and claiming for a concurrent caller to
  -- exploit. Keep the 15s literal in sync with duel_sweep_stale_queue above.
  SELECT
    mq.user_id, mq.device_id, p.username, p.display_name, p.avatar_url, mq.rating,
    us.duel_wins, us.duel_losses
  INTO v_candidate
  FROM public.matchmaking_queue mq
  JOIN public.profiles p ON p.id = mq.user_id
  LEFT JOIN public.user_stats us ON us.user_id = mq.user_id
  WHERE mq.pool_window = p_pool_window
    AND mq.status = 'waiting'
    AND mq.user_id <> v_user_id                       -- never our own identity
    AND mq.device_id IS DISTINCT FROM p_device_id     -- never our own browser
    AND mq.last_seen_at > now() - interval '15 seconds'  -- never a dead row
    AND (
      now() - mq.queued_at > interval '45 seconds'
      OR abs(mq.rating - v_rating) <= (100 + floor(extract(epoch FROM (now() - mq.queued_at)) / 5) * 50)
    )
  ORDER BY mq.queued_at ASC
  FOR UPDATE OF mq SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    -- Defence in depth, NOT the guard itself (that's the WHERE above). If a
    -- future edit ever loosens those predicates this fails loudly instead of
    -- silently pairing someone with themselves and writing ratings for it.
    IF v_candidate.user_id = v_user_id OR v_candidate.device_id IS NOT DISTINCT FROM p_device_id THEN
      RAISE EXCEPTION 'refusing to pair a player with themselves (user % / device %)',
        v_user_id, p_device_id;
    END IF;

    -- Remove the claimed opponent -- and our own row, if this call is itself a
    -- re-poll after an earlier enqueue -- before anything else can see either.
    DELETE FROM public.matchmaking_queue WHERE user_id = v_candidate.user_id;
    DELETE FROM public.matchmaking_queue WHERE user_id = v_user_id;

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
  -- deliberately never touches queued_at -- resetting it on every poll would
  -- defeat the widening logic above for our own wait. last_seen_at IS
  -- refreshed, since a poll is itself proof of life.
  INSERT INTO public.matchmaking_queue (user_id, pool_window, rating, status, queued_at, last_seen_at, device_id)
  VALUES (v_user_id, p_pool_window, v_rating, 'waiting', now(), now(), p_device_id)
  ON CONFLICT (user_id) DO UPDATE
    SET pool_window = EXCLUDED.pool_window,
        rating = EXCLUDED.rating,
        last_seen_at = now(),
        device_id = EXCLUDED.device_id;

  RETURN QUERY SELECT
    NULL::integer, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::timestamptz;
END;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.match_or_queue(text, text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_leave_queue() TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_queue_heartbeat() TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_sweep_stale_queue() TO authenticated;
--> statement-breakpoint

-- The old self-DELETE policy is now redundant: duel_leave_queue() is the only
-- supported way out of the queue, and it authorizes via auth.uid() inside a
-- SECURITY DEFINER body. Dropping the client's direct DELETE grant removes the
-- last path that writes this table without going through a vetted RPC.
DROP POLICY IF EXISTS "matchmaking_queue_delete_own" ON public.matchmaking_queue;
--> statement-breakpoint
REVOKE DELETE ON public.matchmaking_queue FROM authenticated;
