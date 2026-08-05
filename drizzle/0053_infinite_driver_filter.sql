-- Infinite's pool picker becomes a composable filter: any span of seasons,
-- optionally narrowed to one nationality, one constructor, or one achievement
-- tier. lib/game/driverFilter.ts is the TypeScript half; this is the SQL half,
-- and the two MUST agree -- infinite_start_round picks the round's target in
-- here, while the browser filters the same roster for the autocomplete, so any
-- disagreement serves a target the player cannot type. Pinned behaviourally by
-- lib/db/infiniteFilter.sqlParity.test.ts (database CI tier).
--
-- Three of the four criteria already had a column. The achievement tiers did
-- not: `career_wins` is the only one `drivers` carried, so championships,
-- podiums and poles are added below. F1DB ships all three on the drivers CSV
-- the seed already downloads (totalChampionshipWins / totalPodiums /
-- totalPolePositions), so this is a read of an existing feed, not a new source
-- -- but the columns are 0 until scripts/seed.ts next runs, which is what the
-- default below means. The achievement filters match nobody until then.

ALTER TABLE "drivers"
  ADD COLUMN IF NOT EXISTS "championship_wins" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "podiums" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "pole_positions" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- The per-column half of the seed's defence against a mis-parsed release, same
-- as drizzle/0047's: these fail the SEED'S OWN transaction, so a release whose
-- columns moved rolls back instead of quietly zeroing every driver's career.
-- Deliberately NOT a cross-column check (podiums >= career_wins looks true, but
-- career_wins is computed by the seed from race results while podiums comes
-- from F1DB's own total, and two different methodologies must not be able to
-- fail the roster refresh).
ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_championship_wins_check" CHECK ("championship_wins" >= 0),
  ADD CONSTRAINT "drivers_podiums_check" CHECK ("podiums" >= 0),
  ADD CONSTRAINT "drivers_pole_positions_check" CHECK ("pole_positions" >= 0);
--> statement-breakpoint

-- No index on any of this. `drivers` is ~800 rows and the filter is a single
-- sequential scan of a table that fits in a page cache many times over; the
-- pick is already ORDER BY random(), which cannot use an index anyway.
-- infinite_rounds.pool_window becomes the filter that produced the round. It
-- has never had a reader outside the tests -- it exists so a round's provenance
-- is recorded -- and 'pool_window' is no longer a thing Infinite has.
ALTER TABLE "infinite_rounds" DROP COLUMN IF EXISTS "pool_window";
--> statement-breakpoint
ALTER TABLE "infinite_rounds" ADD COLUMN IF NOT EXISTS "filter" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint

-- The signature changes, so the old function is DROPPED rather than replaced:
-- CREATE OR REPLACE cannot change a parameter list, and leaving it would keep a
-- second, callable infinite_start_round(text) with its grants intact, drawing
-- from the old five-window ladder. lib/db/schemaGrants.test.ts fails on exactly
-- that (a live function with no declared grant decision).
DROP FUNCTION IF EXISTS public.infinite_start_round(text);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.infinite_start_round(
  p_from_year integer,
  p_to_year integer,
  p_nationality text,
  p_team text,
  p_achievement text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_year integer := extract(year FROM now())::int;
  v_from integer;
  v_to integer;
  v_nationality text := nullif(btrim(coalesce(p_nationality, '')), '');
  v_team text := nullif(btrim(coalesce(p_team, '')), '');
  v_achievement text := coalesce(p_achievement, 'any');
  v_driver_id integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_achievement NOT IN ('any', 'race-winner', 'podium', 'pole', 'champion') THEN
    RAISE EXCEPTION 'Invalid achievement: %', v_achievement;
  END IF;

  -- Mirrors lib/game/driverFilter.ts#clampDriverFilter, and clamps here rather
  -- than trusting the caller for the same reason every other RPC validates its
  -- arguments: PostgREST is reachable without the UI that produced them.
  -- Ordering the pair is what stops a crossed slider selecting nobody.
  v_from := greatest(1950, least(coalesce(p_from_year, 1950), coalesce(p_to_year, v_year)));
  v_to := least(v_year, greatest(coalesce(p_from_year, 1950), coalesce(p_to_year, v_year)));

  -- The predicate, mirroring lib/game/driverFilter.ts#matchesDriverFilter. The
  -- season test is an OVERLAP: a career that started before the span and ran
  -- into it belongs to that span, so "the 1990s" cannot be last_active_year
  -- BETWEEN, which would drop everyone still racing in 2000.
  SELECT d.id INTO v_driver_id
  FROM public.drivers d
  WHERE d.debut_year <= v_to
    AND d.last_active_year >= v_from
    AND (v_nationality IS NULL OR d.nationality = v_nationality)
    AND (v_team IS NULL OR v_team = ANY(d.previous_teams))
    AND CASE v_achievement
          WHEN 'race-winner' THEN d.career_wins > 0
          WHEN 'podium' THEN d.podiums > 0
          WHEN 'pole' THEN d.pole_positions > 0
          WHEN 'champion' THEN d.championship_wins > 0
          ELSE true
        END
  ORDER BY random()
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    -- The client disables Apply on an empty filter, so reaching this means the
    -- filter was composed elsewhere (or the roster changed under a stored one).
    RAISE EXCEPTION 'No drivers match this filter';
  END IF;

  INSERT INTO public.infinite_rounds (user_id, driver_id, filter, guess_count, started_at)
  VALUES (
    v_user_id,
    v_driver_id,
    jsonb_build_object(
      'fromYear', v_from,
      'toYear', v_to,
      'nationality', v_nationality,
      'team', v_team,
      'achievement', v_achievement
    ),
    0,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    driver_id = EXCLUDED.driver_id,
    filter = EXCLUDED.filter,
    guess_count = 0,
    started_at = now();
END;
$$;
--> statement-breakpoint

-- Same grant decision the old signature carried, restated rather than inferred
-- (CLAUDE.md "Schema": Postgres default-grants EXECUTE to PUBLIC, and Supabase's
-- bootstrap ALTER DEFAULT PRIVILEGES additionally names anon and authenticated,
-- so a PUBLIC-only revoke leaves those standing). The browser calls this one, so
-- authenticated gets it back; every visitor has at least an anon session.
REVOKE EXECUTE ON FUNCTION public.infinite_start_round(integer, integer, text, text, text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.infinite_start_round(integer, integer, text, text, text) TO authenticated;
