# DriverPit

A daily Wordle-style web game presented as a full website. Players guess a Formula 1 driver in 6 guesses. Each guess reveals how the guessed driver compares to the target across five attributes.

**Built and working:** daily, infinite and duel modes; anonymous + email + Google accounts with guest upgrade; the sectioned settings modal and the global leaderboard; server-side daily progress that follows an account across devices; the warm one-hop RPC guess path in every mode; the real-time duel end to end (staging, lights-out countdown, live tug-of-war, intermission, results, rematch, forfeit/disconnect handling); RSS news; AdSense scaffolding behind consent. All of it sits in the full site shell (top bar, mode tabs, modals, marketing sections, ad slot, footer).

A fourth mode, **Knockout**, is planned but not yet built — it's documented here so the duel engine keeps the right seams. Do not change the comparison engine or the daily/infinite game logic unless a task explicitly says to.

## Game rules

Five attribute columns per guess, with the guessed driver's F1DB code shown alongside the row:

| Attribute   | Feedback                                |
|-------------|------------------------------------------|
| Nationality | exact / miss                            |
| Team        | exact / historical / miss               |
| Age         | correct / higher / lower (+ closeness)  |
| Debut year  | correct / higher / lower (+ closeness)  |
| Career wins | correct / higher / lower (+ closeness)  |

"higher" means the target's value is higher than the guess. "historical" (team only) means the guess isn't the target's current team but is one they've raced for at some point. A guess with **no** current team (`last_team` null, shown as "—") is always a team miss — an absent value is not one two drivers can share. "Closeness" is a 0-1 hint on the three numeric columns — the tile shades from grey toward full orange the nearer the guess was, squared falloff; see `lib/game/compare.ts`. 6 guesses max in daily/infinite (duel changes this — see Duel).

**A win is guessing the target driver — never "all five tiles came back exact/correct".** Those are not the same test: drivers aren't uniquely identified by these five attributes, and this roster holds six pairs that match on every one of them (François Mazet / Max Jean, three Kurtis Kraft pairs, …). All three modes used to decide the win from the tiles, so guessing one twin while the target was the other recorded a win and then revealed the other's name — and in duel it paid full speed points and real Elo. Every guess RPC now compares `p_guess_driver_id` against the round's/day's target id (drizzle/0044); `lib/game/compare.ts#isWin` is the same identity test, and `lib/db/winByIdentity.test.ts` pins all three against a fixture doppelgänger. The tiles are what the board *renders*; they never decide the outcome.

The comparison engine (`lib/game/compare.ts`) is pure and unit-tested — don't change its rules unless a task explicitly says to.

## Modes

- **Infinite** — random driver from a player-selectable pool, unlimited plays, no persistence beyond the current round. Round state lives server-side (`infinite_rounds`, keyed on the Supabase identity) so guesses evaluate over the same warm one-hop RPC path as daily/duel — see "Fast guess evaluation".
- **Daily** — one driver per day, same for everyone, resets at UTC midnight. Progress is **stored server-side per account and follows the user across devices** — the guesses themselves are persisted, not just the outcome. One playthrough per account per day, enforced by the server. See "Daily persistence & sync". Always the 10-year pool.
- **Duel** — real-time 1v1 race, matchmade against a random opponent. 3 rounds, tug-of-war scoring. See the Duel section.
- **Knockout** *(planned, not built)* — 20-player F1-qualifying-format elimination game, lives under `/online`. See the Knockout section.

## Driver pools

The `drivers` table holds every driver who has ever started a race. Which are offered as guess targets/suggestions is decided at query time by a **pool window** on each driver's `last_active_year`:

| Window | Tier name | Meaning |
|---|---|---|
| `current-season` | Amateur | `last_active_year >= this year` |
| `10-years` | Regular | `last_active_year >= this year - 10` |
| `20-years` | Professional | `last_active_year >= this year - 20` |
| `30-years` | Veteran | `last_active_year >= this year - 30` |
| `legacy` | Legend | everyone, no cutoff |

Defined in `lib/game/poolWindow.ts` (pure, shared by server queries and client filtering). Daily and Duel always use `10-years`. Infinite defaults to `10-years`; the player can switch, persisted in localStorage. Autocomplete suggestions are scoped to the active pool; guess *validation* only checks the driver exists, not pool membership.

**A driver already guessed this round isn't offered again — and in daily isn't accepted again.** A repeat guess returns the row the board is already showing and, in daily/infinite, burns one of six turns for it. `DriverAutocomplete` takes a `guessedDriverIds` set and withholds those drivers from the suggestions in all three modes, naming the one the query matched ("Lewis Hamilton — already guessed") rather than removing it silently — otherwise the dropdown says "no driver in this pool matches Hamilton", which is false and reads as a broken search. It withholds without rebuilding the search index (`partitionSearchIndex`, `lib/game/fuzzyMatch.ts`): filtering the `drivers` array instead would hand the component a new array identity per guess and re-fold ~800 names, undoing the fix that made typing instant. `daily_submit_guess` rejects the repeat outright (drizzle/0049), under the same row lock as the append — the suggestions are a *list*, and PostgREST is reachable without one, plus a second device's board can be stale. Not extended to the other two: `infinite_rounds` stores `guess_count`, not the guesses, so there is nothing server-side to compare against; duel guesses are unlimited, so a duplicate there costs seconds rather than a turn.

**The cutoff is mirrored in plpgsql and pinned to the TypeScript by a parity suite.** A Postgres function can't import `DAILY_POOL_WINDOW`, so three live functions carry their own copy: `daily_target_id` (drizzle/0038) picks the day's answer, `duel_begin_round` (drizzle/0036) picks each duel round's, and `infinite_start_round` (drizzle/0028) mirrors the whole `poolCutoffYear` ladder. Change the constant alone and **only the autocomplete moves** — the target keeps coming from the old window, so `/daily` can serve a driver the player cannot type, with nothing erroring and nothing looking broken. `lib/game/poolWindow.sqlParity.test.ts` (database CI tier) closes that, and pins `MAX_GUESSES`'s three plpgsql copies in the same pass (audit 2026-07-29 §2.5). The daily cutoff is checked **behaviourally** — `daily_target_id` takes the date as a parameter, so a far-future probe day brackets its cutoff year from both sides with no string matching; the other sites are extracted from `pg_get_functiondef()` and executed, same as the scoring suite. Both probe days must be in the future, and the suite refuses to run rather than pin-and-delete a live day's answer.

## Accounts & auth

Uses **Supabase Auth**. Three entry points, one identity model:

- **Anonymous (guest):** every first-time visitor is silently signed in anonymously (`supabase.auth.signInAnonymously()`) — a real `auth.users` row with no email. This gives guests an identity for duels, matchmaking, and stat-tracking from the first visit. Displayed as an auto-generated handle like `user482913` with a preset avatar.
- **Email** and **Google OAuth** for full accounts.
- **Upgrade, don't replace:** a guest signing in with email/Google **links** to their existing anonymous identity so their stats and duel rating carry over. Never create a fresh row that orphans guest progress.

Gating:
- Playing daily / infinite / **duel**: available to anyone, including anonymous guests. (Guests can matchmake; they just show as `userXXXXXX`.)
- Appearing on the **global leaderboard** and editing a public profile: full accounts only. Guests can *view* the leaderboard but aren't ranked on it. Prompt guests to upgrade at the moments it matters (after a duel win, opening the leaderboard).

A `profiles` row and a `user_stats` row are created for every `auth.users` id via a Postgres trigger on signup. RLS: a user reads their own profile and stats, and can update their own profile — `user_stats` has no client write policy at all, since every real write goes through server code (`lib/stats/actions.ts`) on the trusted Drizzle connection; leaderboard reads go through the owner-privileged `leaderboard` view, which exposes only public columns.

The login/upgrade UI lives in **Settings → Profile** (`components/settings/ProfileSection.tsx`): email, Google, display name, avatar, sign out. There is no standalone account modal — it was folded into the settings restructure, so the top bar's two buttons are Leaderboard (left) and Settings (right), nothing else.

Daily results write to `user_stats` via `recordDailyResult` (`lib/stats/actions.ts`), guarded by the `daily_results` idempotency table so replaying the action can't inflate stats. **It takes no arguments**: `won`, `guessCount` and the UTC day are all read back from the `daily_progress` row `daily_submit_guess` just wrote. See "Server Actions never accept an outcome" below for why that isn't optional. Pre-existing localStorage stats (`lib/stats/store.ts`, from before this feature existed) are folded in once via `migrateLocalStats`, triggered by `AuthProvider` the moment a guest's `profiles.is_guest` flips to `false`.

### Server Actions never accept an outcome

Every `"use server"` export is an **ordinary HTTP endpoint** whose action id ships in the client bundle. It can be called from a devtools console with arguments of the caller's choosing, in a loop, at any time, by any signed-in user — including a fresh anonymous guest. The RPCs in this codebase are locked down hard; the Server Actions beside them were not, and three of them took the *result* of something as a parameter (audit 2026-07-27 §3.2/§3.3/§3.7). Together they were the entire "fake your way onto the leaderboard" surface.

The rule: **a parameter is for something the server genuinely cannot know.** An outcome is never that — it has already been recorded server-side, so it is *read*, not accepted.

- `recordDailyResult()` — took `(won, guessCount)`. `(true, 1)` from a console wrote a win, a 1-guess distribution bucket and an extended streak for a day never finished; worse, the `daily_results` PK guard is first-write-wins, so the forged row also **suppressed** that day's honest result. Now derived from `daily_progress`, with the UTC day resolved by the **database** clock — which also closes the three-clock split-brain (§3.10) that could reset a live streak.
- `forfeitMatch(matchId, forfeitedPlayerId)` — still takes the target, because the disconnect path genuinely is the remaining player acting on the absent one's behalf. What it no longer takes on trust is the *absence*: forfeiting someone else now requires their `duel_matches.last_seen_a/b` heartbeat to be stale (see "Exit, forfeit & disconnect"). Forfeiting yourself stays unconditional.
- `migrateLocalStats(local)` — the one action that legitimately must take client data, since pre-accounts stats exist nowhere but the player's browser. That is exactly why it carries all three of: validation (`lib/stats/localStatsMerge.ts`, pure + unit-tested), a **server-side** once-marker (`user_stats.local_stats_merged_at`, taken under a row lock), and an `is_guest = false` check read server-side.

A PK guard stops a **replay**, not a **forgery** — they are different threats and neither defence substitutes for the other. And a derived-server-side value is only as trustworthy as the table it comes from, which is why drizzle/0042 removed the client write *grants* from every server-authoritative table (they were denied by RLS alone until then — see "Schema").

### Auth state is reactive, everywhere

`AuthProvider` subscribes to `supabase.auth.onAuthStateChange` and exposes `{ userId, isGuest, identityStatus, status }`, each `loading | ready`. **Every game window is a function of `userId`** — no leftover board from a previous identity, ever. Nothing may key persistent game state off anything but the current `userId`.

Sign-in and sign-out are **deliberately asymmetric**:

- **Sign-in re-resolves in place, with no refresh.** The common case (guest → full account) is a *link*: `userId` is preserved, so reloading would interrupt an in-progress daily for nothing. A sign-in can still land on a *different* id — `OAuthErrorHandler`'s `identity_already_exists` path signs you into your other account instead of linking — and that is handled reactively too: game windows are keyed on `userId` so they remount clean.
- **Sign-out is a full application reset.** `signOutAndReset()` (the *only* sign-out entry point — no component calls `supabase.auth.signOut()` directly) releases server-side commitments, signs out, then **hard-navigates to `/` via `window.location.assign`** — never a router push, which would preserve the in-memory state the reload exists to discard. Sign-out is rare and user-initiated, so the reload costs nothing perceptible and eliminates an entire class of stale-identity bug (user ids captured in closures, live Realtime subscriptions, in-flight requests, module caches) that would otherwise need defending against feature by feature.

