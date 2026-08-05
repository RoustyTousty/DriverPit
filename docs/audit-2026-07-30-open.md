# DriverPit — Open Findings Carried Forward (2026-07-30)

> Point-in-time: **2026-07-30**. `HEAD = 018551b "Audit 2"`, working tree **clean**, `main` in sync
> with `origin/main`.
>
> This is **not** a third full audit — nothing new was swept for. It is the **carry-forward**: every
> finding from [audit-2026-07-27](./audit-2026-07-27.md) and [audit-2026-07-29](./audit-2026-07-29.md)
> that is still open, **re-verified against the tree today**, with everything closed removed. Two
> items are new (**P1**, **P3**); both were found while verifying the closures, and both are
> consequences of the fix programme rather than of the original code.
>
> Section numbers are kept from the audit that first raised each item, so `§4.7` here is `§4.7`
> there. Nothing is renumbered.
>
> Two lists at the end, and they are deliberately different: **Do these first** is priority order,
> **How to hand these to Claude Code** is execution order — which items belong in one prompt, which
> must go alone, and the six that need a decision rather than code.

## Method

**Verified directly:** every source, SQL, migration, test and config file named below, read at the
line cited. `npx tsc --noEmit` — **clean**. `npx vitest run` — **250 passed, 137 skipped, 35 files**.
`npm run lint` — **clean**. `git` state.

**Not verified**, same four limits both previous audits record:

- the **live database** — the DB tier needs a reachable Supabase project, and CLAUDE.md records that
  a full run burns the per-IP anonymous sign-in quota for ~an hour. Claims about grants, constraints
  and RPC bodies are inherited from the previous audits' live-database verification; where I make a
  claim about SQL below it is a claim about the text in `drizzle/`;
- **`next build`** — stalls before compiling on this machine;
- **CI job outcomes** — `gh` is not installed here (this is **P2**);
- anything that is a fact about a **real browser** — jsdom has no layout, no compositor and no
  screen reader.

**No code was changed.**

---

## Closures re-verified

Every ✅ in audit #2 was checked against the tree rather than taken on the note's word. All present:

| Claimed closed | Evidence found today |
|---|---|
| §0.1 rematch heartbeat | `onMatchIdChange` threaded `useDuelLifecycle:92,534` → `DuelMatch:30,54,60` → `DuelRoot:319`; no second copy of the match id |
| §0.2 `round_start` fast path | `useDuelLifecycle.ts:214` adopts `beginRound(...)`'s result, not the payload |
| §0.3 the fix programme committed | `018551b`, pushed; `.github/`, `docs/`, `drizzle/0038`–`0049` all tracked (**but see P1/P2**) |
| §0.5 ESLint | `eslint.config.mjs` present, `reportUnusedDisableDirectives: "error"` at :64, `npm run lint` clean, **15** suppressions (was 17) |
| §1.2 daily countdown | `app/(game)/daily/NextPuzzleCountdown.tsx` exists as a leaf; `GuessGrid` is `memo()`'d at :242 |
| §1.4 modal split | `next/dynamic` at `GameModals.tsx:3` |
| §1.5 duel action parallelism | 5 `Promise.all` in `lib/duel/actions.ts` |
| §1.6 leaderboard | `lib/leaderboard/constants.ts` + `lib/leaderboard/rank.ts` both exist |
| §2.5 pool-cutoff parity | `lib/game/poolWindow.sqlParity.test.ts` exists (DB tier, skipped here) |
| §2.6 component tier | `vitest.config.mts:32-48` declares `node` + `dom` projects, jsdom + setup file |
| §3.4 realtime authorization | `private: true` at `useDuelChannel.ts:187`; `drizzle/0046` present |
| §3.9/§4.7 duplicate guard | `drizzle/0049:117-119` raises on `p_guess_driver_id = ANY(v_guesses)`, under the same `FOR UPDATE` |
| §3.11 leaderboard revoke | `drizzle/0048` present |
| §4.1 guess live region | `components/game/GuessAnnouncer.tsx` exists |
| §4.7 focus-on-solve | `RoundPlay.tsx:144` — with the `!active \|\| active === document.body` guard and `tabIndex={-1}` at :187 |
| §5.2 / §5.2b / §5.2c / §5.2d | `scripts/releaseGuards.ts`, `drizzle/0047` present |
| §5.1 seed fails closed | `package.json:11-13` — `db:seed` → bare, `db:seed:commit` → `--commit` |

The one thing this table cannot say is whether the **live** database matches the migrations that
were applied to it; that was measured by the previous passes and is not re-measurable from here.

---

## Scoreboard

