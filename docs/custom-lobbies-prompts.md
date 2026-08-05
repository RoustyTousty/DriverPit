# Custom lobbies — prompt sequence for Claude Code

Companion to [custom-lobbies-plan.md](./custom-lobbies-plan.md). Each prompt below is meant
to be pasted into a **fresh session** (`/clear` first), so every one is self-contained and
points at the plan rather than assuming prior conversation.

Delete this file once the feature is built — it is a working aid, not project documentation.

---

## How to run this efficiently

**One phase per session, `/clear` in between.** The phases were drawn so each ends at a
green typecheck and a green test run. Carrying phase 1's context into phase 5 costs tokens
and buys nothing — the plan doc is the handoff.

**Let the plan do the explaining.** Every prompt starts by pointing at a section of
`docs/custom-lobbies-plan.md`. That is deliberate: re-deriving the architecture from the
codebase costs far more than reading one section, and the decisions in there were made with
the whole picture in view.

**Ask for a plan before code on the two risky phases** (2 and 3 — they touch the live rated
path). Phase 1, 4 and 5 are additive enough to go straight to implementation.

**Approve migrations before they are applied.** Read the `.sql` yourself. `db:migrate` on
this machine is unreliable for large statements — see the gotchas below.

### Verification, in order of cost

```powershell
npm run typecheck                      # fast, run constantly
npm run lint                           # fast
npm test                               # both vitest projects, no database needed
npm run test:dom                       # just the jsdom components
```

**Do not ask Claude to run `next build`** — it hangs before compiling on this machine.
Typecheck plus vitest is the real signal; the build runs in CI.

**Database-tier suites are opt-in and rate-limited:**

```powershell
$env:RUN_DB_INTEGRATION_TESTS="1"; npx vitest run lib/db/customMatchUnranked.test.ts
```

Run **one file at a time**. Every DB suite mints fixture players via
`signInAnonymously()`, and Supabase rate-limits that per IP per hour — a full-tier run
exhausts the quota and locks out reruns for roughly an hour. If a suite fails in
`beforeAll` with `Request rate limit reached`, that is the quota, not a regression.

### If `npm run db:migrate` hangs or exits 1 with no message

That is a path-MTU black hole on this machine's route to Supabase, not a bad migration —
any single statement over about 1400 bytes can vanish. The migrations in phases 1–4 contain
whole plpgsql function bodies, so this **will** come up. Paste this:

```
`npm run db:migrate` exited 1 with no error message (or hung on "applying migrations").
This is the known ~1400-byte statement ceiling on this machine's path to Supabase, not a
bad migration -- see my memory note `db-migrate-mtu-failure`.

Apply drizzle/<NNNN>_<name>.sql using the chunked workaround: stream each statement into a
CREATE TEMP TABLE ... ON COMMIT DROP in sub-MTU parameterized INSERTs, then reassemble and
EXECUTE it server-side in a DO block. Then write drizzle-kit's bookkeeping row by hand --
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) where hash is sha256 of the raw
.sql file contents and created_at is that migration's `when` from drizzle/meta/_journal.json.

Verify by reading pg_get_functiondef() and pg_proc.proacl back from the live database for
every function the migration touched, and show me the ACLs.
```

---

## Phase 1 — Stats isolation

The one that matters most, and it ships alone with no UI.

```
Read docs/custom-lobbies-plan.md sections 0, 1 and 2, then implement PHASE 1 only
(the "Stats isolation" row of section 8's build order). Nothing from phases 2-6.

Scope:
1. A new migration adding to duel_matches: ranked (bool NOT NULL DEFAULT true), rounds
   (int NOT NULL DEFAULT 3), round_seconds (int NOT NULL DEFAULT 60), filter (jsonb NULL),
   with the CHECK constraints from section 2 AND the section 1 constraint
   CHECK (ranked OR (rating_delta_a IS NULL AND rating_delta_b IS NULL)).
   Mirror the columns in lib/db/schema.ts with comments explaining why each exists.
2. The unranked short-circuit in applyMatchResult (lib/duel/actions.ts) -- read off the
   locked row, never a parameter. Section 1 has the exact placement and the comment.
3. requestRematch must copy ranked/rounds/round_seconds/filter forward. Section 1 explains
   why this is the sharp edge; write a comment there saying so.
4. getDuelResults returns `ranked`; DuelResults renders "Unranked - rating unaffected"
   instead of a delta, and suppresses the guest upgrade prompt on an unranked win.
5. lib/db/customMatchUnranked.test.ts covering all four cases in section 7. Share fixture
   guests across describe blocks -- Supabase rate-limits anonymous sign-in per IP per hour.
6. Add duel_lobbies-free grant entries: this migration adds no functions, but if it changes
   any, declare them in lib/db/schemaGrants.test.ts in this same change.

Constraints:
- Defaults must leave every existing duel bit-identical. No backfill.
- Do not touch duel_begin_round or duel_close_round yet -- that is phase 2.
- Show me the migration SQL before applying it.
```