The ordering inside `signOutAndReset()` is load-bearing and must not be rearranged:

1. **Release every server commitment while still authenticated** — `duel_forfeit(match_id)` if a match is live, `duel_leave_queue()` if queued, and await any in-flight guess RPC (`daily_submit_guess` appends server-side; abandoning one mid-write leaves the rendered board disagreeing with what was stored). After step 2 this identity can no longer authenticate anything.
2. `supabase.auth.signOut()`.
3. `window.location.assign('/')`. The fresh load bootstraps a new anonymous identity through the ordinary first-visit path — there is **no** in-place `signInAnonymously()` on the sign-out path.

**It fails closed.** If step 1 can't complete (offline, request error) it throws and does *not* sign out or reload; the caller surfaces the error. Reloading anyway would strand a live match or a matchable queue row — the exact rating-farming vector "Matchmaking queue integrity" closes — while destroying the only client still holding the session needed to clean it up. And when a match is live or the player is queued, **confirm first** ("Signing out will forfeit your match"); a plain sign-out with nothing in flight needs no confirmation.

## Daily persistence & sync

The daily board must be **the same board on every device**. This is a correctness requirement, not a convenience: if a second device renders a fresh board, the player replays the day and the mode is meaningless.

### Model

- **The guesses are the state.** `daily_progress` stores the ordered list of guessed driver ids for a `(user_id, utc_date)`. Tile results are **never** persisted — they're recomputed server-side by the SQL `compare_drivers` function (the parity-tested SQL mirror of `lib/game/compare.ts`, already built for duel) on hydration. One source of truth for compare rules, a small payload, and no way for a client to inject fabricated tiles.
- **One warm hop, no Next.js in the path.** Both `daily_state()` (hydrate) and `daily_submit_guess(driver_id)` (append + evaluate) are Postgres RPCs the browser calls directly via `supabase.rpc()` (PostgREST is always warm), not Next.js Server Actions. This is the whole fix for the slow board load and slow guesses — a Server Action is a serverless invocation per call, cold-starting on Vercel and route-compiling on `next dev`. Same path duel's guesses already use; see "Fast guess evaluation".
- **The server owns the append.** `daily_submit_guess` resolves the UTC date and the guess index server-side and returns the full authoritative board. The client renders what comes back. Two devices guessing at once therefore converge instead of forking, and "one playthrough per day" is enforced where it can't be bypassed.
- **The day's target is pinned, not recomputed per call.** `daily_targets(date, driver_id)` records the day's driver, lazily pinned by the first caller; everyone else reads it. This removes the per-guess pool scan + pick that made guesses slow, and fixes a latent bug where a mid-day pool change silently changed the target. Every path that needs the target (hydrate, guess, reveal) reads this one row — one source of truth.
- **The pick is random, and that is a security property.** It used to be a deterministic FNV-1a hash of the date over the id-sorted pool — and `/daily` ships the whole pool *with ids* to the browser for autocomplete, so anyone could recompute the day's driver in a devtools console with no network call, forever. Pinning a value only makes it a secret if the value is unpredictable. `daily_target_id` (drizzle/0038) picks with `ORDER BY … random() LIMIT 1` and writes it once via `INSERT … ON CONFLICT (date) DO UPDATE SET driver_id = daily_targets.driver_id RETURNING driver_id` — the no-op update exists so `RETURNING` fires on the conflict path too, which is what makes two racing first-callers converge on one answer now that their picks differ. **Never reintroduce a TypeScript (or otherwise reproducible) "which driver is today" helper**; that is the leak, not the transport. A soft cooldown orders recently-used drivers last — an `ORDER BY`, never a `WHERE`, so it can degrade to plain random instead of emptying the pool.
- **It costs the player nothing.** Every call after the day's first returns off one indexed PK read — measured 12µs in-database, identical before and after the change. The pick + pin runs at most once per UTC day globally (~380µs). The pool still ships to the client, because local autocomplete is why typing a driver is instant; once the answer isn't a function of the pool, holding the pool tells you nothing.
- **The date comes from the database**, never the client — `(now() at time zone 'utc')::date`. A client-supplied date is a trivial way to re-roll the day by changing a device clock.
- **The target is not sent to the client until the day is over** (solved, or guesses exhausted), matching the daily rules. Hydration returns tiles + guessed driver display data; it returns the target only on a completed row.
- **Guests persist too.** Anonymous users are real `auth.users` rows, so their daily progress is written server-side like anyone's. It doesn't roam (the anonymous session is device-local), but it means upgrading to a full account carries the in-progress day over with everything else.
- **localStorage becomes a cache, not the record.** It backs offline/failed-write resilience and legacy pre-auth data. It is never authoritative and never a reason to render a playable board.

### Precedence and merge

**The server always wins.** On sign-in, local progress for today is pushed up *only if the server has no row for that date*; if a server row exists it is loaded as-is and local is discarded. Local guesses are never appended onto a server row, and never onto a completed day — that path is exactly how a player would get a second attempt.

### Hydration UX (fast, no replay flash)

The board hydrates from a single warm `daily_state()` RPC fired the moment `userId` is known. Two rules, one for correctness and one for speed:

- **No replay flash.** While the daily fetch is in flight, `/daily` renders a skeleton board with the input disabled — never an empty *playable* board that later fills in, which reads as "you can play again" and invites a duplicate attempt. The same gate applies during sign-in/sign-out re-resolution.
- **The board must not wait on profile/stats.** Board readiness gates on exactly two things: the auth identity being resolved (`userId` known) and `daily_state()` returning. It must **not** gate on `loadProfileAndStats` — those feed Settings/Statistics/Leaderboard and load in parallel, never on the board's critical path. Firing them in series behind auth is what turned the load into ~3s. On a return visit the anon session is already in local storage, so identity resolves without a network hop; the only blocking call left is the one warm `daily_state()`.

Where the Supabase session is cookie-backed (via `@supabase/ssr`), `daily_state()` may be run in the `/daily` Server Component and the board streamed already-hydrated, removing even that hop for returning users. If sessions are local-storage-only, the client-side parallel fetch above is the win. An audit decides which applies before building.

### Completion

When `daily_submit_guess` completes a day it marks the row complete and calls the existing `recordDailyResult` path, still guarded by `daily_results`, so streaks and distribution can't be double-counted by a replay, a second device, or a re-hydration. `recordDailyResult()` reads the outcome and the day back off `daily_progress` rather than being told them — the board is already server-authoritative, so there is no reason for the stats write to trust a second, client-supplied copy of it. It looks for the newest **completed** row within the last two UTC days: yesterday is in range only for the 23:59:59Z-completion whose record call lands after midnight, and nothing older, because writing a stale day would move `last_daily_date` *backwards* past a newer one and restart a live streak at 1.

### Streaks break on a missed day, not just a lost one

A streak is **consecutive UTC days with a daily win**. Skipping a day ends it exactly like losing does — "just don't play" must never be the safe way to protect a streak. `user_stats.last_daily_date` (the UTC day of the last recorded result) is what makes that enforceable, and the rules are pure and unit-tested in `lib/game`-style isolation in `lib/stats/streak.ts`:

- **On write** (`recordDailyResultForUser`): a win extends the stored streak only when it lands the day *after* `last_daily_date`; any gap restarts at 1. A loss is still 0. `last_daily_date` is written on losses too, so the column always means "the day of the last result".
- **On read** — the half that's easy to miss: nothing writes `user_stats` on a day you skip, so a stored streak stays **frozen at its last value forever** unless every reader re-evaluates it. A stored streak counts as 0 unless `last_daily_date` is today or yesterday (today's puzzle isn't missed until the UTC day ends). Applied in `AuthProvider.toUserStats` for the viewer's own stats, and **in SQL in the `leaderboard` view** for everyone else — the view is not optional, because `getLeaderboard` does `ORDER BY current_streak` inside the database, where a client-side adjustment arrives too late to affect who got the slot.
- **Null `last_daily_date` = no live streak.** After the drizzle/0037 backfill from `daily_results`, the only rows with a null anchor and a non-zero streak are legacy `migrateLocalStats` merges, whose streaks carry no dates and so can never be verified or decayed. They read as 0 and restart at 1 on the next result — trusting an undatable number forever is the bug itself.

Decay-on-read rather than a nightly sweep: no cron to own, and it's exact the instant the UTC day turns over instead of whenever a job happens to run. The stored column stays stale by design; it is never the number shown or ranked.

## Fast guess evaluation (all modes)

Every mode's guess must feel instant (~150-260ms measured for duel on a prod build). One path, applied everywhere:

- **One warm hop, no Next.js in it.** The browser calls a Postgres RPC directly via `supabase.rpc()` — `duel_submit_guess`, `daily_submit_guess`, `infinite_submit_guess`. PostgREST is always warm; a Next.js Server Action is a serverless invocation that cold-starts on Vercel and route-compiles on `next dev`. Moving daily/infinite off Server Actions onto RPCs is the fix for both the slow guesses and (via `daily_state`) the slow board load.
- **Compare runs in SQL, locked to the TS rules.** `public.compare_drivers` mirrors `lib/game/compare.ts` and is pinned to it by a fixture parity test (`lib/game/compare.sqlParity.test.ts`) — already built and proven for duel; daily/infinite reuse it. Never fork the compare rules; if a rule changes, change both sides and the parity test catches drift.
- **The secret target lives server-side**, reachable by the RPC but never returned mid-round: duel in `duel_rounds`, daily pinned in `daily_targets`, infinite in `infinite_rounds`. This is why the target can't sit in a Next-side cookie/closure — PostgREST calls don't pass through Next.
- **Optimistic render.** A shimmer `PendingGuessRow` (shared in `components/game/`) appears the instant a driver is picked and is replaced when the RPC returns, so even the ~150ms reads as zero.
- **Local autocomplete.** The pool ships to the client once; no per-keystroke fetch. (Daily/infinite already do this.)
- **Measure on `next build && next start`, never `next dev`.**

## Site architecture

Two site sections share one root layout but have different chrome, split via App Router route groups:

- **`app/(game)/`** — `/`, `/daily`, `/infinite`, `/online`. The persistent game shell:

  ```
  +-----------------------------------------+
  |  TOP BAR  [cup] ... logo ... [settings]  |  <- persistent, always visible
  +=========================================+
  |       [ Daily | Infinite | Online ]      |  <- mode tabs        \
  |  +-----------------------------------+   |                      |
  |  |           GAME WINDOW             |   |  <- the only part     | hidden
  |  |      (swaps by selected mode)     |   |     that changes      | during a
  |  +-----------------------------------+   |                       > live
  |         [   AD BANNER SLOT   ]           |  <- fixed height      | match
  +-----------------------------------------+                       | (except
  |  --------------  divider  ------------   |                      |  the game
  |   How to play / Game modes / FAQ / About |  <- compact teasers,  |  window)
  |          teasers / News (RSS)            |     "See more →" out /
  +-----------------------------------------+     to (info)
  |  FOOTER                                  |
  +-----------------------------------------+
  ```

  `app/(game)/layout.tsx` holds the top bar, ad slot, marketing teasers and footer; `GameChrome` (client) holds the mode tabs. `/daily`, `/infinite`, `/online` render only their game window into `{children}`. Layouts persist across route changes, so switching modes swaps just the game window. `/` redirects to `/daily`. Mode tabs are `next/link`s highlighting the active route.

  **The shell collapses during a live match.** `ActiveMatchContext` (a root-level provider) carries one `active` flag that `DuelMatch` raises when a round starts. `GameChrome` and `AdSlotGate` read it and hide the mode tabs, divider, marketing sections, footer and ad slot — leaving only the top bar and the match. A live race is the wrong moment for any of it, not just the banner. Two constraints if you touch `GameChrome`: `{children}` must stay at a **stable index** across the active/inactive branches (React otherwise remounts the whole game window and resets duel state mid-match), and `marketing`/`footer` are passed in as already-rendered elements rather than imported, because a `"use client"` module can't import the async Server Component inside `NewsSection`.

