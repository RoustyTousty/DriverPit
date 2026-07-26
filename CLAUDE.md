# DriverPit

A daily Wordle-style web game presented as a full website. Players guess a Formula 1 driver in 5 guesses. Each guess reveals how the guessed driver compares to the target across five attributes.

Daily, infinite, and duel modes work, wrapped in the full site shell (top bar, modals, marketing sections, ads). **Current work: (1) accounts & profiles via auth, (2) settings restructure + a global leaderboard, (3) a UX/quality overhaul of the real-time duel — the engine matchmakes and plays, but the moment-to-moment experience (staging, sync, live feedback, exit handling) is being rebuilt to feel like a real head-to-head race, (4) server-side daily progress so a day's board follows the account across devices, now being made fast — daily/infinite guess evaluation and daily hydration move off Next.js Server Actions onto the same warm one-hop RPC path duel already uses.** A fourth mode, **Knockout**, is planned but not yet built — it's documented here so the duel engine is built with the right seams. Do not change the comparison engine or the daily/infinite game logic unless a task explicitly says to.

## Game rules

Five attribute columns per guess, with the guessed driver's F1DB code shown alongside the row:

| Attribute   | Feedback                                |
|-------------|------------------------------------------|
| Nationality | exact / miss                            |
| Team        | exact / historical / miss               |
| Age         | correct / higher / lower (+ closeness)  |
| Debut year  | correct / higher / lower (+ closeness)  |
| Career wins | correct / higher / lower (+ closeness)  |

"higher" means the target's value is higher than the guess. "historical" (team only) means the guess isn't the target's current team but is one they've raced for at some point. "Closeness" is a 0-1 hint on the three numeric columns — the tile shades from grey toward full orange the nearer the guess was, squared falloff; see `lib/game/compare.ts`. 6 guesses max in daily/infinite (duel changes this — see Duel).

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

## Accounts & auth

Uses **Supabase Auth**. Three entry points, one identity model:

- **Anonymous (guest):** every first-time visitor is silently signed in anonymously (`supabase.auth.signInAnonymously()`) — a real `auth.users` row with no email. This gives guests an identity for duels, matchmaking, and stat-tracking from the first visit. Displayed as an auto-generated handle like `user482913` with a preset avatar.
- **Email** and **Google OAuth** for full accounts.
- **Upgrade, don't replace:** a guest signing in with email/Google **links** to their existing anonymous identity so their stats and duel rating carry over. Never create a fresh row that orphans guest progress.

Gating:
- Playing daily / infinite / **duel**: available to anyone, including anonymous guests. (Guests can matchmake; they just show as `userXXXXXX`.)
- Appearing on the **global leaderboard** and editing a public profile: full accounts only. Guests can *view* the leaderboard but aren't ranked on it. Prompt guests to upgrade at the moments it matters (after a duel win, opening the leaderboard).

A `profiles` row and a `user_stats` row are created for every `auth.users` id via a Postgres trigger on signup. RLS: a user reads their own profile and stats, and can update their own profile — `user_stats` has no client write policy at all, since every real write goes through server code (`lib/stats/actions.ts`) on the trusted Drizzle connection; leaderboard reads (once built) go through a `SECURITY DEFINER` view exposing only public columns.

The login/upgrade UI is a **modal** (`components/auth/AccountModal.tsx`, reusing the Modal primitive), openable from the top bar (`components/layout/TopBar.tsx`) — written standalone so its content can move into the Profile settings section with minimal rework once the settings restructure below happens.

