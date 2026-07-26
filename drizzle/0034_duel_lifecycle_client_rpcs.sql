-- Puts the duel round lifecycle on the same warm one-hop path guesses already
-- use (CLAUDE.md "Fast guess evaluation (all modes)"), and closes a
-- pre-existing privilege hole on the way.
--
-- THE PROBLEM. duel_begin_round and duel_close_round were reachable only
-- through Next.js Server Actions (lib/duel/actions.ts), because they run over
-- the trusted Drizzle connection and had no auth.uid() authorization of their
-- own. One beginRound() call therefore cost:
--
--     browser -> Vercel serverless invocation (cold start; on `next dev`, a
--                route compile)
--             -> auth.getUser()            (network hop to Supabase)
--             -> SELECT duel_matches       (network hop to Supabase)
--             -> duel_begin_round          (network hop to Supabase)
--
-- Three sequential Supabase round trips behind a serverless invocation, on the
-- exact path between one round ending and the next starting. On a slow
-- connection that latency is deducted from the countdown -- the round's clock is
-- stamped when the RPC runs, but the client only learns when the response
-- arrives -- so the lights are already over on arrival and the player is
-- dropped into a round that has visibly been running without them. Measured on
-- a bad connection under `next dev`: ~20s, landing in a round with 35s left.
--
-- THE SHAPE OF THE FIX. Thin SECURITY DEFINER wrappers that do exactly one
-- thing the Server Action was doing -- prove the caller is a participant -- and
-- delegate to the existing function. Deliberately wrappers rather than
-- rewriting the originals with an auth check inside:
--
--   * duel_close_round's body is ~120 lines of scoring and advancement logic
--     (last defined in drizzle/0024). Retyping it into this migration to add
--     four lines of authorization would put every DNF/points/winner rule at
--     risk of a transcription error, to change something that isn't in it.
--   * The originals stay callable over the trusted connection exactly as
--     before, so lib/db/duelRpc.ts and its integration tests are untouched.
--   * One definition of the logic, one definition of the authorization.
--
-- THE HOLE THIS ALSO CLOSES. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and these live in the `public` schema -- which PostgREST
-- exposes. So duel_begin_round, duel_close_round, duel_forfeit and duel_state
-- have been callable straight from any browser holding the anon key this whole
-- time, with no participant check anywhere in them (the check lived up in the
-- Server Action, which such a caller simply skips). duel_begin_round in
-- particular would let a stranger stamp another match's round clock early. The
-- REVOKEs at the bottom close that, and are why the wrappers can trust that
-- auth.uid() is non-null: after this migration a browser cannot reach the inner
-- functions at all, only these.

-- The clock every duel countdown corrects against. Same value the getServerTime
-- Server Action returned (the DATABASE's now(), not the Next server's -- see
-- lib/duel/serverClock.ts for why that distinction matters), but reachable in
-- one warm hop, which also makes the round-trip-midpoint offset estimate itself
-- more accurate: a shorter, less variable round trip is a tighter measurement.
CREATE OR REPLACE FUNCTION public.duel_server_time()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT now();
$$;
--> statement-breakpoint

-- Authorization-only wrapper over public.duel_begin_round (drizzle/0033).
-- Mirrors the participant check the beginRound Server Action performed; the
-- delegate keeps every other guarantee (idempotent re-stamp, per-round
-- countdown length, target pick).
CREATE OR REPLACE FUNCTION public.duel_begin_round_client(p_match_id integer, p_round_index integer)
RETURNS TABLE (
  round_index integer,
  started_at timestamptz,
  ends_at timestamptz,
  match_status text,
  newly_started boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_match record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT dm.player_a, dm.player_b INTO v_match
  FROM public.duel_matches dm
  WHERE dm.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id;
  END IF;

  IF v_user_id <> v_match.player_a AND v_user_id <> v_match.player_b THEN
    RAISE EXCEPTION 'You are not part of match %', p_match_id;
  END IF;

  RETURN QUERY SELECT * FROM public.duel_begin_round(p_match_id, p_round_index);
END;
$$;
--> statement-breakpoint

-- Authorization-only wrapper over public.duel_close_round (drizzle/0024).
-- Note what this does NOT do: writing ratings and W/L records on a match that
-- just finished stays in TypeScript (lib/duel/actions.ts's applyMatchRatings,
-- over the trusted connection), because the Elo math is a unit-tested TS
-- function (lib/game/duelRating.ts) and porting it to plpgsql would mean two
-- implementations of the same rules drifting apart. The caller invokes that
-- separately, and only on the last round -- off the between-round path this
-- migration exists to speed up.
CREATE OR REPLACE FUNCTION public.duel_close_round_client(p_match_id integer, p_round_index integer)
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_match record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT dm.player_a, dm.player_b INTO v_match
  FROM public.duel_matches dm
  WHERE dm.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id;
  END IF;

  IF v_user_id <> v_match.player_a AND v_user_id <> v_match.player_b THEN
    RAISE EXCEPTION 'You are not part of match %', p_match_id;
  END IF;

  RETURN QUERY SELECT * FROM public.duel_close_round(p_match_id, p_round_index);
END;
$$;
--> statement-breakpoint

-- Lock the inner lifecycle functions to the trusted connection only. These have
-- never had a participant check of their own -- it lived in the Server Actions
-- calling them -- so leaving them on PostgREST's default PUBLIC grant means the
-- wrappers above could simply be bypassed. duel_forfeit and duel_state get the
-- same treatment: both are still called only from Server Actions that do their
-- own auth, and neither has any business being reachable from a browser.
REVOKE EXECUTE ON FUNCTION public.duel_begin_round(integer, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_close_round(integer, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_forfeit(integer, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_state(integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Every visitor has at least an anonymous session, so `authenticated` is the
-- right grantee -- same as duel_submit_guess (drizzle/0022) and the daily /
-- infinite RPCs (drizzle/0028). `anon` (no JWT at all) is deliberately not
-- granted: it would make auth.uid() null, which the wrappers reject anyway.
REVOKE EXECUTE ON FUNCTION public.duel_begin_round_client(integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_begin_round_client(integer, integer) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_close_round_client(integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_close_round_client(integer, integer) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_server_time() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_server_time() TO authenticated;
