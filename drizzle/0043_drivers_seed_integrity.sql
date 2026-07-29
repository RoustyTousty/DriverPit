-- Makes `drivers` re-seedable, and takes the client's write grants off it.
-- Closes audit 2026-07-27 §5.1 (and the unique-constraint half of §5.2d).
--
-- THE PROBLEM §5.1 DESCRIBES. scripts/seed.ts did `DELETE FROM drivers`
-- followed by a batched re-insert. `drivers.id` is a `serial` and four things
-- point at it:
--
--   duel_rounds.driver_id     FK, ON DELETE no action
--   infinite_rounds.driver_id FK, ON DELETE no action
--   daily_targets.driver_id   FK, ON DELETE no action
--   daily_progress.guesses    integer[] -- no FK, so it breaks SILENTLY
--
-- Against this database (792 drivers, 4 daily_targets, 154 duel_rounds, 16
-- infinite_rounds) that DELETE raises a foreign-key violation, so the
-- documented "re-run the seed after a race weekend" path is already broken.
-- Forced past it, the sequence restarts and every stored id points at a
-- different driver: past boards render the wrong names and daily_targets
-- rewrites which driver each historical day was.
--
-- THE FIX. A stable natural key to upsert on. F1DB's own driver slug
-- ("lewis-hamilton") is already how seed.ts joins drivers to race results; it
-- was simply never stored. With it the seed becomes
-- `INSERT ... ON CONFLICT (f1db_id) DO UPDATE`, wrapped in one transaction:
-- ids are never reassigned, nothing is ever deleted, and a failed run rolls
-- back instead of leaving the table empty.
--
-- NULLABLE, ON PURPOSE. The 792 existing rows have no slug and the CSV isn't
-- reachable from a migration, so the column arrives NULL and the seed adopts
-- those rows by natural key -- (full_name, date_of_birth), verified to have
-- zero collisions across the current table -- on its next run. A NULL is
-- excluded from a UNIQUE constraint in Postgres, so the pre-backfill state is
-- representable and the constraint still holds afterwards. The seed also
-- re-keys a row whose slug changed upstream, rather than inserting a duplicate
-- of a driver it already has.
--
-- The constraint is named the way drizzle-kit would name it, so a later
-- `drizzle-kit generate` against schema.ts's `.unique()` produces no diff.
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS f1db_id text;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.drivers'::regclass
      AND conname = 'drivers_f1db_id_unique'
  ) THEN
    ALTER TABLE public.drivers ADD CONSTRAINT drivers_f1db_id_unique UNIQUE (f1db_id);
  END IF;
END $$;
--> statement-breakpoint

-- AND THE PART THE AUDIT DIDN'T REACH, which is worse than the finding it sits
-- under. §5.1 opens "it's the only way F1 data enters the app". It is not.
-- `drivers` was created by drizzle/0000 as a plain table and never given RLS or
-- a grant decision -- unlike the nine tables drizzle/0042 swept, whose write
-- grants were inert because RLS denied them anyway. Read back from the live
-- database:
--
--   pg_class.relrowsecurity     drivers = false        <- no RLS at all
--   role_table_grants           anon, authenticated =
--                                 SELECT, INSERT, UPDATE, DELETE, TRUNCATE, ...
--
-- Nothing denies the write, so the grant IS the access. Probed over PostgREST
-- with the public anon key that ships in the browser bundle:
--
--   PATCH  /rest/v1/drivers?id=eq.<n>   -> 204   (authorized)
--   DELETE /rest/v1/drivers?id=eq.<n>   -> 204   (authorized)
--   POST   /rest/v1/drivers  {}         -> 23502 not-null violation, i.e. the
--                                          insert was authorized and only the
--                                          DATA stopped it
--   PATCH  /rest/v1/daily_progress      -> 42501 permission denied  (control,
--                                          post-0042 -- so the probe can tell
--                                          the two apart)
--
-- `UPDATE public.drivers SET career_wins = 0` from any visitor's console needs
-- no FK cooperation and corrupts every comparison in every mode, including the
-- daily answer's own attributes. Revoked here, on the same rule as 0042: every
-- write to this table goes through the seed script on the trusted Drizzle
-- connection, and every read goes through a SECURITY DEFINER RPC or a server
-- component -- both run as the owner and are unaffected.
--
-- SELECT stays, deliberately, exactly as in 0042. Nothing client-side queries
-- /rest/v1/drivers today (the pool is shipped as props by the daily/infinite
-- server components), so this is not load-bearing -- but the pool, ids
-- included, is public by design and holding it tells an attacker nothing now
-- that the daily answer is a random pinned pick (§3.1). Removing a read that
-- costs nothing is not worth the behaviour risk in a patch whose point is the
-- writes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.drivers FROM anon, authenticated;