Daily results write to `user_stats` via `recordDailyResult` (`lib/stats/actions.ts`), guarded by the `daily_results` idempotency table so replaying the action can't inflate stats. Pre-existing localStorage stats (`lib/stats/store.ts`, from before this feature existed) are folded in once via `migrateLocalStats`, triggered by `AuthProvider` the moment a guest's `profiles.is_guest` flips to `false`.

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
- **The day's target is pinned, not recomputed per call.** `daily_targets(date, driver_id)` records the day's driver, lazily pinned by the first caller (`INSERT ... ON CONFLICT DO NOTHING`); everyone else reads it. This removes the per-guess pool scan + pick that made guesses slow, and fixes a latent bug where a mid-day pool change silently changed the target. Every path that needs the target (hydrate, guess, reveal) reads this one row — one source of truth.
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

When `daily_submit_guess` completes a day it marks the row complete and calls the existing `recordDailyResult` path, still guarded by `daily_results`, so streaks and distribution can't be double-counted by a replay, a second device, or a re-hydration.

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
  |  TOP BAR   logo ....... [settings] [cup] |  <- persistent
  +-----------------------------------------+
  |       [ Daily | Infinite | Online ]      |  <- mode tabs, persistent
  |  +-----------------------------------+   |
  |  |           GAME WINDOW             |   |  <- the only part that changes
  |  |      (swaps by selected mode)     |   |
  |  +-----------------------------------+   |
  |         [   AD BANNER SLOT   ]           |  <- persistent, fixed height
  +-----------------------------------------+
  |  --------------  divider  ------------   |
  |   How to play / Game modes / FAQ / About  |  <- compact teasers, each with a
  |          teasers / News (RSS)             |     "See more →" link out to (info)
  +-----------------------------------------+
  |  FOOTER                                  |
  +-----------------------------------------+
  ```

  `app/(game)/layout.tsx` holds the top bar, mode tabs, ad slot, marketing teasers, footer. `/daily`, `/infinite`, `/online` render only their game window into `{children}`. Layouts persist across route changes, so switching modes swaps just the game window. `/` redirects to `/daily`. Mode tabs are `next/link`s highlighting the active route.

- **`app/(info)/`** — `/about`, `/faq`, `/game-modes`, `/how-to-play`. Standalone full-detail pages, same footer, but `InfoTopBar` instead of `TopBar`/mode tabs: logo, nav links to the other info pages, and a "Play now" CTA back into the game shell. No ad slot, no marketing teasers here — these pages *are* the detail the home teasers link out to. Each teaser component (e.g. `FaqTeaser`) and its full counterpart (`Faq`) are separate components sharing content style but not JSX, so the home page can stay short without truncating the real page.

`(game)` and `(info)` are route groups — the parens are stripped from the URL, so paths stay flat (`/faq`, not `/info/faq`).

`/online` is a **landing** that offers a match type: **Duel** (live now) and **Knockout** (rendered but disabled / "coming soon" until built). Guests see a "save your progress" upgrade prompt above the mode options, same copy as Settings. Selecting Duel enters the lobby/matchmaking flow.

## Design system

Direction: **modern, clean, precise, thoughtful.** Dark UI. Orange is the single accent — used minimally but noticeably. Restraint is the aesthetic; when in doubt, remove.

### Color tokens (CSS variables in `globals.css`, consumed via Tailwind theme)

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

Two families via `next/font`:
- **Display / UI:** a precise geometric or grotesk sans (e.g. *Geist* / *Inter Tight*) — logo, headings, tabs, buttons.
- **Data / tiles:** a tabular-figure mono (e.g. *Geist Mono* / *JetBrains Mono*) — tiles, counts, years, **timers, scores**. Tabular figures so numbers don't jitter (critical for the duel countdown and tug-of-war score).

Intentional scale (e.g. 12 / 14 / 16 / 20 / 28 / 40).

### Surface, spacing, motion, quality floor

- Radius consistent, small-to-medium (`rounded-lg`). Separators 1px `--border`.
- Game window: single `--surface` card, centered, max-width ~640px. Marketing content wider (~720-960px) and calmer.
- Motion minimal and purposeful: tile reveal, button press, modal enter/exit. Respect `prefers-reduced-motion`. No ambient loops — **except** the duel tug-of-war bar and countdown, which are live and must animate smoothly (still honor reduced-motion by snapping instead of easing).
- Mobile-first (most players on phones). Visible `--accent` focus rings. Modals trap focus, close on Escape + backdrop.
- Themed scrollbar; `html` has `scrollbar-gutter: stable` so modal scroll-lock doesn't shift content. Don't remove without an equivalent fix.

### Duel visual consistency (important)

The duel **guess board must look and behave exactly like the daily/infinite board** — the same guess-row component, the same driver-initials treatment on the side, the same tiles, the same input + autocomplete. The duel is *daily's board plus duel chrome* (tug-of-war, opponent panel, round/timer header), never a bespoke second board. Extract the daily row/tile/initials/input into shared components under `components/game/` and consume them in all three modes so styling can never drift. Anything net-new in duel (tug-of-war, opponent avatars, reveal card, results panel) uses the same tokens, radii, fonts, and motion rules as the rest of the site.

## Modals

One reusable `Modal` primitive (focus trap, Escape, backdrop close, scroll lock) backs all of these.

### Settings modal — sectioned

Restructure the settings modal into **three sections** (tabs or a left rail):

- **General** — hard mode toggle, colorblind mode, show flags, default infinite pool, a note on how UTC reset works, "reset local stats". No filler toggles. There is deliberately **no in-app reduced-motion override** — motion follows the OS `prefers-reduced-motion` setting alone (`motion-reduce:` for CSS, `usePrefersReducedMotion()` for JS-driven animation). A second switch for something the OS already exposes globally is exactly the filler this section is meant to avoid.
- **Profile** — avatar, username / display name (editable for full accounts; read-only `userXXXXXX` for guests), and the auth controls: sign in / sign up with email or Google, sign out, and for guests a prominent "Save your progress — create an account" upgrade path. Show which state the user is in.
- **Statistics** — the personal stats that used to live in the standalone cup popup now live *here*: games played, win %, current + max streak, guess-distribution bar chart, and duel record (rating, wins, losses).

### Leaderboard modal — repurposed cup button

The top-bar **cup** button now opens a **global Leaderboard** (not personal stats — those moved to Settings → Statistics). Content: rankings by duel rating, and a daily-streak board. Full accounts only are ranked; guests see the board with an upgrade prompt. Reads go through the public leaderboard view. Label it "Leaderboard".

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

```
LOBBY_MIN_SEARCH_MS   1000   min time the "searching" UI shows before a match resolves
MATCH_FOUND_HOLD_MS   2500   how long "Match found" + avatars/ratings hold before countdown
COUNTDOWN_MS          3900    F1 lights-out into a round -- the SAME for every round
COUNTDOWN_GO_HOLD_MS   700    lights-out + "GO!" beat, inside the countdown (see below)
ROUND_MS             60000    per-round guessing window (server-stamped)
INTERMISSION_MS       6000    reveal + points animation + mini-countdown between rounds
READY_TIMEOUT_MS      4000    fallback if a client never reports ready
DISCONNECT_GRACE_MS  10000    reconnect window before a dropped opponent forfeits
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
7. **Match end.** Higher aggregate (excluding the equal 100 baseline) wins; update both ratings + records. Clients leave the immersive view and return to the **site shell**, which renders a results panel: WIN/LOSE, final score, rating delta (±), per-round breakdown, and CTAs (**Rematch** re-queues the pair, **Find new opponent**, **Back to modes**). Guests get an upgrade prompt on a win.

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
- **The round lifecycle is one warm hop too, for the same reason guesses are.** `beginRound`/`closeRound` are `supabase.rpc()` calls from the browser, never Server Actions. This is not only about feeling fast: a round's clock is stamped when the RPC runs but the client only learns when the response arrives, so *any* latency in that path is silently deducted from the countdown the player was meant to watch. A Server Action there (serverless invocation + auth hop + query hop + RPC hop) measured ~20s on a bad connection, which meant no lights at all and landing in a round already a third gone.
- Round advancement is **client-triggered but idempotent**: when a client observes both done or the timer expired, it calls `duel_close_round` guarded on current round state — whichever fires first advances; the other is a no-op. A `pg_cron` sweep of expired rounds can back this up but isn't required for v1.
- Guesses are validated and scored **server-side**. Never send the target driver to either client during a round; the target is disclosed only in the intermission, after the round is closed. Never send the opponent's guessed names — only abstracted heat/counts.
- **Resume:** a `duel_state(match_id)` RPC returns the full current phase (status, current round, server timestamps, scores, both players) so a reloaded client rejoins at the right beat.

