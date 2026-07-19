-- Custom SQL migration file, put your code below! --

-- Public leaderboard view: profiles joined with user_stats, restricted to
-- full accounts (is_guest = false) and to the columns that are safe to show
-- anyone. profiles/user_stats RLS only allows self-SELECT, so a querying
-- role can't see other users' rows directly -- but a *view* is checked
-- against RLS as its owner (the migration role, which bypasses RLS), not
-- the querying role. That's what makes this the "public leaderboard view"
-- the app reads through, functioning like a SECURITY DEFINER read even
-- though views don't literally have that clause -- the owner-privilege
-- bypass is the standard Supabase pattern for this.
CREATE VIEW public.leaderboard AS
SELECT
  p.id,
  p.username,
  p.display_name,
  p.avatar_url,
  s.duel_rating,
  s.duel_wins,
  s.duel_losses,
  s.current_streak,
  s.max_streak
FROM public.profiles p
JOIN public.user_stats s ON s.user_id = p.id
WHERE p.is_guest = false;
--> statement-breakpoint

-- Server code (Drizzle's trusted `db`) is the only reader for now and
-- doesn't need this grant, but it documents the view's intended access
-- level for whenever a client-side read is added.
GRANT SELECT ON public.leaderboard TO authenticated;
