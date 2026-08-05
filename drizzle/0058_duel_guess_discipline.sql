-- Duel guess discipline: guesses stay unlimited, but stop being free.
--
-- THE HOLE. duel_submit_guess charged a guess nothing -- no cap, no spacing,
-- and points depended only on solve time. The ranked pool is 103 drivers
-- (last_active_year >= currentYear - 20, measured 2026-08-04), so enumerating
-- it was not a theoretical attack: a devtools loop over duel_submit_guess with
-- every driver id solved every round in a couple of seconds, guaranteed, with
-- no knowledge of the game at all. A human needed no script either -- spraying
-- the autocomplete beat deducing, on the old curve by 845 points to 541.
--
-- Three changes, aimed at three different things:
--
--   1. A COOLDOWN between one player's guesses (the capability). 850ms caps a
--      60s round at ~70 guesses against a 103-driver pool, so enumeration stops
--      being a guaranteed solve, and a bot cannot outpace the wire.
--   2. WRONG GUESSES DECAY THE REWARD (the incentive). The speed bonus is
--      multiplied by 0.88 per wrong guess past the third, so a sprayed win is
--      worth the floor and a deduced one is worth several times it. Applied to
--      the DNF payout in duel_close_round too, or spraying just becomes the way
--      to farm proximity instead.
--   3. A FLOOR UNDER ms-to-solve (the ceiling). Nobody submits in under two
--      seconds; without it the curve pays a script ~982 of a possible 1000.
--
-- lib/game/duelScoring.ts holds the TypeScript half (accuracyFactor,
-- solvePoints, dnfPoints) and lib/game/duelTiming.ts the two timing constants;
-- duelScoring.sqlParity.test.ts pins BOTH against the live definitions here by
-- extracting and executing them, per CLAUDE.md's rule that a constant newly
-- duplicated into plpgsql gets its assertion in the same change.
--
-- WHAT DOES NOT CHANGE: the 100-point floor. It is what makes "any solve beats
-- any DNF" true (proximity ceilings at 75), and decaying it would let a lucky
-- near miss outscore someone who actually found the driver. Only the 900 above
-- it moves. The parity suite's invariant test covers this and still passes.
--
-- Both bodies below are reproduced from their live definitions -- drizzle/0044
-- for duel_submit_guess and drizzle/0055 for duel_close_round, read back with
-- pg_get_functiondef before writing this. CREATE OR REPLACE has no partial
-- form, so a migration that "only changes four lines" still has to restate
-- every other line correctly.

