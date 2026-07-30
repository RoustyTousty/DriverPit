-- Audit 2026-07-29 §5.2d -- the value CHECK constraints on `drivers`.
--
-- The per-column half of §5.2's defence. `releaseGuards.ts` asserts the release
-- is the one someone chose and that its columns and two canary drivers still
-- look right; these say what has to be true of EVERY row, in the database,
-- inside the seed's own transaction. A mis-parsed release that gets past the
-- script aborts the write instead of committing 792 rewritten drivers and
-- surfacing later as "the comparisons are wrong".
--
-- Verified against the live table before writing this: 792 rows, zero
-- violations of any constraint below, min(debut_year) = 1950,
-- max(last_active_year) = 2026.
--
-- Names match lib/db/schema.ts's check() names exactly, so a later
-- `drizzle-kit generate` produces no diff (same rule drizzle/0043 followed for
-- the unique constraint). Each statement is kept well under the ~1400-byte
-- ceiling this machine's path to Supabase silently drops past.
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_career_wins_check CHECK (career_wins >= 0);
--> statement-breakpoint

-- `debut_year` and `last_active_year` are both derived from the same aggregate
-- pass in seed.ts, and both feed pool membership (lib/game/poolWindow.ts) --
-- last_active_year decides which pools a driver is offered in at all.
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_season_order_check CHECK (debut_year <= last_active_year);
--> statement-breakpoint

-- 1950 is F1's first championship season, so it is a fact rather than a magic
-- number. The upper bound is CURRENT_DATE-based because there is no immutable
-- way to say "not in the future"; it only ever widens with time, so a restore
-- can never fail on it. +1 because F1DB lists the coming season's entries
-- before it starts (Arvid Lindblad already carries debut_year 2026).
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_season_range_check CHECK (
    debut_year >= 1950
    AND last_active_year <= EXTRACT(YEAR FROM CURRENT_DATE)::int + 1
  );
--> statement-breakpoint

-- `date_of_death` drives the age column: lib/game/compare.ts uses age at death
-- for a deceased driver, so a date before birth is a negative age in a tile.
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_death_after_birth_check CHECK (
    date_of_death IS NULL OR date_of_death > date_of_birth
  );
--> statement-breakpoint

-- The audit asks for "no future date_of_birth". This says the stronger and
-- immutable version of it -- born before the season you debuted in, which no
-- real driver has ever violated (Verstappen, the youngest ever, was 17) -- and
-- with the range check above it makes a future birth date unreachable without
-- also inventing a future season.
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_born_before_debut_check CHECK (
    date_of_birth < make_date(debut_year, 1, 1)
  );
