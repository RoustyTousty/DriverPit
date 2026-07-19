-- Server-authoritative stats writes only, from here on: recordDailyResult /
-- migrateLocalStats / resetUserStats (lib/stats/actions.ts) run through
-- Drizzle's trusted `db` connection, which bypasses RLS entirely. The
-- self-UPDATE policy from 0006 has no remaining legitimate use and is now
-- a live tamper vector (a client could otherwise PATCH its own
-- duel_rating directly via PostgREST) now that user_stats holds something
-- worth tampering with -- drop it. SELECT stays so the client can still
-- read its own stats.
DROP POLICY IF EXISTS "user_stats_update_own" ON public.user_stats;
--> statement-breakpoint

ALTER TABLE public.daily_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "daily_results_select_own" ON public.daily_results
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- Tidy any pre-existing dev/test rows created before guess_distribution's
-- default changed from an empty object to a proper 5-element array.
UPDATE public.user_stats
SET guess_distribution = '[0,0,0,0,0]'::jsonb
WHERE guess_distribution = '{}'::jsonb;