- **`app/(info)/`** — `/about`, `/faq`, `/game-modes`, `/how-to-play`, `/privacy-policy`, `/terms-of-service`. Standalone full-detail pages, same footer, but `InfoTopBar` instead of `TopBar`/mode tabs: logo, nav links to the other info pages, and a "Play now" CTA back into the game shell. No ad slot, no marketing teasers here — these pages *are* the detail the home teasers link out to. Each teaser component (e.g. `FaqTeaser`) and its full counterpart (`Faq`) are separate components sharing content style but not JSX, so the home page can stay short without truncating the real page. The two legal pages have no teaser — they're linked from the footer only.

`(game)` and `(info)` are route groups — the parens are stripped from the URL, so paths stay flat (`/faq`, not `/info/faq`).

`/online` is a **landing** that offers a match type: **Duel** (live now) and **Knockout** (rendered but disabled / "coming soon" until built). Guests see a "save your progress" upgrade prompt above the mode options, same copy as Settings. Selecting Duel enters the lobby/matchmaking flow.

## Design system

Direction: **modern, clean, precise, thoughtful.** Dark UI. Orange is the single accent — used minimally but noticeably. Restraint is the aesthetic; when in doubt, remove.

### Color tokens (CSS variables in `app/globals.css`, consumed via Tailwind theme)

```
--bg          #0B0D10   near-black, the page
--surface     #14181D   cards, game window, bars
--surface-2   #1C222A   raised elements, inputs, hover
--border      #262C35   hairline separators (1px)
--text        #E7EAEE   primary text
--text-muted  #8A929E   labels, captions, secondary
--accent      #FF6A00   orange -- CTAs, active state, correct tile, logo mark
--accent-weak #3A2418   accent tints for backgrounds/borders
```

Orange discipline: active mode tab, primary buttons, logo mark, "correct" result. Not on every heading, not as section fills, not on every hover. If more than ~10% of a screen is orange, it's overused. **The duel tug-of-war bar is the one deliberate exception** — see Duel.

Tile result colors (kept distinct from accent so orange stays special):
```
correct     #2E7D46 green         exact / correct value
miss        #2A2F37 grey          miss / no-match
historical  --accent, fixed dim opacity     team only -- raced for target's team in the past
closeness   --accent, opacity scaled 0-1    numeric near-misses -- brighter the closer
hint        bold arrow glyph in a small dark chip for higher/lower, not color
```

### Typography

Two families, both wired up in `app/layout.tsx` as CSS variables on `<body>`:
- **Display / UI: Geist Sans** — logo, headings, tabs, buttons.
- **Data / tiles: Geist Mono** — tiles, counts, years, **timers, scores**. Always with `tabular-nums` so numbers don't jitter (critical for the duel countdown and tug-of-war score).

Intentional scale (e.g. 12 / 14 / 16 / 20 / 28 / 40).

### Surface, spacing, motion, quality floor

- Radius consistent, small-to-medium (`rounded-lg`). Separators 1px `--border`.
- Game window: single `--surface` card, centered, max-width ~640px. Marketing content wider (~720-960px) and calmer.
- Motion minimal and purposeful: tile reveal, button press, modal enter/exit. Respect `prefers-reduced-motion`. No ambient loops — **except** the duel tug-of-war bar and countdown, which are live and must animate smoothly (still honor reduced-motion by snapping instead of easing).
- Mobile-first (most players on phones). Visible `--accent` focus rings. Modals trap focus, close on Escape + backdrop.
- **A tile's meaning must exist in text, not only in colour.** Colour, opacity and the ↑/↓ glyph are the *visual* encoding; the spoken one is `lib/game/tileLabel.ts` (pure, unit-tested), applied by `Tile` as `role="img"` + `aria-label` — `role="img"` both because a bare `aria-label` on a `<div>` may be ignored and because it makes the tile atomic, so the value isn't announced twice. A comparison tile gets `guessTileLabels`; a reveal tile gets `tileValueLabel` (no verdict). The label is optional only where visible prose already states the rule (the marketing legend). Same reason `DriverCodeBadge` announces the driver's *name*, not "V E R".
- **A readable board still isn't an audible game — the *event* has to be announced too.** Labelling the tiles made the grid navigable; submitting a guess was still silent, so a screen-reader user had to go back into the grid after every guess to find out what happened. `GuessAnnouncer` (`components/game/`) is one polite `role="status"` region rendered by `GuessGrid`, so daily and infinite get it identically and a later mode gets it by construction. Two rules it must keep: it composes `guessAnnouncement` from the same `guessTileLabels` the tiles use (so spoken row and spoken tile can't drift), and it announces **only guesses that passed through the pending row** — a resumable daily board hydrates a whole day of guesses at once, and reading the last one aloud on every page load is not an event the player caused. Focus works the same way: when a control disappears under the player (a disabled `PoolSelect`, the duel input on solve) the thing that replaces it takes focus, and only if focus was genuinely lost (`document.activeElement` is `body`).
- Themed scrollbar; `html` has `scrollbar-gutter: stable` so modal scroll-lock doesn't shift content. Don't remove without an equivalent fix.

### Duel visual consistency (important)

The duel **guess board looks and behaves exactly like the daily/infinite board** — the same guess-row component, the same driver-code badge on the side, the same tiles, the same input + autocomplete. The duel is *daily's board plus duel chrome* (tug-of-war, opponent panel, round/timer header), never a bespoke second board.

This is enforced by extraction, not by discipline: `components/game/` owns `Tile`, `DriverCodeBadge`, `ColumnLabels`, `GuessRow`, `PendingGuessRow`, `GuessGrid`, `DriverAutocomplete`, `ResultCard` and `PoolSelect`, and all three modes consume them — duel through `ClosestGuessesBoard`, which is only a *sorting* wrapper (best guess on top, since guesses are unlimited) around the same `GuessRow`. Adding a mode-specific copy of any of these is the thing to refuse. Anything genuinely net-new in duel (tug-of-war, opponent panel, round result cards, results panel) uses the same tokens, radii, fonts and motion rules as the rest of the site.

## Modals

One reusable `Modal` primitive (focus trap, Escape, backdrop close, scroll lock) backs all of these.

**The two global ones are `next/dynamic`, and the shape around them is load-bearing.** `GameModals`
sits in the `(game)` layout, so a static import put the whole Settings tree — and, through
`LeaderboardModal` → `AvatarGlyph`, DiceBear — on `/daily`'s and `/infinite`'s critical path to
render nothing until a top-bar button is pressed, for an avatar never visible on either route
(audit 2026-07-29 §1.4). Three things keep it working: `SettingsSection` is imported **as a type**
(a value import drags the module straight back); each modal renders only behind a **one-way mount
latch**, because a lazy chunk is fetched when it first *renders* — an always-mounted
`open={false}` would defeat the split, and a plain `openModal === "settings" &&` would cut off
`Modal`'s 200ms exit transition; and a `requestIdleCallback` **warms both chunks** after first
paint, so the split costs the initial load and not the first click. `/online` keeps DiceBear eager
on purpose — five `components/duel/` modules import `AvatarGlyph` directly and the avatars are on
screen.

### Settings modal — sectioned

The settings modal has **three tabbed sections**, each its own component in `components/settings/`. A guest sees the "Save your progress" upgrade banner above the tablist, whichever section is open.

- **General** (`GeneralSection`) — exactly two toggles, **show flags** and **colorblind mode** (with a live three-swatch preview of the tile colors it changes), plus **reset stats**, a two-click confirm that calls `resetUserStats` server-side. That is the whole section, and it's deliberately short: **no filler toggles.** Two things that sound like they belong here don't:
  - **No reduced-motion override.** Motion follows the OS `prefers-reduced-motion` setting alone (`motion-reduce:` for CSS, `usePrefersReducedMotion()` for JS-driven animation). A second switch for something the OS already exposes globally is exactly the filler this section avoids.
  - **No infinite-pool default.** The pool picker (`PoolSelect`) lives in the Infinite game window where it's actually used, and the choice persists itself (`lib/settings/poolWindow.ts`). A duplicate control in Settings would be a second source of truth for one value.

  There is **no hard mode** anywhere in the app, and never has been. If a doc, comment or page mentions one, that's stale prose to delete — not a feature to go build.
- **Profile** (`ProfileSection`) — avatar picker, display name (editable for full accounts), a Guest/Account state badge, and the auth controls: email + Google upgrade for guests, sign out for full accounts. This is the *only* login UI in the app.
- **Statistics** (`StatisticsSection`) — games played, win %, current + max streak, guess-distribution bar chart, and duel record (rating, wins, losses). Reads `AuthProvider`'s `stats`, so the streak it shows is already decayed — see "Streaks break on a missed day".

Settings live in localStorage (`lib/settings/store.ts`) and are applied to `<html>` as data attributes, so CSS can key off them without a re-render. **Colorblind mode is applied by a render-blocking inline `<script>` (`COLORBLIND_BOOTSTRAP_SCRIPT`, first child of `<body>` in `app/layout.tsx`), not from an effect** — the value only exists in localStorage, so anything running after hydration paints the default green first and flips it to blue a frame later, which is precisely the colour confusion the setting exists to prevent. Keep it blocking, keep the source built from `STORAGE_KEY` so the key can't drift, and keep `suppressHydrationWarning` on `<html>`. Any future `<html>`-attribute setting belongs in that same script, not in a new mount effect.

### Leaderboard modal — the cup button

The top-bar **cup** button (left of the logo) opens the **global Leaderboard** — not personal stats, which live in Settings → Statistics. Two boards, tabbed: **duel rating** and **daily streak**. Full accounts only are ranked (`leaderboard` view filters `is_guest = false`); guests see the board with a "Save your progress" upgrade prompt. A viewer outside the rendered slots gets their own real rank appended (`myDuelRank` / `myStreakRank`), counted against everyone rather than within the fetched page — one query, both ranks, as correlated counts beside the viewer's own row.

**How many rows each board shows is one constant, `LEADERBOARD_TOP_SLOTS` (`lib/leaderboard/constants.ts`), read by the action and the modal.** They were 50 and 10, which fetched 100 rows to render 20 — and worse, "already visible up top" was decided against the fetched 50, so a player ranked 11-50 was suppressed from the "you're #N" row *and* never rendered in the top 10. Two numbers that must agree are one number.

The rank expressions live in `lib/leaderboard/rank.ts` rather than inline, because their outer column reference has to be **table-qualified** and nothing in the result shows whether it is: the subquery aliases the same view, so an unqualified `duel_rating` binds to the *inner* alias, the predicate compares a row to itself, and every viewer comes back rank 1 with no error. `rank.test.ts` (static tier) renders them and pins the qualification.

## Duel (real-time race)

