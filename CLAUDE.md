# DriverPit

A daily Wordle-style web game presented as a full website. Players guess a Formula 1 driver in 5 guesses. Each guess reveals how the guessed driver compares to the target across five attributes.

Daily, infinite, and duel modes work, wrapped in the full site shell (top bar, modals, marketing sections, ads). **Current work: (1) accounts & profiles via auth, (2) settings restructure + a global leaderboard, (3) a UX/quality overhaul of the real-time duel — the engine matchmakes and plays, but the moment-to-moment experience (staging, sync, live feedback, exit handling) is being rebuilt to feel like a real head-to-head race.** A fourth mode, **Knockout**, is planned but not yet built — it's documented here so the duel engine is built with the right seams. Do not change the comparison engine or the daily/infinite game logic unless a task explicitly says to.

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

- **Infinite** — random driver from a player-selectable pool, unlimited plays, no persistence beyond the current round.
- **Daily** — one driver per day, same for everyone, resets at UTC midnight. Progress persists per-account (localStorage for signed-out legacy, migrated to the account on sign-in). Always the 10-year pool.
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

`/online` is a **landing** that offers a match type: **Duel** (live now) and **Knockout** (rendered but disabled / "coming soon" until built). Guests see a "save your progress" upgrade prompt above the mode options, same copy as Settings. Selecting Duel enters the lobby/matchmaking flow, which is where the **live online count** (presence) shows up.

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

- **General** — hard mode toggle, reduced-motion override, default infinite pool, a note on how UTC reset works, "reset local stats". No filler toggles.
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

- **`lobby`** — pair created, both on the match staging screen. Avatars, handles, ratings, W/L records revealed (grid-start feel). Held ~`MATCH_FOUND_HOLD_MS`. Both clients send a `ready` presence flag.
- **`countdown`** — once both `ready` (or `READY_TIMEOUT_MS` elapses), an RPC stamps round 1's clock and the F1 **lights-out** countdown runs to the absolute `started_at`.
- **`active`** — a round is live (`current_round`). Board + tug-of-war + opponent panel. Ends when both solved or the timer expires.
- **`intermission`** — reveal the correct driver, animate both players' round points, settle the bar, mini-countdown into the next round. Server-stamped `intermission_ends_at` (so both see it the same length), plus a ready-gate before the next `active`.
- **`finished`** — winner decided, ratings + records written; clients drop out of the immersive view back to the site shell to show results.
- **`abandoned`** — someone forfeited or disconnected past the grace window; the remaining player is the winner.

### Timing constants (`lib/game/duelTiming.ts`, tunable)

```
LOBBY_MIN_SEARCH_MS   1000   min time the "searching" UI shows before a match resolves
MATCH_FOUND_HOLD_MS   2500   how long "Match found" + avatars/ratings hold before countdown
COUNTDOWN_MS          4000    F1 lights-out into round 1 (and shorter mini-countdowns after)
ROUND_MS             60000    per-round guessing window (server-stamped)
INTERMISSION_MS       6000    reveal + points animation + mini-countdown between rounds
READY_TIMEOUT_MS      4000    fallback if a client never reports ready
DISCONNECT_GRACE_MS  10000    reconnect window before a dropped opponent forfeits
```

These fix the "everything's too fast to see" complaints: the intermission is a real, unrushed beat and the between-round countdown gates on readiness.

### Flow

1. **Mode select.** `/online` landing shows Duel / Knockout (plus a guest upgrade prompt above them, same as Settings).
2. **Lobby / matchmaking.** Selecting Duel renders the lobby UI *first* (searching animation, online count) and enforces `LOBBY_MIN_SEARCH_MS` before resolving, so the player always sees the lobby load in. A Postgres RPC pairs atomically: `SELECT ... FOR UPDATE SKIP LOCKED` finds a waiting opponent (create match, mark both matched) or enqueues. No background worker. Match by rating when possible; widen the window the longer someone waits; fall back to anyone after a timeout.
3. **Match found (staging).** Both avatars slide in from opposite sides (grid-start), with handles, ratings, and duel W/L. Held `MATCH_FOUND_HOLD_MS`. Both clients report `ready`.
4. **Lights-out countdown.** On both-ready (or timeout), `duel_begin_round` stamps round 1's `started_at = now() + COUNTDOWN_MS`, `ends_at = started_at + ROUND_MS`. Five red lights fill, then out = GO. Clients count to the absolute `started_at`, corrected for clock offset.
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

Guessing must feel immediate. Requirements:
- **One hop, warm path.** Evaluate a guess via a single fast call — prefer a Postgres RPC `duel_submit_guess(match, round, guess_driver_id)` returning `{ tiles, solved, points, bestHeat }` in one round trip (no Vercel serverless cold start). If the compare rules are kept solely in `lib/game/compare.ts` (single source of truth), use a **warm Edge route handler** instead of an RPC; either way, one hop, no cold start. If porting the compare rules into SQL, add a parity test against `compare.ts` fixtures so they can't diverge.
- **Optimistic render.** The guessed row appears instantly with a shimmer and fills when the result returns.
- **Preload the pool.** Fetch the 10-year driver list once on match start so autocomplete is local and instant — no per-keystroke fetch.
- **Note on dev:** part of the current slowness is the Next.js dev server compiling routes on first hit; always sanity-check latency against a production build, not `next dev`.

### Server authority (fairness)