### Exit, forfeit & disconnect

- **Explicit exit:** an Exit control (confirm modal) calls `duel_forfeit(match_id)` — marks the match `abandoned`/finished with the opponent as winner, updates ratings — then broadcasts `forfeit`. The leaver returns to the shell with a "You forfeited" result.
- **Tab close / disconnect:** best-effort `forfeit` broadcast on `beforeunload`, plus **presence** on `duel:{matchId}`: when a client sees the opponent's presence leave and they don't rejoin within `DISCONNECT_GRACE_MS`, it calls `duel_forfeit` on the absent player's behalf (idempotent, guarded) and shows "Opponent left — you win."
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
- `NEXT_PUBLIC_ADSENSE_CLIENT` from env, never hardcoded. Approval is external and needs the deployed site with real content. All ad logic isolated in `components/ads/` + a consent hook.
- **Hide the ad slot during an active duel/knockout match** — a live race is the wrong moment for a banner; show it on daily/infinite and the /online landing, and again on the duel **results** screen (which is back in the shell), not during lobby/countdown/active/intermission.

## Stack

- Next.js 15 (App Router) + TypeScript, Tailwind
- Postgres via Supabase, Drizzle ORM
- **Supabase Auth** (anonymous + email + Google)
- **Supabase Realtime** (broadcast + presence) for matchmaking and live matches
- Deployed on Vercel