A fast 1v1 where two matchmade players race across **3 rounds (3 different drivers)**, scoring on speed, visualized as a **tug-of-war**. The whole point is *presence*: it has to feel like a live human is trying to beat you, right now. The engine works; this section defines the experience it must deliver.

### The core problem the lifecycle solves

The round clock must **never** start before both players are actually looking at the board. The old flow stamped the round timer at pairing time, so a slow client loaded into an already-expired round and never saw its opponent. The fix is a staged, server-authoritative lifecycle with **ready-gates**: a round's `started_at`/`ends_at` are stamped only after both clients report they're loaded (or a short fallback timeout). Same gate guards every round and the between-round intermission.

### Match lifecycle (`duel_matches.status`)

```
lobby ──▶ countdown ──▶ active ──▶ intermission ──▶ (next round) active ... ──▶ finished
                                        └── loop rounds 1→3 ──┘
any state ─▶ abandoned   (forfeit / disconnect)
```

- **`lobby`** — pair created, both on the match staging screen. Avatars, handles, ratings revealed (grid-start feel). Held ~`MATCH_FOUND_HOLD_MS`. Both clients send a `ready` presence flag.
- **`countdown`** — once both `ready` (or `READY_TIMEOUT_MS` elapses), an RPC stamps round 1's clock and the F1 **lights-out** countdown runs to the absolute `started_at`.
- **`active`** — a round is live (`current_round`). Board + tug-of-war + opponent panel. Ends when both solved or the timer expires.
- **`intermission`** — reveal the correct driver, animate both players' round points, settle the bar, mini-countdown into the next round. Server-stamped `intermission_ends_at` (so both see it the same length), plus a ready-gate before the next `active`.
- **`finished`** — winner decided, ratings + records written; clients drop out of the immersive view back to the site shell to show results.
- **`abandoned`** — someone forfeited or disconnected past the grace window; the remaining player is the winner.

### Timing constants (`lib/game/duelTiming.ts`, tunable)

**Every duel duration lives in this one file** — nothing in `components/duel` or `lib/duel` hardcodes one. The single documented exception is the SQL literals inside drizzle/0021's functions (`COUNTDOWN_MS` / `ROUND_MS` / `INTERMISSION_MS`) and drizzle/0032's `QUEUE_STALE_MS`, which plpgsql can't import; each carries a keep-in-sync comment pointing back here.

```
LOBBY_MIN_SEARCH_MS          1000   min time the "searching" UI shows before a match resolves
MATCH_FOUND_HOLD_MS          2500   "Match found" + avatars/ratings hold before countdown
COUNTDOWN_MS                 3900   F1 lights-out into a round -- the SAME for every round
COUNTDOWN_GO_HOLD_MS          700   lights-out -> "GO!" beat, inside the countdown (see below)
LIGHTS_ALL_LIT_HOLD_MS        400   all-five-lit dwell; the sweep is sized to end exactly here
MIN/MAX_LIGHT_ON_INTERVAL_MS 150/900  bounds on the DERIVED light interval (no strobe, no crawl)
COUNTDOWN_TICK_MS             100   countdown re-render cadence; BOTH hooks stop at their deadline
ROUND_MS                    60000   per-round guessing window (server-stamped)
INTERMISSION_MS              6000   reveal + points animation + mini-countdown between rounds
POINTS_COUNT_UP_MS           1000   the intermission's "+N" count-up
READY_TIMEOUT_MS             4000   fallback if a client never reports ready
DISCONNECT_GRACE_MS         10000   reconnect window; ALSO the server's staleness bar
DUEL_HEARTBEAT_MS            5000   in-match liveness beat (duel_heartbeat), 3:1 vs the window
MATCHMAKE_POLL_INTERVAL_MS   4000   re-run of match_or_queue while searching (widens the band)
QUEUE_HEARTBEAT_MS / _STALE_MS  5000/15000  queue liveness; survives 2 missed beats
DUEL_POLL_INTERVAL_MS        5000   in-match safety net for a missed broadcast (idempotent)
RESUME_RETRY_MS              2000   retry cadence when a reload lands between rounds
RESUME_RETRIES_BEFORE_FORCE_BEGIN  4  before concluding BOTH clients reloaded and stamping it
```

These fix the "everything's too fast to see" complaints: the intermission is a real, unrushed beat and the between-round countdown gates on readiness.

### Flow

1. **Mode select.** `/online` landing shows Duel / Knockout (plus a guest upgrade prompt above them, same as Settings).
2. **Lobby / matchmaking.** Selecting Duel renders the lobby UI *first* (searching animation) and enforces `LOBBY_MIN_SEARCH_MS` before resolving, so the player always sees the lobby load in. A Postgres RPC pairs atomically: `SELECT ... FOR UPDATE SKIP LOCKED` finds a waiting opponent (create match, mark both matched) or enqueues. No background worker. Match by rating when possible; widen the window the longer someone waits; fall back to anyone after a timeout.
3. **Match found (staging).** Both avatars slide in from opposite sides (grid-start), with handles and ratings. Held `MATCH_FOUND_HOLD_MS`. Both clients report `ready`.
4. **Lights-out countdown.** On both-ready (or timeout), `duel_begin_round` stamps the round's `started_at = now() + COUNTDOWN_MS`, `ends_at = started_at + ROUND_MS`. Every round gets the identical ceremony — same component, same length. The light **interval is derived, not fixed**: `useLightsCountdown` divides the budget actually remaining when the round lands by the four intervals between five lights, so the fifth light always arrives exactly `LIGHTS_ALL_LIT_HOLD_MS` before lights-out. A fixed interval left the leftover budget as dead air with all five lights on, and since that leftover shrank as latency grew, identical constants produced visibly different pauses per round. Five red lights fill one at a time — the number under them names the light that just lit (L1 = "5" … L5 = "1") — then out = GO. Clients count to the absolute `started_at`, corrected for clock offset.

   **`started_at` means "the board is on screen and this player can act", not "the lights went out."** Lights-out is `COUNTDOWN_GO_HOLD_MS` *earlier*; clients run the lights to that moment and hold GO until `started_at`. This is load-bearing for fairness, not presentation: `ends_at` and `duel_submit_guess`'s ms-to-solve are both measured from `started_at`, so defining it as the instant play begins is what stops the ceremony being charged to the player's round time and to their speed points. Every constant in the countdown budget follows from it — the lights must complete within `countdown - COUNTDOWN_GO_HOLD_MS`.
5. **Rounds (×3).** Each round targets one 10-year-pool driver.
   - **Guessing:** unlimited guesses within the timer, each returning the normal 5-attribute comparison (reuse `compare()`). Submission must feel **instant** — see "Instant guesses".
   - **Live standing:** every guess updates the tug-of-war live (not just at round end). Each player's **live score** = `100 (baseline) + confirmed round points + current-round provisional`. Provisional = locked speed points once solved, else the proximity value of the best guess so far. Both start at 100 so the bar opens centered and never snaps to an end.
   - **Success:** speed points — solving at 5s worth far more than at 40s. Pure `speedPoints(msToSolve, roundMs)`. The solving client shows the real earned points (e.g. `+140`), not `+0`.
   - **DNF (timer expires unsolved):** minor **proximity points** from the best incorrect guess. Pure `proximityPoints(bestResult)`.
6. **Intermission.** Reveal the correct driver (card: initials/photo, name, the five stats), count-up both players' round points, settle the tug-of-war, mini-countdown. Ready-gate into the next round.
7. **Match end.** Higher aggregate (excluding the equal 100 baseline) wins; update both ratings + records. Clients leave the immersive view and return to the **site shell**, which renders a results panel: WIN/LOSE, final score, rating delta (±), per-round breakdown, and CTAs (**Rematch**, **Find new opponent**, **Back to modes**). Guests get an upgrade prompt on a win.

### Rematch is mutual consent, not a re-queue

A rematch pairs the *same two players* directly — it never goes back through `matchmaking_queue`. `duel_matches.rematch_requested_by` is the whole mechanism: `requestRematch(oldMatchId)` records the caller's intent if the column is empty, or — finding it already set to the **other** participant — creates the new match and returns its id. A lone request just waits.

Three distinct broadcasts on the old match's channel, and conflating them is the bug to avoid:

- `rematch_request` — "I asked, and I'm first." Without it the opponent's results screen shows a plain Rematch button with no sign anyone is waiting on them, which is precisely why requests go unanswered.
- `rematch_decline` — the answer "no". Without it a refusal is indistinguishable from a slow opponent and the asker waits forever. Terminal: neither side is offered the rematch again.
- `rematch` — "the new match **exists**, join it," carrying `newMatchId`. Sent by whichever client's `requestRematch` actually created it (the second requester); it's the only way the first requester learns. Both clients then meet on `duel:{newMatchId}` for a fresh ready-gate.

### Live opponent presence (make it feel like a fight)

- **Both avatars on screen the whole match** — you (accent side) vs opponent (muted side), each with handle, live provisional points, and guess count.
- **Opponent activity is live but abstracted** — never their guessed driver or the target. On each opponent guess: a pulse on their avatar and a tick on their guess count. Their **best heat** (0-1 closeness of their best guess) drives a glow intensity. On solve: a burst + `SOLVED +N` and the bar jumps. This is the "rival closing in" read, spoiler-free.
- **Tug-of-war** (top, prominent): the one place orange dominates — your accent fill vs the opponent's muted fill, center = tie, driven live by the live-score balance `liveMine / (liveMine + liveOpp)`. Animate smoothly; snap under reduced-motion.

### Board (consistent with daily)

The guess board is the **shared daily/infinite board** (same row, tiles, driver initials on the side, input, autocomplete). Because guesses are unlimited, the list may be sorted by closeness (best on top) — but it is the same row component, not a bespoke grid. Round indicator (1/2/3) and the countdown in mono tabular figures sit in the duel header above the board.

### Instant guesses (perceived latency ~0)

Duel guessing uses the shared one-warm-hop path — see "Fast guess evaluation (all modes)". Duel-specific notes:
- `duel_submit_guess(match, round, guess_driver_id)` returns `{ tiles, solved, points, bestHeat }` in one round trip.
- Preload the 10-year pool on match start so autocomplete is local and instant.

### Server authority (fairness)

- Round timing is **server-stamped**: `duel_begin_round` sets `started_at`/`ends_at` from DB `now()`; both clients count down to the absolute `ends_at`, correcting for clock offset (ping server time once at match start). Never a client-authoritative clock.
- **The round lifecycle is one warm hop too, for the same reason guesses are.** `beginRound`/`closeRound` (`lib/duel/roundLifecycle.ts`) are `supabase.rpc()` calls from the browser, never Server Actions. This is not only about feeling fast: a round's clock is stamped when the RPC runs but the client only learns when the response arrives, so *any* latency in that path is silently deducted from the countdown the player was meant to watch. A Server Action there (serverless invocation + auth hop + query hop + RPC hop) measured ~20s on a bad connection, which meant no lights at all and landing in a round already a third gone.
- Round advancement is **client-triggered but idempotent**: when a client observes both done or the timer expired, it calls `duel_close_round` guarded on current round state — whichever fires first advances; the other is a no-op. A `pg_cron` sweep of expired rounds can back this up but isn't required for v1.
- Guesses are validated and scored **server-side**. Never send the target driver to either client during a round; the target is disclosed only in the intermission, after the round is closed. Never send the opponent's guessed names — only abstracted heat/counts.
- **Resume:** a `duel_state(match_id)` RPC returns the full current phase (status, current round, server timestamps, scores, both players) so a reloaded client rejoins at the right beat.

### Exit, forfeit & disconnect

