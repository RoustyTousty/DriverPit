-- Custom lobbies, phase 1 -- per-match config on duel_matches, plus the one
-- constraint that makes "an unranked match moved a rating" unrepresentable.
--
-- Every default is what a matchmade duel already is (ranked, 3 rounds, 60s,
-- and the 20-year daily pool for a null filter), so this changes no existing
-- row and needs no backfill. Nothing reads rounds/round_seconds/filter yet --
-- duel_begin_round and duel_close_round are phase 2 -- so a duel played
-- against this schema is bit-identical to one played against the last.
ALTER TABLE public.duel_matches
  ADD COLUMN ranked boolean NOT NULL DEFAULT true,
  ADD COLUMN rounds integer NOT NULL DEFAULT 3,
  ADD COLUMN round_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN filter jsonb;
--> statement-breakpoint

-- Bounds, not a ladder. The create screen will offer 1/3/5 rounds and
-- 30/60/90 seconds; the constraint accepts anything sane inside those ranges
-- instead of that exact triple, because pinning the offered list here would
-- duplicate it TS<->SQL and drag in a parity suite (CLAUDE.md: "a new
-- duplicated constant gets an assertion in the same change that creates it")
-- for a value with nothing at stake -- an unranked game the host configured
-- for themselves.
ALTER TABLE public.duel_matches
  ADD CONSTRAINT duel_matches_rounds_check CHECK (rounds BETWEEN 1 AND 5);
--> statement-breakpoint

ALTER TABLE public.duel_matches
  ADD CONSTRAINT duel_matches_round_seconds_check CHECK (round_seconds BETWEEN 15 AND 180);
--> statement-breakpoint

-- THE constraint of this phase. "Not affecting stats" is invisible when it
-- regresses: nothing a player sees changes if `ranked` stops being read -- the
-- leaderboard just quietly starts absorbing friendly games. applyMatchResult
-- is the single writer and it short-circuits on this flag, but a choke point
-- is a line of code someone can reorder. This makes the wrong outcome
-- unrepresentable instead, the same way duel_matches_distinct_players_check
-- (drizzle/0032) does for a self-match: rating_delta_a/b are written in the
-- same transaction as the user_stats update, so a violation aborts both.
--
-- Trivially satisfied by every existing row: `ranked` defaults to true.
--
-- No grant decision to restate, either. The bootstrap's ALTER DEFAULT
-- PRIVILEGES trap (CLAUDE.md "Schema") fires on new TABLES and new FUNCTIONS;
-- a new COLUMN inherits the relation's ACL and gets no attacl of its own, so
-- duel_matches stays SELECT-only for anon/authenticated and no entry in
-- lib/db/schemaGrants.test.ts moves. This migration adds no functions at all.
ALTER TABLE public.duel_matches
  ADD CONSTRAINT duel_matches_unranked_no_rating_check
  CHECK (ranked OR (rating_delta_a IS NULL AND rating_delta_b IS NULL));
