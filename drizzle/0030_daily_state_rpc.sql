-- Moves Daily off Next.js Server Actions onto the same warm one-hop RPC path
-- Duel/Infinite already use (drizzle/0022, 0028) -- for the guess AND the
-- board load, per PLAN-fast-guesses.md Phase 1. Two client-callable SECURITY
-- DEFINER RPCs (daily_state / daily_submit_guess) replace the
-- dailyState()/dailySubmitGuess() Server Actions (lib/db/dailyProgressActions.ts),
-- so hydration and each guess are one PostgREST round trip instead of a Vercel
-- serverless invocation. compare_drivers() (drizzle/0022) stays the single
-- source of truth for the comparison rules; these reuse it.
--
-- The day's target is now PINNED lazily in daily_targets (created below)
-- instead of recomputed from a pool scan on every call. dailySelection.ts's
-- header warns against a *precomputed-a-year-ahead* schedule that drifts when
-- the pool definition changes; that does not apply here -- the pick is computed
-- from TODAY's live pool the first time the day is touched, then frozen for the
-- rest of that day only. Freezing intra-day is the desired fix (a mid-day pool
-- change must NOT silently move the answer), and there is nothing to regenerate
-- ahead of time. pick_daily_driver_id (drizzle/0028, parity-tested in
-- lib/game/dailySelection.sqlParity.test.ts) is reused unchanged.