- **Explicit exit:** an Exit control (confirm modal) calls `duel_forfeit(match_id)` — marks the match `abandoned`/finished with the opponent as winner, updates ratings — then broadcasts `forfeit`. The leaver returns to the shell with a "You forfeited" result.
- **Tab close / disconnect:** best-effort `forfeit` broadcast on `beforeunload`, plus **presence** on `duel:{matchId}`: when a client sees the opponent's presence leave and they don't rejoin within `DISCONNECT_GRACE_MS`, it calls `duel_forfeit` on the absent player's behalf (idempotent, guarded) and shows "Opponent left — you win."
- **Absence is server-verified, not asserted.** Presence decides when a client *asks*; it can't decide the answer, because it lives in a Realtime service Postgres can't query — so "my opponent is gone" used to be a claim the server took at face value, and one devtools `forfeitMatch(id, opponentId)` mid-match was a guaranteed win plus real Elo, farming the column the leaderboard sorts on (audit 2026-07-27 §3.3). `duel_matches.last_seen_a/b` is the server's own evidence: `duel_heartbeat(match_id)` (drizzle/0040) refreshes the **caller's own** column every `DUEL_HEARTBEAT_MS` from whichever client has the match on screen, and `forfeitMatch` refuses to forfeit anyone whose column isn't stale past `DISCONNECT_GRACE_MS`. The comparison runs **in the database**, in the same statement that reads the match row — one clock, no extra round trip. Same shape as `matchmaking_queue.last_seen_at` (drizzle/0032), for the same reason: what must be proven alive is a *row*, not a WebSocket.
  - It lives in `DuelRoot`, not `DuelMatch`, so it covers staging onward — every phase in which the opponent's grace timer could fire against you. It stops itself once the RPC reports the match terminal, so nobody beats through a results screen.
  - **The match id it beats has exactly one owner, `DuelRoot`.** `useDuelLifecycle` reads it as a prop and reports a rematch's new id back up (`onMatchIdChange`); it must never keep its own copy. It did, and the copies diverged the moment a rematch started: `DuelRoot` stayed pinned to the finished match, so the beat — already stood down on that match going terminal — never re-armed, and neither player's `last_seen_a/b` moved off the rematch row's insert-time default. Both were stale ~4s into round 1, which is §3.3's forfeit-on-demand restored in full, on a **primary results-screen CTA** (audit 2026-07-29 §0.1). `setLiveMatchId` was pinned to the dead match by the same split, so signing out mid-rematch forfeited nothing. Anything keyed on the match id belongs at that one level, or downstream of it.
  - `duel_submit_guess` deliberately does **not** carry the beat. That's the hot path, and a `duel_matches` write there would sit behind a row lock `duel_close_round` also takes.
  - The grace timer is an **interval**, not a one-shot: a player who dies the instant after a beat is stale by a hair less than the window when the first attempt lands, and a single refusal used to leave the survivor in a dead match.
- A finished/abandoned match can't be re-entered; `duel_state` reflects the terminal result for a late-loading client.
- **Signing out mid-match forfeits it.** `AuthProvider.signOutAndReset()` calls `duel_forfeit` before tearing down the session, so the opponent gets an immediate clean win instead of waiting out `DISCONNECT_GRACE_MS`. The player is asked to confirm first, and if the forfeit can't be delivered the sign-out is aborted rather than silently abandoning them.

### Matchmaking queue integrity

A stale queue row is a **rating-farming vector**, not a cosmetic leak: if a player queues, signs out (which mints a fresh anonymous identity), and queues again, a naive `user_id <> caller` check passes — the ids genuinely differ — and they are paired with themselves, writing real `duel_rating` to both sides. Four independent layers, so no single failure can produce a self-match:

1. **Explicit dequeue.** `duel_leave_queue()` — idempotent, safe twice, safe when not queued, authorizes via `auth.uid()`. Called on *every* exit from searching: unmount, cancel, navigating away, `beforeunload`/`pagehide` (keepalive POST, since a normal fetch dies with the document), and — critically — **inside `signOutAndReset()` before the session is torn down**, while the outgoing identity can still authenticate it. The queue has no client write policy at all; this RPC is the only way out.
2. **Identity change aborts the search.** A new `userId` is never a reason to re-queue. `DuelSearching` pins the identity it started under, and on a change dequeues and returns to the `/online` landing. **Deliberate exception to the auth-reactivity rule:** readers re-resolve for a new identity, but live server commitments (queue entries, active matches) are *released and abandoned*, never re-established.
3. **Liveness.** `last_seen_at`, refreshed every `QUEUE_HEARTBEAT_MS` by `duel_queue_heartbeat()`. Rows older than `QUEUE_STALE_MS` are ignored by the pairing scan and deleted by `duel_sweep_stale_queue()` (run at the top of every search — no cron needed). A row leaked by a crash or a failed dequeue goes inert on its own. An explicit heartbeat rather than lobby-channel presence: presence tracks a WebSocket, but what must be proven alive is a *row*, and the two disagree in both directions.
4. **Self-match guard.** `device_id` — stable per browser profile, persisted in localStorage so it **survives an identity swap**, which is the one thing signing out cannot change. The scan refuses any row sharing the caller's `device_id`, and separately any sharing their `user_id`. Searching also deletes this device's rows under other identities, so a leaked row converges instead of lingering. *Accepted side effect: two people on one browser profile can't duel each other.*

Both guards live **inside** the single locked `SELECT … FOR UPDATE SKIP LOCKED` that claims the opponent — never a read-then-check afterwards, which would trade the bug for a race. Backing all four, a `CHECK (player_a <> player_b)` on `duel_matches` makes a self-match row unrepresentable regardless of what any future code path does.

## Knockout (planned — do not build yet)

For context so the duel engine leaves room for it. A 20-player elimination game under `/online`:

- **Format:** 3 rounds, F1-qualifying style. All players guess the same driver simultaneously.
- **Hints:** unlike duel, clues are **global auto-reveals** — every ~5s a new fact about the target surfaces to everyone (nationality, then debut era, then a team, etc.), independent of guessing.
- **Elimination:** the bottom 5 each round (slowest / furthest / lowest score) are knocked out; survivors advance; a winner emerges from round 3.
- Reuses the live-match core (lifecycle, timers, rounds, scoring, broadcast, ready-gates) with a many-player lobby, an elimination visualization, and the global-hint reveal system.

### Build seam for Knockout

Build the round lifecycle (server-stamped timers, synchronized countdown, per-round driver selection, scoring hooks, match/round state broadcast, ready-gates) as a **reusable "live match" core**, not hard-wired to 2 players. Knockout is the same machinery with N players, an elimination step, and a different hint source. Don't build Knockout now — just don't wall the duel engine off from it.

## News section — RSS, not X

