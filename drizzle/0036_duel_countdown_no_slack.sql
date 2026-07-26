-- COUNTDOWN_MS 4700 -> 3900. Redefines duel_begin_round (last defined in
-- drizzle/0035); only the countdown literal changes.
--
-- The old value carried 600ms of deliberate slack: the light sweep was a fixed
-- length (4 x 700ms + a 600ms all-lit hold = 3400ms) that had to FIT inside the
-- ceremony budget, and the slack was what absorbed the RPC latency between the
-- stamp and the client learning about it. Without it, lights-out landed after
-- started_at and the overrun came out of the player's 60 seconds.
--
-- That slack was also dead air. It surfaced as all five lights sitting on for
-- roughly a second before going out, and because it shrank as latency grew, the
-- same constants produced a visibly different pause on round 1 (which pays a
-- component mount) than on rounds 2 and 3 (which don't).
--
-- The client now DERIVES the light interval from the budget actually remaining
-- when the round lands (useLightsCountdown), so the sweep fills whatever time
-- there is and the fifth light always arrives exactly LIGHTS_ALL_LIT_HOLD_MS
-- before lights-out. Latency shifts the interval by a few percent instead of
-- leaving a variable gap, so no slack is needed here any more -- the budget is
-- now just the ceremony's real length.
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
  v_started_at := now() + interval '3900 milliseconds';
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
