-- Audit 2026-07-29 §3.4 + §0.2 -- Realtime Authorization for duel:{matchId}.
--
-- "Is auth.uid() one of the two players in the match this Realtime topic
-- names?" Total by construction: substring() with a capture group returns NULL
-- when the topic isn't a duel topic, and `id = NULL` matches nothing -- so a
-- stray topic is a plain false rather than an error raised inside an RLS check.
-- The {1,9} bound keeps the cast inside int4 for the same reason. The `duel:`
-- prefix is the SQL half of lib/duel/liveMatch.ts#duelChannelName; the two are
-- pinned together by duelRealtimeAuthorization.test.ts.
--
-- SECURITY DEFINER so the answer can't depend on duel_matches' own SELECT
-- policy or grant, and STABLE so a join evaluates it once.
CREATE OR REPLACE FUNCTION public.duel_topic_participant(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.duel_matches m
    WHERE m.id = substring(p_topic FROM '^duel:([0-9]{1,9})$')::int
      AND auth.uid() IN (m.player_a, m.player_b)
  );
$$;
--> statement-breakpoint

-- Named grantees, never just PUBLIC: Supabase's bootstrap ALTER DEFAULT
-- PRIVILEGES hands every new function in `public` its own EXECUTE grant to
-- `anon` and `authenticated`, which a REVOKE ... FROM PUBLIC leaves standing
-- (drizzle/0039, and CLAUDE.md's "Schema" note).
REVOKE EXECUTE ON FUNCTION public.duel_topic_participant(text)
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- `authenticated` is the only role that needs it. Realtime evaluates the
-- policies below with SET LOCAL ROLE taken from the caller's JWT, and every
-- visitor here is signed in at least anonymously, so the check never runs as
-- `anon`. Reachable over PostgREST as a side effect, which costs nothing: it
-- answers "am I in this match", which the caller already knows.
GRANT EXECUTE ON FUNCTION public.duel_topic_participant(text) TO authenticated;
--> statement-breakpoint

-- A Supabase channel is PUBLIC unless it asks not to be. Any signed-in user --
-- and AuthProvider signs *everyone* in on first visit -- could join duel:{N}
-- for arbitrary N and post arbitrary events. A forged `round_end` pulled the
-- victim out of a live round with an attacker-chosen reveal and scores; a
-- forged `round_start` handed them an ends_at already in the past, which their
-- own expiry effect turned into an instant DNF. None of it wrote the database
-- (duel_submit_guess, duel_close_round and applyMatchRatings each validate
-- independently) -- but in a rated 1v1 the round is the thing being stolen.
--
-- `private: true` on the client (lib/duel/useDuelChannel.ts) is the other half:
-- it makes Realtime consult RLS on realtime.messages at join time, SELECT for
-- "may receive" and INSERT for "may broadcast / track presence". RLS is already
-- on and there were no policies, so this was deny-all -- these two ARE the
-- access control now. Public channels never reach them, which is why the
-- `lobby` channel (DuelSearching) is unaffected by this migration.
CREATE POLICY "duel_participants_read" ON realtime.messages
  FOR SELECT TO authenticated
  USING (public.duel_topic_participant(realtime.topic()));
--> statement-breakpoint

-- Write covers both broadcast and presence `track()` -- Realtime authorizes
-- both as an INSERT on realtime.messages. Same predicate as read: in a duel
-- there is no participant who may listen but not speak.
CREATE POLICY "duel_participants_write" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (public.duel_topic_participant(realtime.topic()));