-- Spacing needs a timestamp to space against, and duel_round_results had none
-- (solved_at is set once, at the end). Nullable: a round's first guess has
-- nothing before it.
--
-- Deriving the rule from guess_count and started_at instead -- "you may have
-- made at most floor(elapsed / cooldown) + 1 guesses by now" -- would have
-- needed no column, and was rejected: that is a BUDGET, not spacing. It lets a
-- script idle for 30 seconds, bank 30 guesses, and fire them in one burst,
-- which is precisely the behaviour this exists to stop.
ALTER TABLE public.duel_round_results ADD COLUMN IF NOT EXISTS last_guess_at timestamptz;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.duel_submit_guess(
  p_match_id integer,
  p_round_index integer,
  p_guess_driver_id integer
)
RETURNS TABLE (
  solved boolean,
  points integer,
  best_heat numeric,
  score_a integer,
  score_b integer,
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
  career_wins_closeness numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_match record;
  v_round record;
  v_existing record;
  v_guess record;
  v_now timestamptz := now();
  v_cmp record;
  v_solved boolean;
  v_weighted_proximity numeric;
  v_best_heat numeric;
  v_next_guess_count integer;
  v_next_best_proximity numeric;
  v_points integer;
  v_accuracy numeric;
  v_wrong_guesses integer;
  v_ms_to_solve numeric;
  v_round_ms numeric;
  v_clamped numeric;
  v_remaining numeric;
  v_score_a integer;
  v_score_b integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_match FROM public.duel_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;
  IF v_match.player_a <> v_user_id AND v_match.player_b <> v_user_id THEN
    RAISE EXCEPTION 'You are not part of this match';
  END IF;
  IF v_match.status <> 'active' OR v_match.current_round <> p_round_index THEN
    RAISE EXCEPTION 'This round is not active';
  END IF;

  SELECT * INTO v_round FROM public.duel_rounds WHERE match_id = p_match_id AND round_index = p_round_index;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round not found';
  END IF;
  -- duel_begin_round flips the match to 'active' the instant it stamps the
  -- round, but started_at is still COUNTDOWN_MS in the future at that point
  -- (the lights-out countdown) -- the real client UI never lets a guess
  -- through before then (see components/duel/DuelMatch.tsx's isPreRound),
  -- but the server shouldn't trust that alone: a guess submitted well
  -- before the countdown finishes would clamp to msToSolve=0 and score max
  -- speed points for a "solve" that jumped the start. The 2s grace period
  -- below is purely for app-server/db-server clock drift (see drizzle/0025's
  -- header comment), not a loophole for jumping the gun -- it's far short of
  -- COUNTDOWN_MS (4s).
  IF v_now < v_round.started_at - interval '2 seconds' THEN
    RAISE EXCEPTION 'This round has not started yet';
  END IF;
  IF v_now >= v_round.ends_at THEN
    RAISE EXCEPTION 'Time is up for this round';
  END IF;

  SELECT * INTO v_existing FROM public.duel_round_results
  WHERE match_id = p_match_id AND round_index = p_round_index AND user_id = v_user_id
  FOR UPDATE;
  IF FOUND AND v_existing.solved_at IS NOT NULL THEN
    RAISE EXCEPTION 'You already solved this round';
  END IF;

  -- The guess cooldown (see this migration's header). Checked under the row
  -- lock taken just above, so two guesses racing from the same player can't
  -- both read the same last_guess_at and both pass.
  --
  -- Keep the interval in sync with GUESS_COOLDOWN_SERVER_MS in
  -- lib/game/duelTiming.ts. It is deliberately SHORTER than the client's own
  -- GUESS_COOLDOWN_MS wait: the client starts its timer when the response
  -- lands, this measures from when the previous guess was written, and the
  -- difference is one response leg. An honest player is disabled for longer
  -- than this and so never reaches the exception.
  IF v_existing.last_guess_at IS NOT NULL
    AND v_now < v_existing.last_guess_at + interval '850 milliseconds' THEN
    RAISE EXCEPTION 'One guess at a time -- take a moment';
  END IF;

  SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick a driver from the suggestions list';
  END IF;

  SELECT * INTO v_cmp FROM public.compare_drivers(p_guess_driver_id, v_round.driver_id, v_now);

  -- Driver identity, not attribute equality -- see drizzle/0044's header.
  v_solved := p_guess_driver_id = v_round.driver_id;

  -- Weighted proximity -- same weights as lib/game/duelScoring.ts's
  -- weightedProximity() (NATIONALITY/TEAM_EXACT/AGE/DEBUT/WINS = 15 each,
  -- TEAM_HISTORICAL = 8) and same MAX_PROXIMITY_WEIGHT ceiling (75, the
  -- five exact/correct weights -- historical is deliberately excluded from
  -- the ceiling there, matching duelScoring.ts's own comment on why). A
  -- doppelgänger guess can now reach the full 75 without solving, which is
  -- fine: 75 is still below MIN_SPEED_POINTS (100), so "any solve beats any
  -- DNF" holds on the ceiling itself rather than on the old assumption that
  -- an unsolved guess must miss something.
  v_weighted_proximity :=
    (CASE WHEN v_cmp.nationality = 'exact' THEN 15 ELSE 0 END) +
    (CASE WHEN v_cmp.team = 'exact' THEN 15 WHEN v_cmp.team = 'historical' THEN 8 ELSE 0 END) +
    (CASE WHEN v_cmp.age = 'correct' THEN 15 ELSE 15 * COALESCE(v_cmp.age_closeness, 0) END) +
    (CASE WHEN v_cmp.debut_year = 'correct' THEN 15 ELSE 15 * COALESCE(v_cmp.debut_year_closeness, 0) END) +
    (CASE WHEN v_cmp.career_wins = 'correct' THEN 15 ELSE 15 * COALESCE(v_cmp.career_wins_closeness, 0) END);

  v_best_heat := GREATEST(COALESCE(v_existing.best_proximity, 0), v_weighted_proximity) / 75.0;
  v_next_guess_count := COALESCE(v_existing.guess_count, 0) + 1;

  IF v_solved THEN
    -- solvePoints(msToSolve, roundMs, wrongGuesses): 100 + 900 * (remaining/
    -- roundMs)^2 * accuracy, clamped -- lib/game/duelScoring.ts.
    --
    -- The guess that solves is not a wrong one, so the count that decays the
    -- bonus is every guess BEFORE this one. Four guesses to a solve therefore
    -- passes 3 and pays in full. Keep the 0.88 and the 3 in sync with
    -- GUESS_DECAY / FREE_GUESSES in duelScoring.ts.
    v_wrong_guesses := v_next_guess_count - 1;
    v_accuracy := power(0.88, GREATEST(0, v_wrong_guesses - 3));

    -- MIN_SOLVE_MS (lib/game/duelTiming.ts) is the lower clamp: a sub-2s solve
    -- scores what the fastest possible human scores, not more.
    v_ms_to_solve := extract(epoch FROM (v_now - v_round.started_at)) * 1000;
    v_round_ms := extract(epoch FROM (v_round.ends_at - v_round.started_at)) * 1000;
    v_clamped := LEAST(GREATEST(v_ms_to_solve, 2000), v_round_ms);
    v_remaining := 1 - v_clamped / v_round_ms;
    -- Only the 900-point bonus is decayed; the 100 floor never is. See the
    -- header -- a decayed floor puts a near miss above a genuine solve.
    v_points := round(100 + 900 * v_remaining * v_remaining * v_accuracy)::int;
    -- bestProximity is deliberately NOT bumped on a win -- it only ever
    -- matters as a DNF fallback, irrelevant once solved.
    v_next_best_proximity := COALESCE(v_existing.best_proximity, 0);
  ELSE
    v_points := NULL;
    v_next_best_proximity := GREATEST(COALESCE(v_existing.best_proximity, 0), v_weighted_proximity);
  END IF;

  INSERT INTO public.duel_round_results (match_id, round_index, user_id, guess_count, solved_at, best_proximity, points, last_guess_at)
  VALUES (p_match_id, p_round_index, v_user_id, v_next_guess_count, CASE WHEN v_solved THEN v_now ELSE NULL END,
    v_next_best_proximity, COALESCE(v_points, 0), v_now)
  ON CONFLICT (match_id, round_index, user_id) DO UPDATE SET
    guess_count = v_next_guess_count,
    solved_at = CASE WHEN v_solved THEN v_now ELSE NULL END,
    best_proximity = v_next_best_proximity,
    points = COALESCE(v_points, 0),
    last_guess_at = v_now;

  v_score_a := v_match.score_a;
  v_score_b := v_match.score_b;
  IF v_solved THEN
    IF v_match.player_a = v_user_id THEN
      v_score_a := v_score_a + v_points;
    ELSE
      v_score_b := v_score_b + v_points;
    END IF;
    UPDATE public.duel_matches SET score_a = v_score_a, score_b = v_score_b WHERE id = p_match_id;
  END IF;

  RETURN QUERY SELECT
    v_solved, v_points, v_best_heat, v_score_a, v_score_b,
    v_guess.id, v_guess.full_name, v_guess.driver_code, v_guess.nationality, COALESCE(v_guess.last_team, '—'),
    extract(year FROM age(COALESCE(v_guess.date_of_death, (v_now AT TIME ZONE 'UTC')::date), v_guess.date_of_birth))::int,
    v_guess.debut_year, v_guess.career_wins,
    v_cmp.nationality, v_cmp.team, v_cmp.age, v_cmp.age_closeness, v_cmp.debut_year, v_cmp.debut_year_closeness,
    v_cmp.career_wins, v_cmp.career_wins_closeness;
END;
$$;
--> statement-breakpoint

-- Unchanged from drizzle/0055 apart from the two DNF payout lines. See
-- drizzle/0024's header for the reveal columns and why the already-closed
-- branch returns NULL for every one of them, and drizzle/0055's for the
-- per-match last-round test.
CREATE OR REPLACE FUNCTION public.duel_close_round(p_match_id integer, p_round_index integer)
RETURNS TABLE (
  advanced boolean,
  match_status text,
  current_round integer,
  score_a integer,
  score_b integer,
  winner_id uuid,
  intermission_ends_at timestamptz,
  next_round_index integer,
  points_a integer,
  points_b integer,
  target_driver_id integer,
  target_full_name text,
  target_driver_code text,
  target_nationality text,
  target_team text,
  target_age integer,
  target_debut_year integer,
  target_career_wins integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_round record;
  v_target record;
  v_a_result record;
  v_b_result record;
  v_now timestamptz := now();
  v_round_expired boolean;
  v_a_done boolean;
  v_b_done boolean;
  v_score_a integer;
  v_score_b integer;
  v_points_a integer;
  v_points_b integer;
  v_intermission_ends_at timestamptz;
  v_winner_id uuid;
  v_next_round_index integer;
BEGIN
  SELECT * INTO v_match FROM public.duel_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id;
  END IF;

  -- Idempotency guard: only the match's current round, while still active,
  -- can be closed. Already moved on (intermission/finished, or a different
  -- current_round) -- no-op, report current state. No reveal data on this
  -- branch -- a repeat caller already has it from the first, real call.
  IF v_match.status <> 'active' OR v_match.current_round <> p_round_index THEN
    RETURN QUERY SELECT false, v_match.status, v_match.current_round, v_match.score_a, v_match.score_b,
      v_match.winner_id, NULL::timestamptz, NULL::integer,
      NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_round FROM public.duel_rounds WHERE match_id = p_match_id AND round_index = p_round_index;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round % not found for match %', p_round_index, p_match_id;
  END IF;

  v_round_expired := v_now >= v_round.ends_at;

  SELECT * INTO v_a_result FROM public.duel_round_results
  WHERE match_id = p_match_id AND round_index = p_round_index AND user_id = v_match.player_a;
  SELECT * INTO v_b_result FROM public.duel_round_results
  WHERE match_id = p_match_id AND round_index = p_round_index AND user_id = v_match.player_b;

  v_a_done := (v_a_result.solved_at IS NOT NULL) OR v_round_expired;
  v_b_done := (v_b_result.solved_at IS NOT NULL) OR v_round_expired;

  -- Not a repeat call -- genuinely still in progress. Same no-op shape as
  -- the guard above, just a different reason (nobody's finished yet).
  IF NOT (v_a_done AND v_b_done) THEN
    RETURN QUERY SELECT false, v_match.status, v_match.current_round, v_match.score_a, v_match.score_b,
      v_match.winner_id, NULL::timestamptz, NULL::integer,
      NULL::integer, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  v_score_a := v_match.score_a;
  v_score_b := v_match.score_b;

  -- Finalize DNF scoring -- upsert since a player who never guessed at all
  -- this round has no duel_round_results row yet. v_points_a/b end up
  -- holding this round's earned points either way (DNF proximity here, or
  -- the solved value duel_submit_guess already stored) -- the reveal card's
  -- "+N" count-up for each side.
  --
  -- The payout is the round's best proximity DECAYED by the same accuracy
  -- factor a solve pays (drizzle/0058). Every guess in a DNF round is a wrong
  -- one, so the whole guess_count is passed -- unlike the solve path, which
  -- excludes the guess that won. Without this, spraying the pool stays the
  -- optimal DNF strategy: best-of-N rises with N for free, and the ceiling
  -- (75) is most of a whole round's floor. dnfPoints() in
  -- lib/game/duelScoring.ts is this same expression; keep 0.88 and 3 in sync
  -- with GUESS_DECAY / FREE_GUESSES there.
  IF v_a_result.solved_at IS NULL THEN
    v_points_a := ROUND(COALESCE(v_a_result.best_proximity, 0) * power(0.88, GREATEST(0, COALESCE(v_a_result.guess_count, 0) - 3)))::int;
    INSERT INTO public.duel_round_results (match_id, round_index, user_id, guess_count, solved_at, best_proximity, points)
    VALUES (p_match_id, p_round_index, v_match.player_a, COALESCE(v_a_result.guess_count, 0), NULL,
      COALESCE(v_a_result.best_proximity, 0), v_points_a)
    ON CONFLICT (match_id, round_index, user_id) DO UPDATE SET points = v_points_a;
    v_score_a := v_score_a + v_points_a;
  ELSE
    v_points_a := v_a_result.points;
  END IF;

  IF v_b_result.solved_at IS NULL THEN
    v_points_b := ROUND(COALESCE(v_b_result.best_proximity, 0) * power(0.88, GREATEST(0, COALESCE(v_b_result.guess_count, 0) - 3)))::int;
    INSERT INTO public.duel_round_results (match_id, round_index, user_id, guess_count, solved_at, best_proximity, points)
    VALUES (p_match_id, p_round_index, v_match.player_b, COALESCE(v_b_result.guess_count, 0), NULL,
      COALESCE(v_b_result.best_proximity, 0), v_points_b)
    ON CONFLICT (match_id, round_index, user_id) DO UPDATE SET points = v_points_b;
    v_score_b := v_score_b + v_points_b;
  ELSE
    v_points_b := v_b_result.points;
  END IF;

  -- Keep in sync with lib/game/duelTiming.ts's INTERMISSION_MS.
  v_intermission_ends_at := v_now + interval '6 seconds';

  UPDATE public.duel_rounds SET intermission_ends_at = v_intermission_ends_at
  WHERE match_id = p_match_id AND round_index = p_round_index;

  SELECT id, full_name, driver_code, nationality, last_team, debut_year, career_wins, date_of_birth, date_of_death
  INTO v_target
  FROM public.drivers WHERE id = v_round.driver_id;

  -- Per-match round count (drizzle/0054), 0-indexed -- the last round is
  -- rounds - 1. See drizzle/0055 on why the client reads this answer off
  -- match_status rather than deriving a second copy of it.
  IF p_round_index >= v_match.rounds - 1 THEN
    v_winner_id := CASE WHEN v_score_a = v_score_b THEN NULL
      WHEN v_score_a > v_score_b THEN v_match.player_a ELSE v_match.player_b END;

    UPDATE public.duel_matches
    SET status = 'finished', score_a = v_score_a, score_b = v_score_b, winner_id = v_winner_id, finished_at = v_now
    WHERE id = p_match_id;

    RETURN QUERY SELECT true, 'finished'::text, v_match.current_round, v_score_a, v_score_b, v_winner_id,
      v_intermission_ends_at, NULL::integer,
      v_points_a, v_points_b, v_target.id, v_target.full_name, v_target.driver_code, v_target.nationality,
      COALESCE(v_target.last_team, '—'),
      extract(year FROM age(COALESCE(v_target.date_of_death, (v_now AT TIME ZONE 'UTC')::date), v_target.date_of_birth))::int,
      v_target.debut_year, v_target.career_wins;
    RETURN;
  END IF;

  v_next_round_index := p_round_index + 1;
  UPDATE public.duel_matches
  SET status = 'intermission', current_round = v_next_round_index, score_a = v_score_a, score_b = v_score_b
  WHERE id = p_match_id;

  RETURN QUERY SELECT true, 'intermission'::text, v_next_round_index, v_score_a, v_score_b, NULL::uuid,
    v_intermission_ends_at, v_next_round_index,
    v_points_a, v_points_b, v_target.id, v_target.full_name, v_target.driver_code, v_target.nationality,
    COALESCE(v_target.last_team, '—'),
    extract(year FROM age(COALESCE(v_target.date_of_death, (v_now AT TIME ZONE 'UTC')::date), v_target.date_of_birth))::int,
    v_target.debut_year, v_target.career_wins;
END;
$$;
--> statement-breakpoint

-- The grant decisions, restated rather than assumed -- same convention as
-- drizzle/0055. CREATE OR REPLACE keeps an existing function's ACL, so all
-- three lines are no-ops today; they are here so that the file which last
-- defined each function is also the file that says who may call it. Each is
-- exactly what lib/db/schemaGrants.test.ts already declares.
REVOKE EXECUTE ON FUNCTION public.duel_close_round(integer, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_submit_guess(integer, integer, integer) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_submit_guess(integer, integer, integer) TO authenticated;
