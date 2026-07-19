# DriverPit

A daily Wordle-style web game presented as a full website. Players guess a Formula 1 driver in 5 guesses. Each guess reveals how the guessed driver compares to the target across five attributes.

Daily, infinite, and duel modes work, wrapped in the full site shell (top bar, modals, marketing sections, ads). **Current work: (1) accounts & profiles via auth, (2) settings restructure + a global leaderboard, (3) a full overhaul of duel into a real-time race format.** A fourth mode, **Knockout**, is planned but not yet built — it's documented here so the duel engine is built with the right seams. Do not change the comparison engine or the daily/infinite game logic unless a task explicitly says to. The existing room-code duel is being *replaced* by the new format below — treat it as legacy.

## Game rules

Five attribute columns per guess, with the guessed driver's F1DB code shown alongside the row:

| Attribute   | Feedback                                |
|-------------|------------------------------------------|
| Nationality | exact / miss                            |
| Team        | exact / historical / miss               |
| Age         | correct / higher / lower (+ closeness)  |
| Debut year  | correct / higher / lower (+ closeness)  |
| Career wins | correct / higher / lower (+ closeness)  |

"higher" means the target's value is higher than the guess. "historical" (team only) means the guess isn't the target's current team but is one they've raced for at some point. "Closeness" is a 0-1 hint on the three numeric columns — the tile shades from grey toward full orange the nearer the guess was, squared falloff; see `lib/game/compare.ts`. 5 guesses max in daily/infinite (duel changes this — see Duel).

The comparison engine (`lib/game/compare.ts`) is pure and unit-tested — don't change its rules unless a task explicitly says to.

## Modes

- **Infinite** — random driver from a player-selectable pool, unlimited plays, no persistence beyond the current round.
- **Daily** — one driver per day, same for everyone, resets at UTC midnight. Progress persists per-account (localStorage for signed-out legacy, migrated to the account on sign-in). Always the 10-year pool.
- **Duel** — real-time 1v1 race, matchmade against a random opponent. 3 rounds, tug-of-war scoring. See the Duel section — this is being rebuilt.
- **Knockout** *(planned, not built)* — 20-player F1-qualifying-format elimination game, lives under `/duel`. See the Knockout section.

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

The whole thing is **one page** — a persistent shell wrapping a swappable game window:

```
+-----------------------------------------+
|  TOP BAR   logo ....... [settings] [cup] |  <- persistent
+-----------------------------------------+
|        [ Daily | Infinite | Duel ]       |  <- mode tabs, persistent
|  +-----------------------------------+   |
|  |           GAME WINDOW             |   |  <- the only part that changes
|  |      (swaps by selected mode)     |   |
|  +-----------------------------------+   |
|         [   AD BANNER SLOT   ]           |  <- persistent, fixed height
+-----------------------------------------+
|  --------------  divider  ------------   |
|  How to play / FAQ / About / News (RSS)  |  <- persistent marketing content
+-----------------------------------------+
|  FOOTER                                  |  <- persistent
+-----------------------------------------+
```

App Router: a shared `layout.tsx` holds top bar, mode tabs, ad slot, marketing sections, footer. Routes `/daily`, `/infinite`, `/duel` render only their game window into `{children}`. Layouts persist across route changes, so switching modes swaps just the game window. `/` redirects to `/daily`. Mode tabs are `next/link`s highlighting the active route.

`/duel` is a **landing** that offers a match type: **Duel** (live now) and **Knockout** (rendered but disabled / "coming soon" until built). Selecting Duel enters matchmaking.

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
- Game window: single `--surface` card, centered, max-width ~520px. Marketing content wider (~720-960px) and calmer.
- Motion minimal and purposeful: tile reveal, button press, modal enter/exit. Respect `prefers-reduced-motion`. No ambient loops — **except** the duel tug-of-war bar and countdown, which are live and must animate smoothly (still honor reduced-motion by snapping instead of easing).
- Mobile-first (most players on phones). Visible `--accent` focus rings. Modals trap focus, close on Escape + backdrop.
- Themed scrollbar; `html` has `scrollbar-gutter: stable` so modal scroll-lock doesn't shift content. Don't remove without an equivalent fix.

## Modals

One reusable `Modal` primitive (focus trap, Escape, backdrop close, scroll lock) backs all of these.

### Settings modal — sectioned

Restructure the settings modal into **three sections** (tabs or a left rail):

