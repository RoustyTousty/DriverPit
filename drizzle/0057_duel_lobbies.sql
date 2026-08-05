-- Custom lobbies, phase 4 -- the duel_lobbies table and its six RPCs.
--
-- A custom lobby is a short-lived row holding a config and a code. Joining it
-- creates an ORDINARY duel_matches row with ranked = false plus that config,
-- and from that instant every existing duel component, RPC and realtime channel
-- runs unchanged. There is no second lifecycle, no second scoring path and no
-- second channel -- which is the whole safety argument for the feature.
--
-- NO STATUS COLUMN. The three states are derivable and must stay that way:
-- open (match_id IS NULL), consumed (match_id IS NOT NULL), gone (row deleted).
-- A status column would be a fourth thing to keep in agreement with the other
-- three, and the first bug would be a row that says 'open' while holding a
-- match id.
CREATE TABLE IF NOT EXISTS public.duel_lobbies (
  code            text PRIMARY KEY,
  host_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The self-join guard, and the reason it is a separate column from host_id:
  -- signing out mints a fresh anonymous identity, so user_id alone cannot tell
  -- "someone else" from "the same person a minute later". Stable per browser
  -- profile, persisted in localStorage. Same layer drizzle/0032 added to the
  -- matchmaking queue, for the same reason.
  host_device_id  text NOT NULL,
  -- Knockout's seam. The create screen shows it disabled; the CHECK is what
  -- keeps a second mode from arriving by accident before it is built.
  mode            text NOT NULL DEFAULT 'duel',
  rounds          integer NOT NULL,
  round_seconds   integer NOT NULL,
  -- NOT NULL here, unlike duel_matches.filter: a custom lobby always composes
  -- one. Null on the match row means "the daily 20-year pool", which is every
  -- ranked duel and never a custom one.
  filter          jsonb NOT NULL,
  -- ON DELETE CASCADE, deliberately not SET NULL: a deleted match must not
  -- resurrect its lobby as joinable.
  match_id        integer REFERENCES public.duel_matches(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  -- The generated alphabet, asserted in the database rather than trusted from
  -- the generator: 31 unambiguous characters, no 0/O/1/I/L.
  CONSTRAINT duel_lobbies_code_shape_check
    CHECK (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  CONSTRAINT duel_lobbies_mode_check CHECK (mode IN ('duel')),
  -- The same bounds duel_matches carries (drizzle/0054), because these values
  -- are copied onto a match at join time and would fail there instead.
  CONSTRAINT duel_lobbies_rounds_check CHECK (rounds BETWEEN 1 AND 5),
  CONSTRAINT duel_lobbies_round_seconds_check CHECK (round_seconds BETWEEN 15 AND 180)
);
--> statement-breakpoint

-- Both hot lookups: the host's own open lobbies (create sweeps them) and the
-- device guard's converge-on-search delete.
CREATE INDEX IF NOT EXISTS duel_lobbies_host_id_idx ON public.duel_lobbies (host_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duel_lobbies_host_device_id_idx ON public.duel_lobbies (host_device_id);
--> statement-breakpoint

-- RLS ON, NO POLICIES, NO CLIENT GRANTS -- the matchmaking_queue shape, for the
-- matchmaking_queue reason: what has to be proven is a row, and the only
-- supported way to touch one is a vetted function. RLS with no policy is
-- deny-all; the revoke below means the grant and the policy would have to fail
-- together (CLAUDE.md "Schema").
--
-- The revoke names anon and authenticated explicitly and takes SELECT too. The
-- bootstrap's ALTER DEFAULT PRIVILEGES granted ALL on this table to both roles
-- the instant it was created, and a bare REVOKE FROM PUBLIC would leave every
-- one of those named grants standing (drizzle/0039). Unlike the nine tables in
-- drizzle/0042, SELECT goes too: no policy on this table depends on it, and a
-- readable duel_lobbies is every open lobby's code sitting behind one anon-key
-- query -- the one thing a code is supposed to be.
ALTER TABLE public.duel_lobbies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.duel_lobbies FROM anon, authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- duel_sweep_stale_lobbies
-- ---------------------------------------------------------------------------

-- Called at the top of create and join, so no cron is needed -- the same
-- pattern as duel_sweep_stale_queue (drizzle/0032).
--
-- Two windows, and the split matters. Only OPEN lobbies go stale on
-- last_seen_at: a consumed one stops heart-beating the moment its host is in
-- the match, and deleting it would break the joiner's idempotent re-join (a
-- double-click, a reload). Consumed rows age out on created_at instead.
--
-- The 120s literal is CUSTOM_LOBBY_STALE_MS and the 30 minutes is
-- CUSTOM_LOBBY_MAX_AGE_MS, both in lib/game/duelTiming.ts -- plpgsql cannot
-- import it, so change both together. 120s is DELIBERATELY not the queue's 15s:
-- a backgrounded tab throttles setInterval to roughly one call a minute, and
-- hosts alt-tab to paste the code into Discord. The queue's window would kill a
-- live lobby while its host was doing exactly what the feature is for.
CREATE OR REPLACE FUNCTION public.duel_sweep_stale_lobbies()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.duel_lobbies
  WHERE (match_id IS NULL AND last_seen_at < now() - interval '120 seconds')
     OR created_at < now() - interval '30 minutes';
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- duel_lobby_create
-- ---------------------------------------------------------------------------

-- THE CODE IS GENERATED HERE, NEVER SUPPLIED. A client-chosen code would let
-- someone squat AAAAAA and intercept whoever typed it. 31^6 is about 887
-- million, so the retry loop below is for the birthday case, not for pressure.
--
-- Everything the client already clamped is re-clamped, and the achievement
-- re-validated, for the reason every RPC in this codebase validates its
-- arguments: PostgREST is reachable without the UI that produced them.
CREATE OR REPLACE FUNCTION public.duel_lobby_create(
  p_rounds integer,
  p_round_seconds integer,
  p_from_year integer,
  p_to_year integer,
  p_nationality text,
  p_team text,
  p_achievement text,
  p_device_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_year integer := extract(year FROM now())::int;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_from integer;
  v_to integer;
  v_nationality text := nullif(btrim(coalesce(p_nationality, '')), '');
  v_team text := nullif(btrim(coalesce(p_team, '')), '');
  v_achievement text := coalesce(p_achievement, 'any');
  v_rounds integer;
  v_round_seconds integer;
  v_filter jsonb;
  v_code text;
  v_attempt integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  -- A blank device id would opt this host out of the self-join guard. Refuse
  -- rather than degrade to the vulnerable behaviour -- same as match_or_queue.
  IF p_device_id IS NULL OR length(btrim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'A device id is required to host a lobby';
  END IF;
  IF v_achievement NOT IN ('any', 'race-winner', 'podium', 'pole', 'champion') THEN
    RAISE EXCEPTION 'Invalid achievement: %', v_achievement;
  END IF;

  -- infinite_start_round's clamp, verbatim (drizzle/0053, drizzle/0056).
  -- Ordering the pair is what stops a crossed slider selecting nobody.
  v_from := greatest(1950, least(coalesce(p_from_year, 1950), coalesce(p_to_year, v_year)));
  v_to := least(v_year, greatest(coalesce(p_from_year, 1950), coalesce(p_to_year, v_year)));

  -- Clamped, not rejected: these come off a three-button row, so an
  -- out-of-range value is a stale client rather than an attack, and the
  -- constraint would only turn it into an opaque error. Bounds match
  -- duel_lobbies' and duel_matches' CHECKs.
  v_rounds := least(5, greatest(1, coalesce(p_rounds, 3)));
  v_round_seconds := least(180, greatest(15, coalesce(p_round_seconds, 60)));

  v_filter := jsonb_build_object(
    'fromYear', v_from,
    'toYear', v_to,
    'nationality', v_nationality,
    'team', v_team,
    'achievement', v_achievement
  );

  -- Refuse a filter matching nobody, exactly as infinite_start_round does --
  -- and through the same shared predicate (drizzle/0056), so "the lobby is
  -- creatable" and "the rounds are dealable" can never disagree. Without this
  -- the failure surfaces at duel_begin_round, mid-countdown, to two people.
  IF public.pick_filtered_driver(v_filter, NULL) IS NULL THEN
    RAISE EXCEPTION 'No drivers match this filter';
  END IF;

  PERFORM public.duel_sweep_stale_lobbies();

  -- Converge rather than error: one host has one open lobby. A second Create
  -- press replaces the first rather than refusing, so a host who navigated away
  -- and back does not have to find and cancel a row they cannot see. Consumed
  -- lobbies (match_id set) are untouched -- those belong to a real match.
  DELETE FROM public.duel_lobbies WHERE host_id = v_user_id AND match_id IS NULL;
  -- And this browser's open lobbies under any OTHER identity, which is exactly
  -- what signing out mid-lobby leaves behind. Same remediation half as
  -- match_or_queue's device-id delete.
  DELETE FROM public.duel_lobbies
  WHERE host_device_id = p_device_id AND host_id <> v_user_id AND match_id IS NULL;

  -- Retry on collision. The INSERT is wrapped in its own BEGIN block so a
  -- unique_violation is caught and retried instead of aborting the call; ten
  -- attempts against 887 million codes is far past the point where a genuine
  -- collision is the explanation.
  FOR v_attempt IN 1..10 LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;

    BEGIN
      INSERT INTO public.duel_lobbies
        (code, host_id, host_device_id, mode, rounds, round_seconds, filter, created_at, last_seen_at)
      VALUES
        (v_code, v_user_id, p_device_id, 'duel', v_rounds, v_round_seconds, v_filter, now(), now());
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- Taken. Draw again.
    END;
  END LOOP;

  RAISE EXCEPTION 'Could not allocate a lobby code';
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- duel_lobby_state
-- ---------------------------------------------------------------------------

-- The joiner's preview and the host's poll, in one read.
--
-- match_id IS RETURNED ONLY TO THE HOST OR A PARTICIPANT. To anyone else this
-- is a preview of a config and a handle, nothing more -- a third party holding
-- a guessed or shared code must not learn the match id of a game they are not
-- in, which is the id that names the private realtime channel.
CREATE OR REPLACE FUNCTION public.duel_lobby_state(p_code text)
RETURNS TABLE (
  code text,
  mode text,
  rounds integer,
  round_seconds integer,
  filter jsonb,
  host_id uuid,
  host_username text,
  host_display_name text,
  host_avatar_url text,
  host_rating integer,
  match_id integer,
  is_host boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code text;
  v_lobby record;
  v_may_see_match boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Same normalization the join path uses: a code is read off a screen and
  -- retyped, so case, spaces and dashes are noise.
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));

  SELECT dl.*, p.username, p.display_name, p.avatar_url, us.duel_rating
  INTO v_lobby
  FROM public.duel_lobbies dl
  JOIN public.profiles p ON p.id = dl.host_id
  LEFT JOIN public.user_stats us ON us.user_id = dl.host_id
  WHERE dl.code = v_code
    AND (dl.match_id IS NOT NULL OR dl.last_seen_at > now() - interval '120 seconds');
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_may_see_match := v_lobby.host_id = v_user_id
    OR (v_lobby.match_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.duel_matches dm
      WHERE dm.id = v_lobby.match_id AND (dm.player_a = v_user_id OR dm.player_b = v_user_id)
    ));

  RETURN QUERY SELECT
    v_lobby.code, v_lobby.mode, v_lobby.rounds, v_lobby.round_seconds, v_lobby.filter,
    v_lobby.host_id, v_lobby.username, v_lobby.display_name, v_lobby.avatar_url,
    v_lobby.duel_rating,
    CASE WHEN v_may_see_match THEN v_lobby.match_id ELSE NULL END,
    v_lobby.host_id = v_user_id;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- duel_lobby_join
-- ---------------------------------------------------------------------------

-- Returns MATCH_OR_QUEUE'S EXACT ROW SHAPE, on purpose: the client reuses the
-- existing toMatchResult mapper and the MatchResult type, and DuelRoot receives
-- a custom match through the identical onFound seam as a matchmade one. That is
-- most of why the client diff for this feature stays small.
--
-- EVERY CHECK HAPPENS WHILE HOLDING THE ROW LOCK. The lobby is taken FOR UPDATE
-- first and nothing is decided before that, so there is no read-then-check
-- window: a second joiner blocks on the lock, then re-reads the row this call
-- committed and takes the consumed branch. Same rule as the matchmaking scan,
-- where the guards live inside the locked SELECT rather than after it.
CREATE OR REPLACE FUNCTION public.duel_lobby_join(p_code text, p_device_id text)
RETURNS TABLE (
  match_id integer,
  opponent_id uuid,
  opponent_username text,
  opponent_display_name text,
  opponent_avatar_url text,
  opponent_rating integer,
  opponent_duel_wins integer,
  opponent_duel_losses integer,
  you_are text,
  match_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code text;
  v_lobby record;
  v_existing record;
  v_new_match_id integer;
  v_new_match_created_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_device_id IS NULL OR length(btrim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'A device id is required to join a lobby';
  END IF;

  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));

  PERFORM public.duel_sweep_stale_lobbies();

  SELECT * INTO v_lobby FROM public.duel_lobbies WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That lobby code does not exist';
  END IF;

  -- Consumed. Idempotent for a participant -- a double-click or a reload gets
  -- the same match back rather than an error -- and a dead end for anyone else,
  -- so a shared code cannot be used twice.
  IF v_lobby.match_id IS NOT NULL THEN
    SELECT
      dm.id, dm.created_at,
      CASE WHEN dm.player_a = v_user_id THEN 'a' ELSE 'b' END AS you_are,
      opp.id AS opponent_id, opp.username, opp.display_name, opp.avatar_url,
      opp_stats.duel_rating, opp_stats.duel_wins, opp_stats.duel_losses
    INTO v_existing
    FROM public.duel_matches dm
    JOIN public.profiles opp
      ON opp.id = (CASE WHEN dm.player_a = v_user_id THEN dm.player_b ELSE dm.player_a END)
    LEFT JOIN public.user_stats opp_stats ON opp_stats.user_id = opp.id
    WHERE dm.id = v_lobby.match_id AND (dm.player_a = v_user_id OR dm.player_b = v_user_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'That lobby code has already been used';
    END IF;

    RETURN QUERY SELECT
      v_existing.id, v_existing.opponent_id, v_existing.username, v_existing.display_name,
      v_existing.avatar_url, v_existing.duel_rating, coalesce(v_existing.duel_wins, 0),
      coalesce(v_existing.duel_losses, 0), v_existing.you_are, v_existing.created_at;
    RETURN;
  END IF;

  -- Stale: the host stopped heart-beating. Checked here rather than in the
  -- lookup so the joiner is told the lobby expired instead of that the code is
  -- wrong -- two different things to a person holding a link.
  IF v_lobby.last_seen_at < now() - interval '120 seconds' THEN
    RAISE EXCEPTION 'That lobby has expired';
  END IF;

  -- The self-join guard, both halves. The identity half is what
  -- duel_matches_distinct_players_check would catch anyway; the DEVICE half is
  -- the one that matters, because signing out mints a new identity and the two
  -- ids then genuinely differ. Accepted side effect, same as the queue's: two
  -- people sharing one browser profile cannot play each other.
  IF v_lobby.host_id = v_user_id THEN
    RAISE EXCEPTION 'You cannot join your own lobby';
  END IF;
  IF v_lobby.host_device_id IS NOT DISTINCT FROM p_device_id THEN
    RAISE EXCEPTION 'You cannot join a lobby hosted from this browser';
  END IF;

  -- The host is player_a, so the joiner is 'b' -- matching match_or_queue,
  -- where the caller who finds a waiting opponent is also 'b'.
  INSERT INTO public.duel_matches
    (player_a, player_b, status, current_round, ranked, rounds, round_seconds, filter)
  VALUES
    (v_lobby.host_id, v_user_id, 'lobby', 0, false, v_lobby.rounds, v_lobby.round_seconds, v_lobby.filter)
  RETURNING id, created_at INTO v_new_match_id, v_new_match_created_at;

  UPDATE public.duel_lobbies SET match_id = v_new_match_id WHERE code = v_code;

  RETURN QUERY SELECT
    v_new_match_id, host.id, host.username, host.display_name, host.avatar_url,
    host_stats.duel_rating, coalesce(host_stats.duel_wins, 0), coalesce(host_stats.duel_losses, 0),
    'b'::text, v_new_match_created_at
  FROM public.profiles host
  LEFT JOIN public.user_stats host_stats ON host_stats.user_id = host.id
  WHERE host.id = v_lobby.host_id;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- duel_lobby_heartbeat / duel_lobby_cancel
-- ---------------------------------------------------------------------------

-- Refreshes the CALLER'S OWN open lobby and nothing else. Returns false when
-- there was nothing to refresh (cancelled, consumed, swept), which is the
-- client's signal to stop beating -- the same contract duel_heartbeat has.
CREATE OR REPLACE FUNCTION public.duel_lobby_heartbeat(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code text;
  v_updated integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));

  UPDATE public.duel_lobbies
  SET last_seen_at = now()
  WHERE code = v_code AND host_id = v_user_id AND match_id IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated > 0;
END;
$$;
--> statement-breakpoint

-- Deletes the caller's own OPEN lobby. Idempotent: safe twice, safe when never
-- created, safe when the lobby was already consumed by a joiner (that row
-- belongs to a live match now and is deliberately left alone). Called on every
-- exit from the waiting screen, and inside signOutAndReset() while the outgoing
-- identity can still authenticate it -- an open lobby is a live server
-- commitment exactly like a queue row.
CREATE OR REPLACE FUNCTION public.duel_lobby_cancel(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code text;
  v_deleted integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));

  DELETE FROM public.duel_lobbies
  WHERE code = v_code AND host_id = v_user_id AND match_id IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Six functions, six decisions, each naming its grantees. Never a bare REVOKE
-- FROM PUBLIC: Supabase's bootstrap ALTER DEFAULT PRIVILEGES additionally
-- grants EXECUTE to anon and authenticated by name, which a PUBLIC-only revoke
-- leaves standing (drizzle/0039, found by reading pg_proc.proacl back).
--
-- All six are SECURITY DEFINER with an auth.uid() check inside, and the browser
-- calls all six, so authenticated gets each one back. anon does not: every
-- visitor is signed in at least anonymously, so the anon role is never the one
-- making a real request. Declared in lib/db/schemaGrants.test.ts in this same
-- change -- that suite fails on a live function with no decision on record.
REVOKE EXECUTE ON FUNCTION public.duel_sweep_stale_lobbies() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_sweep_stale_lobbies() TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_lobby_create(integer, integer, integer, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_lobby_create(integer, integer, integer, integer, text, text, text, text) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_lobby_state(text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_lobby_state(text) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_lobby_join(text, text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_lobby_join(text, text) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_lobby_heartbeat(text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_lobby_heartbeat(text) TO authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.duel_lobby_cancel(text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.duel_lobby_cancel(text) TO authenticated;
