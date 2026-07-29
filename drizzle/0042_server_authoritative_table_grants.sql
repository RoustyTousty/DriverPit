-- Takes the client's WRITE GRANTS off every table this codebase calls
-- server-authoritative. Nothing here is exploitable today -- RLS denies each of
-- these writes -- but it is the substrate the two fixes shipped alongside it
-- stand on, and it was resting on one flag per table.
--
-- HOW THIS WAS FOUND, because it is not what the audit said. Audit
-- 2026-07-27 §3.11 flagged a single leftover: `GRANT SELECT, UPDATE ON
-- public.user_stats TO authenticated` (drizzle/0006), never revoked when
-- `user_stats_update_own` was correctly dropped in 0008, and suggested
-- `REVOKE UPDATE ... FROM authenticated`. Reading the live catalogue back
-- (the only reliable check -- the same lesson drizzle/0039 learned for
-- functions) shows that is a fraction of it. EVERY application table carries
-- the full set, to BOTH roles:
--
--   user_stats       anon,authenticated: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--   daily_progress   anon,authenticated: (same)
--   daily_results    anon,authenticated: (same)
--   daily_targets    anon,authenticated: (same)
--   infinite_rounds  anon,authenticated: (same)
--   duel_matches     anon,authenticated: (same)
--   duel_rounds      anon,authenticated: (same)
--   duel_round_results anon,authenticated: (same)
--
-- Because the Supabase bootstrap runs `ALTER DEFAULT PRIVILEGES IN SCHEMA
-- public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role`.
-- It is the table-level twin of the function-grant trap drizzle/0039 wrote up:
-- privileges arrive by default, addressed to named roles, and nothing in a
-- migration has to ask for them. 0006's explicit GRANT was never the source of
-- the UPDATE it was blamed for -- revoking exactly that one line would have
-- left `anon` holding UPDATE and both roles holding INSERT and DELETE.
--
-- WHY IT MATTERS NOW RATHER THAN AS HYGIENE. Two fixes landing with this one
-- replace "trust the client's claim" with "read what the server recorded":
--
--   * recordDailyResult reads won/guess_count/date off daily_progress (§3.2).
--     A client that could UPDATE daily_progress would just write
--     `completed = true, won = true, guesses = '{1}'` and call it -- the same
--     forgery through one more hop.
--   * migrateLocalStats' once-marker lives on user_stats (§3.7). A client that
--     could UPDATE user_stats would clear it, and would not have needed the
--     merge at all to write max_streak.
--
-- Each of those derivations is exactly as trustworthy as the table it reads,
-- so "RLS is on and there's no write policy" stops being an argument about
-- defence in depth and becomes the whole proof. Grants and RLS should have to
-- fail together.
--
-- SELECT IS DELIBERATELY LEFT ALONE. AuthProvider reads the caller's own
-- profiles/user_stats rows straight over PostgREST, and daily_progress /
-- daily_results / duel_matches each have a self-SELECT policy that a real
-- feature depends on. The four with no policy at all (daily_targets,
-- duel_rounds, duel_round_results, infinite_rounds) are already deny-all under
-- RLS, so their SELECT grant is inert; removing it would be tidier and is not
-- worth a behaviour risk in a security patch.
--
-- Every write to all of these already goes through a SECURITY DEFINER RPC or
-- the trusted Drizzle connection, both of which run as the table owner and are
-- unaffected. The signup trigger (drizzle/0006 handle_new_user) is SECURITY
-- DEFINER too, so revoking INSERT does not stop a profile or stats row being
-- created.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_stats FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.daily_progress FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.daily_results FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.daily_targets FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.infinite_rounds FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.duel_matches FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.duel_rounds FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.duel_round_results FROM anon, authenticated;
--> statement-breakpoint

-- matchmaking_queue: drizzle/0032 already revoked DELETE from `authenticated`
-- when duel_leave_queue() became the only way out. It left the rest, and left
-- `anon` untouched. Same rule as above -- match_or_queue / duel_leave_queue /
-- duel_queue_heartbeat are the only writers, and all three are SECURITY
-- DEFINER. This matters more than most: a writable queue row is the
-- rating-farming vector the whole of 0032 exists to close.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.matchmaking_queue FROM anon, authenticated;
--> statement-breakpoint

-- profiles is the ONE exception, and only partly. `profiles_update_own`
-- (drizzle/0006) is a real, used policy -- Settings -> Profile edits the
-- caller's display name and avatar through it -- so `authenticated` keeps
-- UPDATE. Everything else goes, from both roles: nothing client-side inserts or
-- deletes a profile (the signup trigger and the ON DELETE CASCADE from
-- auth.users own that), and `anon` has no policy that would let it do anything
-- anyway.
--
-- NOT A FIX FOR §3.6. That finding is that `profiles_update_own` is
-- column-unrestricted, so a client can flip its own `is_guest` to false and
-- appear on the leaderboard. Narrowing the policy is a separate change with its
-- own design question (a column-level grant, or a trigger that pins the
-- non-editable columns); this migration deliberately does not pre-empt it.
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM anon, authenticated;
--> statement-breakpoint
REVOKE UPDATE ON public.profiles FROM anon;
