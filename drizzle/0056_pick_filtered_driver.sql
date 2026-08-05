-- Custom lobbies, phase 3 -- one SQL copy of the driver filter, shared by both
-- callers that pick a target from it.
--
-- lib/game/driverFilter.ts#matchesDriverFilter is already mirrored in plpgsql
-- inside infinite_start_round (drizzle/0053). Teaching duel_begin_round to draw
-- from a custom lobby's filter naively means a THIRD copy of a five-column
-- predicate whose failure mode is silent and unreportable: a target outside the
-- player's own filter cannot be typed into the box, so the round is simply
-- unwinnable with nothing erroring anywhere. In a live, timed 1v1 that is worse
-- than in Infinite, where the player can just start another round.
--
-- So the predicate is extracted once, here, and both callers point at it. Same
-- reasoning as the duel_*_client wrappers in drizzle/0034: one definition of the
-- logic, one place to change it. lib/db/infiniteFilter.sqlParity.test.ts is the
-- safety net for the extraction -- it pins this predicate behaviourally through
-- infinite_start_round, and phase 3 extends it to pin the same function through
-- duel_begin_round too.
--
-- THE ONLY SQL COPY. Anything that needs "which drivers does this filter admit"
-- calls this; nothing re-spells the WHERE clause.
CREATE OR REPLACE FUNCTION public.pick_filtered_driver(
  p_filter jsonb,
  p_exclude integer[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- `->>` yields SQL NULL for a JSON null, so a filter with no nationality and
  -- one with an empty string both land on NULL = "every nationality", matching
  -- the TypeScript's `string | null`.
  v_from integer := (p_filter->>'fromYear')::int;
  v_to integer := (p_filter->>'toYear')::int;
  v_nationality text := nullif(btrim(coalesce(p_filter->>'nationality', '')), '');
  v_team text := nullif(btrim(coalesce(p_filter->>'team', '')), '');
  v_achievement text := coalesce(p_filter->>'achievement', 'any');
  v_exclude integer[] := coalesce(p_exclude, '{}');
  v_driver_id integer;
BEGIN
  -- The predicate, mirroring lib/game/driverFilter.ts#matchesDriverFilter. The
  -- season test is an OVERLAP: a career that started before the span and ran
  -- into it belongs to that span, so "the 1990s" cannot be last_active_year
  -- BETWEEN, which would drop everyone still racing in 2000.
  --
  -- The achievement CASE falls through to `true` on anything unrecognised,
  -- which is the SQL analogue of the TypeScript's 'any' branch -- the union
  -- makes an invalid tier unrepresentable there. Validating the string is the
  -- WRITER'S job (infinite_start_round raises on it before calling; a custom
  -- lobby's filter is validated when the lobby is created), because that is
  -- where a bad value can still be reported to somebody.
  --
  -- EXCLUSION IS AN ORDER BY, NOT A WHERE, and that is the whole of the
  -- degrade-don't-error requirement. duel_begin_round passes the drivers this
  -- match has already used, so a 3-round custom game on a 6-driver filter stops
  -- repeating targets -- but a 5-round game on a 2-driver filter must still
  -- deal a round 3, and a WHERE would return NULL and abort the match mid-play.
  -- Sorting the used ones last prefers a fresh driver whenever one exists and
  -- silently allows a repeat when none does. Same shape, and the same reason,
  -- as daily_target_id's recent-repeat cooldown (drizzle/0038).
  --
  -- With no exclusions every row ties at `false` and this is exactly the plain
  -- `ORDER BY random()` infinite_start_round has always run.
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
  ORDER BY (d.id = ANY(v_exclude)), random()
  LIMIT 1;

  -- NULL means the filter genuinely matches nobody. Deliberately not an
  -- exception: the two callers want different things (infinite_start_round
  -- refuses the round, duel_begin_round refuses to stamp), and a filter
  -- matching nobody is a caller-input problem, not this function's.
  RETURN v_driver_id;
END;
$$;
--> statement-breakpoint

-- An internal helper, like compare_drivers and daily_target_id: it carries no
-- auth check because it needs none -- its callers are SECURITY DEFINER (so it
-- runs as the owner there) or the trusted connection. Revoked from every client
-- role by name, never a bare REVOKE FROM PUBLIC (CLAUDE.md "Schema": Supabase's
-- bootstrap ALTER DEFAULT PRIVILEGES names anon and authenticated too, which a
-- PUBLIC-only revoke leaves standing -- drizzle/0039).
--
-- Declared in lib/db/schemaGrants.test.ts in this same change; that suite fails
-- on a live function with no decision on record, which is the mechanism working.
REVOKE EXECUTE ON FUNCTION public.pick_filtered_driver(jsonb, integer[]) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Repointed at the shared predicate. Otherwise unchanged from drizzle/0053 --
-- same signature, same clamping, same validation, same upsert. The jsonb the
-- round records is now literally the value the pick was made from, rather than
-- a second construction of it that happened to agree.
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
  v_filter jsonb;
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

  v_filter := jsonb_build_object(
    'fromYear', v_from,
    'toYear', v_to,
    'nationality', v_nationality,
    'team', v_team,
    'achievement', v_achievement
  );

  -- No exclusions: Infinite is one round at a time with no history to avoid,
  -- so this is the same plain random pick over the same predicate as before.
  v_driver_id := public.pick_filtered_driver(v_filter, NULL);

  IF v_driver_id IS NULL THEN
    -- The client disables Apply on an empty filter, so reaching this means the
    -- filter was composed elsewhere (or the roster changed under a stored one).
    RAISE EXCEPTION 'No drivers match this filter';
  END IF;

  INSERT INTO public.infinite_rounds (user_id, driver_id, filter, guess_count, started_at)
  VALUES (v_user_id, v_driver_id, v_filter, 0, now())
  ON CONFLICT (user_id) DO UPDATE SET
    driver_id = EXCLUDED.driver_id,
    filter = EXCLUDED.filter,
    guess_count = 0,
    started_at = now();
END;
$$;
--> statement-breakpoint

-- Unchanged from drizzle/0055 apart from the target pick. Everything else --
-- the lock, the already-stamped short circuit, the COUNTDOWN_MS offset, the
-- per-match round_seconds -- is reproduced verbatim from the live definition,
-- because CREATE OR REPLACE has no partial form.
--
-- A null `filter` is every ranked duel, and it takes the unchanged 20-year
-- last_active_year pick. The custom branch is additive: nothing about a
-- matchmade match's target selection moves.
CREATE OR REPLACE FUNCTION public.duel_begin_round(p_match_id integer, p_round_index integer)
RETURNS TABLE (
  round_index integer,
  started_at timestamptz,
  ends_at timestamptz,
  match_status text,
  newly_started boolean
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_existing record;
  v_target_driver_id integer;
  v_used integer[];
  v_started_at timestamptz;
  v_ends_at timestamptz;
BEGIN
  SELECT * INTO v_match FROM public.duel_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id;
  END IF;
  IF v_match.status IN ('finished', 'abandoned') THEN
    RAISE EXCEPTION 'Match % has already ended', p_match_id;
  END IF;

  SELECT dr.round_index, dr.started_at, dr.ends_at INTO v_existing
  FROM public.duel_rounds dr
  WHERE dr.match_id = p_match_id AND dr.round_index = p_round_index;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.round_index, v_existing.started_at, v_existing.ends_at, v_match.status, false;
    RETURN;
  END IF;

  IF v_match.filter IS NOT NULL THEN
    -- Custom lobby. Exclude the drivers this match has already used, so a
    -- 3-round game on a small filter does not deal the same driver twice --
    -- invisible in a 250-driver pool, glaring in a 6-driver one.
    -- pick_filtered_driver degrades to allowing a repeat rather than returning
    -- NULL when the filter is smaller than the round count, so a tiny pool
    -- costs variety and never the match.
    SELECT coalesce(array_agg(dr.driver_id), '{}')
    INTO v_used
    FROM public.duel_rounds dr
    WHERE dr.match_id = p_match_id;

    v_target_driver_id := public.pick_filtered_driver(v_match.filter, v_used);

    IF v_target_driver_id IS NULL THEN
      -- duel_lobby_create refuses a filter matching nobody (phase 4), so this
      -- is the roster having changed under a lobby that was already open.
      RAISE EXCEPTION 'No drivers match this match''s filter';
    END IF;
  ELSE
    -- Ranked duel: the same pool the daily answer is drawn from -- keep the
    -- "- 20" in sync with lib/game/poolWindow.ts's DAILY_POOL_WINDOW.
    SELECT id INTO v_target_driver_id
    FROM public.drivers
    WHERE last_active_year >= extract(year FROM now())::int - 20
    ORDER BY random()
    LIMIT 1;
  END IF;

  -- COUNTDOWN_MS, every round. Already includes COUNTDOWN_GO_HOLD_MS -- see
  -- drizzle/0036's header on what started_at means. Still a literal, and still
  -- the same for every round of every match: the countdown is ceremony, not
  -- configuration, and drizzle/0035 made it uniform on purpose.
  v_started_at := now() + interval '3900 milliseconds';
  -- Per-match round length (drizzle/0054, drizzle/0055). 60 is the column's
  -- DEFAULT, so a matchmade duel stamps exactly what it always did.
  v_ends_at := v_started_at + make_interval(secs => v_match.round_seconds);

  INSERT INTO public.duel_rounds (match_id, round_index, driver_id, started_at, ends_at)
  VALUES (p_match_id, p_round_index, v_target_driver_id, v_started_at, v_ends_at);

  UPDATE public.duel_matches
  SET status = 'active', current_round = p_round_index
  WHERE id = p_match_id;

  RETURN QUERY SELECT p_round_index, v_started_at, v_ends_at, 'active'::text, true;
END;
$$;
--> statement-breakpoint

-- The grant decisions for the two replaced functions, restated rather than
-- assumed -- same convention as drizzle/0052 and drizzle/0055. CREATE OR
-- REPLACE keeps an existing ACL, so these are no-ops today; they are here
-- because "the replace probably kept it" is not a thing to leave a rated
-- match's target selection resting on.
REVOKE EXECUTE ON FUNCTION public.duel_begin_round(integer, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.infinite_start_round(integer, integer, text, text, text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.infinite_start_round(integer, integer, text, text, text) TO authenticated;