**Done when:** `npm run typecheck` and `npm test` are green, and
`RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/customMatchUnranked.test.ts` passes with
the ranked control case proving the test can fail.

---

## Phase 2 — Configurable rounds and round length

Touches the live rated path. Ask for a plan first.

```
Read docs/custom-lobbies-plan.md section 2, then plan (do not write code yet) PHASE 2:
making rounds and round length per-match.

The columns already exist from phase 1. What needs to change:
- duel_begin_round: ends_at from v_match.round_seconds via make_interval, replacing the
  hardcoded 60 seconds.
- duel_close_round: the last-round test becomes p_round_index >= v_match.rounds - 1,
  replacing the hardcoded >= 2.
- useDuelLifecycle: isLastRound comes from the server response (closeRound's matchFinished /
  nextRoundIndex, duel_round_reveal's matchStatus), not from MAX_ROUNDS.
- RoundPlay's "Round N / M" label reads the match's rounds.
- MatchResult gains { ranked, rounds }.
- lib/game/customMatchConfig.ts: the pure options/clamp/describe module + its unit test.

Before writing anything, confirm for me by reading the code:
(a) that duel_submit_guess derives round length from ends_at - started_at and therefore
    needs no change,
(b) every remaining consumer of MAX_ROUNDS and ROUND_MS,
(c) whether any RPC return shape has to change (section 2 says none should -- the Server
    Actions read duel_matches through Drizzle; CREATE OR REPLACE cannot change a
    RETURNS TABLE shape, so a change there means DROP + CREATE + restated grants).

Then give me the plan and wait.
```

Follow-up once the plan looks right:

```
Implement it. Keep the migration to the two function bodies and nothing else, reproduce
them verbatim from their current definitions apart from the two changes (CREATE OR REPLACE
has no partial form), and restate the grant decision at the bottom rather than assuming the
replace kept it -- same convention as drizzle/0052.

Then re-run the existing duel database suites, one file at a time, and tell me which
you ran.
```

---

## Phase 3 — One SQL copy of the driver filter

```
Read docs/custom-lobbies-plan.md section 3, then implement PHASE 3.

Extract public.pick_filtered_driver(p_filter jsonb, p_exclude integer[]) as the single SQL
copy of lib/game/driverFilter.ts#matchesDriverFilter, repoint infinite_start_round at it,
and teach duel_begin_round to use it when duel_matches.filter IS NOT NULL (falling through
to the unchanged 20-year last_active_year pick when it is null).

Two things the plan asks for specifically:
- p_exclude removes drivers already used in this match's rounds, and falls back to allowing
  repeats when the filter is smaller than the round count. A tiny custom pool must degrade,
  not error mid-match.
- duel_submit_guess stays existence-only. Leave a comment saying why (win-by-identity,
  unlimited guesses, and a second copy of the predicate on the hot path).

lib/db/infiniteFilter.sqlParity.test.ts is the safety net for the extraction -- run it and
show me the result. Then extend it (or add a sibling) so the shared function is pinned
through BOTH callers, per section 7.

Declare the new function in lib/db/schemaGrants.test.ts in this same change.
```

---

## Phase 4 — The lobby table and its RPCs

Backend only. No UI yet, so it is verifiable purely by test.

```
Read docs/custom-lobbies-plan.md section 4 (and section 9 for the integrity rules), then
implement PHASE 4: the duel_lobbies table, its six RPCs, lib/duel/customLobby.ts, and
lib/db/customLobby.test.ts.

Non-negotiables from the plan:
- No status column -- open/consumed/gone are derivable. match_id is ON DELETE CASCADE.
- RLS on, no policies, no client grants; every access goes through a SECURITY DEFINER +
  auth.uid() RPC, same shape as matchmaking_queue.
- Codes generated server-side in a retry loop on unique_violation, from the 31-character
  unambiguous alphabet. Never client-supplied.
- duel_lobby_join refuses host_id = auth.uid() OR host_device_id = p_device_id, does its
  checks INSIDE the FOR UPDATE (never read-then-check), and is idempotent for a participant.
- duel_lobby_state returns match_id only to the host or a participant.
- The four CUSTOM_LOBBY_* constants go in lib/game/duelTiming.ts with keep-in-sync comments
  on the SQL literals. The stale window is 120s deliberately -- background tabs throttle
  setInterval to ~1/min. Do not "tidy" it down to the queue's 15s.
- Six new functions plus one relation => seven new entries in lib/db/schemaGrants.test.ts,
  in this same change. REVOKE FROM PUBLIC, anon then GRANT TO authenticated -- naming the
  grantees, never a bare PUBLIC revoke.

Show me the migration SQL before applying it. It will be large -- expect the db:migrate
statement-size problem and be ready to apply it chunked.
```

