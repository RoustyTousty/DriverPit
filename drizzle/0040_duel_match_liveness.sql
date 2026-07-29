-- Gives the server its own evidence that a duel player is still present, so
-- "my opponent disconnected" stops being a claim it has to take on trust.
-- Closes audit 2026-07-27 §3.3.
--
-- THE PROBLEM. forfeitMatch (lib/duel/actions.ts) takes the id of the player
-- being forfeited, because the disconnect path is the REMAINING player calling
-- it on the absent one's behalf after DISCONNECT_GRACE_MS. Its only checks were
-- "the caller is a participant" and "the target is a participant" -- both true
-- of an attacker forfeiting their live opponent mid-match. That set
-- status='abandoned', winner_id=<attacker> and wrote real Elo through
-- applyMatchResult: a guaranteed win on demand, farming duel_rating, which is
-- the primary leaderboard sort. drizzle/0026's own comment named the gap ("the
-- server has no presence view of its own, so it cannot verify absence --
-- accepted for v1"); it is worth re-weighing now that a public leaderboard
-- ranks on the result.
--
-- WHY A HEARTBEAT AND NOT PRESENCE. What has to be proven alive is a *player in
-- a match*, and the proof has to be readable by Postgres at the moment the
-- forfeit is authorized. Realtime presence tracks a WebSocket in a service the
-- database cannot query, and the two genuinely disagree in both directions (a
-- dropped channel with a healthy tab; a tracked channel from a frozen one).
-- Same reasoning drizzle/0032 already applied to matchmaking_queue.last_seen_at,
-- and the same shape: a column, an idempotent RPC that refreshes it, and a
-- staleness window.
--
-- WHAT THIS COSTS. One tiny UPDATE per player per DUEL_HEARTBEAT_MS (5s) while
-- a match is on screen -- roughly 50 per player over a full ~4-minute match, and
-- it stops on its own the moment the match goes terminal (see `live` below).
-- Deliberately NOT folded into duel_submit_guess: that is the hot path every
-- other design decision in this codebase protects, and adding a duel_matches
-- write to it would put a guess behind a row lock duel_close_round also takes.
-- The heartbeat is off every path a player waits on.

ALTER TABLE public.duel_matches
  ADD COLUMN IF NOT EXISTS last_seen_a timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE public.duel_matches
  ADD COLUMN IF NOT EXISTS last_seen_b timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint

-- Liveness beat from a client that currently has this match on screen (staging,
-- countdown, any round, intermission). Authorizes off auth.uid() and writes only
-- the caller's OWN column, so a client can no more forge its opponent's
-- presence than it can forge its own identity.
--
-- Returns whether the match is still live. A terminal match updates nothing
-- (the WHERE excludes it), so the caller gets `false` and stops beating -- which
-- is what keeps a player idling on the results screen deciding about a rematch
-- from writing to the database every 5 seconds forever.
CREATE OR REPLACE FUNCTION public.duel_heartbeat(p_match_id integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.duel_matches
  SET last_seen_a = CASE WHEN player_a = v_user_id THEN now() ELSE last_seen_a END,
      last_seen_b = CASE WHEN player_b = v_user_id THEN now() ELSE last_seen_b END
  WHERE id = p_match_id
    AND (player_a = v_user_id OR player_b = v_user_id)
    AND status NOT IN ('finished', 'abandoned');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;
--> statement-breakpoint

-- Explicit grant decision, stated here rather than inherited (CLAUDE.md
-- "Supabase function grants"; drizzle/0039 for why naming the roles matters).
-- Every visitor holds at least an anonymous session, so `authenticated` is the
-- grantee; `anon` means "no user JWT at all", which the null auth.uid() check
-- above rejects anyway.
REVOKE EXECUTE ON FUNCTION public.duel_heartbeat(integer) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_heartbeat(integer) TO authenticated;
