-- Completes the explicit grant decision drizzle/0038 set out to make on the two
-- client-callable daily RPCs. Forward-only (0038 is applied), grants only --
-- no function body changes.
--
-- WHAT 0038 GOT WRONG, AND IT IS WORTH KNOWING. Its comment reasoned from the
-- plain-Postgres rule that a new function is EXECUTE-granted to PUBLIC, so
-- `REVOKE ... FROM PUBLIC` should be enough to take `anon` off it. On a
-- Supabase project it is not: the project bootstrap runs
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
--
-- so every function created in `public` gets *individually named* grants to
-- anon and authenticated on top of the PUBLIC default. Revoking PUBLIC leaves
-- both standing. Verified against the live database right after 0038 applied:
--
--   compare_drivers      postgres=X/postgres, service_role=X/postgres
--   daily_target_id      postgres=X/postgres, service_role=X/postgres
--   daily_state          postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, ...
--   daily_submit_guess   postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, ...
--
-- The two secret-bearing functions came out right because 0038 revoked them
-- FROM PUBLIC, anon, authenticated by name (as drizzle/0034 does for the duel
-- lifecycle) -- so §3.1's actual exposure was closed. These two were the ones
-- relying on the incomplete reasoning.
--
-- THE RULE, since two migrations have now been written against a wrong model of
-- it: naming `anon` and `authenticated` explicitly is the only reliable revoke
-- in this schema. `FROM PUBLIC` alone is never sufficient on Supabase.
--
-- NOT A BEHAVIOUR CHANGE FOR ANY PLAYER. Every visitor is signed in (anonymous
-- sessions are real auth.users rows), so the browser reaches these as
-- `authenticated`, which keeps its grant. The `anon` role means "anon API key,
-- no user JWT at all" -- a call in that state already hit `RAISE EXCEPTION 'Not
-- authenticated'` on the null auth.uid() check. This turns a runtime rejection
-- into a privilege one, which is the point: "who may execute this" becomes a
-- fact about the grant rather than something each function body has to remember
-- to enforce.
REVOKE EXECUTE ON FUNCTION public.daily_state() FROM anon;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.daily_submit_guess(integer) FROM anon;
--> statement-breakpoint

-- Re-asserted (idempotent) so this migration states the full grant decision for
-- both functions in one place, rather than leaving a reader to diff it against
-- 0028/0030/0038.
GRANT EXECUTE ON FUNCTION public.daily_state() TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daily_submit_guess(integer) TO authenticated;
