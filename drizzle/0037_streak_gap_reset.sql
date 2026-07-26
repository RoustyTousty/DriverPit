-- Daily streaks must break when a day is MISSED, not only when a day is lost.
--
-- Before this, user_stats.current_streak was `won ? streak + 1 : 0` with no
-- notion of when the previous result was (lib/stats/recordDailyResult.ts), and
-- nothing ever re-evaluated a stored streak against the calendar. Two bugs:
--   * a win after a gap incremented the old streak instead of restarting it;
--   * never playing again froze a streak forever -- including on the streak
--     leaderboard, which ORDER BYs this column, so an abandoned account
--     outranked an active one indefinitely.
--
-- last_daily_date is the minimum state that fixes both: the UTC day of the most
-- recently recorded daily result. The write path continues the streak only when
-- it's the day before (lib/stats/streak.ts#nextCurrentStreak); every read path
-- treats the stored streak as 0 unless it's today or yesterday
-- (#currentStreakAsOf, and the view below). Decay-on-read rather than a nightly
-- sweep: it needs no cron, and it's exact the moment the UTC day turns over
-- instead of whenever a job happens to run.

ALTER TABLE "user_stats" ADD COLUMN "last_daily_date" date;
--> statement-breakpoint

-- Backfill from daily_results, which has held one row per (user, day played)
-- since drizzle/0007 and is therefore an exact record of this. Without it every
-- existing row would look unanchored and lose its streak on deploy. Rows that
-- stay null genuinely have no server-side daily history -- a non-zero streak on
-- one can only have come from the legacy localStorage merge (migrateLocalStats),
-- which carries no dates and so can never be verified or decayed; those are
-- treated as broken rather than immortal.
UPDATE "user_stats" s
SET "last_daily_date" = (
  SELECT max(r."date") FROM "daily_results" r WHERE r."user_id" = s."user_id"
);
--> statement-breakpoint

-- Same rule, applied where the streak board is ordered. The decay CANNOT live
-- in the client for this one: getLeaderboard() ORDER BYs current_streak inside
-- the database (lib/leaderboard/actions.ts), so a stale streak would win its
-- slot before any client-side adjustment could see it. Doing it in the view
-- fixes the ranking and the displayed number together, and keeps every
-- leaderboard reader (board, my-rank count) automatically consistent.
--
-- CREATE OR REPLACE keeps the column list, order and types identical -- only
-- current_streak's expression changes -- which is what Postgres requires to
-- replace a view in place. max_streak is deliberately untouched: it's a
-- lifetime record, not a live streak.
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
  s.max_streak
FROM public.profiles p
JOIN public.user_stats s ON s.user_id = p.id
WHERE p.is_guest = false;