CREATE TABLE "daily_targets" (
	"date" date PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_targets" ADD CONSTRAINT "daily_targets_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- The day's target is a secret while the day is live. Enable RLS with NO
-- policy at all -- same "default deny" treatment as duel_rounds (drizzle/0011)
-- and infinite_rounds (drizzle/0028): a direct PostgREST SELECT returns
-- nothing, so the answer can't be scraped from this table. The only readers
-- are the SECURITY DEFINER functions below, which run as the table owner and
-- bypass RLS.
ALTER TABLE public.daily_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Get-or-pin the day's target. The first caller of the day computes the pick
-- from today's live 10-year pool and INSERT ... ON CONFLICT DO NOTHING pins it;
-- everyone else (and every later call) reads the pinned row. The pick is
-- deterministic (pick_daily_driver_id), so even a concurrent first-caller race
-- pins the identical id -- the ON CONFLICT + re-read is belt-and-suspenders,
-- never a split brain. Internal helper: SECURITY DEFINER (writes daily_targets
-- as the owner, past RLS) and deliberately NOT granted to authenticated -- the
-- only callers are the RPCs below and lib/db/dailyProgress.ts's mirror.
--
-- Keep the "- 10" cutoff in sync with lib/game/poolWindow.ts#DAILY_POOL_WINDOW
-- ("10-years"), same requirement the old inline pool query had (drizzle/0028).
CREATE OR REPLACE FUNCTION public.daily_target_id(p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_id integer;
  v_pool_ids integer[];
BEGIN
  SELECT driver_id INTO v_target_id FROM public.daily_targets WHERE date = p_date;
  IF FOUND THEN
    RETURN v_target_id;
  END IF;

  SELECT array_agg(id) INTO v_pool_ids FROM public.drivers
  WHERE last_active_year >= extract(year FROM p_date)::int - 10;

  IF v_pool_ids IS NULL OR array_length(v_pool_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No puzzle is scheduled for today.';
  END IF;

  v_target_id := public.pick_daily_driver_id(p_date, v_pool_ids);

  INSERT INTO public.daily_targets (date, driver_id)
  VALUES (p_date, v_target_id)
  ON CONFLICT (date) DO NOTHING;

  -- Re-read: if a concurrent caller won the INSERT, our ON CONFLICT DO NOTHING
  -- was a no-op -- but the pick is deterministic, so the row's value equals
  -- v_target_id either way. The row now definitely exists.
  SELECT driver_id INTO v_target_id FROM public.daily_targets WHERE date = p_date;
  RETURN v_target_id;
END;
$$;
--> statement-breakpoint

-- Hydration in one warm hop -- replaces lib/db/dailyProgressActions.ts#dailyState.
-- Returns the whole authoritative board as one jsonb object shaped exactly like
-- lib/game/dailyBoard.ts#DailyBoardState (camelCase keys, so the client needs no
-- mapping): the ordered guesses with tiles recomputed via compare_drivers
-- (tiles are NEVER stored -- CLAUDE.md "Daily persistence & sync"), plus
-- completed/won/guessesRemaining. The target is included ONLY once the day is
-- complete; while it's live, 'target' is null and daily_targets isn't readable
-- over PostgREST, so the answer never reaches the client mid-day.
--
-- Keep MAX_GUESSES (6) in sync with lib/game/constants.ts.
CREATE OR REPLACE FUNCTION public.daily_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_target_id integer;
  v_guesses integer[];
  v_completed boolean;
  v_won boolean;
  v_guess_arr jsonb;
  v_target record;
  v_len integer;
  v_max constant integer := 6;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_target_id := public.daily_target_id(v_today);

  SELECT guesses, completed, COALESCE(won, false)
    INTO v_guesses, v_completed, v_won
  FROM public.daily_progress
  WHERE user_id = v_user_id AND date = v_today;

  IF NOT FOUND THEN
    -- No row yet: a fresh, empty (playable) board for today.
    v_guesses := ARRAY[]::integer[];
    v_completed := false;
    v_won := false;
  END IF;

  -- Rebuild each guess row in stored order: display fields off the driver row,
  -- tiles off compare_drivers against the pinned target. null closeness (an
  -- exact/correct column) is stripped so it maps to GuessResult's optional
  -- fields rather than an explicit null.
  SELECT COALESCE(jsonb_agg(row_json ORDER BY ord), '[]'::jsonb)
    INTO v_guess_arr
  FROM (
    SELECT gi.ord,
      jsonb_build_object(
        'driverId', d.id,
        'name', d.full_name,
        'code', d.driver_code,
        'nationality', d.nationality,
        'team', COALESCE(NULLIF(d.last_team, ''), '—'),
        'age', extract(year FROM age(COALESCE(d.date_of_death, v_today), d.date_of_birth))::int,
        'debutYear', d.debut_year,
        'careerWins', d.career_wins,
        'tiles', jsonb_strip_nulls(jsonb_build_object(
          'nationality', c.nationality,
          'team', c.team,
          'age', c.age,
          'ageCloseness', c.age_closeness,
          'debutYear', c.debut_year,
          'debutYearCloseness', c.debut_year_closeness,
          'careerWins', c.career_wins,
          'careerWinsCloseness', c.career_wins_closeness
        ))
      ) AS row_json
    FROM unnest(v_guesses) WITH ORDINALITY AS gi(gid, ord)
    JOIN public.drivers d ON d.id = gi.gid
    CROSS JOIN LATERAL public.compare_drivers(gi.gid, v_target_id, now()) AS c
  ) sub;

  v_len := COALESCE(array_length(v_guesses, 1), 0);

  IF v_completed THEN
    SELECT * INTO v_target FROM public.drivers WHERE id = v_target_id;
  END IF;

  RETURN jsonb_build_object(
    'guesses', v_guess_arr,
    'completed', v_completed,
    'won', v_won,
    'guessesRemaining', GREATEST(0, v_max - v_len),
    'target', CASE
      WHEN v_completed THEN jsonb_build_object(
        'driverId', v_target.id, 'name', v_target.full_name, 'code', v_target.driver_code
      )
      ELSE NULL
    END
  );
END;
$$;
--> statement-breakpoint

-- Replace the stateless daily_submit_guess (drizzle/0028), which only scored a
-- guess and persisted nothing. The RETURNS TABLE shape changes, so it must be
-- dropped and recreated (CREATE OR REPLACE can't change a function's return
-- type). This one is server-authoritative: it appends to daily_progress,
-- resolves the UTC date + guess index itself, and rejects a complete/exhausted
-- day (the anti-second-attempt guard), so two devices converge on one board.
-- It returns the duel-shaped single guess row (guessed driver + tiles), plus
-- the board-level completed/won/guessesRemaining and -- ONLY on the guess that
-- ends the day -- the revealed target. The client appends the row to the board
-- it hydrated from daily_state (lib/game/submitDailyGuessRpc.ts), same as the
-- duel board appends duel_submit_guess's row.
--
-- Stats: this RPC does NOT write user_stats. On completion the client calls the
-- existing recordDailyResult Server Action (lib/stats/actions.ts), which flows
-- through the same daily_results idempotency guard -- result recording is left
-- exactly as it was (a Postgres RPC can't call that TS path, and it must not be
-- forked into SQL).
DROP FUNCTION IF EXISTS public.daily_submit_guess(integer);
--> statement-breakpoint
CREATE FUNCTION public.daily_submit_guess(p_guess_driver_id integer)
RETURNS TABLE (
  won boolean,
  completed boolean,
  guesses_remaining integer,
  guessed_driver_id integer,
  guessed_full_name text,
  guessed_driver_code text,
  guessed_nationality text,
  guessed_team text,
  guessed_age integer,
  guessed_debut_year integer,
  guessed_career_wins integer,
  nationality text,
  team text,
  age text,
  age_closeness numeric,
  debut_year text,
  debut_year_closeness numeric,
  career_wins text,
  career_wins_closeness numeric,
  target_driver_id integer,
  target_full_name text,
  target_driver_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_now timestamptz := now();
  v_target_id integer;
  v_guesses integer[];
  v_row_completed boolean;
  v_guess record;
  v_target record;
  v_cmp record;
  v_won boolean;
  v_new_len integer;
  v_new_completed boolean;
  v_max constant integer := 6;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_target_id := public.daily_target_id(v_today);

  SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick a driver from the suggestions list.';
  END IF;

  -- Ensure the row exists, then lock it -- two devices guessing at once
  -- serialize here and converge instead of forking the board. ON CONFLICT DO
  -- NOTHING is safe under the concurrent-first-guess race.
  INSERT INTO public.daily_progress (user_id, date, guesses)
  VALUES (v_user_id, v_today, ARRAY[]::integer[])
  ON CONFLICT (user_id, date) DO NOTHING;

  SELECT guesses, completed INTO v_guesses, v_row_completed
  FROM public.daily_progress
  WHERE user_id = v_user_id AND date = v_today
  FOR UPDATE;

  -- Never append onto a finished/exhausted day -- rejected like duel's "already
  -- solved", not a silent no-op. The client's own guard normally prevents this;
  -- a stale second device hitting it surfaces the error and re-hydrates.
  IF v_row_completed OR COALESCE(array_length(v_guesses, 1), 0) >= v_max THEN
    RAISE EXCEPTION 'Today''s puzzle is already complete.';
  END IF;

  SELECT * INTO v_cmp FROM public.compare_drivers(p_guess_driver_id, v_target_id, v_now);
  v_won := v_cmp.nationality = 'exact' AND v_cmp.team = 'exact' AND v_cmp.age = 'correct'
    AND v_cmp.debut_year = 'correct' AND v_cmp.career_wins = 'correct';

  v_guesses := array_append(v_guesses, p_guess_driver_id);
  v_new_len := COALESCE(array_length(v_guesses, 1), 0);
  v_new_completed := v_won OR v_new_len >= v_max;

  UPDATE public.daily_progress
  SET guesses = v_guesses,
      completed = v_new_completed,
      won = CASE WHEN v_new_completed THEN v_won ELSE NULL END,
      updated_at = now()
  WHERE user_id = v_user_id AND date = v_today;

  IF v_new_completed THEN
    SELECT * INTO v_target FROM public.drivers WHERE id = v_target_id;
  END IF;

  RETURN QUERY SELECT
    v_won,
    v_new_completed,
    GREATEST(0, v_max - v_new_len),
    v_guess.id, v_guess.full_name, v_guess.driver_code, v_guess.nationality,
    COALESCE(NULLIF(v_guess.last_team, ''), '—'),
    extract(year FROM age(COALESCE(v_guess.date_of_death, v_today), v_guess.date_of_birth))::int,
    v_guess.debut_year, v_guess.career_wins,
    v_cmp.nationality, v_cmp.team, v_cmp.age, v_cmp.age_closeness,
    v_cmp.debut_year, v_cmp.debut_year_closeness, v_cmp.career_wins, v_cmp.career_wins_closeness,
    CASE WHEN v_new_completed THEN v_target.id ELSE NULL END,
    CASE WHEN v_new_completed THEN v_target.full_name ELSE NULL END,
    CASE WHEN v_new_completed THEN v_target.driver_code ELSE NULL END;
END;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.daily_state() TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daily_submit_guess(integer) TO authenticated;
