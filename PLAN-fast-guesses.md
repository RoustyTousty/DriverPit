# Plan: make Daily & Infinite guess evaluation as fast as Duel

## Why Daily/Infinite are slow (measured causes, not guesses)

Every guess in both modes is a **Next.js Server Action** round trip
(`app/(game)/daily/actions.ts#submitDailyGuess`,
`app/(game)/infinite/actions.ts#submitGuess`). On Vercel that is a
serverless function invocation per guess: cold start (can be 1s+), then a
fresh DB connection, then the queries. On `next dev` it's worse (route
compilation). This is *exactly* the path CLAUDE.md's "Instant guesses"
section forbids for duels.

Daily adds an extra self-inflicted cost: `todaysDailyTargetId()` runs on
**every guess**, and it calls `getDailyDriverId` → `listPoolDriverIds`
(fetches the whole pool's ids) → `pickDailyDriverId`. So each daily guess
is: cold start + pool query + 2 driver fetches.

Neither mode renders optimistically — the guessed row appears only when
the action resolves, so the user feels the full latency.

## What made Duel fast (150–260 ms measured on prod build)

1. **One warm hop, no Vercel in the path.** The browser calls the
   `duel_submit_guess` Postgres RPC directly via `supabase.rpc()`
   (PostgREST) — see `lib/duel/submitGuess.ts`. Supabase's REST layer is
   always warm; the entire evaluation (fetch guess + target rows, compare,
   score) happens inside one SQL function, one round trip.
2. **The compare rules already exist in SQL.** `public.compare_drivers`
   (used by `duel_submit_guess`) mirrors `lib/game/compare.ts` and is
   locked to it by a fixture parity test:
   `lib/game/compare.sqlParity.test.ts`. This — the hard part — is
   already built and proven.
3. **Optimistic render.** A shimmer `PendingGuessRow` appears instantly
   and is replaced by the real row when the RPC returns
   (`components/duel/ClosestGuessesBoard.tsx`).
4. **Local autocomplete.** The pool ships to the client once; no
   per-keystroke fetch. (Daily/Infinite already do this — no work needed.)

The same logic applies to Daily/Infinite. The only real design work is
where each mode's *secret target* lives, because PostgREST calls don't go
through Next.js, so the target can't come from a Next-side cookie/closure.

## Phase 1 — Daily via RPC (biggest win, simplest)

Create migration `drizzle/00XX_daily_submit_guess_rpc.sql`:

- New table `daily_targets(date date PK, driver_id int FK)` — today's
  target, **lazily pinned**: the first caller of the day computes the pick
  and `INSERT ... ON CONFLICT DO NOTHING`s it; everyone else reads it.
  - DECISION POINT: `lib/game/dailySelection.ts` deliberately recomputes
    from the live pool each call (see its comment for why — read it
    before choosing). Two options:
    a. Port `pickDailyDriverId`'s deterministic pick to SQL + add a
       parity test (same pattern as compare.sqlParity.test.ts), keep
       recompute-each-call semantics, no new table.
    b. The `daily_targets` table above (pins the day's target at first
       access; also fixes the existing subtle bug where a mid-day pool
       change silently changes the target mid-day). TS actions
       (`revealDailyTarget`, page render) must then read the table too so
       there is exactly one source of truth.
    (b) is less code and removes a dual-implementation risk; prefer it
    unless dailySelection.ts's comment reveals a blocker.
- `daily_submit_guess(p_guess_driver_id int)` SECURITY DEFINER RPC,
  `GRANT EXECUTE TO authenticated` (every visitor has an anon session):
  resolves today's target (per the decision above), validates the guessed
  driver exists, calls `compare_drivers(guess, target, now())`, returns
  the same row shape `duel_submit_guess` returns (guessed driver summary
  + 5 tile results + closeness + `won`). **Never returns the target.**
  Model it directly on `drizzle/0022_duel_submit_guess_rpc.sql` and the
  clock-grace follow-up in 0025 (not needed here — no timer).
- Client: new `lib/game/submitDailyGuessRpc.ts` modeled on
  `lib/duel/submitGuess.ts` (browser `supabase.rpc()`, snake_case row →
  camelCase mapping). `DailyGame.tsx` calls it instead of the action.
  Keep `revealDailyTarget` as-is (once per lost game, latency irrelevant).
- `submitDailyGuess` server action: delete once the RPC path ships.

## Phase 2 — Infinite via RPC

Infinite's round state currently lives in a signed httpOnly cookie
(`lib/game/session.ts`) that PostgREST cannot see. Move it server-side,
keyed on the user's Supabase identity (anon users included):

- Table `infinite_rounds(user_id uuid PK → profiles, driver_id int,
  pool_window text, guess_count int, started_at timestamptz)`. No client
  RLS policies (same reasoning as `user_stats`) — all access via
  SECURITY DEFINER RPCs using `auth.uid()`.
- `infinite_start_round(p_pool_window text)` — validates the window
  string, picks a random pool driver (same SQL as
  `duel_begin_round`'s pick but with the window's cutoff), upserts the
  row. Replaces `startInfiniteRound`.
- `infinite_submit_guess(p_guess_driver_id int)` — loads the caller's
  row, enforces `guess_count < 6`, compares via `compare_drivers`,
  increments, returns tiles + `status` (`won`/`lost`/`continue`) and the
  target summary ONLY when status ≠ continue (mirror the current action's
  contract exactly so `InfiniteGame.tsx` needs minimal changes).
- Delete the cookie machinery (`lib/game/session.ts`, ROUND_COOKIE) once
  cut over.

## Phase 3 — Optimistic render (both modes)

Extract duel's `PendingGuessRow` shimmer from
`components/duel/ClosestGuessesBoard.tsx` into `components/game/` (it
already matches the shared `GuessRow` geometry) and show it in
DailyGame/InfiniteGame the moment a driver is selected, replaced on RPC
response. This is what makes even the remaining ~150 ms feel like zero.

## Verification (match the duel's bar)

- Parity: `compare.sqlParity.test.ts` already covers `compare_drivers`;
  add parity fixtures only if option (a) ports the daily pick to SQL.
- DB integration tests (RUN_DB_INTEGRATION_TESTS=1 pattern,
  `lib/db/duelRpc.test.ts`) for the new RPCs: win, miss, guess limit,
  target never leaked on `continue`, daily target stable across calls.
- **Measure on `npm run build` + `npm start`, never `next dev`** (per
  CLAUDE.md). Duel's prod numbers were 150–260 ms per guess including
  Playwright overhead; expect the same since it's the identical path.
- Confirm daily stats writes (`recordDailyResult` + `daily_results`
  idempotency guard) are untouched — this plan changes only guess
  evaluation, not result recording.

## Non-goals / cautions

- Do NOT change `lib/game/compare.ts` rules (CLAUDE.md).
- Do NOT return the target driver from any RPC while a round is live.
- Keep the PRs small and sequential: Phase 1, then 2, then 3 — each
  independently shippable, same as the duel overhaul was done.
- The RPCs are client-callable (`GRANT ... TO authenticated`) unlike the
  duel lifecycle RPCs — follow `match_or_queue`/`duel_submit_guess`'s
  SECURITY DEFINER + `auth.uid()` precedent, not `duel_begin_round`'s
  trusted-connection one.
