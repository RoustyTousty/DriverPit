-- Every round gets the same countdown length again. Redefines duel_begin_round
-- (last defined in drizzle/0033), changing only the CASE that picked a shorter
-- countdown for rounds after the first; nothing else about the function moves.
--
-- WHY THE SHORTER MINI-COUNTDOWN IS GONE. 0033 gave rounds 2 and 3 a 3200ms
-- countdown, which only fit by sweeping the five lights faster (400ms per light
-- instead of 700ms). In play that didn't read as a deliberate short version of
-- the grid start -- it read as a rushed, cheaper replay of the animation you'd
-- just seen at full speed. One ceremony, one speed.
--
-- AND WHY IT CAN'T SIMPLY BE SHORTENED AGAIN. At 700ms per light the ceremony
-- needs 4 intervals (2800ms) plus LIGHTS_ALL_LIT_HOLD_MS (600ms) before
-- lights-out, and lights-out has to be COUNTDOWN_GO_HOLD_MS (700ms) before
-- started_at -- so 4100ms is a hard floor. Anything below it puts lights-out
-- *after* started_at, and since ends_at and duel_submit_guess's ms-to-solve are
-- both measured from started_at, the overrun is taken straight out of the
-- player's 60 seconds and added to their solve time. That is precisely the bug
-- drizzle/0033 was written to fix, so a future "make later rounds quicker" has
-- to come from the all-lit hold or the number of lights, never the interval.
--
-- Keep in sync with lib/game/duelTiming.ts (COUNTDOWN_MS / ROUND_MS); plpgsql
-- can't import it, which is why these literals are the documented mirrors
-- called out in that file's header.
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

  -- Same 10-year pool as match_or_queue's round-0 pick (drizzle/0013) --
  -- keep the "- 10" in sync with lib/game/poolWindow.ts's DAILY_POOL_WINDOW.
  SELECT id INTO v_target_driver_id
  FROM public.drivers
  WHERE last_active_year >= extract(year FROM now())::int - 10
  ORDER BY random()
  LIMIT 1;

  -- COUNTDOWN_MS, every round. Already includes COUNTDOWN_GO_HOLD_MS -- see the
  -- header note on what started_at means.
  v_started_at := now() + interval '4700 milliseconds';
  v_ends_at := v_started_at + interval '60 seconds';

  INSERT INTO public.duel_rounds (match_id, round_index, driver_id, started_at, ends_at)
  VALUES (p_match_id, p_round_index, v_target_driver_id, v_started_at, v_ends_at);

  UPDATE public.duel_matches
  SET status = 'active', current_round = p_round_index
  WHERE id = p_match_id;

  RETURN QUERY SELECT p_round_index, v_started_at, v_ends_at, 'active'::text, true;
END;
$$;
--> statement-breakpoint

-- CREATE OR REPLACE resets the function's grants to the defaults, so re-apply
-- drizzle/0034's lockdown: this inner function has no auth.uid() check of its
-- own (that lives in duel_begin_round_client) and must stay unreachable from a
-- browser.
REVOKE EXECUTE ON FUNCTION public.duel_begin_round(integer, integer) FROM PUBLIC, anon, authenticated;