> **Batches 1 and 2 landed 2026-07-30; batches 3, 4, 5, 6 and 7 landed 2026-07-31; batches 8 and 9
> landed 2026-08-01.** Closed so far:
> **P1**, **P3**, §3.11's `SESSION_SECRET`, §5.3's User-Agent, **§0.4**, **§0.6** — and §0.6's third
> piece (the 0007-0016 rows), which was closed in code rather than with the migration batch 6 was
> holding for it — plus §4.7's **keyboard/ARIA half** (`aria-autocomplete`, ArrowUp-to-open, Escape;
> Home/End resolved as a documented *no*), §4.7's **tile `title`** half, **§4.5** in full,
> **§3.4's residual** (`round_end` + `match_end`, batch 5), **§3.9's pool validation** (batch 6),
> **two of §1.7's three** smaller items (batch 7; the third is a recorded *leave it*), **§1.4's
> `flag-icons` half** (batch 8) and **§1.1's context split** (batch 9). Each carries a
> **Fixed** note in its own section. §3.11 keeps one residual that is not in this tree (delete the
> variable from Vercel's environment too); §3.4's fix carries one open *verification* (a two-session
> manual duel), not an open item. The table below is as-written on the audit date; the *Open now*
> column is the state after those batches.

| Area | Open (as audited) | Open now | Severity spread |
|---|---|---|---|
| Process | 3 | **1** | P2 only — MED; P1 + P3 closed |
| Performance & efficiency | 4 | **1** | §1.4's `RealtimeClient` move only, and it needs a decision before it needs code; §1.1 and §1.4's `flag-icons` half both closed, and §1.7 is down to its `useLightsCountdown` third, which is a recorded *leave it* |
| Security & data integrity | 7 | **4** | 3 accepted/hygiene, 1 doc-accuracy — **no MED-real left**; §3.4's residual and §3.9's pool validation both closed 2026-07-31, §3.11 closed in-tree with a deployment residual only |
| Stats correctness | 2 | **0** | §0.4 + §0.6 both closed, with a fails-first test each |
| UX & a11y | 2 | **1** | LOW — §4.5 closed in full and §4.7 is down to its **dropdown-direction** third; the keyboard/ARIA and tile-`title` halves closed 2026-07-31 |
| F1 data | 1 | **0** | §5.3's User-Agent closed; the biased shuffle stays INFO / won't-fix |

**19 items as audited; 7 open now** (the count was last restated after batch 7; batches 8 and 9 took
§1.4's `flag-icons` half and §1.1), plus §3.11's deployment-side residual. None is blocked on a
decision — audit #2 closed its own to-do list, including all
three standing decisions (component tests, ESLint, `db:seed` failing closed). What remains is
either small, deliberately accepted, or genuinely deferred with a stated reason.

Nothing here is HIGH. The two HIGHs audit #2 found (§0.1, §0.2) and the three the first audit found
are all closed and re-verified above. **The sharpest remaining item is a process one (P2), now that
P1 and the sharpest code one (§3.4's residual) are both closed** — and P2 is the one item on this
list nothing in the working tree can finish. Batch 6 sharpened that: it found a DB-tier file whose
six cases had been failing in `beforeAll` since drizzle/0047 and could not have been noticed without
running the tier, and it could not finish re-running the tier itself, because Supabase's per-IP
anonymous sign-in quota is exhausted by one full local pass.

---

## 1. Process — 3 items

### ✅ P1 `.env.example` is deleted **and still referenced in three places** — MED (process) — NEW

Escalated from §0.3's resolution, which flagged it as an *unstaged working-tree deletion* and said:
*"restore it or commit the deletion and update those three references — but don't leave it
deleted-and-referenced."* The deletion was committed (`018551b`) and the references were not
updated, so the state it warned against is now the state on `main`:

```
$ git ls-files | grep env.example     →  (nothing)
$ ls .env.example                     →  No such file or directory
```

Still pointing at it:

- [.github/workflows/ci.yml:18](../.github/workflows/ci.yml#L18) — *"See .env.example for what they are"*
- [README.md:35](../README.md#L35) — `cp .env.example .env` — **a fresh clone's documented first
  step now fails**
- [README.md:44-45](../README.md#L44-L45) — *"`.env.example` documents each one"*
- [CLAUDE.md:440](../CLAUDE.md#L440) — the three CI secrets, *"see `.env.example`"*

This is the cheapest item in the document and the one with the widest blast radius, because it is
the file a new contributor meets first. Either `git checkout 122b8d2 -- .env.example` and commit it
back, or rewrite the four references to name the three variables inline. Restoring is better: three
docs currently delegate the *definitions* to it, so removing it means writing them out three times.

**Fixed 2026-07-30** — restored, byte-for-byte, via the recommended route (`git checkout 122b8d2 --
.env.example`). Restoring rather than rewriting was chosen for the reason stated above: all four
references delegate the *definitions* to the file, so the alternative was writing the three
variables out in three places and keeping them in sync by hand. No reference needed editing —
`.gitignore:35` already carried `!.env.example`, so the file is tracked again and all four
pointers resolve. Verified as a fresh clone would meet it: `cp .env.example .env` succeeds and
`dotenv` parses all five keys (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_ADSENSE_CLIENT`, `NEXT_PUBLIC_ADSENSE_SLOT`) — and
**no `SESSION_SECRET`**, which is the interaction with §3.11 that put the two in one batch.

### P2 CI's three jobs have still never been read — MED (process) — §0.3 residual

The workflow is tracked and pushes have happened, so it has almost certainly *run*; what has not
happened is anyone **reading the result**. `gh` is not installed on this machine, so it cannot be
read from here either. Three specifics still stand from §0.3's resolution:

- The **`build` job has never executed anywhere** — `next build` stalls locally, so its first ever
  green is on GitHub, unwatched.
- The **`database` tier self-skips** unless `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set as repository secrets against a **scratch** project. If
  they aren't, the parity suites, the grant policy, the RPC/matchmaking suites and the roster
  integrity suite are still only running when someone remembers — which is the whole of §2.6's
  argument, unresolved, no matter how good the suites are. **14 test files skip by default**; that
  is the number the database tier exists to run.
- The `static` tier now carries the lint step and the `dom` project, neither of which has been seen
  green in CI from here.

Not a code finding, and it needs a human with the Actions tab open. It gates the value of five
other fixes, so it stays near the top.

### ✅ P3 CLAUDE.md contradicts itself on the lint step — LOW (docs) — NEW

[CLAUDE.md:440](../CLAUDE.md#L440) opens by saying `static` is *"typecheck + lint + `npm test`, both
vitest projects"* and closes the same bullet with:

> There is deliberately no lint step: adding one would invent a policy the codebase hasn't adopted.

The second sentence is left over from before §0.5 and is now false — [ci.yml:62-63](../.github/workflows/ci.yml#L62-L63)
runs `npm run lint`, and `eslint.config.mjs` records the measured scope. It is exactly the "stale
prose to delete" case CLAUDE.md itself names elsewhere (*"If a doc, comment or page mentions [hard
mode], that's stale prose to delete — not a feature to go build"*), and it is one sentence. Delete
it, or replace it with the adopted scope. The rest of CLAUDE.md already describes ESLint correctly,
which is what makes this one sentence a trap rather than a gap.

**Fixed 2026-07-30** — replaced with the adopted scope rather than deleted, taking the second of the
two options offered. A bare deletion would have left the bullet silent on what the lint step
*covers*, and the trap that made this finding was a reader concluding something about scope from
CI's description; the replacement states that `static` runs the narrow adopted scope and that
widening it means measuring against the tree in `eslint.config.mjs` first, which is the rule the
ESLint bullet three lines above already sets. One sentence out, one sentence in, no other change.

---

## 2. Performance & efficiency — 4 items

### ✅ §1.1 residual — the two-context split — MED

> **Fixed 2026-08-01 (batch 9).** `AuthProvider` now publishes **two** contexts on exactly the seam
> this finding names. `useAuthIdentity()` → `{ userId, isGuest, identityStatus, refresh,
> signOutAndReset }`; `useAuth()` → that merged with `{ user, session, profile, stats, status,
> loading }`, so every existing consumer keeps working unchanged. See *Batch 9* below for what the
> prescription didn't say and what the fails-first run measured.

The memo landed; the **split** was explicitly scoped out and is unchanged.
[AuthProvider.tsx:483-501](../components/auth/AuthProvider.tsx#L483-L501) still puts `profile` and
`stats` in the same context value as `userId`, so `refresh()` after a completed daily —
[DailyGame.tsx:252](../app/%28game%29/daily/DailyGame.tsx#L252) — re-renders every `useAuth()`
consumer, including the board that just finished. **10 consumer files, 13 call sites**
(`DailyGame`, `DuelLanding`, `DuelRoot`, `DuelSearching`, `LeaderboardModal`, and all four settings
sections). `identityStatus` / `status` already mark where the seam goes.

Softer than when it was written — `GuessGrid` is `memo()`'d now (§1.2) and `DailyGame` holds
`guesses` in a `useMemo`, so the tile subtree is skipped on a context re-render. What still
re-renders is everything else in every consumer.

### ✅ §1.4 residual — `flag-icons` on every route — MED

> **Fixed 2026-08-01 (batch 8).** `app/globals.css` now imports a **generated 40-country subset**,
> `app/flag-icons.subset.css`, written by `scripts/generateFlagSubset.ts` from `COUNTRY_CODES` —
> the codes `components/ui/Flag.tsx` can actually emit, since `countryCode` returns null for
> everything else. See *Batch 8* below for the measurements and the two things the prescription
> didn't anticipate.

[globals.css:2](../app/globals.css#L2), unchanged:

```css
@import "flag-icons/css/flag-icons.min.css";
```

The full ~250-country stylesheet on **every** route — including `/about` and the legal pages —
against `lib/game/flags.ts`'s 40 mapped nationalities, for a setting that is **off by default**
([store.ts:17](../lib/settings/store.ts#L17) — `showFlags: false`). The modal split (§1.4's second
bullet) landed; this one and the next were left alone deliberately, and the reason given was that a
CSS-import decision with a visible-feature tradeoff doesn't belong inside a bundle-splitting pass.
That reason has expired now the pass is over. Subsetting to the 40 codes `COUNTRY_CODES` actually
maps is the obvious shape, and `flags.test.ts` already pins that map's contents.

### §1.4 residual — `RealtimeClient` in the root chunk — MED

[app/layout.tsx:41](../app/layout.tsx#L41) still wraps everything in `AuthProvider`, so
`@supabase/realtime-js` is in the shared chunk on `/about` and the legal pages, which have no auth
UI and no live anything. Moving it changes where every route's auth boundary sits — that is the
stated reason it was deferred, and it is a real one. Worth doing as its own change, not as a
footnote to another.

### §1.7 Smaller items — LOW — ✅ two of three fixed 2026-07-31 (batch 7); the third is a documented *leave it*

- ✅ [Toast.tsx:38,45](../components/ui/Toast.tsx#L38-L45) — two `setTimeout`s, no stored handle, no
  cleanup. Cosmetic: React 19 no-ops the unmounted `setState` and the provider is app-root, so
  nothing leaks in practice. **Fixed:** both go through a `schedule()` helper that registers the
  handle in a `useRef`'d `Set` and deletes it when it fires, plus a mount effect that clears whatever
  is still pending on unmount. The ref is captured into a local on mount rather than read inside the
  cleanup — the stale-value pattern `react-hooks/exhaustive-deps` warns about, and `npm run lint` is
  the thing that would have caught it. The comment at the call site now says why it exists given that
  the only instance is immortal: that is a property of the *call site*, not of the component, and a
  second, shorter-lived provider would leak with no sign at the change that introduced it.
- ✅ [InfiniteGame.tsx:45-58](../app/%28game%29/infinite/InfiniteGame.tsx#L45-L58) — the `poolDrivers`
  filter plus one `.filter().length` per pool window, i.e. **five passes over the 792-row array**
  where one `.reduce()` bucketing by `lastActiveYear` would do. Correctly `useMemo`'d on
  `allDrivers`, so it runs once per mount, not per render. This is the cheapest of the three.
  **Fixed:** `poolOptions` resolves the five cutoffs once, then makes a single `.reduce()` pass
  tallying every window at the same time. `poolDrivers` keeps its own filter — it needs the driver
  objects, not a count, and it is keyed on `poolWindow` rather than on `allDrivers`, so folding the
  two together would recompute all five counts on every pool switch to save nothing.
- [useLightsCountdown.ts:134,145](../components/duel/useLightsCountdown.ts#L134-L145) — `Date.now()`
  read in the render body, so the component is non-idempotent under StrictMode's double-render.
  Latent, not a bug, and the file says so at :38. Noted here because §0.5 measured react-hooks v7's
  Compiler preset flagging exactly this pattern at 30 sites — if that preset is ever revisited, this
  is one of the things it will be arguing about.

---

## 3. Security & data integrity — 7 items

### ✅ §3.4 residual — `round_end` and `match_end` are still applied as sent — MED

> **Fixed 2026-07-31 (batch 5).** Both handlers are triggers now: `onRoundEnd` reads `roundIndex`
> and nothing else, `onMatchEnd` reads nothing at all, and what either one renders comes back from
> **`duel_round_reveal`** — a new read-only, `SECURITY DEFINER`, participant-checked RPC
> (drizzle/0050), on the same warm one-hop path §0.2 chose over `refreshRoundState`.
>
> **The prescription above does not work as written, and that is the substance of this fix.**
> "Re-verify against `duel_close_round_client`" assumes that function is idempotent the way
> `duel_begin_round` is. It is idempotent in its *effect* but not in its *response*: exactly one
> client's close ever advances, and the already-closed branch returns `advanced: false` with **NULL
> for every reveal column** — deliberately, on drizzle/0024's stated assumption that *"a repeat
> caller already has it from the first, real call."* The client receiving `round_end` is precisely
> the client that never made that call. So there was nothing to re-verify against, and the two
> honest options were to widen `duel_close_round`'s already-closed branch or to add a read. The read
> won: `duel_close_round` is ~120 lines of scoring under a `FOR UPDATE` lock on the match row, on a
> path *both* clients hit between rounds, and a question has no business queueing behind that lock
> — nor should a security fix rewrite the DNF/points/winner rules to get at them. That gap is now
> pinned by a test (`roundReveal.test.ts` → *"answers what a second duel_close_round call cannot"*)
> so the assumption can't quietly return.
>
> **What makes the new RPC safe to expose is not the match status but
> `duel_rounds.intermission_ends_at IS NOT NULL`** — stamped by `duel_close_round` in the same
> statement that scores the round, and written by nothing else in the schema (`duel_forfeit` never
> touches `duel_rounds`). Until that is set, the response carries no target, no points, no scores
> and no clock, so a forged `round_end` mid-round comes back with **nothing to apply** and the
> player stays in their round. The match-level columns (status, `winner_id`, `rating_delta_a/b`)
> come back on both branches — they are what `match_end` verifies against, and none of them says
> anything before the match is genuinely over.
>
> A failed or uncorroborated read is not a dead end, and it degrades exactly the way a *dropped*
> `round_end` always has: the client stays on the expired round until the opponent's `round_start`
> arrives, whose handler refetches full state. It skips the reveal — the correct outcome for a
> broadcast the server won't confirm.
>
> **What it costs, stated plainly:** one warm PostgREST hop before the reveal appears on the
> *receiving* client, where it previously rendered synchronously off the payload. `intermissionEndsAt`
> is an absolute server timestamp, so both clients' intermissions still end at the same instant —
> the receiver's is a fraction shorter, not later. This is the same trade §0.2 accepted for
> `round_start`, on a beat where the player is between rounds rather than racing, and it is why a
> warm RPC rather than a Server Action was the only acceptable shape.
>
> The payload fields stay on the wire rather than being deleted, for the same reason
> `RoundStartPayload` kept `startedAt`/`endsAt` after §0.2: a deploy landing mid-match leaves one
> client on each version, and one running the older code still needs them. `realtimeEvents.ts` now
> says in both payload doc-comments that the receiver reads none of it.
>
> **Deviation from the batching rules, stated rather than hidden.** Rule 3 says never mix a
> migration with client-side work, and batch 6 was to be the only DB batch. This batch needed a
> server-side read that did not exist, so it carries one — but it is a **new** function, not an edit
> to a live one, so nothing that scores a duel changed and the rollback is a `DROP FUNCTION`. It
> also cost no anon sign-in quota beyond the four tests below; batch 6 is unaffected.
>
> *Verification (live database, this machine).* `npm run db:migrate` failed the usual silent way
> (the ~1400-byte path-MTU black hole), so 0050 was applied with the chunked-`EXECUTE` workaround
> and drizzle-kit's bookkeeping row written by hand — hash re-derived and cross-checked against
> 0047/0048/0049's stored hashes first. Read back from the catalogue: `prosecdef: true`,
> `provolatile: 's'`, `PUBLIC: false`, `anon: false`, `authenticated: true` — matching the
> `FUNCTION_POLICY` entry added to `schemaGrants.test.ts`, which passes (12/12), as does the new
> `lib/duel/roundReveal.test.ts` (4/4, DB tier). `tsc`, `lint` and `npm test` clean;
> 285 passed / 141 skipped, the +4 being this file's own DB-tier tests. **Not** verified by a
> two-session manual duel — that is this fix's one open verification, and the row in the batch table
> below says so.

The channel is private now (drizzle/0046), which narrows the attacker set from *the internet* to
*the other participant* — a large reduction, and the reason this is MED rather than HIGH. It does
not empty the set. [useDuelLifecycle.ts:242-244](../components/duel/useDuelLifecycle.ts#L242-L244):

```ts
onRoundEnd: (payload) => {
  if (payload.roundIndex !== roundIndexRef.current) return;
  applyRoundEnd({ ...payload, targetDriverPublic → targetDriver });
},
```

The reveal, both players' round points, both scores and `intermissionEndsAt` all come straight off
the wire. `onMatchEnd` ([:246-258](../components/duel/useDuelLifecycle.ts#L246-L258)) likewise
applies `winnerId` and both rating deltas as sent. Nothing here writes the database —
`duel_submit_guess`, `duel_close_round` and `applyMatchRatings` each validate independently, and the
results panel re-reads the authoritative row — so what a forgery costs is the *round, live*: an
opponent can end your round early on an attacker-chosen reveal and park you on an attacker-chosen
intermission length.

The fix shape is the one §0.2 already used one handler over: re-verify against
`duel_close_round_client` / `duel_state` rather than adopting the payload, and let the broadcast say
only *that* the round ended. §0.2's argument for `beginRound` over `refreshRoundState` applies
identically — the warm idempotent RPC, not the Server Action.

### §3.5 The self-match guard's only server-side layer is liveness — MED (accuracy, not exposure)

[deviceId.ts:26-29](../lib/duel/deviceId.ts#L26-L29) — `device_id` is still
`crypto.randomUUID()` in `localStorage`, supplied by the client. So of CLAUDE.md's "four independent
layers", L1 (explicit dequeue), L2 (identity-change abort) and L4 (`device_id`) are all client-side,
and L3 (the 15 s staleness window) is satisfied by simply continuing to heartbeat. The `CHECK
(player_a <> player_b)` on `duel_matches` is the genuine server-side backstop and it holds.

The design reasoning is sound and **no layer should be removed**. The finding is that the
documentation reads stronger than the implementation is, and that a determined self-matcher only has
to lie about one client-supplied string. Either weaken the prose or add a server-side signal
(e.g. binding the queue row to the IP or to the auth session's fingerprint) — the former is honest
and free.

### ✅ §3.9 residual — no pool validation on daily guesses — LOW — **fixed 2026-07-31 (batch 6)**

[drizzle/0049:87-90](../drizzle/0049_daily_duplicate_guess_guard.sql#L87-L90) checks only that the
driver **exists**:

```sql
SELECT * INTO v_guess FROM public.drivers WHERE id = p_guess_driver_id;
IF NOT FOUND THEN
  RAISE EXCEPTION 'Pick a driver from the suggestions list.';
END IF;
```

Any `drivers.id` is accepted, not just the 10-year pool the target is drawn from. Not exploitable —
§3.9's own note holds, and win-by-identity (drizzle/0044) means an out-of-pool guess can never win —
but it corrupts guess history and the shareable emoji grid, and the error message ("pick a driver
from the suggestions list") is a promise the function doesn't keep. `infinite_start_round` validates
its `p_pool_window` against an allow-list, so the pattern is already in the codebase; this is the
same `last_active_year >= cutoff` predicate `daily_target_id` already contains, one function over —
and `poolWindow.sqlParity.test.ts` would then pin a third site for free.

**Fixed 2026-07-31 (batch 6), as written above.** [drizzle/0051](../drizzle/0051_daily_guess_pool_validation.sql)
declares the cutoff as `v_pool_cutoff_year constant integer := extract(year FROM v_today)::int - 10`
— from the same `v_today` the target was resolved for, so the set a guess is checked against is
exactly the set the answer was drawn from — and rejects below it *before* `daily_progress` is
touched, so a refused guess takes no row lock and costs no turn. Applied to the live database with
the chunked-`EXECUTE` workaround and read back from `pg_get_functiondef`; `pg_proc.proacl` is
unchanged (`authenticated=X`, no `anon`, no `PUBLIC`), as `CREATE OR REPLACE` promises and
`schemaGrants.test.ts` re-confirms.

Both halves are pinned, and by **different tiers on purpose**: `poolWindow.sqlParity.test.ts` gains
the third site (extract the declaration, substitute `v_today` with a literal date, execute it), and
`dailyRpc.test.ts` gains the behavioural case — an out-of-pool driver is refused with a board still
holding zero guesses and `MAX_GUESSES` remaining, and the in-pool driver beside it is still accepted.
An extraction alone would never notice a `<` becoming a `>`, and a behavioural case alone would never
notice the constant drifting from `poolWindow.ts`.

**What the batch actually cost was the fixtures, and that was the useful part.** Two DB-tier suites
were building their daily fixtures out of drivers that this check makes illegal, and neither is a
test of the pool:

- `dailyRpc.test.ts` took its six "wrong" driver ids as `ORDER BY id LIMIT 6` with the comment *"guess
  validation is existence-only, so pool membership doesn't matter"* — the lowest ids on the roster
  are 1950s privateers, so every one of its guessing tests would have failed on the new rejection.
  It now filters on the pool, with the cutoff computed from `DAILY_POOL_WINDOW` and the database's
  own UTC day.
- `winByIdentity.test.ts` built the daily doppelgänger by inserting a copy of the day's target with
  `last_active_year = 1960`, deliberately out of every pool so no parallel suite could pick it as a
  target and block the cleanup `DELETE` on a foreign key. That trick and this check are directly
  opposed: the guess now *has* to be in the pool. The resolution is to stop inserting a row at all —
  rewrite an **existing** pool driver into the doppelgänger and restore it afterwards, which changes
  no pool membership (nothing added, nothing removed, every random pick still valid) and undoes with
  an `UPDATE`, which no reference can block. The two suites take opposite ends of the roster (lowest
  ids vs. highest) so they cannot collide, since vitest runs test files in parallel.

**And it surfaced a pre-existing red in that tier**, unrelated to this batch: `winByIdentity.test.ts`'s
twin fixtures carry `debut_year = 1961` with `last_active_year = 1960`, which
[drizzle/0047](../drizzle/0047_drivers_value_checks.sql)'s `drivers_season_order_check` rejects — so
the insert threw in `beforeAll` and **all six cases in the file had been silently unrun since 0047
landed**, including the three that pin win-by-identity for daily, infinite and duel. `debut_year` is
now 1959. This is **P2** in miniature: the file is green in the repo and was red against the database,
and only running the tier could tell the difference.

### §3.9 residual — no rate limiting anywhere — LOW/MED

Both still callable in a loop by any signed-in visitor, including a fresh anonymous guest:

- [0028:174](../drizzle/0028_daily_infinite_fast_guess_rpc.sql#L174) — `infinite_start_round`'s
  unbounded `ORDER BY random()` full-pool scan.
- [0032:181](../drizzle/0032_duel_matchmaking_integrity.sql#L181) — `match_or_queue` takes a
  **global per-pool advisory lock** (`pg_advisory_xact_lock(hashtext('match_or_queue:' || …))`), so
  a loop against it serializes every searching player behind the attacker.

The second is the more interesting one: it is a shared lock, so the cost isn't paid by the caller.
Neither is a data-integrity risk; both are availability. Supabase-side rate limiting or a per-user
cooldown column would close them.

### §3.6 residual — display-name impersonation — LOW (probably accept)

drizzle/0045 closed the part that mattered (the column grant and the unbounded strings).
`display_name` still has no uniqueness constraint and no check against existing `username`s, so two
leaderboard rows can both read "Max Verstappen". Arguably correct product behaviour — display names
usually aren't unique. **Recorded so the omission stays deliberate rather than assumed**; if the
answer is "accept", the right close is one sentence in CLAUDE.md, not a constraint.

One cosmetic follow-on, unchanged: a `CHECK` violation surfaces raw as
`Something went wrong: <postgres message>`
([ProfileSection.tsx:88-90](../components/settings/ProfileSection.tsx#L88-L90)). Unreachable through
the UI (the input is `maxLength={32}` and the value is trimmed before send), so it is only reachable
by someone calling PostgREST directly — who deserves the raw message.

### ✅ §3.11 residual — `.env` still carries an unused `SESSION_SECRET` — LOW

Confirmed dead: `grep -rn SESSION_SECRET` across `.ts`/`.tsx`/`.mjs`/`.yml` (excluding
`node_modules`) returns **nothing**. It survives only in the operator's local `.env` and in any
deployment environment. Dead since infinite's round state moved from the signed httpOnly cookie into
`infinite_rounds`. Hygiene — delete it from `.env` and from Vercel's env, and note that it should
*not* come back when `.env.example` is restored under **P1**.

**Fixed 2026-07-30, local half.** Removed from the operator's `.env`, which now holds exactly
`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; re-verified by
parsing the file back through `dotenv` rather than by reading the diff. **P1's restored
`.env.example` does not reintroduce it** — the pre-deletion file never carried it, which is why
restoring byte-for-byte was safe here.

One thing this edit nearly broke, worth recording because the next person editing a dotfile on this
machine will hit it: Windows PowerShell 5.1's `Set-Content -Encoding utf8` writes a **UTF-8 BOM**,
and `dotenv` does not strip one — the first key would have parsed as `﻿DATABASE_URL` and the
database connection would have failed with a missing-variable error that named the variable that
was plainly there. The BOM was detected and stripped, and the parse check above is what caught it.
Same family as the `npm run -- --flag` trap recorded under §5.1: the shell, not the code.

**Still open — deployment half.** `SESSION_SECRET` must also be deleted from Vercel's project
environment. That is a dashboard action outside this working tree and nothing here can verify it;
it is carried forward as the residual of this item.

### §3.1 residual — 13 functions carry bootstrap `anon`/`PUBLIC` grants — LOW (accepted, ratcheted)

Enumerated with a per-function reason at
[schemaGrants.test.ts:98-132](../lib/db/schemaGrants.test.ts#L98-L132), under a ratchet at
[:495](../lib/db/schemaGrants.test.ts#L495) asserting the count can only fall
(`expect(open.length).toBeLessThanOrEqual(13)`). Hygiene rather than exposure — each reads
`auth.uid()` as its first act, which is `NULL` for `anon`. Listed for completeness only; the
handling is genuinely good (recorded, not blessed, and a new function can't join the list without
failing the suite first). **No action recommended** beyond letting the ratchet do its work.

### §3.0 residual — no site-wide CSP — MED

[next.config.ts](../next.config.ts) is still the empty `create-next-app` object:

```ts
const nextConfig: NextConfig = {
  /* config options here */
};
```

The per-response nonce CSP covers `/auth/callback` alone, which is enough to close §3.0 as written
(that is the app's only server-rendered HTML built from request input). But the Supabase session
cookies are non-`httpOnly` by `@supabase/ssr` design, so any *future* injection anywhere in the app
is a session takeover. The scoping problem is real — AdSense, Funding Choices, the Supabase
WebSocket, DiceBear, and Next's inline hydration bootstrap needing a nonce (which forces affected
pages dynamic). `Content-Security-Policy-Report-Only` first, as the original suggested.

---

## 4. Stats correctness — 2 items

These two are one bug seen from both ends, and they are cheapest fixed together.

### ✅ §0.4 `migrateLocalStats` silently truncates the guess distribution — LOW

[actions.ts:98-99](../lib/stats/actions.ts#L98-L99), unchanged:

```ts
const mergedDistribution = current.guessDistribution.map(
  (count, i) => count + (clean.guessDistribution[i] ?? 0),
);
```

`.map` over `current` preserves **current's** length. `sanitizeLocalStats` produces a
`MAX_GUESSES`-length (6) array, so against a server row holding a 5-bucket distribution — what any
`user_stats` row created between drizzle/0007 and drizzle/0016 holds — the legacy player's 6-guess
wins are dropped and the row stays 5 buckets forever. Safe in the direction that matters (it can
only lose counts, never invent them).

```ts
Array.from({ length: MAX_GUESSES }, (_, i) =>
  (current.guessDistribution[i] ?? 0) + (clean.guessDistribution[i] ?? 0))
```

fixes it and normalises the row's length in the same expression. Note the file already imports
`MAX_GUESSES` — [actions.ts:136](../lib/stats/actions.ts#L136) uses
`Array(MAX_GUESSES).fill(0)` for the reset path, so the correct spelling is three lines away from
the wrong one.

**Fixed 2026-07-30** — as `mergeDistributions(current.guessDistribution, clean.guessDistribution)`,
which is the suggested `Array.from` expression with a name. The reason it got a name rather than
staying inline is the observation this section itself makes: *"the correct spelling is three lines
away from the wrong one."* Two spellings of one rule, three lines apart, is the shape of the bug —
so the rule now has exactly one definition, `lib/stats/guessDistribution.ts` (pure, unit-tested),
and all four sites that had a length opinion read from it. `resetUserStats`'s
`Array(MAX_GUESSES).fill(0)` became `emptyDistribution()` in the same pass, which is why
`actions.ts` no longer imports `MAX_GUESSES` at all.

The regression test the batch asked for is
[`guessDistribution.test.ts`](../lib/stats/guessDistribution.test.ts) → *"keeps the 6-guess bucket
when the server row has only five"*, and it was **checked against the pre-fix expression before
being kept**: `[0,0,0,0,0].map((c, i) => c + local[i])` returns five buckets with the legacy
player's four 6-guess wins gone, so the test fails first exactly as §2.6's convention requires.

One thing the fix is deliberately stricter about than the suggested expression: `bucket()` reads a
non-array, a hole, a negative or a non-number as `0` instead of trusting the column's TypeScript
type. `guess_distribution` is **jsonb**, and drizzle/0005 defaulted it to `'{}'` — an *object* —
which drizzle/0008 had to go back and tidy. `.map` over one of those throws inside a render; the
new shape degrades to zeroes.

### ✅ §0.6 residual — `StatisticsSection` falls back to a 5-element array — LOW

[StatisticsSection.tsx:25](../components/settings/StatisticsSection.tsx#L25):

```ts
const guessDistribution = stats?.guessDistribution ?? [0, 0, 0, 0, 0];
```

A viewer whose stats haven't loaded sees five bars, then six. `Array(MAX_GUESSES).fill(0)` is the
one-line fix and removes the last hardcoded copy of the number outside SQL (where
`poolWindow.sqlParity.test.ts` now pins the three plpgsql copies).

**Fixed 2026-07-30** — `emptyDistribution()`, and the hardcoded five is gone from the tree.

Pinned as **rendered DOM**, not as a value, because the whole symptom is a count of elements on
screen: [`StatisticsSection.test.tsx`](../components/settings/StatisticsSection.test.tsx) asserts
the bars are `["1","2","3","4","5","6"]` both before and after stats arrive. Also checked to fail
first — reverting the fallback to `[0, 0, 0, 0, 0]` produces `["1","2","3","4","5"]`, which is
§0.6's sentence rendered as an assertion. It is the first settings-surface component test, so it
also establishes the `vi.mock("@/components/auth/AuthProvider")` shape for the ones batches 3 and 4
will need.

The **loaded** half was fixed one level up, in
[`AuthProvider.toUserStats`](../components/auth/AuthProvider.tsx): a legacy five-bucket row is
normalised on read, beside the streak decay and for the identical stated reason — *"so no consumer
can forget"*. Fixing only the fallback would have left a legacy player looking at five bars
permanently, which is the same bug with the loading state removed.

### ✅ §0.6's third piece — the 0007-0016 rows — closed **without** a backfill migration

The third piece — **rows created between 0007 and 0016 still hold 5 buckets, and nothing backfilled
them** — is a live-database question this pass can't answer. They self-repair on the first 6-guess
win. If a backfill is wanted it is a one-statement migration, and it should land *after* §0.4 so the
merge path can't re-truncate.

**Handled 2026-07-30, and this removes the migration from batch 6.** The self-repair described
above was narrower than it reads: `recordDailyResult` did `[...current.guessDistribution]`, and a
spread of a five-element array stays five — so the row healed *only* on a win in exactly six
guesses, the one index whose write happens to extend the array. A five-guess win, or any loss, left
it five buckets. That write now normalises too, so **every affected row heals on its next result of
any kind**.

Preferred over the one-statement migration for three reasons, all of which are why this was worth
doing rather than deferring: it needs no live-database access (the constraint that made this "a
question this pass can't answer" in the first place), it is idempotent rather than one-shot, and it
cannot miss a row — a backfill only fixes the rows that exist when it runs, and this is a class of
row that is *already* in the database with nothing preventing more reads of it. The remaining
exposure of an un-healed row is now zero anyway, since `toUserStats` normalises on read: the stored
length stopped being observable before it stopped being wrong.

Batch 6 is therefore a single-item batch again (§3.9's pool validation).

---

## 5. UX & accessibility — 2 items

### §4.7 residual — three autocomplete/board items — MED/LOW
### ✅ keyboard/ARIA half + tile `title` fixed 2026-07-31 · dropdown direction still open

`DriverAutocomplete` got the duplicate-guess withholding (§3.9) and `PoolSelect` got its keyboard
model (§4.5), but three things named in §4.7 are untouched:

- ✅ **Escape doesn't `preventDefault`/`stopPropagation`**
  ([DriverAutocomplete.tsx:112-114](../components/game/DriverAutocomplete.tsx#L112-L114) —
  `setIsOpen(false)` and nothing else), so inside a `Modal` it bubbles and closes the modal as well
  as the dropdown. **Latent today**, and worth stating precisely rather than inheriting the original
  wording: no `Modal` currently contains a `DriverAutocomplete` (the five `<Modal>` sites are the
  share modal, the duel exit confirm, and the three settings/leaderboard surfaces), so nothing
  composes them yet. It costs one line to make safe before something does.
- ✅ **Three keyboard/ARIA gaps in the same handler**, and these are live, not latent: no
  `aria-autocomplete="list"` on the input ([:126-150](../components/game/DriverAutocomplete.tsx#L126-L150)
  — `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant` are all there,
  so this is the one missing attribute of the set); no Home/End; and **ArrowUp doesn't open a closed
  list** ([:103-106](../components/game/DriverAutocomplete.tsx#L103-L106) returns early when there
  are no matches, where ArrowDown at [:92-97](../components/game/DriverAutocomplete.tsx#L92-L97)
  opens first). `PoolSelect` implements all of this now, and `PoolSelect.test.tsx` shows what
  pinning it looks like — the two components have drifted apart in the direction that reads as
  correct and isn't, exactly as §4.5 said of `InfoTopBar`.

  **Fixed 2026-07-31** (batch 3 — the two ✅ bullets above, one commit), each with a `dom` test
  written to fail against the pre-fix component and **checked to**: stashing the component and
  re-running produced exactly four failures, no more and no fewer.

  - `aria-autocomplete="list"` on the input — the one missing attribute of a set that already had
    `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`.
  - **ArrowUp opens a closed list**, as ArrowDown already did. Worse than an asymmetry: with the
    query unchanged the matches are unchanged, so *nothing typed* reopened a list dismissed with
    Escape — the player had to edit the query to get their suggestions back. The cursor is left
    where it was rather than jumped to the last suggestion; the APG's "ArrowUp moves visual focus to
    the last suggested value" resolves an **unset** visual focus, and this list has none
    (`activeIndex` is always on an option, 0 by default and reset on every keystroke).
  - **Escape now `preventDefault`s and `stopPropagation`s — but only when a popup is displayed.**
    `stopPropagation` is the load-bearing half: `Modal` closes from a listener on `document`, which
    never consults `defaultPrevented`, so a `preventDefault`-only fix would still have closed the
    dialog. React dispatches from the (portal) root container, below `document`, so stopping the
    native event here reaches the dialog's listener in time. The guard is the other half — with no
    popup open, Escape belongs to the container, and eating it would make a dialog take two presses
    to close. Both directions are pinned by tests that render the autocomplete **inside a real
    `Modal`**, i.e. the composition this finding called latent now exists in the test suite even
    though it still doesn't exist in the app.
  - Along the way, `isPanelOpen` (`isOpen` **and** something to show) replaced `isOpen` on
    `aria-expanded`, `aria-activedescendant`, the panel and the Escape guard. The two differ only on
    an empty pool, but "expanded" over an absent listbox is the same species of false ARIA promise
    the rest of this finding is about, and the Escape guard has to mean *displayed*, not *intended*.

  **Home/End were deliberately not implemented, and that decision is itself pinned by a test.** This
  is the one place the two controls must **not** match, so "make these match" was the wrong
  instruction: `PoolSelect` is a **select-only** combobox (a `<button>`), where Home/End can only
  mean first/last option. `DriverAutocomplete` is **editable**, and the APG gives Home/End to the
  editing cursor for an editable combobox — *"Home: Moves visual focus to the textbox and places the
  editing cursor at the beginning of the field"* — and says so even for the case where visual focus
  is in the popup (*"if the combobox is editable, returns focus to the combobox and places the
  cursor on the first character"*). Binding them to the option list would have taken away the only
  keys that jump the caret through a half-typed name, in the one mode where guessing is scored on
  speed. The reasoning is at the call site, and the test asserts the caret moves while the option
  cursor doesn't — so a future pass finds a decision rather than a gap.
- **The dropdown opens downward only** ([:158](../components/game/DriverAutocomplete.tsx#L158) —
  `absolute z-10 mt-1 w-full`, list `max-h-64`), with no flip-up and no collision detection, in the
  one mode where guessing speed is scored.
- ✅ **Tile clipping at 320 px with no recovery** — `grep title=` across
  [GuessGrid.tsx](../components/game/GuessGrid.tsx), `Tile.tsx` and
  [DuelIntermission.tsx](../components/duel/DuelIntermission.tsx) returns **nothing**, so "Scuderia
  AlphaTauri" still `line-clamp-2`s with no `title` to recover the value. §4.1's `aria-label` means
  the value now exists *in speech*, which helps a screen-reader user and does nothing for a sighted
  user on a small phone.

  **Fixed 2026-07-31** (batch 4), as an optional `title` prop on `Tile` — with two decisions in it
  that a bare "add `title=`" would have got wrong:

  - **It goes on the value `<span>`, not on the tile `<div>`.** The tile already carries
    `role="img"` + `aria-label`, and a `title` beside an `aria-label` becomes the element's
    accessible *description* — so the tooltip would have been announced a second time, immediately
    after the label that already said the value. Inside `role="img"` the span is presentational and
    pruned from the accessibility tree, so the tooltip reaches the mouse and not the screen reader.
    A test asserts no tile `<div>` has a `title`, so the "simplification" of hoisting it one level
    fails rather than quietly regressing §4.1.
  - **Only `nationality` and `team` get one.** Age, debut and wins are at most four mono digits and
    cannot clip at any width the board renders at; a tooltip repeating a fully-visible `105` is
    noise. Nationality gets one despite being the shorter of the two strings because "Show flags"
    replaces that tile's text with a flag glyph — the tooltip is then the only way a sighted player
    who doesn't recognise the flag reads the country, which is a gain the finding didn't ask for.

  Applied at both call sites that render real driver data — `GuessRow` (so daily, infinite **and**
  the duel board through `ClosestGuessesBoard` get it from one change) and `DuelIntermission`'s
  reveal row. The marketing legend's tiles are deliberately left alone: short literal values in a
  two-column grid, captioned in visible prose.

  **What this does not fix:** `title` has no touch affordance. On the 320px phone the finding is
  about, the value is recoverable by hover or long-press and is not *discoverable*. A real fix for
  small screens is a layout change, not an attribute — noted here so the next pass doesn't read the
  ✅ as "small screens are solved".

### ✅ §4.5 residual — `InfoTopBar` makes an ARIA promise it doesn't implement — LOW

[InfoTopBar.tsx:86,110,117](../components/layout/InfoTopBar.tsx#L86) still sets `role="combobox"` /
`role="listbox"` / `role="option"` with **no `onKeyDown`, no `tabIndex`, no
`aria-activedescendant`** — those three greps return nothing in that file, confirmed today. Lower
severity than `PoolSelect` was, because its options are `<Link>`s and therefore genuinely tabbable,
so the menu *is* operable. But the roles describe an interaction it doesn't implement, and it was
copied from `PoolSelect`'s markup — which now has the handlers. Either implement the handlers (the
`PoolSelect` fix, one component over, for the third time) or drop the three roles and let it be the
nav menu it actually is. **Dropping the roles is probably right here** — a list of links doesn't
need to be a combobox.

**Fixed 2026-07-31** (batch 4), by dropping the roles, as recommended. The argument for *not* doing
the `PoolSelect` fix a third time is worth keeping, because the two components will keep looking
like each other: `PoolSelect` picks a **value** and has to be a combobox; this picks a **page** and
is four links. Every ARIA promise the collapsed nav now makes is one the browser keeps for free.

| Was | Now |
|---|---|
| `role="combobox"` + `aria-haspopup="listbox"` on the trigger | plain `<button>` with `aria-expanded` + `aria-controls` — the APG disclosure pattern, which needs no keydown handler |
| `role="listbox"` on the `<ul>` | nothing; a `<ul>` of `<Link>`s is a list of links, with the `id` the trigger now points at |
| `role="option"` + `aria-selected` on each `<li>` | `aria-current="page"` on the `<Link>` — the same attribute the wide-viewport nav directly above it already used for the same state |

`aria-haspopup` went too, and deliberately: it was the same species of claim as the roles (it
promises a `menu`/`listbox` widget with arrow-key navigation), so leaving it would have kept a third
of the finding open.

**One thing was added beyond the stated scope**, because dropping the roles is what made it visible:
Escape now **returns focus to the trigger** when the panel is closed from inside it. The panel
unmounts on close, so closing while focus sat on one of the links dropped focus to `<body>` and the
next Tab restarted from the top of the document. The audit's own reason for rating this LOW is that
the links are "genuinely tabbable" — that claim is only true with the focus restore, so it belongs
with the rest of the finding rather than in a later pass. It follows CLAUDE.md's existing rule
(*"when a control disappears under the player, the thing that replaces it takes focus"*), guarded on
focus actually being inside the container so a click-then-Escape doesn't steal it.

Four `dom` tests in a new [InfoTopBar.test.tsx](../components/layout/InfoTopBar.test.tsx), all four
confirmed to fail against the pre-fix component. What they pin is mostly the *absence* of an ARIA
claim, which is the shape a "make these two match `PoolSelect`" pass would silently undo.

**Two adjacent defects were seen in the same element and deliberately left**, since neither is this
finding and inventing scope inside a batch is what rule 2 exists to stop. Recorded so they aren't
re-found as new:

- **Label in Name (WCAG 2.5.3), LOW.** The trigger's visible text is the current page ("FAQ") but
  its accessible name is `aria-label="Info pages"`, which doesn't contain it — so a voice-control
  user saying "click FAQ" doesn't activate it. Pre-existing, one attribute to fix, but it changes
  the button's name and therefore the four tests' primary selector, which is more than a
  role-removal batch should carry.
- **`activeLink` falls back to `LINKS[0]`**, and the two legal pages are in the `(info)` group but
  not in `LINKS` — so on `/privacy-policy` and `/terms-of-service` the collapsed trigger reads
  "About" while nothing in the panel is `aria-current`. A wrong label rather than a missing one.
  The wide-viewport nav has the same gap without the mislabel (it just highlights nothing).

---

## 6. F1 data — 2 items

### ✅ §5.3 The RSS fetcher advertises someone else's repository — LOW

[fetchNews.ts:43](../lib/news/fetchNews.ts#L43), unchanged:

```ts
headers: { "User-Agent": "DriverPitBot/1.0 (+https://github.com/f1db/f1db)" },
```

Five news sources — motorsport.com, Autosport, Crash.net, Sky Sports, RaceFans — are being told to
contact the **F1DB maintainers** about your crawler. Point it at your own site before traffic
scales. One string.

**Fixed 2026-07-30** — now `+https://driver-pit.vercel.app`, the deployed origin, taken from the
contact address the two legal pages already publish (`TermsOfService.tsx:134`,
`PrivacyPolicy.tsx:167` — `privacy@driver-pit.vercel.app`) rather than invented, so there is one
answer to "who is this crawler" and it is reachable. A comment at the call site records *why* the
URL must be ours — a feed operator wanting to rate-limit or block this crawler follows it — because
the failure mode of the old value was not a broken build but correctly-delivered mail to the wrong
people. If the site moves to a custom domain, this string and the two `mailto:`s move together.

### §5.3 `sort(() => Math.random() - 0.5)` is a biased shuffle — INFO

[seed.ts:448](../scripts/seed.ts#L448). It only picks a console preview sample, so the bias has no
effect on any stored row. Cosmetic; listed only so it isn't rediscovered as a finding a third time.

---

## Do these first

1. ✅ **P1 — restore `.env.example` (or rewrite its four references).** — **done 2026-07-30**,
   restored byte-for-byte from `122b8d2`; `cp .env.example .env` works again and all four references
   resolve. A fresh clone's documented first step (`cp .env.example .env`) currently fails. Smallest
   fix in the document, widest audience, and it is the item audit #2 explicitly asked not to be left
   in this state.
2. **P2 — read the three CI jobs on the Actions tab, and set the database tier's three secrets
   against a scratch project.** `build` has never executed anywhere. Until the secrets exist, 15
   test files — every parity, grant, RPC and matchmaking suite — skip on every run, which is the gap
   §2.6 spent two audits arguing about, still open at the last step. **Batch 6 gave this its sharpest
   evidence yet:** running the tier by hand found six cases in `winByIdentity.test.ts` that had been
   failing in `beforeAll` since drizzle/0047 and were green in every local `npm test` — and then hit
   Supabase's per-IP anonymous sign-in limit before the tier could be finished. CI has neither
   problem.
3. ✅ **§3.4 residual — re-verify `round_end`/`match_end` instead of applying the payload.** The
   largest remaining code-level hole in the duel. The pattern is already written: §0.2 did exactly
   this for `round_start` via the idempotent `duel_begin_round_client`, and `duel_close_round_client`
   is its counterpart here. — **done 2026-07-31**, and the last sentence is the part that didn't
   survive contact: `duel_close_round_client` is idempotent in effect but returns NULL for every
   reveal column on its already-closed branch, which is the only branch the receiving client can
   ever reach. Closed instead with a new read-only RPC (`duel_round_reveal`, drizzle/0050) that
   discloses a round's reveal only once `intermission_ends_at` is stamped. See §3.4's own note.
4. ✅ **§0.4 + §0.6 together — one `Array.from`, one `Array(MAX_GUESSES).fill(0)`.** — **done
   2026-07-30**, as one shared `lib/stats/guessDistribution.ts` rather than two inline expressions,
   with a fails-first test on each end and the 0007-0016 rows self-healing on write. Two lines, one
   bug, and it removes the last hardcoded copy of the guess count outside SQL.
5. ✅ **§4.7's keyboard/ARIA gaps in `DriverAutocomplete`** (`aria-autocomplete`, Home/End,
   ArrowUp-to-open, Escape's `preventDefault`). `PoolSelect` already implements all four and
   `PoolSelect.test.tsx` shows how to pin them in the `dom` tier — so this is the first item in
   either audit that can be *closed with a test that fails first*, which is the convention §2.6 just
   established. — **done 2026-07-31**, and it was: seven new `dom` tests, four of which were
   confirmed to fail against the pre-fix component. Three of the four items were implemented as
   written; **Home/End were not**, because the premise ("`PoolSelect` already implements all four")
   doesn't survive contact with the APG — `PoolSelect` is a select-only combobox and this one is
   editable, where Home/End belong to the editing cursor. That divergence is now a documented,
   tested decision rather than an open gap.

**Runners-up, in rough order:** ~~§1.4's `flag-icons` subset~~ ✅; ~~§3.9's pool validation on
`daily_submit_guess` (and a third site for `poolWindow.sqlParity.test.ts`)~~ ✅; ~~P3's stale
CLAUDE.md sentence~~ ✅; ~~§1.7's `.reduce()` in `InfiniteGame`~~ ✅; ~~§3.11's `SESSION_SECRET`~~ ✅ (in-tree);
~~§5.3's User-Agent~~ ✅; ~~§4.5's `InfoTopBar` roles~~ ✅; ~~§4.7's tile `title` attributes~~ ✅.
Then the two that are real projects rather than
fixes: §3.0's site-wide CSP (`Report-Only` first) and ~~§1.1's context split~~ ✅. §1.4's
`RealtimeClient` move, §3.5, §3.6 and §3.1 are all either accepted or need a decision about scope
before they need code.

---

## How to hand these to Claude Code

The list above is priority order. This section is **execution** order — which items go in one
prompt, which must go alone, and why. The two differ because what makes a batch is not severity but
**shared surface and shared verification**.

### The rules the batches follow

1. **One batch = one prompt = one commit.** Don't start the next batch before the previous one is
   committed. Two audits' worth of evidence says the expensive failure here isn't a bad fix, it's a
   working tree holding six unrelated fixes at once (§0.3).
2. **2-4 items per prompt, and only when they share a surface *and* a verification method.** Four
   one-line text edits are one prompt. Two changes to the same component are one prompt. Two
   MED findings in different subsystems are two prompts, even if each is small.
3. **Never mix a migration with client-side work.** They have different verification (live database
   read-back vs. `dom` tests), different rollback, and the migration half needs the chunked-apply
   workaround this machine's ~1400-byte MTU ceiling forces.
4. **Bank the live-database work.** A full DB-tier run burns Supabase's per-IP anonymous sign-in
   quota for ~an hour. Everything that needs the real database should be verified in **one sitting**,
   not spread across days — so batch 6 is deliberately the only DB batch.
5. **Anything whose benefit can't be measured locally goes alone**, so it can be reverted alone.
   `next build` stalls here, so no bundle-size claim can be checked before deploy (§1.4).
6. **A "decide" item is not a "code" item.** Never put one in a prompt with code — the model will
   implement rather than ask, and the decision goes unmade. Those are listed last, on their own.
7. **Ask for the test to fail first.** §2.6 made this the repo convention and there is now a tier
   that can honour it. Any batch touching a component should say so explicitly in the prompt.

### The batches, in order

| # | Items | Why together | Verify with | Est. |
|---|---|---|---|---|
| **1** ✅ | **P1**, **P3**, §3.11 `SESSION_SECRET`, §5.3 User-Agent | Four text edits, zero runtime behaviour, nothing can regress. P1 and §3.11 genuinely interact — the restored `.env.example` must **not** reintroduce `SESSION_SECRET` — which is the argument for doing them in one prompt rather than four | `tsc` + `lint` + `npm test` unchanged; `cp .env.example .env` works from a clean checkout | S |
| **2** ✅ | §0.4 + §0.6 | One bug from both ends, one shared constant (`MAX_GUESSES`), one file apart. Splitting them risks fixing the display and leaving the merge to re-truncate | static tier; add a unit test for the merge against a 5-bucket server row | S |
| **3** ✅ | §4.7's `aria-autocomplete` + Home/End + ArrowUp-to-open + Escape's `preventDefault` | All four are the same `handleKeyDown` and the same input element in one component, and `PoolSelect` already implements all four — the prompt is "make these match, with the same tests" | `dom` tier, written to fail first (copy `PoolSelect.test.tsx`'s shape) | M |
| **4** ✅ | §4.5 `InfoTopBar` roles + §4.7 tile `title` attributes | Both are markup-only a11y with no logic, both assertable as attribute presence. **Include the decision in the prompt** for `InfoTopBar` — "drop the three roles" is the recommendation, not "implement the handlers" | `dom` tier | S |
| **5** ✅ | §3.4 residual (`round_end` + `match_end`) | **Alone.** The riskiest change in the list: it touches the live duel path, and §0.2 is the worked example to point the prompt at. Both handlers together because they're the same trust decision — splitting would leave the codebase claiming a rule it half-follows | reasoning + a two-session manual duel; the `dom` tier can't drive Realtime | L |
| **6** ✅ | §3.9 pool validation. ~~**plus** §0.6's 0007-0016 backfill if batch 2 decided to do it~~ — **batch 2 decided not to**: the rows self-heal on write and are normalised on read, so the migration has nothing left to do | **The only DB batch.** One migration, applied chunked, read back from `pg_get_functiondef`, plus a third site added to `poolWindow.sqlParity.test.ts`. Bank every live-database verification here | DB tier in one sitting; `schemaGrants.test.ts` if any grant moves | M |
| **7** ✅ | §1.7's `InfiniteGame` `.reduce()` + `Toast` cleanup | Two trivial hygiene items, no behaviour change, no test can see the difference — which is exactly why they belong in the same throwaway prompt rather than each getting a pass | static tier unchanged | S |
| **8** ✅ | §1.4 `flag-icons` subset | **Alone.** A visible-feature tradeoff whose benefit can't be measured on this machine, so it must be revertable on its own. The prompt should name `COUNTRY_CODES` as the source of the subset and `flags.test.ts` as the thing that pins it | `dom` tier for a rendered flag; deploy to measure | M |
| **9** ✅ | §1.1 context split | **Alone.** 10 consumer files, and the failure mode (a consumer reading a stale half) is silent. Point the prompt at `identityStatus`/`status` as the existing seam | `dom` tier: a consumer of `userId` must not re-render on a `stats` change | L |
| **10** | §3.0 CSP, `Report-Only` first | **Alone**, and it is infrastructure rather than a fix — it needs a deployed environment and a week of report collection before enforcement. Don't start it in the same week as batch 5 | deploy + reports | L |

#### Batch 1 — done 2026-07-30

Four files touched, all text, no runtime behaviour changed:

| Item | File | Change |
|---|---|---|
| **P1** | `.env.example` | restored from `122b8d2`, unmodified; already un-ignored by `.gitignore:35` |
| **P3** | `CLAUDE.md:440` | the "deliberately no lint step" sentence replaced with the adopted scope |
| **§3.11** | `.env` (untracked) | `SESSION_SECRET` removed; **Vercel's copy is still to delete** |
| **§5.3** | `lib/news/fetchNews.ts:43` | User-Agent contact URL → `https://driver-pit.vercel.app`, with a comment saying why it must be ours |

Verification, matching the row's *Verify with* column exactly: `npm run typecheck` clean,
`npm run lint` clean, `npm test` **250 passed / 137 skipped / 35 files** — identical to the
baseline in *Verification notes* below, which is the point (this batch was chosen because nothing
in it can move that number). `cp .env.example .env` was then run from a scratch directory and the
result parsed back through `dotenv`: five keys, no `SESSION_SECRET`.

The one surprise is recorded in §3.11's own note: PowerShell 5.1 wrote a UTF-8 **BOM** into `.env`,
which `dotenv` does not strip, and the first variable would have parsed as `﻿DATABASE_URL`. It was
caught because the check was "parse the file back", not "read the diff" — worth keeping as the
verification shape for any future dotfile edit on this machine.

#### Batch 2 — done 2026-07-30

One new module, five call sites, two new test files:

| Item | File | Change |
|---|---|---|
| **new** | `lib/stats/guessDistribution.ts` | `emptyDistribution` / `normalizeDistribution` / `mergeDistributions` — one definition of "a distribution is `MAX_GUESSES` buckets", total against jsonb |
| **§0.4** | `lib/stats/actions.ts` | merge built from `MAX_GUESSES`, not from the receiver's length; `resetUserStats` reads the same helper, so the file no longer imports `MAX_GUESSES` |
| **§0.6** | `components/settings/StatisticsSection.tsx` | hardcoded `[0,0,0,0,0]` → `emptyDistribution()` |
| **§0.6** | `components/auth/AuthProvider.tsx` | `toUserStats` normalises on read, beside the streak decay and for the same reason |
| **§0.6 third piece** | `lib/stats/recordDailyResult.ts` | normalises on write, so legacy rows heal on *any* next result — not only a 6-guess win |
| test | `lib/stats/guessDistribution.test.ts` | 16 cases incl. the merge against a 5-bucket server row |
| test | `components/settings/StatisticsSection.test.tsx` | 3 cases; first settings component test |

`npm run typecheck` clean, `npm run lint` clean, `npm test` **272 passed / 137 skipped / 23 files**
— up from batch 1's 250/137/21, with the 137 skipped (the DB tier, **P2**) deliberately unmoved.

**Both fixes were checked to fail first**, per §2.6's convention: the pre-fix merge expression
returns five buckets and drops the legacy player's four 6-guess wins, and reverting
`StatisticsSection`'s fallback renders `["1","2","3","4","5"]`. The second was run, not reasoned
about — the temporary revert is what produced that string.

Worth recording because it is the argument for the `dom` tier in miniature: the component test's
**first** version failed against the *fixed* code, because its selector matched both spans in each
bar row. The component was right and the test was wrong — which no amount of reading either file
would have revealed.

#### Batch 4 — done 2026-07-31

Three components, one new test file, both items markup-only as the row promised:

| Item | File | Change |
|---|---|---|
| **§4.5** | `components/layout/InfoTopBar.tsx` | `role="combobox"`/`listbox`/`option` + `aria-haspopup` + `aria-selected` dropped; `aria-controls` on the trigger, `aria-current="page"` on the active `<Link>`. Plus focus restored to the trigger on Escape — see the finding for why that is part of the same fix and not scope creep |
| **§4.7** | `components/game/GuessGrid.tsx` | `Tile` gains an optional `title`, rendered on the value **span** (inside `role="img"`) so it can't become the tile's accessible description; `GuessRow` passes it for `nationality` + `team` only |
| **§4.7** | `components/duel/DuelIntermission.tsx` | same two columns on the reveal row |
| test | `components/layout/InfoTopBar.test.tsx` | 4 cases, new file |
| test | `components/game/GuessGrid.test.tsx` | +2 cases on the existing file |

`npm run typecheck` clean, `npm run lint` clean, `npm test` **285 passed / 137 skipped / 38 files**
— up 6 from batch 3's 279, with the 137 skipped (the DB tier, **P2**) deliberately unmoved.

**All six new tests were checked to fail first**, and the check was run rather than reasoned about:
the three component files were stashed by pathspec (leaving the tests in place) and the suite
re-run, which produced exactly 6 failed / 8 passed — the 8 being `GuessGrid.test.tsx`'s pre-existing
§4.1 cases, which must *not* move.

Two things the batch produced that the prompt didn't ask for, both recorded in the findings above
rather than only here: the `title`-on-the-span placement (a `title` beside an `aria-label` becomes
an accessible description, so the naive placement would have made every tile say its value twice and
quietly regressed §4.1), and the honest limit that `title` has no touch affordance — so §4.7's
"clipping at 320px" is *recoverable* now, not *solved*.

#### Batch 5 — done 2026-07-31

One migration, one new client module, two handlers, one new DB-tier test file:

| Item | File | Change |
|---|---|---|
| §3.4 res. | `drizzle/0050_duel_round_reveal.sql` | **new** `duel_round_reveal(match_id, round_index)` — read-only, `STABLE`, `SECURITY DEFINER`, `auth.uid()` participant check. Discloses the target/points/scores/intermission clock only once `duel_rounds.intermission_ends_at` is stamped; match-level columns (status, winner, deltas) on both branches. Grants: `REVOKE … FROM PUBLIC, anon` + `GRANT … TO authenticated` |
| §3.4 res. | `lib/duel/roundReveal.ts` | **new** browser one-hop wrapper, `{ ok, closed }` discriminated union so the un-closed case can't be read as a reveal |
| §3.4 res. | `components/duel/useDuelLifecycle.ts` | `onRoundEnd` → `verifyRoundEnd(payload.roundIndex)`; `onMatchEnd` → `verifyMatchEnd()` (takes no payload at all). New `roundEndVerifyRef` de-dupes repeat broadcasts and is reset on a rematch, where round indices restart at 0 |
| §3.4 res. | `lib/duel/realtimeEvents.ts`, `lib/duel/useDuelChannel.ts` | the trust rule stated where the payloads and the transport are defined; the channel header's *"round_end's payload is authoritative as-is"* claim corrected |
| docs | `CLAUDE.md` | the "private channel narrows but does not empty the attacker set" paragraph, and `duel_round_reveal` added to the RPC list with why it is a read and not a wrapper |
| test | `lib/duel/roundReveal.test.ts` | **new**, 4 cases, DB tier |
| policy | `lib/db/schemaGrants.test.ts` | the new function's grant decision, as CLAUDE.md requires of every new function |

`npm run typecheck` clean, `npm run lint` clean, `npm test` **285 passed / 141 skipped / 39 files** —
passing count deliberately unmoved from batch 4, the +4 skipped being this batch's own DB-tier file.
With the database: `roundReveal.test.ts` **4/4**, `schemaGrants.test.ts` **12/12**.

Two things worth carrying forward. **The prompt's premise was wrong again, and in the most useful
way yet**: `duel_close_round_client` cannot serve as the re-verification target, because its
already-closed branch — the only branch a receiving client can reach — returns NULL for every reveal
column *by design*. Three batches in a row have now amended their premise; that keeps being the
signal that the batch was small enough to check. **And this batch broke rule 3** (never mix a
migration with client-side work) because the fix needs a server-side read that did not exist. It is a
*new* function rather than an edit to a live one, so nothing that scores a duel moved and the
rollback is a `DROP FUNCTION` — but the rule was broken knowingly, and the migration went in with
the chunked-`EXECUTE` workaround after `db:migrate` failed the usual silent MTU way.

**One verification is still owed: the two-session manual duel** the batch row asks for. Everything
above is reasoning plus live-database evidence; nothing here has watched two browsers play three
rounds through the new path. The specific things to watch are the intermission appearing on the
*non-closing* client (that is the whole changed path), the reveal being the right driver, and the
last round's winner + rating delta filling in.

#### Batch 6 — done 2026-07-31

One migration, one parity site, two DB-tier fixture repairs — and the fixtures were most of it:

| Item | File | Change |
|---|---|---|
| §3.9 res. | `drizzle/0051_daily_guess_pool_validation.sql` | **new**. `daily_submit_guess` declares `v_pool_cutoff_year constant integer := extract(year FROM v_today)::int - 10` and rejects a guess below it, before `daily_progress` is inserted or locked. Body otherwise 0049's verbatim (`CREATE OR REPLACE` has no partial form); signature unchanged, so the ACL carries over |
| §3.9 res. | `lib/game/poolWindow.sqlParity.test.ts` | the fourth plpgsql copy of the cutoff, pinned the same way `duel_begin_round`'s is — extracted from `pg_get_functiondef()` and executed, with `v_today` substituted by a literal date so the assertion is timezone-proof |
| §3.9 res. | `lib/db/dailyRpc.test.ts` | fixtures moved into the pool (`ORDER BY id LIMIT 6` was picking 1950s privateers), plus the behavioural case: an out-of-pool guess is refused, the board still shows zero guesses and `MAX_GUESSES` remaining, and the in-pool driver beside it is still accepted |
| §3.9 res. | `lib/db/winByIdentity.test.ts` | the daily doppelgänger is now a rewritten **existing** pool driver, restored in `afterAll`, instead of an inserted out-of-pool row — see the finding for why the old trick and this check are mutually exclusive |
| **pre-existing red** | `lib/db/winByIdentity.test.ts` | twin fixtures' `debut_year` 1961 → 1959. drizzle/0047's `drivers_season_order_check` had been failing that insert in `beforeAll`, so **all six cases in the file were unrun** — found only by running the tier |
| docs | `CLAUDE.md` | "guess *validation* only checks the driver exists" corrected (it was the sentence this fix invalidates); the cutoff's mirror list goes three sites → four; the RPC list names the new rejection |

`npm run typecheck` clean, `npm run lint` clean, `npm test` **285 passed / 143 skipped / 39 files** —
passing count deliberately unmoved from batch 5, the +2 skipped being this batch's two new DB-tier
cases.

With the database, per the row's *Verify with* column: drizzle/0051 applied chunked, then
`pg_get_functiondef` and `pg_proc.proacl` read back (`authenticated=X`, no `anon`, no `PUBLIC` —
unchanged, as `CREATE OR REPLACE` promises). Suites re-run against it: `poolWindow.sqlParity` **8/8**,
`schemaGrants` **12/12**, `dailyRpc` **8/8**, `winByIdentity` **6/6**, `compare.sqlParity` +
`duelScoring.sqlParity` + `duelRealtimeAuthorization` **32/32**, `driversRosterIntegrity` **18/19**.

**The one non-green needs stating plainly, and it is the tier's own constraint rather than this
change**: Supabase rate-limits anonymous sign-ins per IP, and a full-tier run exhausts the hourly
quota — so `driversRosterIntegrity`'s single failure is `signInAnonymously` returning **429**, and
the five suites not listed above (`dailyInfiniteRpc`, `dailyTargetSecrecy`, `duelRpc`,
`duelMatchmakingIntegrity`, `serverAuthoritativeWrites`, plus `duel/submitGuess` and
`duel/roundReveal`) could not be re-run in the same sitting for the same reason. None of them calls
`daily_submit_guess`; the two that touch daily at all (`dailyTargetSecrecy`,
`serverAuthoritativeWrites`) go through `daily_target_id` and `daily_progress` directly, neither of
which this migration changes. **This is exactly the argument for P2** — CI runs the tier from a
different IP, once, on a push.

Worth carrying forward: the batching rules say *never mix a migration with client-side work*, and
this batch honoured it — but the fixture repairs were not foreseen by the row, and they were **more
than half the diff**. A guard that narrows what the server accepts will invalidate any fixture built
on the old width, and DB-tier fixtures are exactly where "any driver will do" gets written down.

#### Batch 7 — done 2026-07-31

Two hygiene items, no behaviour change, exactly as the row said — `npm run typecheck` clean,
`npm run lint` clean, `npm test` unmoved at **285 / 143 / 39**. Both are written up in §1.7 above:
`Toast`'s timers are tracked in a `Set` and cleared on unmount, and `InfiniteGame`'s five
`.filter().length` passes over the roster became one `.reduce()`. The row's own claim — *"no test can
see the difference"* — held: nothing in either tier moved, which is the whole reason these two shared
a prompt rather than each getting a pass.

#### Batch 8 — done 2026-08-01

| Item | File | Change |
|---|---|---|
| new | `scripts/flagSubset.ts` | pure + fs helpers: extract upstream's base rules, assert upstream still ships each mapped country, emit the subset |
| new | `scripts/generateFlagSubset.ts` | the write half — `npm run flags:subset` |
| new | `app/flag-icons.subset.css` | **generated**, 4,697 bytes, 40 countries, checked in |
| **§1.4** | `app/globals.css:2` | `@import "flag-icons/css/flag-icons.min.css"` → `@import "./flag-icons.subset.css"` |
| test | `scripts/flagSubset.test.ts` | 13 node-tier cases; regenerates and diffs the checked-in file |
| test | `components/ui/Flag.test.tsx` | 4 dom-tier cases; every mapped nationality's emitted class is one the subset defines |

**Measured on a fresh `.next` before and after, same dev server, same chunk:**

| | globals chunk | gzip | country rules | flag SVGs emitted |
|---|---|---|---|---|
| before | 91,717 B | 15,247 B | 542 (36,486 B) | 542 / 5.1 MB |
| after | 57,790 B | 8,958 B | **40** (2,600 B) | **40 / 211 KB** |

The row said *"deploy to measure"* because `next build` stalls here (§2.6). It didn't need one:
`next dev` compiles the same CSS through the same turbopack pipeline, and both halves of the claim —
the stylesheet and the emitted assets — are readable off a cleared `.next`. `/daily`, `/infinite`,
`/online`, `/about` and `/faq` all 200, and `/_next/static/media/gb.58677b3a.svg` serves 504 bytes at
the **same content hash it had before the change**, which is the actual proof that the rewritten
`url()`s resolve to the same files.

**Three things the prescription didn't anticipate:**

- **"`flags.test.ts` already pins that map's contents" is true and not the pin that was needed.**
  That file pins the map's *shape*; what a generated stylesheet needs pinned is that it still matches
  the map — a different claim, and the one whose failure is silent. `scripts/flagSubset.test.ts`
  regenerates and diffs, which covers both drift directions at once (a nationality added to
  `COUNTRY_CODES`; a bumped `flag-icons`). Confirmed to fail first, both ways: deleting `.fi-gb`
  from the subset and adding `Norway: "no"` to `COUNTRY_CODES` each fail four tests, and the dom one
  names the nationality.
- **The subset introduces a new untyped seam, so the `dom` test isn't optional.** `Flag` builds its
  class as `` `fi fi-${code}` `` — a template string nothing type-checks — and the stylesheet is now
  the only thing that can back it. `Flag.test.tsx` renders all 40 nationalities and checks each
  emitted class against the generated file. jsdom applies no CSS, so the sheet is read off disk;
  that is the honest form of "a `dom` tier for a rendered flag".
- **The subset is by country *and* by aspect ratio, which is a judgement the row didn't make.**
  `Flag` renders `fi fi-<code>`; nothing in the repo uses flag-icons' `fis` (square) or `fib` (box)
  variants. Emitting their rules would have doubled the assets for nothing, but keeping upstream's
  `.fi.fis { width: 1em }` while dropping the rules behind it would leave a class that renders a
  letterboxed 4x3 flag. So the variant *selectors* are dropped too — mechanically, by the generator,
  not by hand-editing vendor CSS, so an upstream restructure still surfaces as a diff. The base rules
  are otherwise extracted verbatim, and the generator hard-fails if they stop styling a bare `.fi`.

`npm run typecheck` clean, `npm run lint` clean, `npm test` **302 passed / 143 skipped / 41 files**
(+17 tests, +2 files over batch 7's 285 / 143 / 39). Two follow-ons worth knowing: the generated file
is the first checked-in build artifact in the tree, so **`npm run flags:subset` is now part of
changing `COUNTRY_CODES`** (CI enforces it, and CLAUDE.md says so beside §5.2c); and `flag-icons`
stays a runtime `dependency` rather than a devDependency, because the subset still points `url()`s
into `node_modules/flag-icons/flags/4x3/` and the build needs the SVGs there.

#### Batch 9 — done 2026-08-01

| Item | File | Change |
|---|---|---|
| **§1.1** | `components/auth/AuthProvider.tsx` | one context → `AuthIdentityContext` + `AuthAccountContext`, two memos, new `useAuthIdentity()`; `useAuth()` unchanged in shape |
| **§1.1** | `app/(game)/daily/DailyGame.tsx` | both call sites → `useAuthIdentity()` |
| **§1.1** | `components/settings/GeneralSection.tsx` | → `useAuthIdentity()` (it only ever wanted `refresh`) |
| test | `components/auth/AuthProvider.test.tsx` | 3 dom-tier cases against a real provider over a fake supabase client |
| doc | `CLAUDE.md` | the split, the seam, and the two rules that keep it working |

**Measured, which is the only way this finding is visible at all.** The `dom` test counts renders of
a consumer that reads `userId` while a second consumer reads `stats`, then fires `refresh()` — the
call `DailyBoard` makes on the completing guess. Against a probe that reproduces the pre-split
subscription (`useAuthIdentity` reading both contexts) the identity consumer re-renders **2×**;
after the split, **0**. That 2 is the finding in one number: nothing in `tsc`, in `lint`, or in any
pure test can see it, and it is invisible in the source too — the pre-fix `useMemo` was *correct*,
it just had the wrong membership.

**Three things worth recording:**

- **The prescription's stated failure mode doesn't exist, and the real hazard is elsewhere.** The row
  says *"a consumer reading a stale half"*. It can't happen: both values are computed in the same
  render of the same provider from the same state, so they can never describe different moments. What
  a future change *can* silently do is put an object-valued field back on the identity side — one
  `user` or `session` and the identity value churns on every `getSession()`, restoring the exact
  behaviour this closed, with nothing failing. So the identity value is **primitives and stable
  callbacks only**, said in the type's comment, in CLAUDE.md, and enforced by the test.
- **That is also why the fake `getSession()` returns a fresh object every call.** supabase-js
  re-reads and `JSON.parse`s the persisted session, so `user`/`session` come back with new identities
  after every refresh even when the account is unchanged — which is what forced them onto the account
  side. A fake returning one frozen object would have let the regression above pass silently, so the
  fake mirrors the real behaviour rather than the convenient one.
- **"10 consumer files" overstates the work.** There are 9 files / 10 call sites, and only **3** are
  identity-only (`DailyGame`, `DailyBoard`, `GeneralSection`). The other 7 read `profile`/`stats` and
  correctly stay on `useAuth()`. Keeping `useAuth()` returning the merged object — rather than
  splitting every consumer — is what made this a small diff; it also keeps the merged result
  memoized, so a consumer holding the whole object in a dependency array behaves as it did before.

`npm run typecheck` clean, `npm run lint` clean, `npm test` **305 passed / 143 skipped / 42 files**
(+3 tests, +1 file over batch 8's 302 / 143 / 41; the baseline was re-run with this file excluded to
confirm nothing else moved). Not verified in a real browser — jsdom render counts are the honest
measure of a subscription boundary, but they say nothing about paint.

### Do not put these in a prompt yet — they need a decision, not code

Each is one question. Answer it, write the answer into CLAUDE.md, and only then (if the answer is
"change something") schedule a batch:

- **§3.5** — is "four independent layers" prose to soften, or do you want a genuine server-side
  signal? Softening is free and honest; the alternative is real work.
- **§3.6** — accept non-unique display names as correct product behaviour? Recommendation: yes, and
  close it with one sentence in CLAUDE.md rather than a constraint.
- **§3.9 rate limiting** — needs a strategy (Supabase-side limits vs. a per-user cooldown column)
  before any code makes sense.
- **§1.4 `RealtimeClient`** — moving `AuthProvider` out of the root layout changes where every
  route's auth boundary sits. That is an architecture call, not a bundle tweak.
- **§3.1** and **§5.3's shuffle** — recommendation: **won't fix**, both already ratcheted or inert.
  Recording the decision is the close.
- **§1.7's `useLightsCountdown`** — leave it. It is latent, documented at the call site, and its
  real resolution is tied to whether react-hooks v7's Compiler preset is ever adopted (§0.5 measured
  it at 30 violations and rejected it).

### Rough shape of the whole thing

Batches 1, 2, 4 and 7 are an afternoon between them — they are 11 of the 19 items and none needs a
database, a browser or a decision. Batch 3 is the first one worth doing carefully. **Batch 5 is the
only one that genuinely deserves a nervous review**, and batches 8-10 are each a project with its
own justification. If time is short, do 1 → 2 → 3 → 5 and stop: that clears every process item, both
stats bugs, the live a11y gaps and the last real security residual, and everything left is either
accepted, deferred with a reason, or infrastructure.

**Progress: batches 1 and 2 done** (2026-07-30); **batches 3, 4, 5, 6 and 7 done** (2026-07-31);
**batches 8 and 9 done** (2026-08-01).
That is the whole "afternoon" group, plus the one this note called the first worth doing carefully,
the one it called the only one deserving a nervous review, and the only DB batch — so the "if time
is short, do 1 → 2 → 3 → 5 and stop" line above is more than satisfied: every process item that can
be closed in this tree is closed, both stats bugs, the live a11y gaps, the last real security
residual, and §3.9's pool validation. With §4.5 closed and §4.7 down to its dropdown-direction third,
the UX & a11y section is one LOW item; §1.7 is down to a recorded *leave it*. Batches 8 and 9 then
took **two of the three "projects"**, and neither needed the deployed environment its row assumed:
batch 8's CSS claim is countable off a cleared `.next` (`next dev` compiles through the same
pipeline), and batch 9's is a `dom`-tier render count. That prediction is now confirmed rather than
guessed — **only batch 10 (the CSP) genuinely needs a deploy**. **Everything left is that one
project, P2, and the accepted/deferred set** — nothing small remains.

Batches 3, 4, 5, 6, 8 and 9 all ended with the prompt's premise amended rather than executed —
Home/End were *not* made to match `PoolSelect` (batch 3), `InfoTopBar`'s roles were dropped rather
than implemented (batch 4, as the row recommended), `duel_close_round_client` turned out to be
unusable as batch 5's re-verification target, and batch 6's one-line predicate turned out to be
**less than half the change**, the rest being two DB-tier suites whose fixtures were built on the
width the guard removes. Batch 8 amended two: the named pin (`flags.test.ts`) was the wrong pin, and
the verification (`deploy to measure`) turned out to be unnecessary. Batch 9 amended the *risk*: its
stated failure mode (a consumer reading a stale half) cannot occur, while the real hazard — an
object-valued field creeping back onto the identity side — is one the row never named, and is now
what the test and CLAUDE.md guard. All six divergences are written down as decisions with tests
behind them. Worth noting as a pattern: the batching rules produce prompts small enough that the
premise is checkable, which is most of what makes them work — and six in a row now says the premise
being wrong is the *normal* outcome, not the exception.

Two things neither batch could touch: **P2**, which needs a human with the Actions tab open and the
three repository secrets set — still the item gating five other fixes — and §3.11's Vercel-side
variable.

---

## Verification notes

- `npx tsc --noEmit` — **clean**.
- `npm run lint` — **clean**. 15 `eslint-disable` comments tree-wide, all of which suppress
  something real (`reportUnusedDisableDirectives: "error"` guarantees it).
- `npx vitest run` — **250 passed, 137 skipped, 35 files** (21 passed, 14 skipped). The 14 skipped
  files are the `RUN_DB_INTEGRATION_TESTS=1` tier; this is the number **P2** is about.
- `git` — `HEAD = 018551b`, tree clean, `main` level with `origin/main`.
- **Not run:** the DB integration tier, `next build`, and any browser. Every claim above about the
  live database's grants, constraints or function bodies is inherited from the previous audits'
  verification; claims about SQL here are claims about the text in `drizzle/`. *Batches 5 and 6 are
  the exceptions since: drizzle/0050 and drizzle/0051 were both applied to the live database and read
  back from the catalogue, and batch 6 ran most of the tier against it — `poolWindow.sqlParity`,
  `schemaGrants`, `dailyRpc`, `winByIdentity`, `compare.sqlParity`, `duelScoring.sqlParity`,
  `duelRealtimeAuthorization` all green, `driversRosterIntegrity` 18/19 with the one failure being a
  429 from Supabase's anonymous sign-in limit. The remaining seven files could not be run in the same
  sitting for that same reason, and no browser has been opened. **A full local pass of this tier
  exhausts the hourly per-IP quota, which is why the batching rules bank the DB work into one
  sitting — and why P2 matters: CI runs it from a fresh IP, once, per push.***
- Each open item was re-read at the line cited today — none is carried over on the strength of the
  earlier audit's wording. Three were **downgraded in the writing** because the tree had moved
  underneath them: §1.1 (the `memo()` and `GuessGrid`'s memoization absorb part of the cost),
  §3.4's residual (private channel ⇒ opponent-trust, not internet-trust), and §4.7's Escape item
  (latent, since nothing currently composes an autocomplete inside a `Modal`). *The Escape item was
  fixed anyway on 2026-07-31, and the composition it needs to be non-latent now exists in
  `DriverAutocomplete.test.tsx` even though it still doesn't exist in the app.*
