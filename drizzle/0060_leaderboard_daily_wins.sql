-- The leaderboard grows a third board -- total daily wins -- and the streak
-- board switches from the live streak to the lifetime best.
--
-- WHY THE VIEW HAS TO CHANGE AT ALL. getLeaderboard() reads ONLY this view,
-- never profiles/user_stats directly, and it ORDER BYs inside the database
-- (lib/leaderboard/actions.ts) -- that is what keeps a public board from ever
-- selecting a column nobody agreed to show every visitor (drizzle/0009). So a
-- board ranked on user_stats.wins needs that column exposed here first.
--
-- Named daily_wins, not wins: duel_wins is already a column on this view, and
-- two win counts one word apart is a mis-read waiting to happen -- in the rank
-- subqueries above all, where picking the wrong one still parses, still runs
-- and still returns a plausible number (lib/leaderboard/rank.ts documents the
-- sibling trap that already cost this view an every-viewer-is-rank-1 bug).
--
-- current_streak STAYS, decay and all (drizzle/0037), even though nothing
-- ranks on it any more. CREATE OR REPLACE VIEW can append a column but cannot
-- drop one, so removing it means DROP + CREATE, which discards the grants
-- drizzle/0009 and drizzle/0048 settled and lib/db/schemaGrants.test.ts pins.
-- A carried column costs nothing; a re-granted view is exactly the kind of
-- thing that comes back slightly wrong.
--
-- max_streak needs no decay clause of its own and never did: it is a lifetime
-- record rather than a live streak, so an account that stops playing keeps its
-- best -- which is the whole point of ranking on it. The 0037 rule is about
-- current_streak alone.
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  p.id,
  p.username,
  p.display_name,
  p.avatar_url,
  s.duel_rating,
  s.duel_wins,
  s.duel_losses,
  CASE
    WHEN s.last_daily_date >= (now() AT TIME ZONE 'UTC')::date - 1 THEN s.current_streak
    ELSE 0
  END AS current_streak,
  s.max_streak,
  s.wins AS daily_wins
FROM public.profiles p
JOIN public.user_stats s ON s.user_id = p.id
WHERE p.is_guest = false;