---

## Phase 5 — The UI

The biggest diff, but the lowest risk. Worth splitting into two sessions if it gets long.

```
Read docs/custom-lobbies-plan.md section 5, then implement PHASE 5: the custom lobby UI.

Build order within the phase:
1. DuelLanding gets a Custom card under Knockout, same card style as Duel.
2. components/duel/CustomLobby.tsx owning menu | create | waiting | join as its own
   sub-phase state, reporting a MatchResult upward -- the same contract DuelSearching has.
   DuelRoot gains exactly one phase, "custom".
3. CustomLobbyCreate: rounds and round length as the primary controls; a small secondary
   "Advanced" button opening the EXISTING components/game/DriverFilterModal unmodified.
4. CustomLobbyWaiting: the code, Copy link, Copy code, navigator.share where available,
   the live driver count, Cancel. Host waits on the public `lobby` channel's MATCHED_EVENT
   plus a CUSTOM_LOBBY_POLL_MS poll, and resolves the match through duel_lobby_state rather
   than trusting the broadcast payload (section 6).
5. CustomLobbyJoin: code input normalizing case/spaces/dashes, a preview of the host and
   config, then Join.
6. /online?join=CODE read in a mount effect from window.location.search then stripped with
   history.replaceState. NOT searchParams on the page (kills ISR) and NOT useSearchParams
   (drags in Suspense).
7. app/(game)/online/page.tsx switches to listAllDriverOptionsWithActivity().
8. Open lobby registered in lib/duel/duelCommitments.ts and cancelled in
   signOutAndReset() STEP 1, while the outgoing identity can still authenticate it.
9. DuelResults: "New custom game" instead of "Find new opponent" for a custom match.
10. components/duel/CustomLobbyJoin.test.tsx in the dom project -- write it so it fails
    against the pre-fix code and check that it does.

Follow the design system in CLAUDE.md: existing tokens, rounded-lg, Geist Mono with
tabular-nums for the code itself, visible accent focus rings, and the code readable and
selectable rather than copy-button-only.
```

If it runs long, cut the session after step 5 and start a fresh one with:

```
Continue PHASE 5 of docs/custom-lobbies-plan.md from step 6 (the deep link) onward. Steps
1-5 are already done -- read components/duel/CustomLobby*.tsx to see where things landed.
```

---

## Phase 6 — Documentation

```
Read docs/custom-lobbies-plan.md and the custom lobby code as built, then add a "Custom
lobbies" section to CLAUDE.md.

Match the surrounding voice: state what the thing is, then the constraints that are
load-bearing and WHY, naming the failure mode each one prevents. Specifically cover:

- ranked = false and the single choke point in applyMatchResult, including the rematch
  carry-forward trap.
- Per-match rounds/round_seconds, and that isLastRound comes from the server.
- pick_filtered_driver as the one SQL copy of the filter predicate.
- duel_lobbies' liveness window and why it is not the queue's 15s.
- The lobby channel reuse, and why no new Realtime policy was needed.

Also update the Schema section's table list, the RPC list, and the duelTiming constants
block. Then tell me anything in the existing CLAUDE.md that this feature made stale.
```

---

## Prompts worth keeping for when something goes sideways

**A DB suite fails in `beforeAll`:**

```
That failure is in beforeAll from createGuest/makeGuestClient, not an assertion -- read the
message. If it says "Request rate limit reached" it is Supabase's per-IP hourly anonymous
sign-in quota, exhausted by an earlier run, and not a regression. Confirm which it is before
investigating anything.
```

**Checking a migration actually landed:**

```
Read the live database back rather than the migration file: pg_get_functiondef() for every
function it touched, pg_proc.proacl for their ACLs, information_schema.role_table_grants for
any table, and pg_attribute.attacl if a column grant is involved. Show me the output. Twice
in this repo a migration has not said what it appeared to say, and both were only ever found
this way.
```

**Reviewing before commit:**

```
/code-review
```

then

```
Re-read docs/custom-lobbies-plan.md sections 1 and 9, and check the diff against them
specifically: is there any path where a custom match can write user_stats or a rating delta,
and is any of the four matchmaking self-match layers weakened or bypassed by the new join
path? Answer with the code paths, not a summary.
```