- Round timing is **server-stamped**: `duel_begin_round` sets `started_at`/`ends_at` from DB `now()`; both clients count down to the absolute `ends_at`, correcting for clock offset (ping server time once at match start). Never a client-authoritative clock.
- Round advancement is **client-triggered but idempotent**: when a client observes both done or the timer expired, it calls `duel_close_round` guarded on current round state — whichever fires first advances; the other is a no-op. A `pg_cron` sweep of expired rounds can back this up but isn't required for v1.
- Guesses are validated and scored **server-side**. Never send the target driver to either client during a round; the target is disclosed only in the intermission, after the round is closed. Never send the opponent's guessed names — only abstracted heat/counts.
- **Resume:** a `duel_state(match_id)` RPC returns the full current phase (status, current round, server timestamps, scores, both players) so a reloaded client rejoins at the right beat.

### Exit, forfeit & disconnect

- **Explicit exit:** an Exit control (confirm modal) calls `duel_forfeit(match_id)` — marks the match `abandoned`/finished with the opponent as winner, updates ratings — then broadcasts `forfeit`. The leaver returns to the shell with a "You forfeited" result.
- **Tab close / disconnect:** best-effort `forfeit` broadcast on `beforeunload`, plus **presence** on `duel:{matchId}`: when a client sees the opponent's presence leave and they don't rejoin within `DISCONNECT_GRACE_MS`, it calls `duel_forfeit` on the absent player's behalf (idempotent, guarded) and shows "Opponent left — you win."
- A finished/abandoned match can't be re-entered; `duel_state` reflects the terminal result for a late-loading client.

## Knockout (planned — do not build yet)

For context so the duel engine leaves room for it. A 20-player elimination game under `/online`:

- **Format:** 3 rounds, F1-qualifying style. All players guess the same driver simultaneously.
- **Hints:** unlike duel, clues are **global auto-reveals** — every ~5s a new fact about the target surfaces to everyone (nationality, then debut era, then a team, etc.), independent of guessing.
- **Elimination:** the bottom 5 each round (slowest / furthest / lowest score) are knocked out; survivors advance; a winner emerges from round 3.
- Reuses the live-match core (lifecycle, timers, rounds, scoring, broadcast, ready-gates) with a many-player lobby, an elimination visualization, and the global-hint reveal system.

### Build seam for Knockout

Build the round lifecycle (server-stamped timers, synchronized countdown, per-round driver selection, scoring hooks, match/round state broadcast, ready-gates) as a **reusable "live match" core**, not hard-wired to 2 players. Knockout is the same machinery with N players, an elimination step, and a different hint source. Don't build Knockout now — just don't wall the duel engine off from it.

## News section — RSS, not X

Recent F1 news from RSS feeds — motorsport.com, Autosport, Crash.net, Sky Sports, and RaceFans (formula1.com's official feed and planetf1.com were evaluated but rejected: the former's items have no publish date, so `parseRssItems` correctly drops all of them, and the latter's feed URL currently redirects to a broken page). Fetched server-side, revalidate hourly, merged and sorted by recency. Rendered client-side only as an interactive carousel (`NewsCarousel`): one big featured story (image + title + source + relative time) with prev/next arrows, larger-hit-area dots, and auto-advance (paused on hover/focus, disabled under either the in-app or OS reduced-motion signal — see WCAG 2.2.2) to step through the top ~5 across all sources. The *fetch* stays server-side; only which slide is showing is client state. Do **not** integrate the X/Twitter API — no free read tier, bills per request.

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
           guess_distribution jsonb, last_result jsonb, duel_rating int default 1000,
           duel_wins, duel_losses)
daily_results(user_id FK, date, won, guess_count, created_at, PRIMARY KEY (user_id, date))
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
matchmaking_queue(user_id PK, pool_window, rating, status, queued_at)
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
duel_matchmake(pool_window, rating)         -> pairs atomically or enqueues
duel_begin_round(match_id, round_index)     -> stamps started_at/ends_at once both ready
duel_submit_guess(match_id, round_index, guess_driver_id)
                                            -> { tiles, solved, points, bestHeat }, one hop
duel_close_round(match_id, round_index)     -> stamps intermission_ends_at, persists points/scores, advances or finishes
duel_forfeit(match_id)                      -> marks abandoned/finished, opponent wins, writes ratings
duel_state(match_id)                        -> full current phase for resume/reconnect
```

Knockout (planned — not yet created):
```
-- knockout_games(id, status, current_round, created_at)
-- knockout_players(game_id, user_id, eliminated_round null, score)
-- knockout_rounds(game_id, round_index, driver_id, revealed_hints jsonb, started_at, ends_at)
```

## Realtime channels

- **`lobby`** (presence) — queued + online players; drives the online count on the searching state.
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
- Guess evaluation is **one warm hop** (RPC or Edge handler) with optimistic client render — no serverless cold start on the guessing path.
- Vercel can't hold WebSockets; all realtime goes through Supabase Realtime.
- Matchmaking pairing is atomic (`FOR UPDATE SKIP LOCKED` RPC), never a background worker. Round timing is server-stamped; round advancement, forfeit, and match finish are all idempotent.
- Every phase transition is **ready-gated or server-timestamped** so the two clients stay in sync; a reloaded client resumes via `duel_state`.
- Auth identity is continuous: anonymous upgrades link to the same row, never orphan guest data.

## Conventions

- Server Components by default; `"use client"` only where interactivity requires it (game windows, modals, auth, ad consent, all live-match UI).
- Drizzle queries in `lib/db/`; Supabase RPCs/policies in `supabase/` migrations. Never inline queries in components.
- No `any`. If a type is unclear, ask.
- Focused, reviewable diffs over sweeping rewrites. The duel overhaul is sequenced into small PRs — do one prompt at a time, in order.