## Data

Seeded from **F1DB** (https://github.com/f1db/f1db) — full historical roster. **Jolpica-F1** (https://api.jolpi.ca/ergast/f1/) weekly cron refreshes current wins/teams — cache hard, never call from a request handler; doubles as a Supabase keepalive.

Attribute definitions: age = current age (age at death if deceased); team = most recently raced constructor; wins = all-time race wins; debut = first race-start year; nationality = country string; driver_code = F1DB 3-letter abbreviation (unique only within what's shown together); previous_teams = every distinct constructor raced for; last_active_year = most recent race-start year, drives pool membership.

## Schema

Existing:
```
drivers(id, full_name, driver_code, nationality, date_of_birth, date_of_death, debut_year, career_wins, last_team, previous_teams text[], last_active_year)
```

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
daily_targets(date date PK, driver_id int FK)        -- the day's driver, lazily pinned by the first caller
infinite_rounds(user_id uuid PK FK, driver_id int FK, pool_window text,
                guess_count int, started_at)         -- server-side infinite round state (replaces the signed cookie)
```
`daily_progress` is what makes a day's board follow the account across devices; `daily_results`
keeps its separate job as the stats idempotency guard (don't merge them — one is live board state,
the other is a write-once outcome record). `daily_targets` pins the day's driver so it's an indexed
read, not a per-call pool scan, and can't drift mid-day. `infinite_rounds` moves infinite's round
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
                                  index itself, rejects a complete/exhausted day; SQL compare_drivers
infinite_start_round(pool_window)   -> upserts infinite_rounds with a fresh random pool driver
infinite_submit_guess(driver_id)    -> { tiles, status: won|lost|continue, target? }; enforces the
                                       6-guess cap; target only when status ≠ continue
```

`profiles` + `user_stats` rows created by a Postgres trigger on `auth.users` insert. RLS: self
`SELECT` on both, plus self `UPDATE` on `profiles` only -- `user_stats` has no client-facing
write policy at all; every write (`lib/stats/actions.ts`) goes through Drizzle's server
connection, which bypasses RLS, so a permissive client policy would just be a tamper vector for
`duel_rating` etc. with no legitimate use. `daily_results` exists purely as a per-day idempotency
guard for `recordDailyResult`, self-`SELECT` only. Leaderboard reads (once built) go through a
`SECURITY DEFINER` view of public columns only.

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

- **`lobby`** (presence + broadcast) — the channel every searching player joins; broadcasts a just-created match to the player who was waiting for it (`MATCHED_EVENT`, see `DuelSearching`).
- **`duel:{matchId}`** (broadcast + presence) — the live match. Presence carries connection + `ready` flags (drives the ready-gates and disconnect detection). Broadcast events (all opponent data abstracted — never target or guessed names):
  ```
  round_start  { roundIndex, startedAt, endsAt }
  guess        { playerId, guessCount, bestHeat, provisionalPoints }   -- opponent activity + live bar
  solved       { playerId, points, solveMs }                           -- "+N" burst + bar jump
  round_end    { roundIndex, targetDriverPublic, pointsA, pointsB, scoreA, scoreB, intermissionEndsAt }
  match_end    { winnerId, scoreA, scoreB, ratingDeltaA, ratingDeltaB, breakdown }
  forfeit      { playerId }
  ```
  Payload types live in one shared module so client and (relaying) server can't drift.

## Architecture constraints

- `lib/game/compare.ts` and `lib/game/duelScoring.ts` (speed + proximity + live-score helpers) are pure and unit-tested. Don't touch compare's rules unless a task says to.
- Never send the target driver to a client during a round; comparison and scoring are server-side (via `duel_submit_guess`). The target is revealed only at round end. Opponent reads are abstracted heat/counts only.
- Guess evaluation in **every mode** is **one warm hop** — a `supabase.rpc()` Postgres call (`duel_submit_guess`, `daily_submit_guess`, `infinite_submit_guess`) with optimistic client render. No Next.js Server Action on any guess or daily-hydration critical path; compare runs in the parity-tested SQL `compare_drivers`.
- **The board's first paint never waits on profile/stats.** Daily hydration (`daily_state`) fires as soon as the auth identity resolves and runs in parallel with `loadProfileAndStats`; board readiness gates only on identity + `daily_state`. Chaining data loads behind auth is what made the board take seconds.
- Vercel can't hold WebSockets; all realtime goes through Supabase Realtime.
- Matchmaking pairing is atomic (`FOR UPDATE SKIP LOCKED` RPC), never a background worker. Round timing is server-stamped; round advancement, forfeit, and match finish are all idempotent.
- Every phase transition is **ready-gated or server-timestamped** so the two clients stay in sync; a reloaded client resumes via `duel_state`.
- **Daily progress is server-authoritative:** guesses are appended by `daily_submit_guess`, the UTC date is resolved in the database, and localStorage is a cache that never decides whether a day is playable. The server is the only thing that may conclude "you've already played today."
- **Game windows are auth-reactive:** persistent game state is keyed on `userId` and re-resolves on `onAuthStateChange` with no refresh; a hydration gate prevents a playable board from rendering before state is known.
- Auth identity is continuous: anonymous upgrades link to the same row, never orphan guest data.

## Conventions

- Server Components by default; `"use client"` only where interactivity requires it (game windows, modals, auth, ad consent, all live-match UI).
- Drizzle queries in `lib/db/`; Supabase RPCs/policies in `supabase/` migrations. Never inline queries in components.
- No `any`. If a type is unclear, ask.
- Focused, reviewable diffs over sweeping rewrites. The duel overhaul is sequenced into small PRs — do one prompt at a time, in order.