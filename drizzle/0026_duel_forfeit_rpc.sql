-- Custom SQL migration file, put your code below! --

-- Forfeit / abandonment (CLAUDE.md "Exit, forfeit & disconnect"): marks the
-- match abandoned with the *other* player as winner. Same trust model as
-- duel_begin_round/duel_close_round in drizzle/0021 -- called only from
-- server code over the trusted Drizzle connection (lib/db/duelRpc.ts), so
-- it takes the forfeiting player's id explicitly and relies on the calling
-- server action to have verified the *requesting* user is a participant.
-- Not GRANTed to authenticated/anon, so unreachable via PostgREST.
--
-- p_forfeited_player is whoever is *leaving*, which is not always the
-- caller: on explicit exit the leaver reports themselves, but on a
-- disconnect it's the REMAINING player calling this on the absent
-- opponent's behalf after DISCONNECT_GRACE_MS (the server has no presence
-- view of its own, so it cannot verify absence -- accepted for v1, per
-- CLAUDE.md's design).
--
-- Idempotent and safe from either side: the FOR UPDATE lock serializes
-- concurrent calls (leaver's own call vs the opponent's grace-timer call,
-- or a forfeit racing duel_close_round's normal finish), and any call that
-- finds the match already terminal is a pure read reporting the settled
-- outcome -- it never flips a finished match to abandoned, never reassigns
-- winner_id, and (because advanced=false tells the caller to skip
-- applyMatchResult) never double-writes ratings.
CREATE OR REPLACE FUNCTION public.duel_forfeit(p_match_id integer, p_forfeited_player uuid)
RETURNS TABLE (
  advanced boolean,
  match_status text,
  winner_id uuid,
  score_a integer,
  score_b integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_winner uuid;
BEGIN
  SELECT * INTO v_match FROM public.duel_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id;
  END IF;
  IF p_forfeited_player <> v_match.player_a AND p_forfeited_player <> v_match.player_b THEN
    RAISE EXCEPTION 'User % is not part of match %', p_forfeited_player, p_match_id;
  END IF;

  IF v_match.status IN ('finished', 'abandoned') THEN
    RETURN QUERY SELECT false, v_match.status, v_match.winner_id, v_match.score_a, v_match.score_b;
    RETURN;
  END IF;

  v_winner := CASE WHEN p_forfeited_player = v_match.player_a THEN v_match.player_b ELSE v_match.player_a END;

  UPDATE public.duel_matches
  SET status = 'abandoned', winner_id = v_winner, finished_at = now()
  WHERE id = p_match_id;

  RETURN QUERY SELECT true, 'abandoned'::text, v_winner, v_match.score_a, v_match.score_b;
END;
$$;
