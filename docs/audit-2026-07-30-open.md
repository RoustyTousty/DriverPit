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

> **Batches 1 and 2 landed 2026-07-30.** Closed so far: **P1**, **P3**, §3.11's `SESSION_SECRET`,
> §5.3's User-Agent, **§0.4**, **§0.6** — and §0.6's third piece (the 0007-0016 rows), which was
> closed in code rather than with the migration batch 6 was holding for it. Each carries a **Fixed
> 2026-07-30** note in its own section. §3.11 keeps one residual that is not in this tree (delete the
> variable from Vercel's environment too). The table below is as-written on the audit date; the
> *Open now* column is the state after those two batches.

| Area | Open (as audited) | Open now | Severity spread |
|---|---|---|---|
| Process | 3 | **1** | P2 only — MED; P1 + P3 closed |
| Performance & efficiency | 4 | 4 | 3 MED, 1 LOW |
| Security & data integrity | 7 | **6** | 1 MED-real, 4 accepted/hygiene, 1 doc-accuracy; §3.11 closed in-tree, deployment residual only |
| Stats correctness | 2 | **0** | §0.4 + §0.6 both closed, with a fails-first test each |
| UX & a11y | 2 | 2 | 1 MED, 1 LOW |
| F1 data | 1 | **0** | §5.3's User-Agent closed; the biased shuffle stays INFO / won't-fix |

**19 items as audited; 13 open now**, plus §3.11's deployment-side residual. None is blocked on a
decision — audit #2 closed its own to-do list, including all
three standing decisions (component tests, ESLint, `db:seed` failing closed). What remains is
either small, deliberately accepted, or genuinely deferred with a stated reason.

Nothing here is HIGH. The two HIGHs audit #2 found (§0.1, §0.2) and the three the first audit found
are all closed and re-verified above. **The sharpest remaining item is a process one (P1), and the
sharpest code one is §3.4's residual.**

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

### §1.1 residual — the two-context split — MED

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

### §1.4 residual — `flag-icons` on every route — MED

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

### §1.7 Smaller items — LOW — all three still open

- [Toast.tsx:38,45](../components/ui/Toast.tsx#L38-L45) — two `setTimeout`s, no stored handle, no
  cleanup. Cosmetic: React 19 no-ops the unmounted `setState` and the provider is app-root, so
  nothing leaks in practice.
- [InfiniteGame.tsx:45-58](../app/%28game%29/infinite/InfiniteGame.tsx#L45-L58) — the `poolDrivers`
  filter plus one `.filter().length` per pool window, i.e. **five passes over the 792-row array**
  where one `.reduce()` bucketing by `lastActiveYear` would do. Correctly `useMemo`'d on
  `allDrivers`, so it runs once per mount, not per render. This is the cheapest of the three.
- [useLightsCountdown.ts:134,145](../components/duel/useLightsCountdown.ts#L134-L145) — `Date.now()`
  read in the render body, so the component is non-idempotent under StrictMode's double-render.
  Latent, not a bug, and the file says so at :38. Noted here because §0.5 measured react-hooks v7's
  Compiler preset flagging exactly this pattern at 30 sites — if that preset is ever revisited, this
  is one of the things it will be arguing about.

---

## 3. Security & data integrity — 7 items

### §3.4 residual — `round_end` and `match_end` are still applied as sent — MED

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

### §3.9 residual — no pool validation on daily guesses — LOW

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

`DriverAutocomplete` got the duplicate-guess withholding (§3.9) and `PoolSelect` got its keyboard
model (§4.5), but three things named in §4.7 are untouched:

- **Escape doesn't `preventDefault`/`stopPropagation`**
  ([DriverAutocomplete.tsx:112-114](../components/game/DriverAutocomplete.tsx#L112-L114) —
  `setIsOpen(false)` and nothing else), so inside a `Modal` it bubbles and closes the modal as well
  as the dropdown. **Latent today**, and worth stating precisely rather than inheriting the original
  wording: no `Modal` currently contains a `DriverAutocomplete` (the five `<Modal>` sites are the
  share modal, the duel exit confirm, and the three settings/leaderboard surfaces), so nothing
  composes them yet. It costs one line to make safe before something does.
- **Three keyboard/ARIA gaps in the same handler**, and these are live, not latent: no
  `aria-autocomplete="list"` on the input ([:126-150](../components/game/DriverAutocomplete.tsx#L126-L150)
  — `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant` are all there,
  so this is the one missing attribute of the set); no Home/End; and **ArrowUp doesn't open a closed
  list** ([:103-106](../components/game/DriverAutocomplete.tsx#L103-L106) returns early when there
  are no matches, where ArrowDown at [:92-97](../components/game/DriverAutocomplete.tsx#L92-L97)
  opens first). `PoolSelect` implements all of this now, and `PoolSelect.test.tsx` shows what
  pinning it looks like — the two components have drifted apart in the direction that reads as
  correct and isn't, exactly as §4.5 said of `InfoTopBar`.
- **The dropdown opens downward only** ([:158](../components/game/DriverAutocomplete.tsx#L158) —
  `absolute z-10 mt-1 w-full`, list `max-h-64`), with no flip-up and no collision detection, in the
  one mode where guessing speed is scored.
- **Tile clipping at 320 px with no recovery** — `grep title=` across
  [GuessGrid.tsx](../components/game/GuessGrid.tsx), `Tile.tsx` and
  [DuelIntermission.tsx](../components/duel/DuelIntermission.tsx) returns **nothing**, so "Scuderia
  AlphaTauri" still `line-clamp-2`s with no `title` to recover the value. §4.1's `aria-label` means
  the value now exists *in speech*, which helps a screen-reader user and does nothing for a sighted
  user on a small phone.

### §4.5 residual — `InfoTopBar` makes an ARIA promise it doesn't implement — LOW

[InfoTopBar.tsx:86,110,117](../components/layout/InfoTopBar.tsx#L86) still sets `role="combobox"` /
`role="listbox"` / `role="option"` with **no `onKeyDown`, no `tabIndex`, no
`aria-activedescendant`** — those three greps return nothing in that file, confirmed today. Lower
severity than `PoolSelect` was, because its options are `<Link>`s and therefore genuinely tabbable,
so the menu *is* operable. But the roles describe an interaction it doesn't implement, and it was
copied from `PoolSelect`'s markup — which now has the handlers. Either implement the handlers (the
`PoolSelect` fix, one component over, for the third time) or drop the three roles and let it be the
nav menu it actually is. **Dropping the roles is probably right here** — a list of links doesn't
need to be a combobox.

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
   against a scratch project.** `build` has never executed anywhere. Until the secrets exist, 14
   test files — every parity, grant, RPC and matchmaking suite — skip on every run, which is the gap
   §2.6 spent two audits arguing about, still open at the last step.
3. **§3.4 residual — re-verify `round_end`/`match_end` instead of applying the payload.** The
   largest remaining code-level hole in the duel. The pattern is already written: §0.2 did exactly
   this for `round_start` via the idempotent `duel_begin_round_client`, and `duel_close_round_client`
   is its counterpart here.
4. ✅ **§0.4 + §0.6 together — one `Array.from`, one `Array(MAX_GUESSES).fill(0)`.** — **done
   2026-07-30**, as one shared `lib/stats/guessDistribution.ts` rather than two inline expressions,
   with a fails-first test on each end and the 0007-0016 rows self-healing on write. Two lines, one
   bug, and it removes the last hardcoded copy of the guess count outside SQL.
5. **§4.7's keyboard/ARIA gaps in `DriverAutocomplete`** (`aria-autocomplete`, Home/End,
   ArrowUp-to-open, Escape's `preventDefault`). `PoolSelect` already implements all four and
   `PoolSelect.test.tsx` shows how to pin them in the `dom` tier — so this is the first item in
   either audit that can be *closed with a test that fails first*, which is the convention §2.6 just
   established.

**Runners-up, in rough order:** §1.4's `flag-icons` subset; §3.9's pool validation on
`daily_submit_guess` (and a third site for `poolWindow.sqlParity.test.ts`); ~~P3's stale CLAUDE.md
sentence~~ ✅; §1.7's `.reduce()` in `InfiniteGame`; ~~§3.11's `SESSION_SECRET`~~ ✅ (in-tree);
~~§5.3's User-Agent~~ ✅; §4.5's `InfoTopBar` roles; §4.7's tile `title` attributes. Then the two that are real projects rather than
fixes: §3.0's site-wide CSP (`Report-Only` first) and §1.1's context split. §1.4's `RealtimeClient`
move, §3.5, §3.6 and §3.1 are all either accepted or need a decision about scope before they need
code.

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
| **3** | §4.7's `aria-autocomplete` + Home/End + ArrowUp-to-open + Escape's `preventDefault` | All four are the same `handleKeyDown` and the same input element in one component, and `PoolSelect` already implements all four — the prompt is "make these match, with the same tests" | `dom` tier, written to fail first (copy `PoolSelect.test.tsx`'s shape) | M |
| **4** | §4.5 `InfoTopBar` roles + §4.7 tile `title` attributes | Both are markup-only a11y with no logic, both assertable as attribute presence. **Include the decision in the prompt** for `InfoTopBar` — "drop the three roles" is the recommendation, not "implement the handlers" | `dom` tier | S |
| **5** | §3.4 residual (`round_end` + `match_end`) | **Alone.** The riskiest change in the list: it touches the live duel path, and §0.2 is the worked example to point the prompt at. Both handlers together because they're the same trust decision — splitting would leave the codebase claiming a rule it half-follows | reasoning + a two-session manual duel; the `dom` tier can't drive Realtime | L |
| **6** | §3.9 pool validation. ~~**plus** §0.6's 0007-0016 backfill if batch 2 decided to do it~~ — **batch 2 decided not to**: the rows self-heal on write and are normalised on read, so the migration has nothing left to do | **The only DB batch.** One migration, applied chunked, read back from `pg_get_functiondef`, plus a third site added to `poolWindow.sqlParity.test.ts`. Bank every live-database verification here | DB tier in one sitting; `schemaGrants.test.ts` if any grant moves | M |
| **7** | §1.7's `InfiniteGame` `.reduce()` + `Toast` cleanup | Two trivial hygiene items, no behaviour change, no test can see the difference — which is exactly why they belong in the same throwaway prompt rather than each getting a pass | static tier unchanged | S |
| **8** | §1.4 `flag-icons` subset | **Alone.** A visible-feature tradeoff whose benefit can't be measured on this machine, so it must be revertable on its own. The prompt should name `COUNTRY_CODES` as the source of the subset and `flags.test.ts` as the thing that pins it | `dom` tier for a rendered flag; deploy to measure | M |
| **9** | §1.1 context split | **Alone.** 10 consumer files, and the failure mode (a consumer reading a stale half) is silent. Point the prompt at `identityStatus`/`status` as the existing seam | `dom` tier: a consumer of `userId` must not re-render on a `stats` change | L |
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

**Progress: batches 1 and 2 done** (2026-07-30). Next by this ordering is **batch 3**
(`DriverAutocomplete`'s four keyboard/ARIA gaps) — the first one the note above calls "worth doing
carefully", and the first with a `PoolSelect` implementation to copy rather than a shape to invent.
Batch 6 shrank to one item on the way past, since §0.6's backfill turned out not to need a
migration.

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
  verification; claims about SQL here are claims about the text in `drizzle/`.
- Each open item was re-read at the line cited today — none is carried over on the strength of the
  earlier audit's wording. Three were **downgraded in the writing** because the tree had moved
  underneath them: §1.1 (the `memo()` and `GuessGrid`'s memoization absorb part of the cost),
  §3.4's residual (private channel ⇒ opponent-trust, not internet-trust), and §4.7's Escape item
  (latent, since nothing currently composes an autocomplete inside a `Modal`).
