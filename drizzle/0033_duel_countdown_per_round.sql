-- Redefines duel_begin_round (last defined in drizzle/0021_duel_lifecycle_rpcs.sql)
-- for two related changes to the pre-round countdown. Everything else about the
-- function -- the FOR UPDATE lock, the idempotent "already stamped" return, the
-- 10-year target pick, the status/current_round update -- is carried over
-- unchanged.
--
-- 1. started_at now means "the board is on screen and this player can act",
--    NOT "the lights went out".
--
--    The clients run the five-light ceremony, then hold on lights-out + "GO!"
--    for COUNTDOWN_GO_HOLD_MS before handing off to the board. started_at used
--    to be stamped at the lights-out moment, so that hold played out *inside*
--    the live round: ends_at is started_at + 60s and duel_submit_guess measures
--    ms-to-solve from started_at, which meant every player silently lost the
--    hold off their round AND had it added to every solve time, dragging their
--    speed points down for time they spent watching an animation.
--
--    Adding the hold to the countdown instead of to ends_at fixes both at once
--    and needs no change to duel_submit_guess: as long as started_at is the
--    instant play actually begins, everything already measured from it is
--    correct by construction. The lights-out moment lands at the same wall
--    clock as before (4000ms after the stamp for round 1) -- the ceremony is
--    not longer, the round simply no longer starts underneath it.
--
-- 2. Rounds after the first get a shorter countdown.
--
--    Same five-light ceremony and the same UI component, just tighter: the full
--    grid-start beat earns its length once, and replaying it at full length
--    twice more inside a three-round match is where it starts to drag.
--
-- Keep every literal below in sync with lib/game/duelTiming.ts
-- (COUNTDOWN_MS / MINI_COUNTDOWN_MS / ROUND_MS). plpgsql can't import that
-- file, which is why these are the documented mirrors called out in its header.
-- The client picks its light pacing from the same round index via
-- roundCountdownMs/roundLightIntervalMs, so if these two diverge the lights
-- stop finishing before lights-out.
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
  v_countdown interval;
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

  -- COUNTDOWN_MS for round 1, MINI_COUNTDOWN_MS after it. Both already include
  -- COUNTDOWN_GO_HOLD_MS -- see the header note on what started_at means.
  v_countdown := CASE
    WHEN p_round_index = 0 THEN interval '4700 milliseconds'
    ELSE interval '3200 milliseconds'
  END;

  v_started_at := now() + v_countdown;
  v_ends_at := v_started_at + interval '60 seconds';

  INSERT INTO public.duel_rounds (match_id, round_index, driver_id, started_at, ends_at)
  VALUES (p_match_id, p_round_index, v_target_driver_id, v_started_at, v_ends_at);

  UPDATE public.duel_matches
  SET status = 'active', current_round = p_round_index
  WHERE id = p_match_id;

  RETURN QUERY SELECT p_round_index, v_started_at, v_ends_at, 'active'::text, true;
END;
$$;