Recent F1 news from RSS feeds — motorsport.com, Autosport, Crash.net, Sky Sports, and RaceFans (formula1.com's official feed and planetf1.com were evaluated but rejected: the former's items have no publish date, so `parseRssItems` correctly drops all of them, and the latter's feed URL currently redirects to a broken page). Fetched server-side, revalidate hourly, merged and sorted by recency. Rendered client-side only as an interactive carousel (`NewsCarousel`): one big featured story (image + title + source + relative time) with prev/next arrows, larger-hit-area dots, and auto-advance (paused on hover/focus, disabled under the OS reduced-motion signal — see WCAG 2.2.2) to step through the top ~5 across all sources. The *fetch* stays server-side; only which slide is showing is client state. Do **not** integrate the X/Twitter API — no free read tier, bills per request.

## Ads — AdSense + consent

Single responsive banner in the fixed-height slot under the game window.

- `AdSlot` reserves space with a fixed min-height (zero CLS); renders a neutral placeholder pre-approval.
- AdSense script via `next/script` `strategy="afterInteractive"`, gated behind consent.
- **EU audience → consent required:** Google Consent Mode v2 + a Google-certified CMP (built-in Google consent messages are the free default). Ad cookies must not load until consent; default all signals to denied.
- **Two** env vars, both required before a real ad renders, both read only through `components/ads/adsenseConfig.ts` and never hardcoded: `NEXT_PUBLIC_ADSENSE_CLIENT` (account-level, `ca-pub-…`) and `NEXT_PUBLIC_ADSENSE_SLOT` (the specific unit, which only exists *after* approval). `getAdsenseUnit()` is the single "are real ads on?" check — it returns the `{ clientId, slotId }` pair or `null` rather than a boolean, so the caller that asks is also the caller that gets the ids to render with. (It replaced a boolean `isAdsenseConfigured()` that ended up with no callers precisely because it didn't narrow — audit §2.1.) Funding Choices (the CMP loader) wants the bare `pub-…` form — hence `getPublisherId()`, which strips the `ca-` prefix. Approval is external and needs the deployed site with real content; until then `AdSlot` renders its neutral placeholder. All ad logic stays isolated in `components/ads/`.
- **Hide the ad slot during an active duel/knockout match** — a live race is the wrong moment for a banner; show it on daily/infinite and the /online landing, and again on the duel **results** screen (which is back in the shell), not during lobby/countdown/active/intermission. `AdSlotGate` does this by reading `ActiveMatchContext` — the same flag `GameChrome` uses to hide the rest of the shell (see "Site architecture").

## Stack

- Next.js 15 (App Router) + TypeScript, **Tailwind v4** (CSS-first `@theme` config in `app/globals.css`, no `tailwind.config.js`)
- Postgres via Supabase, Drizzle ORM (`postgres` driver); migrations in `drizzle/`
- **Supabase Auth** (anonymous + email + Google), `@supabase/ssr` for the cookie-backed server client
- **Supabase Realtime** (broadcast + presence) for matchmaking and live matches
- **Vitest** for tests (`npm test`), in **two projects split by environment**: `node` (`lib/**`, `scripts/**` — pure logic, as it always was) and `dom` (`**/*.test.tsx` — real components rendered in jsdom with Testing Library; `npm run test:dom` for just those). DB integration suites live in the `node` project and are opt-in behind `RUN_DB_INTEGRATION_TESTS=1` so the default run needs no database. The `dom` project exists because six audit resolutions in a row closed with *"not verified in a browser"* — an ARIA promise, a live region's firing rule, a timer's rollover and a mount latch are all facts about a rendered DOM that `tsc` cannot see. **A component test earns its place by pinning behaviour a player or a screen reader can observe** (what the listbox offers, what gets announced, where focus lands, what stays mounted), never a component's internals; write it so it fails against the pre-fix code, and check that it does.
- Avatars are **DiceBear** glyphs generated from a seed string (`lib/avatars.tsx`) — `profiles.avatar_url` stores the seed, not a URL. There is no upload or Storage path.
- Deployed on Vercel. The checks are `tsc --noEmit` (`npm run typecheck`), `npm run lint`, `npm test` and `next build`.
- **ESLint is adopted, and deliberately narrow** (`eslint.config.mjs`, 2026-07-30 — audit §0.5). Four rules and nothing else: `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, `@typescript-eslint/no-explicit-any` (the "No `any`" convention below, enforced) and `@next/next`'s recommended set minus one Pages-Router rule that can only false-positive here. **No style or formatting rules** — `tsc` is the type authority and a house style invented inside a lint adoption is how a lint step becomes one people skip. The scope was chosen by *measuring* each candidate ruleset against the tree first; `eslint.config.mjs` records those numbers and names what was rejected (react-hooks v7's React Compiler preset, 30 violations on patterns this codebase chose on purpose). `reportUnusedDisableDirectives` is an **error**, so a suppression that stops being needed fails the build — the count of `eslint-disable` comments can now only fall unless someone writes one deliberately. Adding a rule means measuring it the same way; a new suppression means a reason at the call site.
- **CI: `.github/workflows/ci.yml`**, two tiers. `static` (typecheck + lint + `npm test`, both vitest projects) needs nothing and runs everywhere, including fork PRs. `database` + `build` need three repository secrets (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, see `.env.example`) and **self-skip when they're absent** rather than failing red; point them at a **scratch** project, since those suites write real rows. The database tier is what actually runs the opt-in suites — the TS↔SQL parity tests, the RPC and matchmaking suites, and the grant policy — so it's the difference between those rules being documented and being enforced. `static`'s lint step runs the narrow adopted scope described above and nothing wider; widening it means measuring the candidate ruleset against the tree first, in `eslint.config.mjs`, not adding a rule in CI.

## Data

Seeded from **F1DB** (https://github.com/f1db/f1db) — the full historical roster, pulled as `f1db-csv.zip` by `scripts/seed.ts` (`npm run db:seed` to rehearse, `npm run db:seed:commit` to write). This is currently the **only** way driver data gets in or gets updated: re-run the seed after a race weekend to refresh wins and teams.

**Which release is an env var, and there is no default.** `F1DB_RELEASE=v2026.11.0` pins a tag; `F1DB_RELEASE=latest` follows upstream and says so in the log. Unset, the seed refuses to run. That is not ceremony — see the next bullet list.

**The seed is an idempotent upsert, and `drivers.id` is never reassigned.** It used to `DELETE FROM drivers` and re-insert, which throws a foreign-key violation against any database that has served one daily — and, forced past that, renumbers a `serial` that `daily_targets`, `duel_rounds` and `infinite_rounds` hold FKs to and that `daily_progress.guesses` stores with no FK at all (audit §5.1, drizzle/0043). Now every row is matched to the release on **`f1db_id`** — F1DB's own driver slug — and `UPDATE`d in place, inside one transaction, with nothing ever deleted:

- **Reconciliation is `scripts/rosterPlan.ts`**, pure and unit-tested. Rows imported before drizzle/0043 carry no slug, so they're adopted by `(full_name, date_of_birth)`; a row whose slug changed upstream is re-keyed rather than duplicated; genuine ambiguity on either side is reported and never guessed at. Rows the release no longer mentions are **kept and reported**, never deleted.
- **The seed fails closed: `npm run db:seed` is a dry run, and writing takes `npm run db:seed:commit`.** It does the whole write either way — the reconciliation report is only worth reading against the real table — and rolls back unless `--commit` was passed. The default was inverted on 2026-07-30 (audit §5.1 residual) because the old shape put the *safe* mode behind the flag, and the flag is the part a shell can eat: **Windows PowerShell 5.1 drops the bare `--`** when it invokes a native command, npm then swallows `--dry-run` as its own config flag, and `process.argv.slice(2)` arrives as `[]`. That silently committed a 792-row roster refresh once. Now the same stripping produces a dry run — measured: `npm run db:seed -- --commit` in PowerShell prints `Mode: DRY RUN`, while `npm run db:seed:commit` (flag inside the script string, nothing to forward) prints `Mode: REAL WRITE`. **A lost `--commit` costs a re-run; a lost `--dry-run` cost a database.** `resolveWriteMode` (`scripts/releaseGuards.ts`, pure + unit-tested) also rejects an unrecognised argument outright rather than shrugging at a typo, and `main()` prints the mode as its first line before the download, because the difference is 792 live rows and should be on screen rather than inferred from a message at the end.
- **The upsert made a loud failure silent, so the loudness was rebuilt** (audit 2026-07-29 §5.2). The old `DELETE` hit a foreign key when a release parsed wrong; an in-place `UPDATE` of 792 rows just commits, and the first symptom is players reporting that the comparisons are wrong. `MIN_ROSTER_RATIO` only catches "most of the feed is missing" — the three dangerous modes all preserve the row count exactly: a renamed `positionText` makes every DNQ/DNS a race start (shifting debut years, `last_active_year` and pool membership), a renamed `positionNumber` zeroes every driver's wins, a renamed `round` makes the last-team tie-break `NaN`. **`scripts/releaseGuards.ts`** (pure, unit-tested, runs in the static CI tier) is the answer: the release pin above, a **header assertion** on every column the seed reads out of all four CSVs, and canaries — Hamilton has ≥ 100 wins, Verstappen's `last_active_year >= currentYear - 1`, and at least one race result still carries a `NON_START_CODES` value. A missing canary slug is a failure, not a skip: it means the driver key scheme moved, which every join in the seed rests on.
- **The two reference-table joins count what they can't resolve** (audit 2026-07-29 §5.2b). The seed stores country and constructor *names*, looked up from ids; both lookups fell back to the raw id (`?? id`) with nothing counted or logged, so a roster could hold `"united-states-of-america"` beside `"United States of America"`. That is a comparison bug, not a cosmetic one: `compare_drivers` compares nationality **and** team by string equality, so two drivers *of the same country* report a nationality **miss** against each other (and `countryCode()` returns null for a slug, so the flag silently vanishes). Every lookup now goes through `resolveName`, which tallies misses — same reason `assertColumns` lives inside `readCsv`: the counting can't be forgotten. The fallback **stays**, because one unresolvable id must not cost the other 791 drivers their refreshed wins; what's new is that misses are reported worst-first on every run, and that a join resolving **nothing** is a hard failure before the transaction opens — that means the id space moved, and it preserves the row count exactly, so `MIN_ROSTER_RATIO` and the header assertion both miss it by construction. Measured against `v2026.11.0`: 40 country ids, 176 constructor ids, **zero** misses.
- **`drivers` carries value `check()` constraints** (drizzle/0047) — non-negative wins, `debut_year <= last_active_year`, seasons within 1950…next year, `date_of_death > date_of_birth`, and born before the debut season (the immutable form of "no future birth date"). They are the per-column half of the same defence and they fail the *seed's own transaction*, so a bad row rolls the whole run back rather than reaching the game. Write-time only — `drivers` is written by the seed and nothing else, so this costs a guess or a board load nothing.
- The seed's writes go through **scalar parameters in batched `VALUES` lists, never one big array or jsonb parameter** — a single large parameter kills the Supabase transaction pooler connection (`write CONNECTION_CLOSED`) where thousands of small ones are fine. There's a measured note on this in `seed.ts`.
- `drivers` is the one table with **RLS disabled**, so its grants *are* its access control. drizzle/0043 revoked the client write set from `anon`/`authenticated`; before that any visitor could `UPDATE`/`DELETE` the whole roster with the public anon key. Reads stay open (the pool is public by design). Same rule as drizzle/0042: **grants and RLS should have to fail together.**

**Not built yet:** the **Jolpica-F1** (https://api.jolpi.ca/ergast/f1/) weekly cron that was planned to refresh current wins/teams automatically and double as a Supabase keepalive. There is no cron route, no `vercel.json`, and no Jolpica code anywhere in the repo. When it is built: cache hard, never call it from a request handler.

Attribute definitions: age = current age (age at death if deceased); team = most recently raced constructor; wins = all-time race wins; debut = first race-start year; nationality = country string; driver_code = F1DB 3-letter abbreviation (unique only within what's shown together); previous_teams = every distinct constructor raced for; last_active_year = most recent race-start year, drives pool membership.

**Whether `lib/game/flags.ts` still covers the roster is asked of the roster, not of a copy of the map** (audit 2026-07-29 §5.2c). `flags.test.ts` used to hold a hand-transcribed duplicate of `COUNTRY_CODES`' 40 keys and assert each one resolved — true by construction, and blind to a nationality entering, leaving or being renamed. That question moved to the database tier: `lib/db/driversRosterIntegrity.test.ts` → *"nationality coverage"* runs `SELECT DISTINCT nationality FROM drivers` and asserts every value resolves, that **no two values map to the same country code**, and that none is blank. The second is the sharp one: the seed keeps rows a release no longer mentions, so an upstream country rename leaves the old spelling on the un-refreshed drivers and writes the new one on the rest — one country under two strings, which by string-equality compare is a nationality **miss** between two drivers of the same country. What stays in the static tier is only what needs no database: the map's shape (ISO-shaped codes, no aliases, no untrimmed keys) and `countryCode`'s contract. Same rule as the plpgsql constants — **a claim about the data belongs in the tier that can see the data.**

## Schema

Existing:
```
drivers(id, f1db_id text unique null, full_name, driver_code, nationality, date_of_birth,
        date_of_death, debut_year, career_wins, last_team, previous_teams text[],
        last_active_year)
```
`f1db_id` (drizzle/0043) is F1DB's own driver slug and the seed's upsert key — the reason `id`
survives a re-seed. Nullable only for rows imported before it existed; the seed adopts those by
`(full_name, date_of_birth)` on its next run. No client write grants (see "Data"). Five value
`check()`s (drizzle/0047) reject what can't be true of a real driver, so a mis-parsed release
rolls the seed's transaction back instead of committing — the per-column half of the release
guards in `scripts/releaseGuards.ts`.

Accounts:
```
profiles(id PK = auth.users.id, username, display_name, avatar_url, is_guest bool, created_at)
user_stats(user_id PK FK, games_played, wins, current_streak, max_streak,
           guess_distribution jsonb, last_result jsonb,
           last_daily_date date null,               -- UTC day of the last recorded daily result
           duel_rating int default 1000,
           duel_wins, duel_losses)
daily_results(user_id FK, date, won, guess_count, created_at, PRIMARY KEY (user_id, date))
daily_progress(user_id FK, date,                    -- date is the UTC day, resolved server-side
               guesses int[] not null default '{}', -- ordered guessed driver ids: the actual answers
               completed bool not null default false, won bool null,
               created_at, updated_at,
               PRIMARY KEY (user_id, date))
daily_targets(date date PK, driver_id int FK)        -- the day's driver: RANDOM, pinned once by the
                                                     -- first caller. Indexed on driver_id for the
                                                     -- recent-repeat cooldown.
infinite_rounds(user_id uuid PK FK, driver_id int FK, pool_window text,
                guess_count int, started_at)         -- server-side infinite round state (replaces the signed cookie)
```
`daily_progress` is what makes a day's board follow the account across devices; `daily_results`
keeps its separate job as the stats idempotency guard (don't merge them — one is live board state,
the other is a write-once outcome record). `daily_targets` pins the day's driver so it's an indexed
read, not a per-call pool scan, and can't drift mid-day — and the pinned value is a *random* pick,
which is the only reason the answer is a secret at all (see "Daily persistence & sync").
`infinite_rounds` moves infinite's round
state off the signed httpOnly cookie (invisible to PostgREST) into the DB so its guesses can use the
same warm RPC path. All three are self-`SELECT` (or no) client policy under RLS with **no client
write policy**; every write goes through a `SECURITY DEFINER` RPC. Tile results are never stored —
they're recomputed from `guesses` via SQL `compare_drivers` on hydration.

Daily / infinite RPCs — **warm, client-callable via `supabase.rpc()` (PostgREST), `SECURITY DEFINER`
+ `auth.uid()`, `GRANT EXECUTE TO authenticated`** (every visitor has at least an anon session).
Model them on the existing `duel_submit_guess` (SECURITY DEFINER + `auth.uid()`), not on the
trusted-connection lifecycle RPCs like `duel_begin_round`. None return the target while a round/day
is live.
```
daily_state()                  -> { guesses[{driverId, name, code, tiles}], completed, won,
                                    guessesRemaining, target|null }   -- target only when completed
daily_submit_guess(driver_id)  -> same shape; appends to daily_progress, resolves UTC date + guess
                                  index itself, rejects a complete/exhausted day and a driver already
                                  in guesses[] (drizzle/0049); SQL compare_drivers
infinite_start_round(pool_window)   -> upserts infinite_rounds with a fresh random pool driver
infinite_submit_guess(driver_id)    -> { tiles, status: won|lost|continue, target? }; enforces the
                                       6-guess cap; target only when status ≠ continue
```

Their two internal helpers are **not** client-callable and must stay that way — `EXECUTE` is
revoked from `PUBLIC`/`anon`/`authenticated` (drizzle/0038), so a browser holding the anon key
cannot reach them; the `SECURITY DEFINER` RPCs above call them as the table owner:
```
daily_target_id(date)              -- get-or-pin the day's answer. Reachable over PostgREST, it
                                   -- simply RETURNS the answer, past daily_targets' deny-all RLS.
compare_drivers(guess, target, at) -- the comparison rules; the guess-evaluation core
```
Postgres default-grants `EXECUTE` on a new function to `PUBLIC`, and `public` is the schema
PostgREST exposes — so **every new function needs an explicit grant decision written next to it.**
Assuming otherwise is what left `daily_target_id` open (and, before drizzle/0034, the duel
lifecycle).

**`REVOKE … FROM PUBLIC` alone is not that decision on Supabase.** The project bootstrap runs
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated,
service_role`, so every new function *also* gets individually named grants to `anon` and
`authenticated` that a `PUBLIC` revoke leaves standing. Always name the grantees:
`REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon, authenticated`, then `GRANT … TO authenticated` if
the browser needs it. Two migrations were written against the wrong model of this before it was
caught by reading `pg_proc.proacl` back from the live database (drizzle/0039) — which is also the
only reliable way to check it.

**The same trap exists on TABLES, and it is the bigger one.** The bootstrap also runs `ALTER
DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated,
service_role`, so **every** table created here arrived with `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`
granted to `anon` *and* `authenticated` — including `daily_progress`, `daily_targets`, `user_stats`
and `duel_matches`. RLS denied all of it (no write policy), so nothing was exploitable; but that
made one flag per table the entire proof, on tables whose contents are now *read back* as the
authoritative outcome. drizzle/0042 revokes the write set from both roles on all nine, keeping
`SELECT` (real self-select policies depend on it) and `authenticated`'s `UPDATE` on `profiles`
alone (`profiles_update_own` is a used policy). **Grants and RLS should have to fail together.**
New table ⇒ state its write-grant decision, same as a new function; and check it by reading
`information_schema.role_table_grants` back from the live database, not by reading the migration.

**And there is a third grant surface: COLUMNS.** `profiles_update_own` was the last client write
in the schema, and it was column-unrestricted — `update({ is_guest: false })` passed `auth.uid() =
id` cleanly and put a throwaway guest onto the leaderboard, which filters on exactly that flag.
**RLS cannot fix this**: a policy's `USING` sees the old row and its `WITH CHECK` sees the new one,
and nothing in a policy can compare the two, so "this column may not change" is not something a
policy can say. Postgres spells it as a column-level `GRANT`, and drizzle/0045 does: table-wide
`UPDATE` revoked, `GRANT UPDATE (display_name, avatar_url)` — the two columns Settings → Profile
actually edits — put back. `id`, `username`, `is_guest` and `created_at` are now server-owned like
every other table's columns; the signup triggers are `SECURITY DEFINER` and unaffected. Both
editable columns also carry `CHECK` constraints (length, trimmed, no control characters), because
`maxLength={32}` on the input is client-only and PostgREST is reachable without it. A column grant
is **invisible to `information_schema.role_table_grants`** — read `pg_attribute.attacl` for it, as
`schemaGrants.test.ts`'s `COLUMN_GRANT_POLICY` does.

**That decision is now enforced, not just documented.** `lib/db/schemaGrants.test.ts` declares the
intended client access for **every** function and relation in `public` and diffs it against
`pg_proc.proacl` + `information_schema.role_table_grants` on the live database, both directions —
so a new function or table fails the suite until someone writes its grant decision down, and a
silently-restored default fails it too. CI runs it on every push (`.github/workflows/ci.yml`,
database tier). Adding an RPC or a table therefore means adding its entry there; that file is the
policy, and the migration is only how the policy gets applied.

**Views are a relation too, and the `leaderboard` view was the sweep's blind spot.** drizzle/0042
swept the nine tables and didn't consider it, so it kept the bootstrap's full write set for both
client roles until drizzle/0048 revoked it (`SELECT` stays — it exists to be read). Nothing was
exploitable in between, but only because a `JOIN` view is not auto-updatable: a view is
owner-privileged and **isn't checked against RLS**, so making one updatable turns standing
`anon`/`authenticated` grants into real writes to `user_stats` *as the owner*. That made "don't
flatten `leaderboard` to a single-table view or give it an `INSTEAD OF` trigger" a load-bearing
security constraint held by a test comment. Both halves are now checked — `schemaGrants.test.ts`
pins the grants and, separately, the property (`is_updatable`/`is_insertable_into` must stay `NO`)
rather than the view's shape — so re-granting a write set and making it updatable have to happen
together to be dangerous.

`profiles` + `user_stats` rows created by a Postgres trigger on `auth.users` insert (`SECURITY
DEFINER`, so it writes as the owner and is unaffected by the revokes above). RLS: self
`SELECT` on both, plus self `UPDATE` on `profiles` only -- `user_stats` has no client-facing
write policy at all; every write (`lib/stats/actions.ts`) goes through Drizzle's server
connection, which bypasses RLS, so a permissive client policy would just be a tamper vector for
`duel_rating` etc. with no legitimate use. `profiles_update_own` is the row filter; the *column*
filter is the grant (drizzle/0045, above) — `display_name` and `avatar_url` and nothing else.
`user_stats.local_stats_merged_at` (drizzle/0041) is the
one-shot marker for the legacy localStorage merge — it lives here rather than on `profiles`
precisely because `profiles` was the one table still carrying a client `UPDATE`, and a marker the
client can clear is not a marker. `daily_results` exists purely as a per-day idempotency
guard for `recordDailyResult`, self-`SELECT` only — a guard against *replay*, not against forgery
(that's the action's own no-outcome-parameters rule). Leaderboard reads go through the `leaderboard`
view (drizzle/0009, updated in 0037), which exposes public columns only and is checked against RLS
as its *owner* rather than the querying role — the standard Supabase stand-in for a `SECURITY
DEFINER` read.

Duel:
```
matchmaking_queue(user_id PK, pool_window, rating, status, queued_at,
                  last_seen_at,      -- liveness heartbeat; stale rows are unmatchable + swept
                  device_id)         -- stable per browser, survives an identity swap; the
                                     -- self-match guard. No client write policy at all --
                                     -- every write goes through match_or_queue /
                                     -- duel_leave_queue / duel_queue_heartbeat.
duel_matches(id PK, player_a FK, player_b FK,
             status,            -- lobby | countdown | active | intermission | finished | abandoned
             current_round int,
             score_a int, score_b int,      -- CONFIRMED round points (baseline 100 applied in the bar, not stored)
             winner_id FK null,
             rating_delta_a int null, rating_delta_b int null,   -- stored at finish for the results screen
             rematch_requested_by FK null,  -- mutual-consent gate; set by the first requester,
                                            -- consumed when the second one creates the new match
             last_seen_a, last_seen_b,      -- per-player in-match liveness (drizzle/0040). The
                                            -- server's ONLY evidence a player is present, and what
                                            -- forfeitMatch checks before forfeiting the OTHER
                                            -- player. Defaults to now() at insert.
             created_at, finished_at)
duel_rounds(match_id FK, round_index, driver_id FK,
            started_at, ends_at,            -- server timestamps, stamped at ready-gate
            intermission_ends_at null,      -- server-stamped when the round closes
            PRIMARY KEY (match_id, round_index))
duel_round_results(match_id FK, round_index, user_id FK, solved_at null,
                   guess_count, best_proximity numeric, points int,
                   PRIMARY KEY (match_id, round_index, user_id))
```
`score_a`/`score_b` cache confirmed round points for the tug-of-war and winner check; derivable from `duel_round_results`. The 100-point tug-of-war baseline and the live *provisional* score are display/realtime concerns — not persisted per guess (avoid write storms). Player **readiness** is realtime-only (presence/broadcast), never a DB column.

RPCs (Postgres functions, all idempotent where they mutate round/match state):
```
match_or_queue(pool_window, device_id)      -> pairs atomically or enqueues; refuses any
                                               candidate sharing the caller's user_id or
                                               device_id, or stale past QUEUE_STALE_MS
duel_leave_queue()                          -> idempotent dequeue of the caller's own row
duel_queue_heartbeat()                      -> refreshes last_seen_at; no-op if not queued
duel_sweep_stale_queue()                    -> deletes rows past the liveness window
duel_begin_round(match_id, round_index)     -> stamps started_at/ends_at once both ready
duel_submit_guess(match_id, round_index, guess_driver_id)
                                            -> { tiles, solved, points, bestHeat }, one hop
duel_close_round(match_id, round_index)     -> stamps intermission_ends_at, persists points/scores, advances or finishes
duel_heartbeat(match_id)                    -> refreshes the CALLER'S OWN last_seen_a/b; returns
                                               false (and the client stops beating) once terminal
duel_forfeit(match_id)                      -> marks abandoned/finished, opponent wins, writes ratings
duel_state(match_id)                        -> full current phase for resume/reconnect
```

The four above run on the **trusted Drizzle connection only** and have no `auth.uid()` check of
their own -- `EXECUTE` is revoked from `anon`/`authenticated` (drizzle/0034), so a browser cannot
reach them. The round lifecycle the browser *does* drive goes through thin `SECURITY DEFINER`
authorization wrappers, so it gets the same one-warm-hop path as guesses:
```
duel_begin_round_client(match_id, round_index)   -> auth.uid() participant check, delegates to duel_begin_round
duel_close_round_client(match_id, round_index)   -> auth.uid() participant check, delegates to duel_close_round
duel_server_time()                               -> DB now(), for the clock-offset ping
```
Wrappers rather than adding the check inside the originals: `duel_close_round` is ~120 lines of
scoring and advancement rules, and rewriting it to add four lines of authorization would put those
rules at risk for no reason. One definition of the logic, one definition of the authorization.

One more `authenticated`-granted function exists that no application code ever calls — **Postgres**
calls it, as an RLS predicate:
```
duel_topic_participant(topic)   -> is auth.uid() a player in the match this Realtime topic names?
                                   The USING/WITH CHECK of realtime.messages' two policies
                                   (drizzle/0046). SECURITY DEFINER, and total by construction:
                                   a non-duel topic parses to NULL and reads as false, never as an
                                   exception raised inside an RLS check.
```

**Ratings are the deliberate exception to the warm path.** `duel_close_round_client` does not write
them; `applyMatchRatings` (a Server Action, `lib/duel/actions.ts`) does, called separately and only
when a close actually finished the match. The Elo math is a unit-tested TypeScript function
(`lib/game/duelRating.ts`) and porting it to plpgsql would leave two definitions of the same rules
to drift. It's the one moment in a duel where latency costs nothing -- the match is already over.
Because it is no longer in the same server-side breath as the close, it is idempotent on its own:
`duel_matches` row lock + a `rating_delta_a IS NULL` check, so a second caller reads back what the
first wrote.

Knockout (planned — not yet created):
```
-- knockout_games(id, status, current_round, created_at)
-- knockout_players(game_id, user_id, eliminated_round null, score)
-- knockout_rounds(game_id, round_index, driver_id, revealed_hints jsonb, started_at, ends_at)
```

## Realtime channels

- **`lobby`** (presence + broadcast) — the channel every searching player joins; broadcasts a just-created match to the player who was waiting for it (`MATCHED_EVENT`, see `DuelSearching`). Deliberately **public**: it is shared by everyone searching, so scoping it to a participant set isn't a thing the topic can express. Nothing on it is authoritative — a forged `MATCHED_EVENT` just sends a client to a match id it isn't in, which `duel_state` rejects.
- **`duel:{matchId}`** (broadcast + presence) — the live match, and a **private channel**. Broadcast events (all opponent data abstracted — never target or guessed names):
  ```
  round_start      { roundIndex, startedAt, endsAt }
  guess            { playerId, guessCount, bestHeat, provisionalPoints }  -- activity + live bar
  solved           { playerId, points, solveMs }                          -- "+N" burst + bar jump
  round_end        { roundIndex, targetDriverPublic, pointsA, pointsB, scoreA, scoreB,
                     intermissionEndsAt }
  match_end        { winnerId, scoreA, scoreB, ratingDeltaA, ratingDeltaB, breakdown }
  forfeit          { playerId }
  ready            { playerId, ready }          -- the ready-gate; see below
  rematch_request  { playerId }                 -- "I asked, and I'm first"
  rematch_decline  { playerId }                 -- "no" -- terminal for this results screen
  rematch          { newMatchId }               -- "the new match exists, join it"
  ```
  Payload types live in one shared module (`lib/duel/realtimeEvents.ts`) so client and (relaying) server can't drift.

  **Realtime Authorization is on, and `private: true` is the half of it that lives in the client.** A Supabase channel is public unless it asks not to be, and until drizzle/0046 this one didn't ask: any signed-in user — and `AuthProvider` signs *everyone* in on first visit — could join `duel:{N}` for arbitrary `N` and post arbitrary events. Nothing on this channel writes the database (`duel_submit_guess`, `duel_close_round` and `applyMatchRatings` each validate independently), so what a forgery cost was the **round**, live, in a rated match: a fake `round_end` pulled the victim out of play onto an attacker-chosen reveal and scores, a fake `round_start` handed them an `endsAt` already in the past and their own expiry effect turned it into an instant DNF. `config.private` makes Realtime consult RLS on `realtime.messages` at join time — `SELECT` for "may receive", `INSERT` for "may broadcast and track presence" — and drizzle/0046's two policies scope both to the match's own participants via `duel_topic_participant(realtime.topic())`. **Both halves are required**: the flag without the policies is deny-all (RLS is on and there were none), the policies without the flag are never consulted. `lib/db/duelRealtimeAuthorization.test.ts` reproduces the join-time check on the live database, in both directions.

  It costs **nothing per event**: authorization runs once per join (and again on a token refresh), never per broadcast, so `guess`/`solved` are exactly as fast as before. The one client-side consequence is that the join must carry the user's JWT, so `useDuelChannel` awaits `supabase.realtime.setAuth()` before subscribing — a join sent before the session resolved would be evaluated as `anon` and refused.

  **The `duel:` prefix is now a cross-language contract** — `lib/duel/liveMatch.ts#duelChannelName` and the regex inside `duel_topic_participant`. If they drift nothing errors; every duel channel just silently stops joining. The test above pins them together.

  **A private channel narrows the attacker set to the two participants; it does not empty it.** Payloads that decide anything are still re-verified server-side: `onForfeit` re-reads `duel_state`, and `onRoundStart`'s intermission fast path takes the round clock from the idempotent `duel_begin_round_client` RPC rather than from the broadcast (audit 2026-07-29 §0.2 — the payload says *that* a round started, never *when*). `round_end`/`match_end` are still applied as sent, which is now an opponent-trust decision rather than an internet-trust one.

  **`ready` is a broadcast, not a presence field** — this is deliberate and must not be "tidied up" back into presence. Presence has a much stricter Supabase rate limit ("Client presence rate limit exceeded") that a *single match* can trip on its own: every ready-gate (pre-match hold, then once per intermission) tracks at least once, on top of the staging channel's own tracking, and a few rounds is enough to get the whole channel force-closed by the server — silently, with no reconnect. Broadcast has no such ceiling in practice (`guess`/`solved` fire constantly all match without issue). Presence is kept for the one thing it's genuinely needed for: **join/leave membership** for disconnect detection, via a single `track()` per subscription, never repeated.

  `ratingDeltaA/B` on `match_end` are nullable on purpose: the rating write is a separate call from closing the round (see "Ratings are the deliberate exception"), so if it hasn't landed the opponent shows no delta rather than a fabricated "+0". The results panel reads the authoritative values from `duel_matches` regardless.

## Architecture constraints

- `lib/game/compare.ts` and `lib/game/duelScoring.ts` (speed + proximity + live-score helpers) are pure and unit-tested. Don't touch compare's rules unless a task says to. **Both are mirrored in plpgsql and both are pinned by a parity suite** — `compare.sqlParity.test.ts` and `duelScoring.sqlParity.test.ts`. The duel one is the more urgent of the pair, because both sides are live *simultaneously*: the TypeScript drives the tug-of-war bar the player watches, the SQL writes the authoritative score, so drift makes the bar lie. It pins the **live** definition rather than a transcription — the arithmetic is extracted from `pg_get_functiondef()` and executed, so a weight changed in a future migration fails the suite without anyone remembering the file exists. Neither of these is a caller-free "dead" module; deleting `compare()`/`isWin()`/`speedPoints()` deletes the spec side of a running check.
- **Every constant duplicated into plpgsql has a parity suite, not a comment.** Four rules are mirrored TS↔SQL because a Postgres function can't import TypeScript: the compare ladder, the duel scoring weights, `DAILY_POOL_WINDOW`'s cutoff and `MAX_GUESSES`. All four are now pinned (`compare.sqlParity`, `duelScoring.sqlParity`, `poolWindow.sqlParity`) and run in the database CI tier. **A new duplicated constant gets an assertion there in the same change that creates it** — a keep-in-sync comment is what let the pool cutoff go unguarded, and its failure mode (a daily answer outside the pool the board autocompletes) is silent to everyone including the player. See "Driver pools".
- **A win is driver identity, never tile equality** — `p_guess_driver_id = <target id>`, in all three guess RPCs. The five attributes don't identify a driver uniquely (six colliding pairs on this roster), so a tile-derived win is winnable with the wrong driver. See "Game rules".
- Never send the target driver to a client during a round; comparison and scoring are server-side (via `duel_submit_guess`). The target is revealed only at round end. Opponent reads are abstracted heat/counts only.
- Guess evaluation in **every mode** is **one warm hop** — a `supabase.rpc()` Postgres call (`duel_submit_guess`, `daily_submit_guess`, `infinite_submit_guess`) with optimistic client render. No Next.js Server Action on any guess or daily-hydration critical path; compare runs in the parity-tested SQL `compare_drivers`.
- **The board's first paint never waits on profile/stats.** Daily hydration (`daily_state`) fires as soon as the auth identity resolves and runs in parallel with `loadProfileAndStats`; board readiness gates only on identity + `daily_state`. Chaining data loads behind auth is what made the board take seconds.
- **Ticking state lives in the leaf that renders it, never on a board.** `GuessAnnouncer` and `NextPuzzleCountdown` (daily's "next driver in HH:MM:SS") both hold their own state and pass only real *events* upward — the countdown's single `onRollover` when the UTC day turns. Held on `DailyBoard`, that one `setCountdown` re-rendered `GuessGrid`'s 36 tiles, `ResultCard` and the share `Modal` 60×/minute to repaint eight characters (audit 2026-07-29 §1.2). `GuessGrid` is `memo()`'d for the renders that remain, which is why both callers keep `guesses` in state or a `useMemo` rather than mapping it per render — a fresh array identity makes the memo a no-op.
- Vercel can't hold WebSockets; all realtime goes through Supabase Realtime.
- Matchmaking pairing is atomic (`FOR UPDATE SKIP LOCKED` RPC), never a background worker. Round timing is server-stamped; round advancement, forfeit, and match finish are all idempotent.
- Every phase transition is **ready-gated or server-timestamped** so the two clients stay in sync; a reloaded client resumes via `duel_state`.
- **Daily progress is server-authoritative:** guesses are appended by `daily_submit_guess`, the UTC date is resolved in the database, and localStorage is a cache that never decides whether a day is playable. The server is the only thing that may conclude "you've already played today."
- **No Server Action takes an outcome.** A `"use server"` export is an HTTP endpoint anyone can call with any arguments; results are already recorded server-side, so they are read there, not accepted as parameters. `migrateLocalStats` is the single, deliberate exception (the data exists nowhere else), and pays for it with validation + a server-side once-marker + an `is_guest` check. See "Server Actions never accept an outcome".
- **A derived value is only as trustworthy as the table it's derived from.** Client write *grants* are revoked on every server-authoritative table (drizzle/0042), so reading `daily_progress` back is a real guarantee rather than a bet on RLS alone.
- **The daily answer is unpredictable, not merely hidden.** It's a random pick made once and pinned in `daily_targets`; there is no algorithm anywhere that reproduces it from the date and the pool. Hiding a *deterministic* answer behind grants is not a fix — the pool is in the browser by design.
- **Game windows are auth-reactive:** persistent game state is keyed on `userId` and re-resolves on `onAuthStateChange` with no refresh; a hydration gate prevents a playable board from rendering before state is known.
- Auth identity is continuous: anonymous upgrades link to the same row, never orphan guest data.
- **Streaks are decayed on every read**, never trusted from the stored column — in `AuthProvider` for the viewer and in SQL in the `leaderboard` view for the ranking. A stored streak with a stale `last_daily_date` is meaningless by design.
- **A live match owns the screen.** One `ActiveMatchContext` flag hides the mode tabs, marketing, footer and ad slot (`GameChrome`, `AdSlotGate`). Whatever gets added to the shell, check what it does mid-duel.
- **Realtime readiness rides on broadcast, not presence** (Supabase's presence rate limit force-closes the channel otherwise). Presence is join/leave membership only, one `track()` per subscription.
- **`duel:{matchId}` is a private channel.** `private: true` plus `realtime.messages` RLS scoped to the match's two participants (drizzle/0046). A Supabase channel is public unless it asks not to be, and an unauthenticated live-match channel is a stolen round in a rated 1v1. Any new per-match or per-user channel gets the same treatment — and a `private: true` with no matching policy is deny-all, so it fails closed either way.

## Conventions

- Server Components by default; `"use client"` only where interactivity requires it (game windows, modals, auth, ad consent, all live-match UI).
- Drizzle queries in `lib/db/`. **Every** migration — table DDL, RPCs, RLS policies, views, triggers — lives in `drizzle/`, numbered and registered in `drizzle/meta/_journal.json`. There is no `supabase/` directory; the Supabase CLI isn't part of this workflow. Never inline queries in components.
- Most migrations from 0005 onward are **hand-written SQL**, not drizzle-kit output, because they express things drizzle-kit can't (functions, policies, views, `auth.users` triggers). Adding one means writing the `.sql` file *and* appending its journal entry by hand; `drizzle-kit generate` is only for plain table/column diffs, and `lib/db/schema.ts` carries `.existing()` markers (e.g. the `leaderboard` view) for objects it must not try to create. Apply with `npm run db:migrate`.
- No `any`. If a type is unclear, ask.
- Focused, reviewable diffs over sweeping rewrites.