- **General** — hard mode toggle, reduced-motion override, default infinite pool, a note on how UTC reset works, "reset local stats". No filler toggles.
- **Profile** — avatar, username / display name (editable for full accounts; read-only `userXXXXXX` for guests), and the auth controls: sign in / sign up with email or Google, sign out, and for guests a prominent "Save your progress — create an account" upgrade path. Show which state the user is in.
- **Statistics** — the personal stats that used to live in the standalone cup popup now live *here*: games played, win %, current + max streak, guess-distribution bar chart, and duel record (rating, wins, losses).

### Leaderboard modal — repurposed cup button

The top-bar **cup** button now opens a **global Leaderboard** (not personal stats — those moved to Settings → Statistics). Content: rankings by duel rating, and a daily-streak board. Full accounts only are ranked; guests see the board with an upgrade prompt. Reads go through the public leaderboard view. Label it "Leaderboard".

## Duel (real-time race — the overhaul)

Replaces the legacy room-code duel. A fast 1v1 where two matchmade players race across **3 rounds (3 different drivers)**, scoring on speed, visualized as a **tug-of-war**.

### Flow

1. **Matchmaking.** Player enters the queue. A Postgres RPC pairs them atomically: `SELECT ... FOR UPDATE SKIP LOCKED` finds a waiting opponent (create match, mark both matched) or enqueues the player. No background worker — pairing happens on join. Match roughly by duel rating when possible; widen the rating window the longer someone waits; fall back to anyone after a timeout.
2. **Lobby.** While queued, a Realtime **Presence** channel shows a searching state and an online-players count. On match, reveal both players' avatars + handles (guests: preset avatar + `userXXXXXX`) with a short "lights out" style countdown into round 1. This is where the F1-race theming lives — make the match-found moment feel like a grid start.
3. **Rounds (x3).** Each round targets one 10-year-pool driver. A **synchronized countdown** (~45s, tunable) runs per round.
   - **Guessing:** unlimited guesses within the timer, each returning the normal 5-attribute comparison feedback (reuse `compare()`). This is guess-driven, not global-hint-driven (that's Knockout).
   - **Success:** points on a sliding scale by *speed* — solving at 5s is worth far more than at 40s. Pure fn `speedPoints(msToSolve, roundMs)`.
   - **DNF (timer expires unsolved):** minor **proximity points** from the player's *best* incorrect guess, derived from its `compare()` result (matched nationality / historical team / era closeness). Pure fn `proximityPoints(bestResult)`.
4. **Match end.** After round 3, higher aggregate score wins; update both players' duel rating and record. Offer **rematch** (re-queue the same pair) and "find new opponent".

### Server authority (fairness)

- Round timing is **server-stamped**: an RPC sets `started_at` / `ends_at` using DB `now()`; both clients count down to the absolute `ends_at`, correcting for clock offset (ping server time once at match start to estimate offset). Never let a client run its own authoritative clock.
- Round advancement is **client-triggered but idempotent**: when a client observes both players done or the timer expired, it calls an advance RPC guarded on current round state — whichever client fires first advances, the other is a no-op. (A `pg_cron` sweep of expired rounds can back this up but isn't required for v1.)
- Guesses are validated and scored **server-side**. Never send the target driver to either client. Never send the opponent's guessed driver names — see the feed.

### Duel UI (distinct from the daily board)

- **Tug-of-war bar** (top, prominent): the one place orange is allowed to dominate — one player's accent fill vs the opponent's muted fill, center = tie, driven live by aggregate score balance `scoreMine / (scoreMine + scoreOpp)`. Animate smoothly; snap under reduced-motion.
- **Opponent feed** (side/under the bar): an *abstracted* read on how the opponent is doing — heat/closeness of their best guess, guess count, solved/DNF — **never their guessed names or the driver**. "Rival closing in" energy, not a spoiler.
- **Closest-guesses board** (replaces the fixed 5-row grid, since guesses are now unlimited): a ranked list of the player's own guesses sorted by closeness, TikTok-leaderboard style — top ~10 shown, a better guess slots into position and pushes the worst off-screen, older/worse guesses fade. Keeps a busy round legible.
- Clear **round indicator** (1/2/3), the countdown in mono tabular figures, and per-round result cards (solved in Xs / DNF + proximity).

### Build seam for Knockout

Build the round lifecycle (server-stamped timers, synchronized countdown, per-round driver selection, scoring hooks, match/round state broadcast) as a **reusable "live match" core**, not hard-wired to 2 players. Knockout is the same machinery with N players, an elimination step, and a different hint source. Don't build Knockout now — just don't wall the duel engine off from it.

## Knockout (planned — do not build yet)

For context so the duel engine leaves room for it. A 20-player elimination game under `/duel`:

- **Format:** 3 rounds, F1-qualifying style. All players guess the same driver simultaneously.
- **Hints:** unlike duel, clues are **global auto-reveals** — every ~5s a new fact about the target surfaces to everyone (nationality, then debut era, then a team, etc.), independent of guessing.
- **Elimination:** the bottom 5 each round (slowest / furthest / lowest score) are knocked out; survivors advance; a winner emerges from round 3.
- Reuses the live-match core (timers, rounds, scoring, broadcast) with a many-player lobby, an elimination visualization, and the global-hint reveal system.

## News section — RSS, not X

Recent F1 news from an RSS feed (motorsport.com / Autosport / formula1.com). Fetched server-side, revalidate hourly, render title + source + link + timestamp. Never client-side. Do **not** integrate the X/Twitter API — no free read tier, bills per request.

## Ads — AdSense + consent

Single responsive banner in the fixed-height slot under the game window.

- `AdSlot` reserves space with a fixed min-height (zero CLS); renders a neutral placeholder pre-approval.
- AdSense script via `next/script` `strategy="afterInteractive"`, gated behind consent.
- **EU audience → consent required:** Google Consent Mode v2 + a Google-certified CMP (built-in Google consent messages are the free default). Ad cookies must not load until consent; default all signals to denied.
- `NEXT_PUBLIC_ADSENSE_CLIENT` from env, never hardcoded. Approval is external and needs the deployed site with real content. All ad logic isolated in `components/ads/` + a consent hook.
- **Hide the ad slot during an active duel/knockout match** — a live race is the wrong moment for a banner; show it on daily/infinite and the /duel landing, not mid-match.

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

Accounts (new):
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

Duel (new — replaces `duel_rooms` / `duel_players`):
```
matchmaking_queue(user_id PK, pool_window, rating, status, queued_at)
duel_matches(id PK, player_a FK, player_b FK, status, current_round int,
             score_a int, score_b int, winner_id FK null, created_at, finished_at)
duel_rounds(match_id FK, round_index, driver_id FK, started_at, ends_at,
            PRIMARY KEY (match_id, round_index))     -- server timestamps
duel_round_results(match_id FK, round_index, user_id FK, solved_at null,
                   guess_count, best_proximity numeric, points int,
                   PRIMARY KEY (match_id, round_index, user_id))
```
`score_a` / `score_b` cached on `duel_matches` for the tug-of-war; derivable from `duel_round_results`.

Knockout (planned — not yet created):
```
-- knockout_games(id, status, current_round, created_at)
-- knockout_players(game_id, user_id, eliminated_round null, score)
-- knockout_rounds(game_id, round_index, driver_id, revealed_hints jsonb, started_at, ends_at)
```

## Realtime channels

- **`lobby`** (presence) — queued players; drives the online count and searching state.
- **`duel:{matchId}`** (broadcast) — round start/end, score updates, abstracted opponent-progress events, match end. Never carries target driver or opponent guess names.

## Architecture constraints

- `lib/game/compare.ts` and the new `lib/game/duelScoring.ts` (speed + proximity) are pure and unit-tested. Don't touch compare's rules unless a task says to.
- Never send the target driver to the client in daily/duel/knockout — comparison and scoring are server-side; clients get tile results and abstracted opponent heat only.
- Vercel can't hold WebSockets; all realtime goes through Supabase Realtime.
- Matchmaking pairing is atomic (`FOR UPDATE SKIP LOCKED` RPC), never a background worker. Round timing is server-stamped; round advancement is idempotent.
- Auth identity is continuous: anonymous upgrades link to the same row, never orphan guest data.

## Conventions

- Server Components by default; `"use client"` only where interactivity requires it (game windows, modals, auth, ad consent, all live-match UI).
- Drizzle queries in `lib/db/`; Supabase RPCs/policies in `supabase/` migrations. Never inline queries in components.
- No `any`. If a type is unclear, ask.
- Focused, reviewable diffs over sweeping rewrites.