-- Makes the intermission a thing a client can ASK the server about, instead of
-- something the opponent tells it (audit 2026-07-30 §3.4 residual).
--
-- THE PROBLEM. duel:{matchId} is a private channel since drizzle/0046, which
-- narrowed the attacker set from "the internet" to "the other participant" --
-- but it did not empty it, and two handlers were still applying their payload
-- verbatim. A forged `round_end` pulled the victim out of a live round onto an
-- attacker-chosen reveal, attacker-chosen round points, attacker-chosen running
-- scores and an attacker-chosen intermission length; a forged `match_end`
-- painted an attacker-chosen winner and rating delta over the final reveal.
-- Nothing there writes the database -- duel_submit_guess, duel_close_round and
-- applyMatchRatings each validate independently -- so what a forgery cost was
-- the round, live, in a rated 1v1.
--
-- The fix shape is drizzle/0034 + audit 2026-07-29 §0.2's: let the broadcast
-- say only *that* something happened, and read *what* happened back over the
-- warm one-hop RPC path. `round_start` could already do that, because
-- duel_begin_round is idempotent in its RESPONSE as well as its effect -- the
-- second caller gets the same started_at/ends_at echoed back with
-- newly_started: false.
--
-- WHY A NEW FUNCTION AND NOT duel_close_round. duel_close_round is idempotent
-- in its effect but NOT in its response: its already-closed branch returns
-- `advanced: false` and NULLs for every reveal column (drizzle/0024:65-74,
-- "no reveal data on this branch -- a repeat caller already has it from the
-- first, real call"). That assumption is exactly what this finding overturns:
-- the receiving client never made a real call, because only ONE client's close
-- ever advances. So the audit's suggested "re-verify against
-- duel_close_round_client" does not actually work today, and the honest
-- options were to widen that function's already-closed branch or to add a
-- read. This adds the read:
--
--   * duel_close_round is ~120 lines of scoring and advancement rules under a
--     FOR UPDATE lock on the match row. This is on the between-rounds path,
--     called by BOTH clients; a read has no business queueing behind that lock,
--     and the same argument drizzle/0034 made for wrappers over a rewrite
--     applies to leaving those rules alone.
--   * A read cannot corrupt a match. The whole finding is about a client
--     adopting state it should have asked for; the thing it should have asked
--     is a question, not a command.
--
-- WHAT MAKES THIS SAFE TO EXPOSE. `closed` is not the caller's word and not
-- the match status: it is duel_rounds.intermission_ends_at IS NOT NULL, which
-- duel_close_round stamps in the same statement that scores the round and which
-- nothing else in the schema ever writes (duel_forfeit does not touch
-- duel_rounds at all). So there is exactly one way for a round to read as
-- closed here, and until it does, this function returns no target, no points
-- and no clock -- CLAUDE.md's "never send the target driver to a client during
-- a round" is preserved by construction, and a forged round_end mid-round comes
-- back with nothing to apply.
--
-- The match-level columns (status, current_round, winner_id, rating_delta_a/b)
-- are returned on both branches: they are what `match_end` re-verifies against,
-- and none of them says anything before the match is actually over
-- (winner_id/rating_delta_* are NULL until finished).

CREATE OR REPLACE FUNCTION public.duel_round_reveal(p_match_id integer, p_round_index integer)
RETURNS TABLE (
  -- Round-level: has THIS round actually been closed server-side?
  closed boolean,
  -- Match-level, always populated -- what match_end re-verifies against.
  match_status text,
  current_round integer,
  winner_id uuid,
  rating_delta_a integer,
  rating_delta_b integer,
  -- Round-level reveal, NULL unless closed.
  score_a integer,
  score_b integer,
  points_a integer,
  points_b integer,
  intermission_ends_at timestamptz,
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
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_match record;
  v_round record;
  v_target record;
  v_now timestamptz := now();
  v_score_a integer;
  v_score_b integer;
  v_points_a integer;
  v_points_b integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT dm.player_a, dm.player_b, dm.status, dm.current_round, dm.winner_id,
         dm.rating_delta_a, dm.rating_delta_b
  INTO v_match
  FROM public.duel_matches dm
  WHERE dm.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id;
  END IF;

  IF v_user_id <> v_match.player_a AND v_user_id <> v_match.player_b THEN
    RAISE EXCEPTION 'You are not part of match %', p_match_id;
  END IF;

  SELECT dr.driver_id, dr.intermission_ends_at
  INTO v_round
  FROM public.duel_rounds dr
  WHERE dr.match_id = p_match_id AND dr.round_index = p_round_index;

  -- Either the round was never stamped, or it is still live. Report the
  -- match-level state and nothing else -- no target, no points, no clock.
  IF NOT FOUND OR v_round.intermission_ends_at IS NULL THEN
    RETURN QUERY SELECT false, v_match.status, v_match.current_round, v_match.winner_id,
      v_match.rating_delta_a, v_match.rating_delta_b,
      NULL::integer, NULL::integer, NULL::integer, NULL::integer, NULL::timestamptz,
      NULL::integer, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  -- The running score AS OF the end of this round, summed from the per-round
  -- rows rather than read off duel_matches.score_a/b. Those columns are
  -- "cumulative right now" -- duel_submit_guess adds to them the moment a
  -- player solves (drizzle/0044:518) -- so once the next round is under way
  -- they no longer describe the intermission this call is about.
  SELECT COALESCE(SUM(rr.points) FILTER (WHERE rr.user_id = v_match.player_a), 0)::integer,
         COALESCE(SUM(rr.points) FILTER (WHERE rr.user_id = v_match.player_b), 0)::integer
  INTO v_score_a, v_score_b
  FROM public.duel_round_results rr
  WHERE rr.match_id = p_match_id AND rr.round_index <= p_round_index;

  -- This round's own earned points -- the reveal card's "+N" count-up. A
  -- player who never guessed still has a row by now: duel_close_round upserts
  -- one for the DNF side before it stamps intermission_ends_at.
  SELECT COALESCE((SELECT rr.points FROM public.duel_round_results rr
                   WHERE rr.match_id = p_match_id AND rr.round_index = p_round_index
                     AND rr.user_id = v_match.player_a), 0),
         COALESCE((SELECT rr.points FROM public.duel_round_results rr
                   WHERE rr.match_id = p_match_id AND rr.round_index = p_round_index
                     AND rr.user_id = v_match.player_b), 0)
  INTO v_points_a, v_points_b;

  -- Same public reveal columns, and the same age expression, duel_close_round
  -- returns to the closing client (drizzle/0024:136-154).
  SELECT d.id, d.full_name, d.driver_code, d.nationality, d.last_team,
         d.debut_year, d.career_wins, d.date_of_birth, d.date_of_death
  INTO v_target
  FROM public.drivers d
  WHERE d.id = v_round.driver_id;

  RETURN QUERY SELECT true, v_match.status, v_match.current_round, v_match.winner_id,
    v_match.rating_delta_a, v_match.rating_delta_b,
    v_score_a, v_score_b, v_points_a, v_points_b, v_round.intermission_ends_at,
    v_target.id, v_target.full_name, v_target.driver_code, v_target.nationality,
    COALESCE(v_target.last_team, '—'),
    extract(year FROM age(COALESCE(v_target.date_of_death, (v_now AT TIME ZONE 'UTC')::date), v_target.date_of_birth))::integer,
    v_target.debut_year, v_target.career_wins;
END;
$$;
--> statement-breakpoint

-- The grant decision, written next to the function as CLAUDE.md's "Schema"
-- section requires -- and naming the grantees, because Supabase's bootstrap
-- ALTER DEFAULT PRIVILEGES hands every new function in `public` an individually
-- named grant to anon and authenticated that a bare PUBLIC revoke leaves
-- standing (drizzle/0039). Every visitor has at least an anonymous session, so
-- `authenticated` is the role that makes real requests; `anon` would make
-- auth.uid() NULL, which the participant check above rejects anyway.
REVOKE EXECUTE ON FUNCTION public.duel_round_reveal(integer, integer) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_round_reveal(integer, integer) TO authenticated;
