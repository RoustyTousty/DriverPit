-- Deletes guest accounts that represent nobody (roadmap Pass 4a/4b).
--
-- WHERE THE GARBAGE CAME FROM. Until Pass 4a, AuthProvider signed every visitor
-- with no session in anonymously on MOUNT. Googlebot executes JavaScript and
-- carries no cookies between renders, so each crawl of each URL minted a
-- permanent auth.users + profiles + user_stats row -- multiplied by the several
-- hundred archive pages Pass 3 just added. That source is now closed; this
-- clears what it already produced, and what a real visitor who plays one guess
-- and never returns will keep producing at a much lower rate.
--
-- WHAT COUNTS AS GARBAGE, and the rule is deliberately conservative: a guest
-- (profiles.is_guest), older than 60 days, with NO trace of ever having played
-- -- no daily_results, no daily_progress, no infinite round, no duel match, no
-- queue row, no lobby, and default stats. Anything at all keeps the row. The
-- cost of keeping a dead guest is a few hundred bytes; the cost of deleting a
-- live one is a person's streak, rating and history, with no way back.
--
-- IT DELETES FROM auth.users, NOT FROM profiles. Everything else cascades from
-- there (profiles.id references auth.users with ON DELETE CASCADE, and
-- user_stats/daily_* cascade off profiles), so this is the one delete that
-- leaves nothing behind. Deleting the profile alone would strand the auth.users
-- row, which is the row the MAU meter actually counts.
--
-- BATCHED, and that is not a nicety. A single unbounded DELETE across
-- auth.users takes row locks on every matching row plus every cascade target
-- for the length of one transaction; GoTrue is reading that table on every
-- token refresh. p_limit caps one call, the workflow loops, and each batch
-- commits on its own.

CREATE OR REPLACE FUNCTION public.sweep_abandoned_guests(
  p_older_than_days integer DEFAULT 60,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted integer;
BEGIN
  -- Clamped rather than trusted, the same way every other RPC here re-clamps
  -- its inputs: a caller passing 0 would delete guests created seconds ago,
  -- including the one who is mid-guess right now.
  v_cutoff := now() - make_interval(days => GREATEST(COALESCE(p_older_than_days, 60), 7));

  WITH candidates AS (
    SELECT p.id
    FROM public.profiles p
    JOIN public.user_stats s ON s.user_id = p.id
    WHERE p.is_guest
      AND p.created_at < v_cutoff
      -- Never played a daily, in either sense: no recorded result and no board.
      AND NOT EXISTS (SELECT 1 FROM public.daily_results r WHERE r.user_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.daily_progress d WHERE d.user_id = p.id)
      -- No infinite round, matchmade or custom duel, queue row or lobby.
      AND NOT EXISTS (SELECT 1 FROM public.infinite_rounds i WHERE i.user_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.duel_matches m WHERE m.player_a = p.id OR m.player_b = p.id
      )
      AND NOT EXISTS (SELECT 1 FROM public.matchmaking_queue q WHERE q.user_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.duel_lobbies l WHERE l.host_id = p.id)
      -- Stats untouched. Redundant against the checks above for anything the
      -- app writes today, and deliberately kept: it is the one condition that
      -- still holds if a future feature writes user_stats through a path none
      -- of those tables record, and it costs nothing on an indexed PK join.
      AND s.games_played = 0
      AND s.wins = 0
      AND s.duel_wins = 0
      AND s.duel_losses = 0
      AND s.max_streak = 0
      AND s.last_daily_date IS NULL
    -- Oldest first, so repeated batches make monotonic progress instead of
    -- re-examining the same head of the table.
    ORDER BY p.created_at
    LIMIT GREATEST(COALESCE(p_limit, 500), 1)
  )
  DELETE FROM auth.users u
  USING candidates c
  WHERE u.id = c.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
--> statement-breakpoint

-- NOT CLIENT-CALLABLE. Postgres default-grants EXECUTE on a new function to
-- PUBLIC, and Supabase's bootstrap ALSO grants it to anon and authenticated by
-- name -- so revoking from PUBLIC alone would leave a mass-delete of auth.users
-- one anon-key PostgREST call away. Name every grantee (CLAUDE.md, "Supabase
-- function grants"); the only caller is the monthly workflow on the trusted
-- connection. Declared in lib/db/schemaGrants.test.ts, which fails until it is.
REVOKE EXECUTE ON FUNCTION public.sweep_abandoned_guests(integer, integer)
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- The sweep's own scan predicate: it filters guests by age, and without this it
-- is a sequential scan of profiles on every batch.
CREATE INDEX IF NOT EXISTS profiles_guest_created_at_idx
  ON public.profiles (created_at)
  WHERE is_guest;
