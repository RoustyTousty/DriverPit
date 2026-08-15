# DriverPit

A daily Wordle-style web game presented as a full website. Players guess a Formula 1 driver in 6 guesses. Each guess reveals how the guessed driver compares to the target across five attributes.

**Built and working:** daily, infinite and duel modes; anonymous + email + Google accounts with guest upgrade; the sectioned settings modal and the global leaderboard; server-side daily progress that follows an account across devices; the warm one-hop RPC guess path in every mode; the real-time duel end to end (staging, lights-out countdown, live tug-of-war, intermission, results, rematch, forfeit/disconnect handling); custom lobbies (code + shareable link, per-match rounds/clock/driver filter, unranked); RSS news; AdSense scaffolding behind consent. All of it sits in the full site shell (top bar, mode tabs, modals, marketing sections, ad slot, footer).

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

- **Infinite** — random driver from a pool the player *composes*, unlimited plays, no persistence beyond the current round. Round state lives server-side (`infinite_rounds`, keyed on the Supabase identity) so guesses evaluate over the same warm one-hop RPC path as daily/duel — see "Fast guess evaluation". The pool is a filter, not one of the five windows — see "Infinite's driver filter".
- **Daily** — one driver per day, same for everyone, resets at UTC midnight. Progress is **stored server-side per account and follows the user across devices** — the guesses themselves are persisted, not just the outcome. One playthrough per account per day, enforced by the server. See "Daily persistence & sync". Always the 20-year pool.
- **Duel** — real-time 1v1 race, matchmade against a random opponent. 3 rounds, tug-of-war scoring. Always the 20-year pool. See the Duel section.
- **Custom** — the same duel engine, hosted by code instead of matchmade: the host picks the rounds, the round length and the driver pool, and **nothing counts toward rating, W/L or the leaderboard**. See "Custom lobbies".
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

Defined in `lib/game/poolWindow.ts` (pure, shared by server queries and client filtering). Daily always uses `DAILY_POOL_WINDOW`, and so does a duel with no filter of its own — which is every matchmade one. It is `20-years` (drizzle/0052 widened it from `10-years`; the two modes move together — one constant, and `duel_begin_round` mirrors the same cutoff in its unfiltered branch). **These windows are now daily's and the RANKED duel's alone** — Infinite composes its pool instead (drizzle/0053, see "Infinite's driver filter"), and a custom lobby composes one too (drizzle/0054/0056, see "Custom lobbies"), so `POOL_WINDOWS` survives for the seed's report and the parity suite rather than for a picker. A duel falls back to this window exactly when `duel_matches.filter IS NULL`, which is every matchmade one. Autocomplete suggestions are scoped to the active pool. **Daily guess *validation* is scoped to it too** (drizzle/0051) — `daily_submit_guess` refuses a driver below the daily cutoff instead of merely checking they exist, because "pick a driver from the suggestions list" was otherwise a promise the function didn't keep and the day's stored guess list could hold rows the board would never have offered. Not a security fix (win-by-identity means an out-of-pool guess can never win, and it costs the caller their own turn) — it protects the *record* of the day, the guess history and the shareable emoji grid. Infinite and duel still validate existence only: infinite's pool is per-round and player-composed, so the check would need a second copy of the whole filter predicate, and a duel guess is unlimited, so an out-of-pool one costs the player seconds and nothing else.

**A driver already guessed this round isn't offered again — and in daily isn't accepted again.** A repeat guess returns the row the board is already showing and, in daily/infinite, burns one of six turns for it. `DriverAutocomplete` takes a `guessedDriverIds` set and withholds those drivers from the suggestions in all three modes, naming the one the query matched ("Lewis Hamilton — already guessed") rather than removing it silently — otherwise the dropdown says "no driver in this pool matches Hamilton", which is false and reads as a broken search. It withholds without rebuilding the search index (`partitionSearchIndex`, `lib/game/fuzzyMatch.ts`): filtering the `drivers` array instead would hand the component a new array identity per guess and re-fold ~800 names, undoing the fix that made typing instant. `daily_submit_guess` rejects the repeat outright (drizzle/0049), under the same row lock as the append — the suggestions are a *list*, and PostgREST is reachable without one, plus a second device's board can be stale. Not extended to the other two: `infinite_rounds` stores `guess_count`, not the guesses, so there is nothing server-side to compare against; duel guesses are unlimited, so a duplicate there costs seconds rather than a turn.

### Infinite's driver filter

**Infinite's pool is composed, not chosen from a list** (drizzle/0053). `PoolSelect`'s five-window dropdown is gone; a **Filter** button opens a `Modal` (same primitive as Settings/Leaderboard) holding four criteria, ANDed:

- **Seasons** — a two-thumb range over 1950…current year (`YearRangeSlider`: two native `<input type="range">` stacked over one drawn track, so keyboard operation, value announcement and touch AT come free — the input is `pointer-events: none` and only its *thumb* takes pointers, or the upper input swallows every click meant for the lower). The test is an **overlap** (`debut_year <= to AND last_active_year >= from`), not `last_active_year BETWEEN`: "the 1990s" means everyone who raced in them, so a career that began in 1984 or ran on to 2012 belongs. Getting this wrong drops most of the grid from every historical span and looks plausible.
- **Achievement** — one tier of Any / podium finishers / race winners / pole sitters / world champions, as a wrapping chip row. A radio group, not checkboxes: the tiers are alternatives, and ANDing "champion" with "pole sitter" empties easily for no gain.
- **Nationality** and **Team** (`components/ui/SearchableSelect.tsx`). Team matches `previous_teams` — anyone who *ever* drove for them, which is what "Ferrari drivers" means and what `last_team` cannot answer. A native `<select>` was the first cut and was wrong twice: it renders in the OS's own chrome, which reads as a foreign control on this UI, and it can't show the per-option counts. The replacement is the same ARIA 1.2 combobox pattern `DriverAutocomplete` implements (focus stays in the search box, `aria-activedescendant` is the cursor, options aren't focusable), with the same `stopPropagation` on Escape — the panel lives inside a `Modal` that closes from a `document` listener, so one Escape would otherwise dismiss both.

**Every option is counted against the rest of the draft, and unreachable ones are not offered.** With 1994 selected there is no Aston Martin to pick; with Germany selected the team list is the teams Germans actually drove for, and vice versa. `optionsExcludingSelf` blanks the criterion being listed before counting — so an option's number is what you'd get by choosing it, never zero-because-of-itself — and it does **one pass over the roster per list**, not one per option: a 170-entry team list re-counted per option would be 170 scans on every slider tick. The current selection stays in its list even at 0, because a control whose value its own menu denies is worse than a visible zero, and that zero is the explanation for the "No drivers match" line. The alternative — letting the pickers offer every value and reporting the emptiness afterwards — is a menu that lies, across 40-odd nationalities × 170-odd teams × 5 tiers × any span.

**An active filter is displayed exactly one way, everywhere it appears.** `driverFilterParts` (pure) returns the criteria one string each — the span always, then each narrowing that is on — and `describeDriverFilter` is that, joined. `DriverFilterSummary` renders it as a caption: parts on the left, the count on the right, both mono/muted/tabular so the two halves read as one annotation rather than a label and a value. Deliberately **unboxed** — it sits above Infinite's guess input, and a border would make it compete with the input it describes. Used by Infinite, the custom lobby's create screen, the host's waiting screen and the joiner's preview; `DriverFilterButton` (icon only — sliders, not a funnel, because it opens adjustable criteria rather than applying a preset) is the trigger in both modes.

Two richer treatments were tried for the custom create screen and both were worse, for one reason worth recording: **they invented surfaces the site does not have.** A `bg-surface-2` card holding `bg-surface` chips and a `bg-surface` icon well puts *darker* panels inside a *lighter* one, inverting the depth model where `--surface` is the window and `--surface-2` is what is raised and interactive on it; and a large mono driver count is a type size nothing else on the site uses. The control is now built as a **settings row** — label, one-line description, control on the right — which is the shape `components/settings/GeneralSection.tsx` already established for exactly this. The only elevated element is the button, as in Infinite. Reach for an existing idiom before designing a new panel.

Three things hold it together:

- **`lib/game/driverFilter.ts` is the pure half of a TS↔SQL pair**, like the compare ladder. `matchesDriverFilter` scopes the autocomplete; the same predicate lives once in SQL as `pick_filtered_driver` (drizzle/0056), which `infinite_start_round` calls to pick the round's target — and which `duel_begin_round` now calls too, so there is one copy and two callers rather than two copies. Drift means a target outside the player's own filter — untypeable, unwinnable, silent. Pinned by `lib/db/infiniteFilter.sqlParity.test.ts` — through **both** callers — and pinned **behaviourally**: this is a predicate over five columns, not a constant, and the two sides spell it with `= ANY(previous_teams)` vs `.includes()`, so the suite runs the real RPC a dozen times per probe filter and asserts every pick is one the TypeScript admits — plus a coupon-collector pass in the other direction, because a too-*strict* SQL predicate keeps every draw legal while quietly shrinking the pool. This replaced the two `infinite's pool ladder` assertions in `poolWindow.sqlParity.test.ts`.
- **The RPC re-clamps and re-validates everything.** `infinite_start_round(from, to, nationality, team, achievement)` orders a crossed pair, bounds both years, and rejects an unknown achievement — the modal's own clamping is UX, and PostgREST is reachable without it.
- **Applying starts the round.** The panel edits a *draft* and commits on Apply, because applying picks a new target and clears the board; there is no coherent state where the filter has changed but the board is still playing the old pool's driver. Apply is disabled on a filter nothing matches (the RPC refuses it too, but by then the board has already cleared).

The three achievement counts are columns on `drivers` (`championship_wins`, `podiums`, `pole_positions`), straight from F1DB's own totals — unlike `career_wins`, which the seed computes from race results. **They are 0 until the seed next runs**, which is what the migration's defaults mean; `scripts/releaseGuards.ts` carries a Hamilton canary (≥7 titles, ≥190 podiums, ≥100 poles) because a renamed column would zero all three across the roster while preserving the row count, and the only symptom would be "World champions" matching nobody.

**With nothing typed, the dropdown offers a random eight rather than the head of the pool.** An empty query isn't a search, so it isn't answered like one: `fuzzyFilter` hands back the first N in pool order, and the pool arrives alphabetical, so every player in every mode opened the box on the same eight A-names. `sampleSearchIndex` (`lib/game/fuzzyMatch.ts`) draws them instead — a partial Fisher-Yates over a sparse map, so it stays O(8) on an ~800-driver pool and reuses the same prebuilt index as everything else. It is **seeded**, and that is the load-bearing part: the draw happens during render, and `DriverAutocomplete` re-renders on things that have nothing to do with it (the duel's 10Hz round clock, daily's 1Hz countdown), so a `Math.random()` in that path would reshuffle the list under the player's cursor ten times a second. The seed is state, re-rolled *only* when the list opens — so the eight change between guesses but never while they're being read, and deleting a query back to empty returns the same eight rather than silently swapping them. A typed query goes back to the fuzzy ranking untouched.

**The cutoff is mirrored in plpgsql and pinned to the TypeScript by a parity suite.** A Postgres function can't import `DAILY_POOL_WINDOW`, so three live functions carry their own copy: `daily_target_id` picks the day's answer, `duel_begin_round` picks each unfiltered duel round's, and `daily_submit_guess` is the one that uses it to *reject* rather than to pick — all three last carried the same cutoff into **drizzle/0052**, which is what moving the window means in practice (the constant and every plpgsql copy in one migration, never a TypeScript-only edit). `duel_begin_round` has been replaced twice since, by drizzle/0055 and drizzle/0056, each reproducing that cutoff verbatim — which is exactly why the parity suite reads the LIVE definition rather than trusting the newest migration that happens to mention the function. `infinite_start_round` used to be a fourth site mirroring the whole `poolCutoffYear` ladder; drizzle/0053 replaced that mode's window with a composed filter, so it no longer carries a copy of this constant at all (its own TS↔SQL pair is pinned separately — see "Infinite's driver filter"). Change the constant alone and **only the autocomplete moves** — the target keeps coming from the old window, so the daily page can serve a driver the player cannot type, and the guess check refuses one it does offer, with nothing erroring and nothing looking broken. `lib/game/poolWindow.sqlParity.test.ts` (database CI tier) closes that, and pins `MAX_GUESSES`'s three plpgsql copies in the same pass (audit 2026-07-29 §2.5). The daily cutoff is checked **behaviourally** — `daily_target_id` takes the date as a parameter, so a far-future probe day brackets its cutoff year from both sides with no string matching; the other sites are extracted from `pg_get_functiondef()` and executed, same as the scoring suite. Both probe days must be in the future, and the suite refuses to run rather than pin-and-delete a live day's answer. The guess check needs **both tiers to be complete**, and deliberately: the parity suite pins the *cutoff*, `lib/db/dailyRpc.test.ts` pins the *predicate* behaviourally (an out-of-pool driver is refused, an in-pool one is not), and an extraction alone would never notice a `<` becoming a `>`.

## Accounts & auth

Uses **Supabase Auth**. Three entry points, one identity model:

- **Anonymous (guest):** a visitor is signed in anonymously (`supabase.auth.signInAnonymously()`) the first time they do something that needs an identity — a real `auth.users` row with no email. **Not on page load**: see "Identity is acquired on the first interaction that needs one" below, which is the whole of why. Displayed as an auto-generated handle like `user482913` with a preset avatar.
- **Email + password** and **Google OAuth** for full accounts.
- **Upgrade, don't replace:** a guest signing in with email/Google **links** to their existing anonymous identity so their stats and duel rating carry over. Never create a fresh row that orphans guest progress.

### `/auth/sign-in` — the one login page

**All auth UI lives on one page, `/auth/sign-in`, and nowhere else.** `components/auth/AuthPanel.tsx` is the whole of it — the tabs, the email + password form, Google, forgot-password — and `app/auth/sign-in/page.tsx` is the only thing that renders it. It used to be inlined in Settings → Profile; a modal is the wrong container for a flow that *leaves*, since creating an account sends the player to their inbox, signing in may send them to a password manager, and a recovery link has to land on a page regardless — half the flow already happened somewhere a dialog couldn't follow.

Standalone, in **neither route group**, exactly like its sibling `/auth/reset-password`: not a game window (no mode tabs, no ad slot, no marketing) and not an info page (no `InfoTopBar` nav into content). It keeps the logo as a link because a page with no top bar and no way back is a dead end, and this one is reachable from six places.

**Three states, and the fork is `isGuest` — never "is there a session".** Every visitor has one (`AuthProvider` signs first-time visitors in anonymously), so a session test would show a signed-in visitor the sign-up form and a guest the "you're signed in" card. Same trap, same answer, as `/auth/reset-password`'s gate. A full account landing here has confirmed an email address or typed the URL; what it needs is the way out, not a form. The third state is `identityStatus === "loading"` — gated on the **identity** half only, not on `profile`, so the form isn't held behind a fetch it doesn't use (and doesn't hang forever if that fetch fails).

**`?next=` is a destination, not an action.** Read in a mount effect from `window.location.search` — the same pattern as `/online?join=`, for the same two reasons (a `searchParams` page prop opts the route out of static rendering; `useSearchParams()` drags in a Suspense boundary for a client-only value) — and put through `sanitizeNextPath`, because it ends up inside the `redirectTo` handed to Supabase. Deliberately **not** stripped from the URL afterwards, unlike `?join=`: nothing fires on arrival, so a refresh should still know where the player was going. `signInHref(next)` (`lib/auth/routes.ts`) is the other half; `routes.test.ts` pins the round trip, since a broken one silently returns everyone to `DEFAULT_NEXT` with no symptom anybody would connect to an encoding rule.

One thing it does **not** carry: a password sign-in lands on `/` regardless, because `AuthProvider.signInWithPassword` hard-navigates there by design (see "Auth state is reactive, everywhere"). That is a clean boot into a different account, which is the point; `next` applies to the two flows that come back through `/auth/callback`.

### Email + password: two tabs, one identity model

The page shows a guest a **Create account / Sign in** tablist (`SettingsModal`'s, same as `CustomLobby`'s Host/Join) over an email + password form, with one **Continue with Google** button below both. The two tabs are two genuinely different intents — "that email is taken" is an error on one and the premise of the other — and someone arriving with an account already knows which they want.

- **Create account is `updateUser({ email, password })`, in ONE call, and both halves of that are load-bearing.** It is `updateUser` and not `signUp` because `signUp` posts **no Authorization header** (checked in `@supabase/auth-js`), so it would mint a second, empty `auth.users` row and orphan the guest's daily, stats and rating — the "upgrade, don't replace" rule, broken silently. And the two attributes go together because GoTrue **refuses** a password on an anonymous user unless the same request carries the address it will belong to: *"Updating password of an anonymous user without an email or phone is not allowed"* (422 `validation_failed`, measured against this project). The password applies immediately; the address stays pending until the emailed link is opened, and only then does `auth.users.is_anonymous` flip — which `handle_user_updated` (drizzle/0006) mirrors onto `profiles.is_guest`.
- **Sign in goes through `AuthProvider.signInWithPassword`, never `supabase.auth.signInWithPassword` in a component** — the same rule, and the same reason, as `signOutAndReset` being the only sign-out. Signing in as someone else *abandons* the identity currently signed in, so it releases the same commitments (live match, queue row, open lobby, in-flight guess) first, behind the same confirmation prompt.
- **Forgot password** is not optional garnish: with no support desk behind this app, a password nobody can reset locks an account forever. `resetPasswordForEmail` → `/auth/callback` → **`/auth/reset-password`**, a standalone page (in neither route group — it is a step inside an auth flow, not a game window or an info page). Its gate is `user.is_anonymous`, **not** "is there a session": every visitor has one, so "no session" never happens and a *guest* landing there is what "this link didn't take" looks like. PKCE means the link must be opened in the browser that requested it; that page says so.
- **Auto-sign-in on the next visit is already the behaviour, not a feature added here** — the session is cookie-backed via `@supabase/ssr` and `middleware.ts` refreshes it on every real page request. A password exists so the account can be reached from a *different* device, and so a sign-out is not one-way.

`lib/auth/credentials.ts` is the pure half: `normalizeEmail` (trim + lowercase, so one address is one account on our side as well as GoTrue's), `validateEmail`, `validateNewPassword` (`PASSWORD_MIN_LENGTH` 8) and `describeAuthError`. Two rules in it that look cosmetic and aren't: **`validateNewPassword` must never run on the sign-in form** — an account made before that floor existed can hold a shorter password, and telling someone their own password is too short is a dead end — and `email_exists` is rewritten to name the *other tab*, because a returning player always lands on a guest session, which opens on Create account.

**The post-redirect message is chosen by a `flow` param, not assumed.** Three journeys come back through `/auth/callback` — Google, an email-address confirmation, and a password reset — and "Signed in with Google" is false for two of them. Whoever builds a `redirectTo` names its flow; `sanitizeAuthFlow` allowlists it (unknown ⇒ `google`, which is what an absent param means: the hash-forward branch and any link built before this); the route forwards it as `?auth=<flow>` on **both** the success and failure paths, and `OAuthErrorHandler` maps it to copy. The failure path needs it too: GoTrue's `/verify` runs *before* the redirect, so a confirmation link opened on a second device has already confirmed the address and only the PKCE exchange failed — reporting that as a Google error would be wrong twice over.

Three `dom`-tier suites pin the observable half. `components/auth/AuthPanel.test.tsx`: that a password field exists at all, that the create call carries both attributes, that sign-in goes through `AuthProvider`, that a live match is confirmed before either, and that the email/Google redirects carry the panel's `next` rather than the current pathname (they were built from `window.location.pathname`, which on a dedicated sign-in page would land a player who just confirmed their address back on the sign-in page). `app/auth/sign-in/page.test.tsx`: the three-state fork and the `?next=` handling above. `components/settings/ProfileSection.test.tsx`: that a guest gets a **link** there and that the form is *gone* rather than duplicated — two live copies of an auth form is what this extraction exists to prevent, since one of them stops being the copy that gets fixed.

**A failed round trip names its cause, because "please try again" is sometimes the wrong advice.** `/auth/callback` forwards `error_code` *and* a bounded `error_description` (`sanitizeErrorDescription`), the hash-forward script reads the description straight out of the hash at runtime (so it never becomes an interpolation site — see `lib/auth/oauthCallback.ts`), and `OAuthErrorHandler` logs both before stripping the URL, which is the only record that outlives the redirect. Two codes get their own copy: a **rate limit** (`over_request_rate_limit` and friends) says to wait, because retrying spends another request against an empty bucket — and this app is unusually exposed to that, since every first-time visitor is signed in anonymously and the limit is per **IP**, so a developer testing in a loop or a CI run of the database tier drains the same bucket real visitors draw from. Everything else keeps its sentence plus the code in parentheses; an unnamed failure is a bug report nobody can act on.

**Auth emails are branded in the dashboard, and the templates live in `docs/email-templates/`.** Body styling is the Templates panel; the *sender* (`DriverPit <…>` instead of `noreply@mail.app.supabase.io`) requires **custom SMTP**, and the built-in service's ~2-emails-per-hour cap is not raisable without it — so a project on the built-in sender has unbranded mail *and* mail that mostly doesn't arrive. Brand **both** "Confirm signup" and "Change Email Address": a guest upgrading calls `updateUser({ email, password })` on an existing anonymous row, so which of the two GoTrue sends depends on how it classifies that and on "Secure email change". `{{ .ConfirmationURL }}` must stay verbatim — hand-building a link from `{{ .Token }}` breaks the PKCE exchange and the `?auth=<flow>` arrival message with it.

Gating:
- Playing daily / infinite / **duel**: available to anyone, including anonymous guests. (Guests can matchmake; they just show as `userXXXXXX`.)
- Appearing on the **global leaderboard** and editing a public profile: full accounts only. Guests can *view* the leaderboard but aren't ranked on it. Prompt guests to upgrade at the moments it matters (after a duel win, opening the leaderboard).

A `profiles` row and a `user_stats` row are created for every `auth.users` id via a Postgres trigger on signup. RLS: a user reads their own profile and stats, and can update their own profile — `user_stats` has no client write policy at all, since every real write goes through server code (`lib/stats/actions.ts`) on the trusted Drizzle connection; leaderboard reads go through the owner-privileged `leaderboard` view, which exposes only public columns.

The login/upgrade UI is the page above; **Settings → Profile** (`components/settings/ProfileSection.tsx`) keeps only what is genuinely a setting — avatar, display name, the Guest/Account badge, sign out — plus one row linking a guest to `/auth/sign-in`. There is no account *modal*, and the top bar's two buttons are still Leaderboard (left) and Settings (right), nothing else.

**Every "Save your progress" nudge is `GuestUpgradePrompt` (`components/auth/`), and every one of them is a link.** There were four hand-copied cards — Settings, the leaderboard, `/online`, the duel results panel — which had already drifted apart in their focus rings and each reached the auth UI its own way: two through `openSettings("profile")`, one through an `onUpgrade` prop threaded down from `GameModals`. One component with one `description` prop replaced all of it, which is what let `LeaderboardModal.onUpgrade` be deleted outright. Only the sentence varies per site, because only the sentence should: the stake differs ("appear on the leaderboard" vs "keep your duel rating"), and a generic line in all four is the version nobody acts on. It has no client hooks — a nudge is a card and a link.

One accepted consequence: following a nudge is a **navigation**, so a guest who does it from inside a live match leaves the match (presence drops, the opponent's grace timer runs out, forfeit). That escape hatch already existed and is not new — the top bar stays visible mid-match and its logo has always linked to the daily board — so this adds a second door to a room that was never locked, rather than a new class of bug. The in-match-reachable nudge is Settings' banner; if that ever needs guarding, guard the logo in the same change.

Daily results write to `user_stats` via `recordDailyResult` (`lib/stats/actions.ts`), guarded by the `daily_results` idempotency table so replaying the action can't inflate stats. **It takes no arguments**: `won`, `guessCount` and the UTC day are all read back from the `daily_progress` row `daily_submit_guess` just wrote. See "Server Actions never accept an outcome" below for why that isn't optional. Pre-existing localStorage stats (`lib/stats/store.ts`, from before this feature existed) are folded in once via `migrateLocalStats`, triggered by `AuthProvider` the moment a guest's `profiles.is_guest` flips to `false`.

### Server Actions never accept an outcome

Every `"use server"` export is an **ordinary HTTP endpoint** whose action id ships in the client bundle. It can be called from a devtools console with arguments of the caller's choosing, in a loop, at any time, by any signed-in user — including a fresh anonymous guest. The RPCs in this codebase are locked down hard; the Server Actions beside them were not, and three of them took the *result* of something as a parameter (audit 2026-07-27 §3.2/§3.3/§3.7). Together they were the entire "fake your way onto the leaderboard" surface.

The rule: **a parameter is for something the server genuinely cannot know.** An outcome is never that — it has already been recorded server-side, so it is *read*, not accepted.

- `recordDailyResult()` — took `(won, guessCount)`. `(true, 1)` from a console wrote a win, a 1-guess distribution bucket and an extended streak for a day never finished; worse, the `daily_results` PK guard is first-write-wins, so the forged row also **suppressed** that day's honest result. Now derived from `daily_progress`, with the UTC day resolved by the **database** clock — which also closes the three-clock split-brain (§3.10) that could reset a live streak.
- `forfeitMatch(matchId, forfeitedPlayerId)` — still takes the target, because the disconnect path genuinely is the remaining player acting on the absent one's behalf. What it no longer takes on trust is the *absence*: forfeiting someone else now requires their `duel_matches.last_seen_a/b` heartbeat to be stale (see "Exit, forfeit & disconnect"). Forfeiting yourself stays unconditional.
- `applyMatchResult(...)` — never a `"use server"` export at all, which is the same rule one step earlier. It takes `winnerId` and two player ids, so exporting it from `lib/duel/actions.ts` would be a client-callable "tell the server who won this match, and which two players to pay". It lives in a plain module; the only ways in are the two cookie-resolved actions above, which read every argument off a match row they have already authorized the caller against. Same split, same reason, as `lib/stats/recordDailyResult.ts`.
- `migrateLocalStats(local)` — the one action that legitimately must take client data, since pre-accounts stats exist nowhere but the player's browser. That is exactly why it carries all three of: validation (`lib/stats/localStatsMerge.ts`, pure + unit-tested), a **server-side** once-marker (`user_stats.local_stats_merged_at`, taken under a row lock), and an `is_guest = false` check read server-side.

A PK guard stops a **replay**, not a **forgery** — they are different threats and neither defence substitutes for the other. And a derived-server-side value is only as trustworthy as the table it comes from, which is why drizzle/0042 removed the client write *grants* from every server-authoritative table (they were denied by RLS alone until then — see "Schema").

### Auth state is reactive, everywhere

`AuthProvider` subscribes to `supabase.auth.onAuthStateChange` and exposes `{ userId, isGuest, identityStatus, status }`, each `loading | ready`. **Every game window is a function of `userId`** — no leftover board from a previous identity, ever. Nothing may key persistent game state off anything but the current `userId`.

**It publishes two contexts, and `identityStatus`/`status` is the seam** (audit 2026-07-30 §1.1). `useAuthIdentity()` gives `{ userId, isGuest, identityStatus, refresh, signOutAndReset }` — **primitives and stable callbacks only**; `useAuth()` gives that merged with `{ user, session, profile, stats, status, loading }`. Because the provider wraps the whole app, one context value made `userId` and `stats` a single subscription: `refresh()` after a completed daily, whose only job is to pull the new `user_stats` into Settings, re-rendered the board that had just finished — for data it doesn't display. Memoizing the value can't fix that; profile/stats genuinely changed. Two rules keep it working: **the identity value must stay free of object-valued fields** (`user`/`session` are re-materialized by every `supabase-js` `getSession()`, so they belong on the account side, where all three of their readers want profile/stats anyway), and a component that only destructures identity fields uses `useAuthIdentity()` — `DailyGame`/`DailyBoard` and `GeneralSection` do. There is no stale-half hazard: both values are computed in the same render of the same provider from the same state, so the split is about *who subscribes*, never about *when*. `AuthProvider.test.tsx` (`dom` tier) pins the pair — an identity consumer must not re-render on a stats change, and must re-render on an identity change.

**Identity is acquired on the first interaction that needs one, never on mount** (roadmap Pass 4a). `AuthProvider` used to call `signInAnonymously()` for any visitor with no session as it mounted; Googlebot executes JavaScript and carries no cookies between renders, so **every crawl of every URL minted a permanent `auth.users` + `profiles` + `user_stats` row** — multiplied by the archive's several hundred pages, against a 50k-MAU free tier. Measured 2026-08-08: **692 of 694 profiles were guests**, for a handful of real players. `ensureIdentity()` on the identity context replaced it, called from ten event handlers (the guess input taking focus, opening Settings or the leaderboard, picking a mode on `/online`, hosting or joining a lobby, the two auth-panel submits) and from nothing that runs on render. One `signInAnonymously()` call remains in the repo, inside it.

Three things make that safe rather than merely cheaper:

- **`identityStatus` is three-valued: `loading | anonymous | ready`, and the first two are not the same question.** `anonymous` means `getSession()` came back *empty* after `withRetry` — proven no stored session. `loading` covers the retryable-failure branch, where a real session may exist and we could not reach it. Only `anonymous` licenses a game window to render a fresh **playable** board, and it does so honestly: "how much of today is already played" has a known answer, none. Collapsing the two would let a returning player whose token refresh was slow see an empty board and replay their day — the exact bug the no-replay-flash gate exists to prevent.
- **It is called on interaction, not in an effect.** An effect is indistinguishable from a render to anything automated, which is the whole cost being removed. Calling it a beat early — a focus, a menu click — also keeps the sign-in off the critical path, so a first guess is still one warm hop rather than a sign-in followed by one.
- **One in-flight sign-in at most**, latched in a ref so it is observable synchronously. Two entry points can fire within a frame (focusing the input while a modal opens) and two concurrent calls would mint two rows and orphan one.

`AuthPanel` is where this is a hard precondition rather than a head start: `updateUser({ email, password })` upgrades the anonymous row that is *already signed in*, so with no session there is nothing to upgrade — and arriving at `/auth/sign-in` without touching the game is ordinary, since six places link there. Both it and the Google `linkIdentity()` path mint the guest first, which is what keeps "upgrade, don't replace" true for someone whose first action on the site is signing up. `components/auth/AuthProvider.test.tsx` pins the pair that matters: no sign-in for a visitor who never interacts, exactly one under concurrent callers; `DailyGame.test.tsx` pins that `anonymous` renders a playable board and fires no `daily_state`, while `loading` still holds the skeleton.

**The rows it already produced are swept monthly.** `sweep_abandoned_guests` (drizzle/0059) deletes guests older than 60 days with no daily result, no board, no infinite round, no duel match, no queue row, no lobby and untouched stats — anything at all keeps the row, because a few hundred wasted bytes is nothing against somebody's streak. It deletes from **`auth.users`**, not `profiles`: everything else cascades from there, and `auth.users` is the row the MAU meter counts. Batched, because one unbounded `DELETE` holds locks on a table GoTrue reads on every token refresh. `EXECUTE` is revoked from `PUBLIC, anon, authenticated` by name and declared in `lib/db/schemaGrants.test.ts` — a client grant here is a mass delete one anon-key call away. `.github/workflows/guest-cleanup.yml` runs it on the 1st via `PRODUCTION_DATABASE_URL`, fails loudly on a missing secret (a sweep silently not happening looks exactly like one happening), and **a manual run is a dry run**: deletion is opt-in by the exact string `"false"` in an env var, never a forwarded flag — `scripts/sweepGuests.test.ts` exists for that default alone.

Sign-in and sign-out are **deliberately asymmetric, and the axis is `userId`, not which button was pressed**:

- **An upgrade re-resolves in place, with no refresh.** Guest → full account (email confirmation, or linking Google) is a *link*: `userId` is preserved, so reloading would interrupt an in-progress daily for nothing.
- **A password sign-in reloads**, because it resolves to a *different* account whose board, stats and duel record all have to be re-fetched anyway. With nothing worth preserving the clean boot is free, and it spares the one remaining path that would otherwise swap ids in place the whole class of stale-identity bug below. (`OAuthErrorHandler`'s `identity_already_exists` path also lands on a different id, and is handled reactively — game windows are keyed on `userId` so they remount clean — but it arrives through a full document load anyway.)
- **Sign-out is a full application reset.** `signOutAndReset()` (the *only* sign-out entry point — no component calls `supabase.auth.signOut()` directly) releases server-side commitments, signs out, then **hard-navigates to `/` via `window.location.assign`** — never a router push, which would preserve the in-memory state the reload exists to discard. Sign-out is rare and user-initiated, so the reload costs nothing perceptible and eliminates an entire class of stale-identity bug (user ids captured in closures, live Realtime subscriptions, in-flight requests, module caches) that would otherwise need defending against feature by feature.

The ordering inside `signOutAndReset()` is load-bearing and must not be rearranged:

1. **Release every server commitment while still authenticated** — `duel_forfeit(match_id)` if a match is live, `duel_leave_queue()` if queued, `duel_lobby_cancel(code)` if hosting an open custom lobby, and await any in-flight guess RPC (`daily_submit_guess` appends server-side; abandoning one mid-write leaves the rendered board disagreeing with what was stored). After step 2 this identity can no longer authenticate anything.
2. `supabase.auth.signOut()`.
3. `window.location.assign('/')`. The fresh load bootstraps a new anonymous identity through the ordinary first-visit path — there is **no** in-place `signInAnonymously()` on the sign-out path.

**It fails closed.** If step 1 can't complete (offline, request error) it throws and does *not* sign out or reload; the caller surfaces the error. Reloading anyway would strand a live match or a matchable queue row — the exact rating-farming vector "Matchmaking queue integrity" closes — while destroying the only client still holding the session needed to clean it up. And when a match is live, the player is queued, or a lobby is open, **confirm first** ("Signing out will forfeit your match" / "Anyone you sent the code to won't be able to join"); a plain sign-out with nothing in flight needs no confirmation.

**Step 1 is `releaseServerCommitments()`, shared with `signInWithPassword`** — signing in as someone else abandons the current identity exactly as signing out does, so it has the same three rows to release and reuses the same confirmation prompt (only the verb changes). The one place the two orderings differ: sign-out can release first because `signOut()` cannot fail on user input, but a sign-in fails on a typo, and *"we forfeited your rated match, and also the password was wrong"* is not recoverable. So when there is something to lose — and **only** then — the credentials are proven first on a throwaway client (`createSupabaseProbeClient`, `persistSession: false` so it cannot overwrite the live session's cookies as a side effect of the question) and nothing is released until they come back valid. That costs one extra token grant on a path almost nobody takes, and nothing at all on the normal one.

## Daily persistence & sync

The daily board must be **the same board on every device**. This is a correctness requirement, not a convenience: if a second device renders a fresh board, the player replays the day and the mode is meaningless.

### Model

- **The guesses are the state.** `daily_progress` stores the ordered list of guessed driver ids for a `(user_id, utc_date)`. Tile results are **never** persisted — they're recomputed server-side by the SQL `compare_drivers` function (the parity-tested SQL mirror of `lib/game/compare.ts`, already built for duel) on hydration. One source of truth for compare rules, a small payload, and no way for a client to inject fabricated tiles.
- **One warm hop, no Next.js in the path.** Both `daily_state()` (hydrate) and `daily_submit_guess(driver_id)` (append + evaluate) are Postgres RPCs the browser calls directly via `supabase.rpc()` (PostgREST is always warm), not Next.js Server Actions. This is the whole fix for the slow board load and slow guesses — a Server Action is a serverless invocation per call, cold-starting on Vercel and route-compiling on `next dev`. Same path duel's guesses already use; see "Fast guess evaluation".
- **The server owns the append.** `daily_submit_guess` resolves the UTC date and the guess index server-side and returns the full authoritative board. The client renders what comes back. Two devices guessing at once therefore converge instead of forking, and "one playthrough per day" is enforced where it can't be bypassed.
- **The day's target is pinned, not recomputed per call.** `daily_targets(date, driver_id)` records the day's driver, lazily pinned by the first caller; everyone else reads it. This removes the per-guess pool scan + pick that made guesses slow, and fixes a latent bug where a mid-day pool change silently changed the target. Every path that needs the target (hydrate, guess, reveal) reads this one row — one source of truth.
- **The pick is random, and that is a security property.** It used to be a deterministic FNV-1a hash of the date over the id-sorted pool — and the daily page ships the whole pool *with ids* to the browser for autocomplete, so anyone could recompute the day's driver in a devtools console with no network call, forever. Pinning a value only makes it a secret if the value is unpredictable. `daily_target_id` (drizzle/0038) picks with `ORDER BY … random() LIMIT 1` and writes it once via `INSERT … ON CONFLICT (date) DO UPDATE SET driver_id = daily_targets.driver_id RETURNING driver_id` — the no-op update exists so `RETURNING` fires on the conflict path too, which is what makes two racing first-callers converge on one answer now that their picks differ. **Never reintroduce a TypeScript (or otherwise reproducible) "which driver is today" helper**; that is the leak, not the transport. A soft cooldown orders recently-used drivers last — an `ORDER BY`, never a `WHERE`, so it can degrade to plain random instead of emptying the pool.
- **It costs the player nothing.** Every call after the day's first returns off one indexed PK read — measured 12µs in-database, identical before and after the change. The pick + pin runs at most once per UTC day globally (~380µs). The pool still ships to the client, because local autocomplete is why typing a driver is instant; once the answer isn't a function of the pool, holding the pool tells you nothing.
- **The date comes from the database**, never the client — `(now() at time zone 'utc')::date`. A client-supplied date is a trivial way to re-roll the day by changing a device clock.
- **The target is not sent to the client until the day is over** (solved, or guesses exhausted), matching the daily rules. Hydration returns tiles + guessed driver display data; it returns the target only on a completed row.
- **Guests persist too.** Anonymous users are real `auth.users` rows, so their daily progress is written server-side like anyone's. It doesn't roam (the anonymous session is device-local), but it means upgrading to a full account carries the in-progress day over with everything else.
- **localStorage becomes a cache, not the record.** It backs offline/failed-write resilience and legacy pre-auth data. It is never authoritative and never a reason to render a playable board.

### Precedence and merge

**The server always wins.** On sign-in, local progress for today is pushed up *only if the server has no row for that date*; if a server row exists it is loaded as-is and local is discarded. Local guesses are never appended onto a server row, and never onto a completed day — that path is exactly how a player would get a second attempt.

### Hydration UX (fast, no replay flash)

The board hydrates from a single warm `daily_state()` RPC fired the moment `userId` is known. Two rules, one for correctness and one for speed:

- **No replay flash.** While the daily fetch is in flight, the daily page renders a skeleton board with the input disabled — never an empty *playable* board that later fills in, which reads as "you can play again" and invites a duplicate attempt. The same gate applies during sign-in/sign-out re-resolution.
- **The board must not wait on profile/stats.** Board readiness gates on exactly two things: the auth identity being resolved (`userId` known) and `daily_state()` returning. It must **not** gate on `loadProfileAndStats` — those feed Settings/Statistics/Leaderboard and load in parallel, never on the board's critical path. Firing them in series behind auth is what turned the load into ~3s. On a return visit the anon session is already in local storage, so identity resolves without a network hop; the only blocking call left is the one warm `daily_state()`.

Where the Supabase session is cookie-backed (via `@supabase/ssr`), `daily_state()` may be run in the daily page's Server Component and the board streamed already-hydrated, removing even that hop for returning users. If sessions are local-storage-only, the client-side parallel fetch above is the win. An audit decides which applies before building.

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

- **`app/(game)/`** — `/` (the daily game), `/infinite`, `/online`, plus `/daily` as a 308 into `/`. The persistent game shell:

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
  |     teasers / Support / News (RSS)       |     "See more →" out /
  +-----------------------------------------+     to (info)
  |  FOOTER                                  |
  +-----------------------------------------+
  ```

  `app/(game)/layout.tsx` holds the top bar, ad slot, marketing teasers and footer; `GameChrome` (client) holds the mode tabs. `/`, `/infinite`, `/online` render only their game window into `{children}`. Layouts persist across route changes, so switching modes swaps just the game window. Mode tabs are `next/link`s highlighting the active route.

  **The daily game is served at `/`, and the daily route's files live directly in `app/(game)/`** — `page.tsx`, `loading.tsx`, `DailyGame.tsx`, `NextPuzzleCountdown.tsx` — because this route *is* the group's root. `app/(game)/loading.tsx` is therefore the daily skeleton; it cannot leak onto the other two, because each has a `loading.tsx` of its own nested inside that boundary and React shows the nearest one. `app/(game)/daily/page.tsx` is now the 308 back into `/`, for inbound links only.

  **`ModeTabs` decides the active tab with an exact match on `/` and a prefix match on everything else, and that split is load-bearing.** Every route on the site is "under" `/`, so any prefix test applied to the Daily tab lights it up on `/infinite` and `/online` too — two `aria-selected="true"` in one tablist, two accent fills, nothing erroring. The prefix arm is kept for a future nested route (`/online/...`) rather than collapsed into equality everywhere. `components/layout/ModeTabs.test.tsx` (`dom` tier) pins the property — exactly one active tab per route — not the cases.

  **The shell collapses during a live match — and only then.** `ActiveMatchContext` (a root-level provider) carries one `active` flag, raised for `DuelRoot`'s `MATCH_PHASES` (`found` | `countdown` | `in-match`) and by `DuelMatch` itself once a round starts. **Matchmaking and the custom-lobby screens are not in that set**: waiting for an opponent and composing a lobby are ordinary browsing, and a host pasting a code into Discord wants the rest of the page. It used to be `phase !== "landing"`, which collapsed the shell the moment someone pressed Duel. `MATCH_PHASES` is now the single predicate behind all three things keyed on it — the shell, `setLiveMatchId`, and the `duel_heartbeat` beat — which were previously spelled two different ways. `GameChrome` and `AdSlotGate` read it and hide the mode tabs, divider, marketing sections, footer and ad slot — leaving only the top bar and the match. A live race is the wrong moment for any of it, not just the banner. Two constraints if you touch `GameChrome`: `{children}` must stay at a **stable index** across the active/inactive branches (React otherwise remounts the whole game window and resets duel state mid-match), and `marketing`/`footer` are passed in as already-rendered elements rather than imported, because a `"use client"` module can't import the async Server Component inside `NewsSection`.

- **`app/(info)/`** — `/about`, `/faq`, `/game-modes`, `/how-to-play`, `/strategy`, `/contact`, `/privacy-policy`, `/terms-of-service`. Standalone full-detail pages, same footer, but `InfoTopBar` instead of `TopBar`/mode tabs: logo, nav links to the other info pages, and a "Play now" CTA back into the game shell. No ad slot, no marketing teasers here — these pages *are* the detail the home teasers link out to. Each teaser component (e.g. `FaqTeaser`) and its full counterpart (`Faq`) are separate components sharing content style but not JSX, so the home page can stay short without truncating the real page. The two legal pages have no teaser — they're linked from the footer only.

  **`/strategy` and `/contact` were added 2026-08-12**, answering the AdSense "low value content" rejection with the only thing that actually answers it: more real content. `/strategy` is the site's longest hand-written page (~1,100 words) and is deliberately *not* a second how-to-play — that page is the rules, this one is what to do with them (opening guesses, why the closeness shading is squared and what that means when reading a board, why the team column's three-state result is the strongest clue in the game, and the duel accuracy decay). The two cross-link, once each. `/contact` is footer-only and not in `InfoTopBar`: it is not a page you browse to, it is the one you look for when something is wrong.

  **`InfoTopBar`'s inline nav breakpoint moved `sm` → `md`** when `/strategy` joined it. Five links plus the logo and the CTA overflow 640px, and the failure is quiet — the row does not wrap, it pushes the CTA past the edge. A sixth link means measuring, or the footer.

  **`components/marketing/contentPages.test.tsx` guards these pages against a class of bug nothing else here can see**: a missing message key. `tsc` cannot check a string argument to `t()`, lint cannot either, and next-intl does not throw — it renders the **full dotted key path** in place of the sentence, so the page still returns 200 with `marketing.strategy.sections.opening.p3` sitting in a paragraph. The strategy guide alone reads ~40 keys. The test asserts the property (every key resolves, in the DOM and on the console) rather than the copy, so the prose stays free to edit.

`(game)` and `(info)` are route groups — the parens are stripped from the URL, so paths stay flat (`/faq`, not `/info/faq`).

- **`app/auth/`** — `/auth/callback` (route handler), `/auth/sign-in` and `/auth/reset-password`. The two pages are in **neither** route group and get no site chrome beyond the logo: each is one step inside an auth flow, not a game window and not an info page. A third page here would be a third auth step, not a third kind of content.

**`SupportCallout` ("Support me") is the one marketing block with no `(info)` page behind it** — a Buy Me a Coffee ask (`buymeacoffee.com/ecozo`) that is a few lines and one link, so a "See more →" would lead somewhere with less on it than the teaser. Named `Callout` rather than `Teaser` so that difference shows at the import. It sits directly **after** `AboutTeaser`, because About is where the reader learns this is one person's side project and that is the sentence the ask only makes sense after.

It is assembled from `GameModesTeaser`'s card, part for part — `bg-surface-2 p-4` + hairline border, an `accent-weak` well holding an `accent` stroke glyph, a `text-sm font-bold` lead over a `text-xs text-text-muted` line. A donation ask is the block most likely to end up looking like an advert bolted onto someone else's site, and being made of the same parts as the sections above it is the cheapest defence. Orange lands twice, and both mean something: the icon (matching every mode icon on the page) and the button (the only action in the block) — no accent fill, no tinted card. The destination is named in muted text under the button rather than hinted with an ↗: it is the only control in the marketing column that leaves the site, and naming the platform is also what makes the ask credible.

**About is about the project, not about the dataset.** `AboutTeaser`/`AboutSection` describe what DriverPit is, the four ways to play, who builds it and how it stays free — no F1DB, and no driver-data provenance at all, which is not what anyone opens an About section to read. That disclosure still lives in `TermsOfService` and `PrivacyPolicy`, where it is a real one and where the source's attribution belongs; **don't strip it from those two.** The player-facing "F1DB code" wording in `Faq`/`HowToPlay` is now just "three-letter code" — the players it was addressed to have no idea what F1DB is.

`/online` is a **landing** that offers a match type: **Duel**, then **Knockout** (rendered but disabled / "coming soon" until built), then **Custom**. Guests see a "save your progress" upgrade prompt above the mode options, same copy as Settings. Selecting Duel enters the lobby/matchmaking flow; selecting Custom enters the code flow (see "Custom lobbies").

**It is a dense row list, not three tall cards** — `DuelLanding` uses `GameModesTeaser`'s card (accent-weak well + `ModeIcon`, `text-sm font-bold` name, one `text-xs` line) plus a chevron, which is what makes a row read as "go here" rather than as a description. The cards it replaced carried a two-to-three-line `text-sm` description each, so choosing a mode meant reading ~60 words about modes most players already know, and on a phone Custom started below the fold. `online/loading.tsx` mirrors the header exactly, padding included, so the real screen doesn't move the title.

`ModeIcon` covers all five modes; **`custom` is a link glyph** — what makes a custom game custom, from the player's side, is the code you send someone — deliberately not a sliders glyph, which already means "adjustable criteria" on `DriverFilterButton`.

### The three mode lists, and what belongs in each

`GameModesTeaser` (home), `GameModes` (`/game-modes`) and `DuelLanding` (`/online`) all list modes, and three rules keep them from drifting into three different products:

- **Same summary strings, same register.** One clause per fact, describing the *shape of the contest*: "1v1, one target, 3 rounds — highest score wins." Not the plumbing — "race a matchmade opponent across 3 rounds" led with how you get an opponent, which is the part a player has no decision to make about.
- **The home teaser lists four; the other two list five.** Custom is a *variant of Duel*, not a fifth thing to learn, so it belongs where you can start one (`/online`) and where the rules are (`/game-modes`), but not in the home page's one-glance answer to "what is there to play here?".
- **Custom is last** wherever it appears, for the same reason: read after Duel, "the same match, on your terms" lands; between Duel and Knockout it reads as a third headline mode.

**Scoring is explained on `/game-modes` and nowhere else in the marketing chrome.** The guess-decay rule (drizzle/0058) briefly had a line of its own on `/online`; a landing screen is where you choose a mode, not where you learn its scoring. It is a bullet under Duel and named again under Custom (which inherits it), and — the part that actually matters for "a rule that bites invisibly reads as a bug" — it is surfaced *live in the match*, as the `SolvePotential` figure and the `×0.88 on a solve` caption. Those are the load-bearing disclosure; the marketing copy is reference.

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

- Radius consistent, small-to-medium (`rounded-lg`). Separators 1px `--border`. **This includes avatars** — they are `rounded-lg` tiles, not circles, and `AvatarGlyph` is the only place that shape is decided. Anything that draws a ring, glow or empty-slot placeholder around one (`OpponentPanel`'s heat glow and solve ping, `AvatarPicker`'s focus ring, the leaderboard's open ranks, matchmaking's opponent slot) carries the same radius — a circular ping around a square avatar is the failure mode, and it is four files away from the component that changed.
- Game window: single `--surface` card, centered, max-width ~640px. Marketing content wider (~720-960px) and calmer.
- Motion minimal and purposeful: tile reveal, button press, modal enter/exit. Respect `prefers-reduced-motion`. No ambient loops — **except** the duel tug-of-war bar and countdown, which are live and must animate smoothly (still honor reduced-motion by snapping instead of easing).
- Mobile-first (most players on phones). Modals trap focus, close on Escape + backdrop.
- **A focus indicator is 2px of `--accent`, everywhere.** Buttons spell that `focus-visible:ring-2`; inputs and input-shaped triggers spell it `focus:border-accent focus:ring-1`, because their 1px border turns accent too and the ring sits directly outside it. Inputs used to carry `ring-2` *on top of* that border — 3px against the buttons' 2px, which read as two different design languages in one form. The rule is the total, not the class: anything that adds a ring to a control whose border already changes uses `ring-1`.
- **A tile's meaning must exist in text, not only in colour.** Colour, opacity and the ↑/↓ glyph are the *visual* encoding; the spoken one is `lib/game/tileLabel.ts` (pure, unit-tested), applied by `Tile` as `role="img"` + `aria-label` — `role="img"` both because a bare `aria-label` on a `<div>` may be ignored and because it makes the tile atomic, so the value isn't announced twice. A comparison tile gets `guessTileLabels`; a reveal tile gets `tileValueLabel` (no verdict). The label is optional only where visible prose already states the rule (the marketing legend). Same reason `DriverCodeBadge` announces the driver's *name*, not "V E R".
- **A readable board still isn't an audible game — the *event* has to be announced too.** Labelling the tiles made the grid navigable; submitting a guess was still silent, so a screen-reader user had to go back into the grid after every guess to find out what happened. `GuessAnnouncer` (`components/game/`) is one polite `role="status"` region rendered by `GuessGrid`, so daily and infinite get it identically and a later mode gets it by construction. Two rules it must keep: it composes `guessAnnouncement` from the same `guessTileLabels` the tiles use (so spoken row and spoken tile can't drift), and it announces **only guesses that passed through the pending row** — a resumable daily board hydrates a whole day of guesses at once, and reading the last one aloud on every page load is not an event the player caused. Focus works the same way: when a control disappears under the player (the duel input on solve) the thing that replaces it takes focus, and only if focus was genuinely lost (`document.activeElement` is `body`).
- Themed scrollbar; `html` has `scrollbar-gutter: stable` so modal scroll-lock doesn't shift content. Don't remove without an equivalent fix.

### Duel visual consistency (important)

The duel **guess board looks and behaves exactly like the daily/infinite board** — the same guess-row component, the same driver-code badge on the side, the same tiles, the same input + autocomplete. The duel is *daily's board plus duel chrome* (tug-of-war, opponent panel, round/timer header), never a bespoke second board.

This is enforced by extraction, not by discipline: `components/game/` owns `Tile`, `DriverCodeBadge`, `ColumnLabels`, `GuessRow`, `PendingGuessRow`, `GuessGrid`, `DriverAutocomplete` and `ResultCard`, and all three modes consume them — duel through `ClosestGuessesBoard`, which is only a *sorting* wrapper (best guess on top, since guesses are unlimited) around the same `GuessRow`. Adding a mode-specific copy of any of these is the thing to refuse. Anything genuinely net-new in duel (tug-of-war, opponent panel, round result cards, results panel) uses the same tokens, radii, fonts and motion rules as the rest of the site.

## Modals

One reusable `Modal` primitive (focus trap, Escape, backdrop close, scroll lock) backs all of these.

**The two global ones are `next/dynamic`, and the shape around them is load-bearing.** `GameModals`
sits in the `(game)` layout, so a static import put the whole Settings tree — and, through
`LeaderboardModal` → `AvatarGlyph`, DiceBear — on the daily page's and `/infinite`'s critical path to
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
  - **No infinite-pool default.** The driver filter lives in the Infinite game window where it's actually used, and persists itself (`lib/settings/driverFilter.ts`). A duplicate control in Settings would be a second source of truth for one value.

  There is **no hard mode** anywhere in the app, and never has been. If a doc, comment or page mentions one, that's stale prose to delete — not a feature to go build.
- **Profile** (`ProfileSection`) — avatar picker, display name (editable for full accounts), a Guest/Account state badge, and sign out. It holds **no auth form**: a guest gets one settings row linking to `/auth/sign-in`, which is the only login UI in the app (see "`/auth/sign-in` — the one login page"). The row is deliberately not a second accent "Save your progress" card — the modal already shows that banner above the tablist for a guest, and two copies of the same ask in one dialog is one too many.
- **Statistics** (`StatisticsSection`) — games played, win %, current + max streak, guess-distribution bar chart, and duel record (rating, wins, losses). Reads `AuthProvider`'s `stats`, so the streak it shows is already decayed — see "Streaks break on a missed day".

Settings live in localStorage (`lib/settings/store.ts`) and are applied to `<html>` as data attributes, so CSS can key off them without a re-render. **Colorblind mode is applied by a render-blocking inline `<script>` (`COLORBLIND_BOOTSTRAP_SCRIPT`, first child of `<body>` in `app/layout.tsx`), not from an effect** — the value only exists in localStorage, so anything running after hydration paints the default green first and flips it to blue a frame later, which is precisely the colour confusion the setting exists to prevent. Keep it blocking, keep the source built from `STORAGE_KEY` so the key can't drift, and keep `suppressHydrationWarning` on `<html>`. Any future `<html>`-attribute setting belongs in that same script, not in a new mount effect.

### Leaderboard modal — the cup button

The top-bar **cup** button (left of the logo) opens the **global Leaderboard** — not personal stats, which live in Settings → Statistics. Two boards, tabbed: **duel rating** and **daily streak**. Full accounts only are ranked (`leaderboard` view filters `is_guest = false`); guests see the board with a "Save your progress" upgrade prompt. A viewer outside the rendered slots gets their own real rank appended (`myDuelRank` / `myStreakRank`), counted against everyone rather than within the fetched page — one query, both ranks, as correlated counts beside the viewer's own row.

**How many rows each board shows is one constant, `LEADERBOARD_TOP_SLOTS` (`lib/leaderboard/constants.ts`), read by the action and the modal.** They were 50 and 10, which fetched 100 rows to render 20 — and worse, "already visible up top" was decided against the fetched 50, so a player ranked 11-50 was suppressed from the "you're #N" row *and* never rendered in the top 10. Two numbers that must agree are one number.

The rank expressions live in `lib/leaderboard/rank.ts` rather than inline, because their outer column reference has to be **table-qualified** and nothing in the result shows whether it is: the subquery aliases the same view, so an unqualified `duel_rating` binds to the *inner* alias, the predicate compares a row to itself, and every viewer comes back rank 1 with no error. `rank.test.ts` (static tier) renders them and pins the qualification.

## Duel (real-time race)

A fast 1v1 where two matchmade players race across **3 rounds (3 different drivers)**, scoring on speed, visualized as a **tug-of-war**. (A custom lobby plays the same engine over a configurable 1-5 rounds — see "Custom lobbies"; everything below describes the matchmade default.) The whole point is *presence*: it has to feel like a live human is trying to beat you, right now. The engine works; this section defines the experience it must deliver.

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

**Every duel duration lives in this one file** — nothing in `components/duel` or `lib/duel` hardcodes one. The single documented exception is the SQL literals plpgsql can't import: `COUNTDOWN_MS` / `INTERMISSION_MS` in drizzle/0021's functions, `QUEUE_STALE_MS` in drizzle/0032, and `CUSTOM_LOBBY_STALE_MS` / `CUSTOM_LOBBY_MAX_AGE_MS` in drizzle/0057. Each carries a keep-in-sync comment pointing back here. `ROUND_MS` **stopped being one of them** in drizzle/0054: it is now `duel_matches.round_seconds`' column default, so the constant documents the default rather than mirroring a literal.

```
LOBBY_MIN_SEARCH_MS          1000   min time the "searching" UI shows before a match resolves
MATCH_FOUND_HOLD_MS          2500   "Match found" + avatars/ratings hold before countdown
COUNTDOWN_MS                 3900   F1 lights-out into a round -- the SAME for every round
COUNTDOWN_GO_HOLD_MS          700   lights-out -> "GO!" beat, inside the countdown (see below)
LIGHTS_ALL_LIT_HOLD_MS        400   all-five-lit dwell; the sweep is sized to end exactly here
MIN/MAX_LIGHT_ON_INTERVAL_MS 150/900  bounds on the DERIVED light interval (no strobe, no crawl)
COUNTDOWN_TICK_MS             100   countdown re-render cadence; BOTH hooks stop at their deadline
ROUND_MS                    60000   DEFAULT per-round guessing window; per-match round_seconds
                                    overrides it (drizzle/0054), server-stamped either way
INTERMISSION_MS              6000   reveal + points animation + mini-countdown between rounds
POINTS_COUNT_UP_MS           1000   the intermission's "+N" count-up
GUESS_COOLDOWN_MS / _SERVER_MS 1000/850  min gap between one player's guesses;
                                    client waits the longer one, so an honest
                                    player never meets the server's rejection
MIN_SOLVE_MS                 2000   floor under ms-to-solve -- a sub-2s solve is
                                    a script, and scores what a human would
READY_TIMEOUT_MS             4000   fallback if a client never reports ready
DISCONNECT_GRACE_MS         10000   reconnect window; ALSO the server's staleness bar
DUEL_HEARTBEAT_MS            5000   in-match liveness beat (duel_heartbeat), 3:1 vs the window
MATCHMAKE_POLL_INTERVAL_MS   4000   re-run of match_or_queue while searching (widens the band)
QUEUE_HEARTBEAT_MS / _STALE_MS  5000/15000  queue liveness; survives 2 missed beats
DUEL_POLL_INTERVAL_MS        5000   in-match safety net for a missed broadcast (idempotent)
RESUME_RETRY_MS              2000   retry cadence when a reload lands between rounds
RESUME_RETRIES_BEFORE_FORCE_BEGIN  4  before concluding BOTH clients reloaded and stamping it
CUSTOM_LOBBY_HEARTBEAT_MS / _STALE_MS  20000/120000  open-lobby liveness -- NOT the queue's 5/15
CUSTOM_LOBBY_POLL_MS         2500   the waiting host's safety-net poll of duel_lobby_state
CUSTOM_LOBBY_MAX_AGE_MS   1800000   hard cap; also what clears CONSUMED lobbies, which stop beating
```

These fix the "everything's too fast to see" complaints: the intermission is a real, unrushed beat and the between-round countdown gates on readiness.

### Flow

1. **Mode select.** `/online` landing shows Duel / Knockout / Custom (plus a guest upgrade prompt above them, same as Settings).
2. **Lobby / matchmaking.** Selecting Duel renders the lobby UI *first* (searching animation) and enforces `LOBBY_MIN_SEARCH_MS` before resolving, so the player always sees the lobby load in. A Postgres RPC pairs atomically: `SELECT ... FOR UPDATE SKIP LOCKED` finds a waiting opponent (create match, mark both matched) or enqueues. No background worker. Match by rating when possible; widen the window the longer someone waits; fall back to anyone after a timeout.
3. **Match found (staging).** Both avatars slide in from opposite sides (grid-start), with handles and ratings. Held `MATCH_FOUND_HOLD_MS`. Both clients report `ready`.
4. **Lights-out countdown.** On both-ready (or timeout), `duel_begin_round` stamps the round's `started_at = now() + COUNTDOWN_MS`, `ends_at = started_at + ROUND_MS`. Every round gets the identical ceremony — same component, same length. The light **interval is derived, not fixed**: `useLightsCountdown` divides the budget actually remaining when the round lands by the four intervals between five lights, so the fifth light always arrives exactly `LIGHTS_ALL_LIT_HOLD_MS` before lights-out. A fixed interval left the leftover budget as dead air with all five lights on, and since that leftover shrank as latency grew, identical constants produced visibly different pauses per round. Five red lights fill one at a time — the number under them names the light that just lit (L1 = "5" … L5 = "1") — then out = GO. Clients count to the absolute `started_at`, corrected for clock offset.

   **`started_at` means "the board is on screen and this player can act", not "the lights went out."** Lights-out is `COUNTDOWN_GO_HOLD_MS` *earlier*; clients run the lights to that moment and hold GO until `started_at`. This is load-bearing for fairness, not presentation: `ends_at` and `duel_submit_guess`'s ms-to-solve are both measured from `started_at`, so defining it as the instant play begins is what stops the ceremony being charged to the player's round time and to their speed points. Every constant in the countdown budget follows from it — the lights must complete within `countdown - COUNTDOWN_GO_HOLD_MS`.
5. **Rounds (×3).** Each round targets one driver from the daily pool (20 years) — or from the match's own filter when it has one (custom lobbies).
   - **Guessing:** unlimited guesses within the timer, each returning the normal 5-attribute comparison (reuse `compare()`). Submission must feel **instant** — see "Instant guesses". Unlimited, but **not free, and not unpaced** — see "Guess discipline".
   - **Live standing:** every guess updates the tug-of-war live (not just at round end). Each player's **live score** = `100 (baseline) + confirmed round points + current-round provisional`. Provisional = locked speed points once solved, else the *decayed* proximity value of the best guess so far (`dnfPoints`, so the bar shows what the round would actually pay rather than climbing on every wasted guess and dropping at the close). Both start at 100 so the bar opens centered and never snaps to an end.
   - **Success:** speed points, scaled by efficiency — solving at 5s worth far more than at 40s, and solving in 4 guesses worth far more than in 40. Pure `solvePoints(msToSolve, roundMs, wrongGuesses)`. The solving client shows the real earned points (e.g. `+140`), not `+0`.
   - **DNF (timer expires unsolved):** minor **proximity points** from the best incorrect guess, decayed the same way. Pure `dnfPoints(bestProximity, guessCount)`.
6. **Intermission.** Reveal the correct driver (card: initials/photo, name, the five stats), count-up both players' round points, settle the tug-of-war, mini-countdown. Ready-gate into the next round.
7. **Match end.** Higher aggregate (excluding the equal 100 baseline) wins; update both ratings + records. Clients leave the immersive view and return to the **site shell**, which renders a results panel: WIN/LOSE, final score, rating delta (±), per-round breakdown, and CTAs (**Rematch**, **Find new opponent**, **Back to modes**). Guests get an upgrade prompt on a win.

### Guess discipline — unlimited guesses that cost something

Duel guesses were unlimited **and free**: nothing paced them, and points depended only on solve time. The ranked pool is **103 drivers**, so enumerating it was not theoretical — a devtools loop over `duel_submit_guess` solved every round in seconds, guaranteed, knowing nothing about the game. No script was needed either: spraying the autocomplete beat deducing, 845 points to 541 on the old curve. Speed was the only currency, so the mode rewarded typing and automation rather than thinking.

Three mechanisms (drizzle/0058), aimed at three different things. All three are enforced in `duel_submit_guess` / `duel_close_round`; the client only *displays* them.

- **A cooldown between one player's guesses** (the *capability*). `GUESS_COOLDOWN_SERVER_MS` = 850 in SQL, `GUESS_COOLDOWN_MS` = 1000 on the client. Caps a 60s round at ~70 guesses against a 103-driver pool, so enumeration stops being a guaranteed solve. **Two values on purpose:** the client's wait starts when the response *lands*, the server measures from when the previous guess was *written*, and the difference is one response leg — so the client is always the binding one and an honest player never sees the rejection. Same tolerance reasoning as drizzle/0025's clock grace. It spaces against `duel_round_results.last_guess_at`, under the row lock the RPC already takes. Deriving the rule from `guess_count` and `started_at` instead needs no column and is **wrong**: that is a *budget*, so a script idles 30s, banks 30 guesses and bursts them.
- **Wrong guesses decay the reward** (the *incentive*). `accuracyFactor(wrongGuesses) = GUESS_DECAY ^ max(0, wrong - FREE_GUESSES)` — 0.88 and 3. Applied to the DNF payout too, or spraying just becomes the way to farm proximity (best-of-N rises with N for free, and the 75 ceiling is most of a round's floor). **The solving guess is never counted as wrong**, so a 4-guess solve pays in full; a DNF passes its whole `guess_count`, since every guess in it was wrong. That off-by-one is pinned on both sides.
- **A floor under ms-to-solve** (the *ceiling*). `MIN_SOLVE_MS` = 2000. Nobody submits in under two seconds; without it the curve pays a script ~982 of a possible 1000. Costs a lucky-first-guess human ~45 points.

**Only the 900-point bonus decays — never the 100 floor.** That floor is what makes "any solve beats any DNF" true (proximity ceilings at 75), and decaying it would put a lucky near miss above someone who actually found the driver. The parity suite tests this with the *worst possible* solve (slowest **and** maximally penalised), not merely the slowest.

Net effect: a considered solve is unchanged (4 guesses at 18s is still 541), a sprayed one collapses to the floor (~100), and an enumerator usually DNFs instead of winning. **What this does not do is beat a purpose-built solver** — a script that reimplements `compare()` still lands ~904 to a human's 541, because the pool ships to the client with all five attributes and must, for autocomplete to be instant. Closing that gap means either reweighting the bonus off raw speed and onto efficiency, or detection; both were deliberately left for later.

The player-facing half is the point, not decoration — a rule that bites invisibly reads as a bug:

- **"Solve now +487"** beside the round clock (`SolvePotential`), folding the time falloff and the decay into the one number the game already speaks in. It steps in **fives**, because it ticks at 10Hz and a number sliding 487→486 is noise. On a penalised guess a **`−52`** falls away from it, through a persistently-mounted `role="status"` so the cost is announced as well as drawn.
- **`×0.88 on a solve`** in the guess-board caption, in `DriverFilterSummary`'s idiom (parts left, count right, mono/muted). Shown **only once a guess has actually cost something** — a permanent `×1.00` reads as a warning about a rule the player has not broken.
- **The cooldown is drawn, not explained**: a 2px accent line draining under the input for exactly `GUESS_COOLDOWN_MS`. No toast, no copy, and deliberately not a placeholder swap — the placeholder is where the action is named, and replacing it makes the control look broken every guess.
- **And it hands focus back.** Disabling a focused element drops focus to `<body>`, so a temporary disable costs a keyboard player the input *every guess* and makes Tab restart from the top of the page mid-round — §4.7's bug, reintroduced by a different route. `DriverAutocomplete` takes an optional `inputRef` for exactly this, and the restore lives in `RoundPlay` because only the caller knows whether a disable is temporary (cooldown: restore) or terminal (time up, solved: leave it), with the same "only if focus was genuinely lost" guard the solved panel uses. It covers the in-flight `pendingGuess` window too, which had the same hole and no restore.
- **The intermission shows both players' guess counts** under their `+N`. This is where you find out you were beaten by someone slower who guessed better, which is otherwise invisible. Both counts were already on screen live, so nothing new is disclosed — and neither is *acted* on.

### Rematch is mutual consent, not a re-queue

A rematch pairs the *same two players* directly — it never goes back through `matchmaking_queue`. It also **copies the match's config forward** (`ranked`, `rounds`, `round_seconds`, `filter`); see "Custom lobbies" for why that is the sharpest edge in the whole feature. `duel_matches.rematch_requested_by` is the whole mechanism: `requestRematch(oldMatchId)` records the caller's intent if the column is empty, or — finding it already set to the **other** participant — creates the new match and returns its id. A lone request just waits.

Three distinct broadcasts on the old match's channel, and conflating them is the bug to avoid:

- `rematch_request` — "I asked, and I'm first." Without it the opponent's results screen shows a plain Rematch button with no sign anyone is waiting on them, which is precisely why requests go unanswered.
- `rematch_decline` — the answer "no". Without it a refusal is indistinguishable from a slow opponent and the asker waits forever. Terminal: neither side is offered the rematch again.
- `rematch` — "the new match **exists**, join it," carrying `newMatchId`. Sent by whichever client's `requestRematch` actually created it (the second requester); it's the only way the first requester learns. Both clients then meet on `duel:{newMatchId}` for a fresh ready-gate.

### Live opponent presence (make it feel like a fight)

- **Both avatars on screen the whole match** — you (accent side) vs opponent (muted side), each with handle, live provisional points, and guess count.
- **Opponent activity is live but abstracted** — never their guessed driver or the target. On each opponent guess: a pulse on their avatar and a tick on their guess count. Their **best heat** (0-1 closeness of their best guess) drives a glow intensity. On solve: a burst + `SOLVED +N` and the bar jumps. This is the "rival closing in" read, spoiler-free.
- **Tug-of-war** (top, prominent): the one place orange dominates — your accent fill vs the opponent's muted fill, center = tie, driven live by the live-score balance `liveMine / (liveMine + liveOpp)`. Animate smoothly; snap under reduced-motion.

### Board (consistent with daily)

The guess board is the **shared daily/infinite board** (same row, tiles, driver initials on the side, input, autocomplete). Because guesses are unlimited, the list may be sorted by closeness (best on top) — but it is the same row component, not a bespoke grid. Round indicator ("Round N / M", from the match's own `rounds`) and the countdown in mono tabular figures sit in the duel header above the board.

### Instant guesses (perceived latency ~0)

Duel guessing uses the shared one-warm-hop path — see "Fast guess evaluation (all modes)". Duel-specific notes:
- `duel_submit_guess(match, round, guess_driver_id)` returns `{ tiles, solved, points, bestHeat }` in one round trip.
- The roster is already on the client: `/online` ships the full one (see "Custom lobbies"), and each mode narrows it with a pure predicate — `poolCutoffYear` for a ranked duel, `matchesDriverFilter` for a custom one. No per-match fetch, so autocomplete is local and instant.

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
- **Signing out mid-match forfeits it**, and signing out while hosting an open lobby cancels it. `AuthProvider.signOutAndReset()` calls `duel_forfeit` (and `duel_lobby_cancel`) before tearing down the session, so the opponent gets an immediate clean win instead of waiting out `DISCONNECT_GRACE_MS`. The player is asked to confirm first, and if the forfeit can't be delivered the sign-out is aborted rather than silently abandoning them.

### Matchmaking queue integrity

A stale queue row is a **rating-farming vector**, not a cosmetic leak: if a player queues, signs out (which mints a fresh anonymous identity), and queues again, a naive `user_id <> caller` check passes — the ids genuinely differ — and they are paired with themselves, writing real `duel_rating` to both sides. Four independent layers, so no single failure can produce a self-match:

1. **Explicit dequeue.** `duel_leave_queue()` — idempotent, safe twice, safe when not queued, authorizes via `auth.uid()`. Called on *every* exit from searching: unmount, cancel, navigating away, `beforeunload`/`pagehide` (keepalive POST, since a normal fetch dies with the document), and — critically — **inside `signOutAndReset()` before the session is torn down**, while the outgoing identity can still authenticate it. The queue has no client write policy at all; this RPC is the only way out.
2. **Identity change aborts the search.** A new `userId` is never a reason to re-queue. `DuelSearching` pins the identity it started under, and on a change dequeues and returns to the `/online` landing. **Deliberate exception to the auth-reactivity rule:** readers re-resolve for a new identity, but live server commitments (queue entries, active matches) are *released and abandoned*, never re-established.
3. **Liveness.** `last_seen_at`, refreshed every `QUEUE_HEARTBEAT_MS` by `duel_queue_heartbeat()`. Rows older than `QUEUE_STALE_MS` are ignored by the pairing scan and deleted by `duel_sweep_stale_queue()` (run at the top of every search — no cron needed). A row leaked by a crash or a failed dequeue goes inert on its own. An explicit heartbeat rather than lobby-channel presence: presence tracks a WebSocket, but what must be proven alive is a *row*, and the two disagree in both directions.
4. **Self-match guard.** `device_id` — stable per browser profile, persisted in localStorage so it **survives an identity swap**, which is the one thing signing out cannot change. The scan refuses any row sharing the caller's `device_id`, and separately any sharing their `user_id`. Searching also deletes this device's rows under other identities, so a leaked row converges instead of lingering. *Accepted side effect: two people on one browser profile can't duel each other.*

Both guards live **inside** the single locked `SELECT … FOR UPDATE SKIP LOCKED` that claims the opponent — never a read-then-check afterwards, which would trade the bug for a race. Backing all four, a `CHECK (player_a <> player_b)` on `duel_matches` makes a self-match row unrepresentable regardless of what any future code path does.

## Custom lobbies

A third entry under `/online`, below Duel and Knockout: a host composes a match (rounds, round length, and behind an "Advanced" button the full Infinite-style driver filter), gets a six-character code and a shareable link, and a friend joins with it. The two play an ordinary duel that **does not touch ratings, duel W/L, or the leaderboard**.

**One sentence carries the whole safety argument:** a custom lobby is a short-lived `duel_lobbies` row holding a config and a code; joining it creates an ordinary `duel_matches` row with `ranked = false` plus that config, and from that instant **every existing duel component, RPC and realtime channel runs unchanged**. There is no second lifecycle, no second scoring path and no second channel — only a flag and three config columns the existing lifecycle reads off the row it already holds. The duel engine has had four separate audit findings about one value living in two places (§0.1's match id, §3.3's absence claim, §3.4's trusted payloads, §0.2's round clock); a parallel "custom match" code path would have invited a fifth.

### Stats isolation, and the rematch trap

Every duel write to `user_stats` goes through exactly one function: `applyMatchResult` (`lib/duel/applyMatchResult.ts`). Both callers reach it — `applyMatchRatings` on a normal finish, `forfeitMatch` on a forfeit/disconnect/sign-out — and there is no second writer of `duel_rating`/`duel_wins`/`duel_losses` anywhere in the repo. It already takes the match row `FOR UPDATE` for its idempotency guard, so the flag is free where it is needed: **after the lock, before the `user_stats` reads**, so the unranked branch writes nothing at all and is trivially re-entrant.

**`ranked` is read off the locked row, never accepted as a parameter** — CLAUDE.md's "Server Actions never accept an outcome" applied to a question rather than an answer: which matches count is not something a client gets to say.

It lives in a plain module rather than in `lib/duel/actions.ts` for the reason `recordDailyResultForUser` does: it takes `winnerId`, so a `"use server"` export of it would be a client-callable "tell the server who won and which two players to pay". The move is also what makes it reachable from `lib/db/customMatchUnranked.test.ts`, since a `"use server"` export resolves its caller through `next/headers` and has no meaning outside a request.

Four layers, because **a silent non-write is invisible when it breaks** — nothing a player sees changes if `ranked` stops being read; the leaderboard just quietly starts absorbing friendly games:

| Layer | What it buys |
|---|---|
| `ranked bool NOT NULL DEFAULT true` | Every existing and matchmade row stays rated. No backfill, no migration risk. |
| `CHECK (ranked OR (rating_delta_a IS NULL AND rating_delta_b IS NULL))` | Makes the wrong outcome **unrepresentable**, the way `duel_matches_distinct_players_check` does for a self-match. Catches the realistic regression: someone reorders `applyMatchResult`. |
| `lib/db/customMatchUnranked.test.ts` (database tier) | The only thing that will ever notice. Its **ranked control case is not optional**: every other assertion is "this number did not change", which is equally what a writer that stopped working entirely would produce. |
| `getDuelResults` returns `ranked`; `DuelResults` renders it | "Unranked · rating unaffected" instead of a fabricated `+0`, and no guest upgrade prompt on an unranked win — "keep your duel rating and record" is false there. |

**THE SHARP EDGE IS `requestRematch`.** A rematch is a brand-new `duel_matches` row, so every column it doesn't name takes its DEFAULT — `ranked = true`, 3 rounds, 60 seconds, the 20-year pool. Miss the carry-forward and pressing Rematch on a friendly game silently produces a rated, differently-shaped duel neither player asked for, off a **primary results-screen CTA**. That is exactly the shape of audit 2026-07-29 §0.1, where the same button silently re-armed nothing. `ranked`, `rounds`, `round_seconds` and `filter` are copied forward explicitly, and the test asserts both the columns and the consequence (finishing the rematch still writes nothing).

### Per-match rounds and round length

`rounds` and `round_seconds` are columns, read where the round lifecycle already holds the match row (drizzle/0055): `duel_begin_round` stamps `ends_at = started_at + make_interval(secs => round_seconds)`, and `duel_close_round`'s last-round test is `p_round_index >= v_match.rounds - 1`. Two lines; the defaults are the values those functions used to hardcode, so a matchmade duel is bit-identical.

This is cheap for one finding: **`duel_submit_guess` needed no change at all**, because it already derives `v_round_ms` from `ends_at - started_at` on the round row rather than carrying its own copy. The whole speed-points path follows a per-match round length for free, and `duelScoring.sqlParity.test.ts` is untouched.

**`isLastRound` comes from the server, and this is the load-bearing half.** `useDuelLifecycle` used to derive it as `roundIndex >= MAX_ROUNDS - 1`, which required a client constant and `duel_close_round`'s own test to agree about how long a match is. With rounds per-match they cannot: one is a number, the other is per-row, so the intermission would offer a fourth round of a three-round match or cut a five-round one short. Both callers already hold the authoritative answer — `closeRound`'s `matchFinished` (`match_status = 'finished'`) and `duel_round_reveal`'s `matchStatus` — so they pass it in. Strictly more correct today too, for the same reason drizzle/0050 made `round_end` a trigger rather than data: the client rendering the outcome may never have made the call that produced it.

With that done, `MAX_ROUNDS` became **`DEFAULT_ROUNDS`** (`lib/duel/liveMatch.ts`) and the rename is the point — with `CHECK (rounds BETWEEN 1 AND 5)` a constant called "MAX" that equals 3 is a lie. **The invariant that replaced it: the only remaining client-side consumer of a round count is the cosmetic "Round N / M" label.** A wrong value there misprints a label and cannot desync a match. Anything that would make a client-side round count load-bearing again belongs on the match row instead.

The offered options (1/3/5 rounds, 30/60/90 seconds) live in `lib/game/customMatchConfig.ts`, pure and unit-tested, and are **deliberately looser than the CHECK constraints rather than identical to them**. Pinning the exact triple in SQL would duplicate a list TS↔SQL and drag in a parity suite for a value with nothing at stake — an unranked game the host configured for themselves.

### `pick_filtered_driver` — one SQL copy of the predicate

`matchesDriverFilter` (`lib/game/driverFilter.ts`) was already mirrored in plpgsql inside `infinite_start_round`. Teaching `duel_begin_round` to draw from a lobby's filter naively meant a **third** copy of a five-column predicate whose failure mode is silent: a target outside the player's own filter cannot be typed, so the round is unwinnable with nothing erroring. In a timed 1v1 that is worse than in Infinite, where the player can just start another round.

So the predicate is extracted once (drizzle/0056) and both callers point at it — `infinite_start_round` repointed, `duel_begin_round` using it when `filter IS NOT NULL` and falling through to the unchanged 20-year `last_active_year` pick otherwise. Same reasoning as the `duel_*_client` wrappers: one definition of the logic. `lib/db/infiniteFilter.sqlParity.test.ts` pins it **through both callers**, since the two pass different things — Infinite a filter it just built with no exclusions, duel a filter stored on a row plus the drivers this match has used.

**`p_exclude` is an `ORDER BY`, never a `WHERE`,** and that is the whole of the degrade-don't-error requirement. `duel_begin_round` passes the drivers already used in this match, so a 3-round game on a 6-driver filter stops repeating targets — invisible in a 250-driver pool, glaring in a small one. But a 5-round game on a 2-driver filter must still deal round 3, and a `WHERE` returns NULL and aborts the match mid-play, with two people watching. Sorting used drivers last prefers a fresh one whenever one exists and silently allows a repeat when none does. Same shape, same reason, as `daily_target_id`'s recent-repeat cooldown.

**`duel_submit_guess` stays existence-only.** The reasoning is unchanged by custom filters and there is a comment at `lib/duel/submitGuess.ts` saying so: win-by-identity means an out-of-filter guess can never win, duel guesses are unlimited so a bad one costs seconds rather than a turn, and adding the check would put a second copy of the whole predicate on the hot path. Contrast daily, which *does* validate against its pool (drizzle/0051), because there a guess costs one of six turns and the stored list is the shareable record of the day.

### The lobby row, and its liveness window

`duel_lobbies` has **no `status` column** — open (`match_id IS NULL`), consumed (`match_id IS NOT NULL`) and gone (row deleted) are derivable, and a status column would be a fourth thing to keep in agreement with the other three. Codes are generated **server-side** in a retry loop on `unique_violation`, from a 31-character alphabet with no `0/O/1/I/L`; a client-supplied code would let someone squat `AAAAAA` and intercept whoever typed it. `duel_lobby_join` takes the row `FOR UPDATE` and decides **everything** under that lock — consumed, stale, `host_id = auth.uid()`, `host_device_id = p_device_id` — so there is no read-then-check window, and it is idempotent for a participant (a double-click or reload gets the same match back).

**The liveness window is 120s against a 20s beat, and is deliberately NOT the queue's 15s/5s.** A backgrounded tab throttles `setInterval` to roughly one call per minute in Chrome, and hosts **will** alt-tab — pasting the code into Discord is the entire point of the feature. At the queue's window the host's own lobby dies while they are doing the thing it exists for, and the friend following the link is told the code expired. Do not "tidy" these toward `QUEUE_STALE_MS`: the two windows measure different things, because a searching player is staring at a spinner and a hosting player is somewhere else on purpose.

The staleness rule applies to **open lobbies only**. A consumed one stops beating the moment its match starts, so sweeping it on `last_seen_at` would break the joiner's idempotent re-join; consumed rows age out on `created_at` against `CUSTOM_LOBBY_MAX_AGE_MS` instead.

An open lobby is a **live server commitment** exactly like a queue row, registered in `lib/duel/duelCommitments.ts` and cancelled in `signOutAndReset()` **step 1c**, while the outgoing identity can still authenticate the call. Higher stakes than the queue's: a stranded lobby has a second person pointed at it, who joins a match whose host no longer exists and eats a `DISCONNECT_GRACE_MS` forfeit for nothing.

### Realtime — no new policy needed, and why

**The live match uses `duel:{matchId}` unchanged.** It is a real `duel_matches` row, so `duel_topic_participant` (drizzle/0046) already scopes the private channel to its two participants. Nothing to add.

**The host's wait reuses the existing public `lobby` channel and `MATCHED_EVENT`** — the joiner broadcasts to the host exactly as `DuelSearching`'s joiner already does. That channel is deliberately public and deliberately non-authoritative, so this needs zero new RLS.

One improvement over the matchmaking path, and it is the rule the rest of the duel already follows: **the broadcast is a doorbell, not data.** On receiving it the host calls `duel_lobby_state(code)` and `getMyLiveMatch()` and renders those, rather than the payload — so the host never renders profile data a stranger typed into a public channel. It is a between-phases beat where a round trip is free. A `CUSTOM_LOBBY_POLL_MS` poll backs it up, the same belt-and-braces as matchmaking's poll beside its own broadcast.

### Client shape

`DuelRoot` gains exactly **one** phase, `"custom"`. `CustomLobby` owns `compose | waiting` with a **Host/Join tablist** inside `compose`, and reports a `MatchResult` upward — the same contract `DuelSearching` has — so a custom match reaches staging, the ready-gate, the countdown, the match and the results by the identical path a matchmade one does. `DriverFilterModal` is reused **unmodified**, so the lobby gets Infinite's cascading per-option counts for free; if it ever seems to need a variant, that is the signal to change the shared one, not to fork it.

Host and Join are **tabs, not a menu screen**. A two-card "create or join?" step cost a click and hid half the feature behind it — someone arriving with a code in hand had to first answer a question they already knew the answer to. The tablist is `SettingsModal`'s, so a tab looks like a tab everywhere. `waiting` deliberately leaves the tabs behind and takes the whole screen: a code is out in the world by then, and a Join tab beside it invites the host to abandon their own lobby by accident. **The code itself is the button** — copying it is the only thing anyone wants from that screen, so the largest target on it does that rather than sitting inert beside a smaller control that does. It stays real text (`select-all`, readable aloud over a call), and both it and Copy link confirm with `toast.success("… copied to clipboard")`, the same way the daily share does — a clipboard write is invisible, and on the code there is no button label to flip, so without the toast a click looks like it did nothing. One level of elevation throughout, for the reason above.

**The create screen asks which game first, and `lib/game/onlineModes.ts` is why.** A duel is rounds and a clock; a knockout will be a player count and a hint interval — so the mode decides what the rest of the screen asks, and the controls render from the selected mode's own `settings` list rather than being hardcoded. Adding Knockout is a spec entry plus its controls, not a restructure. **`available: false` is not a UI preference**: `duel_lobbies.mode` is `CHECK (mode IN ('duel'))` and `duel_lobby_create` takes no mode parameter at all, so a knockout lobby is unrepresentable until a migration widens that CHECK — flipping the flag alone would host a duel wearing a Knockout label, which is worse than a disabled button because it looks like it worked. `onlineModes.test.ts` pins the available set to exactly `["duel"]` so the migration is what ships the mode.

**The pool opens on the last 20 seasons** (`defaultDriverFilter`), the same span daily, a ranked duel and Infinite all use. It opened on all-time, which made "Custom" quietly mean "and also a pool you did not ask for" — a friendly game's first round could be a driver from 1953 with nothing erroring. `CustomLobbyCreate.test.tsx` (`dom` tier) pins the span, the count and the disabled Knockout control.

**The filter persists, under its own key.** `lib/settings/driverFilter.ts` is scoped — `readDriverFilterPreference("custom" | "infinite", year)` — because the two are different things: Infinite's is a practice preference, a lobby's is the shape of a game you are about to host for someone else. One shared key would mean narrowing Infinite to Ferrari silently re-pooling the next game you invite a friend to, a change nobody made and nobody would connect to what they did. Same storage behaviour otherwise, including the re-clamp on **read** so a filter stored last year does not outlive its ceiling. `lib/settings/driverFilter.test.ts` pins the independence (it carries a `@vitest-environment jsdom` docblock — the one file under `lib/` that needs a DOM, since what is under test is storage rather than a component).

`/online?join=CODE` is read in a **mount effect from `window.location.search`** and stripped with `history.replaceState` so a refresh cannot re-fire it. Deliberately not `searchParams` on the page (that opts `/online` out of ISR entirely) and deliberately not `useSearchParams()` (which drags a Suspense boundary into a client-only concern). A deep link **pre-fills and previews but never auto-joins** — joining consumes the lobby, so a forwarded link would otherwise burn someone else's game on open.

The join box normalizes case, spaces and dashes on every keystroke, and **unwraps a pasted share link first**: "Copy link" is the host's primary button, so the whole URL is the likeliest paste, and stripping punctuation from it yields `HTTPSD` — a plausible-looking code that is not the one in the link. For the same ordering reason the input carries **no `maxLength`**: it bounds the raw value before stripping, so a seven-character `ABC-234` truncates to `ABC-23` and normalizes to five characters, silently losing the end of a valid code. `normalizeLobbyCode` slices *after* stripping. `components/duel/CustomLobbyJoin.test.tsx` (`dom` tier) pins all of it.

`/online` fetches the **full roster** (`listAllDriverOptionsWithActivity`, the same query `/infinite` serves under the same ISR) rather than the 20-year pool, because the filter panel needs every driver for its counts. The ranked-duel list is then derived from it client-side via `poolCutoffYear`, so there is one source and no "which list am I on" bug.

## Knockout (planned — do not build yet)

For context so the duel engine leaves room for it. A 20-player elimination game under `/online`:

- **Format:** 3 rounds, F1-qualifying style. All players guess the same driver simultaneously.
- **Hints:** unlike duel, clues are **global auto-reveals** — every ~5s a new fact about the target surfaces to everyone (nationality, then debut era, then a team, etc.), independent of guessing.
- **Elimination:** the bottom 5 each round (slowest / furthest / lowest score) are knocked out; survivors advance; a winner emerges from round 3.
- Reuses the live-match core (lifecycle, timers, rounds, scoring, broadcast, ready-gates) with a many-player lobby, an elimination visualization, and the global-hint reveal system.

### Build seam for Knockout

Build the round lifecycle (server-stamped timers, synchronized countdown, per-round driver selection, scoring hooks, match/round state broadcast, ready-gates) as a **reusable "live match" core**, not hard-wired to 2 players. Knockout is the same machinery with N players, an elimination step, and a different hint source. Don't build Knockout now — just don't wall the duel engine off from it.

## News section — RSS, not X

Recent F1 news from RSS feeds — motorsport.com, Autosport, Crash.net and Sky Sports. Fetched server-side, revalidate hourly, merged and sorted by recency. Rendered client-side only as an interactive carousel (`NewsCarousel`): one big featured story (image + title + source + relative time), with prev/next arrows and larger-hit-area dots in a control row **under** the card, and auto-advance (paused on hover/focus, disabled under the OS reduced-motion signal — see WCAG 2.2.2) to step through the top 5 across all sources. The *fetch* stays server-side; only which slide is showing is client state. Do **not** integrate the X/Twitter API — no free read tier, bills per request.

**A story without an image is not shown**, and that guarantee is a *type*, not a convention: `getLatestNews` returns `NewsItemWithImage[]`, so `NewsCarousel` has no placeholder branch to fall out of date. The card is one big photo with a caption under it, so an imageless item renders as an empty grey box that reads like a failed load rather than a story. The filter runs **before** the `limit` slice — filtering the top five afterwards would silently return three on a day two of them were imageless, which looks like the feeds being half-down.

**"Has an `<enclosure>`" is not "has an image", and the gap between them is enforced in three places** — a filter that only asked `imageUrl !== null` still shipped empty boxes:

- `usableImageUrl` (`lib/news/parseRss.ts`, pure + unit-tested) is the **only** place a URL enters the app, and rejects everything that isn't an absolute `http(s)` URL: `url=""` (the sharp one — `""` is not `null`, so it sailed through the type guard into `<img src="">`), whitespace-only, relative and protocol-relative (both resolve against *our* origin, not the feed's), and non-http schemes. The enclosure regex captures `[^"]*` rather than `[^"]+` on purpose, so an explicitly empty url is captured and *rejected* instead of falling through to the other attribute-order pattern and looking like a missing enclosure.
- `getLatestNews` drops the item.
- `NewsCarousel`'s `onError` drops it too, keyed by link. A URL can be well-formed, survive both checks and still 404 / be hotlink-blocked / have an expired CDN signature, and only the browser finds that out. The index is **clamped, not reset** — sending a reader back to story 1 because an unrelated image failed is worse than showing them the one that took its place — and `go()` steps from the clamped index for the same reason.

**The swap must not show the previous story's photo**, which it did for a second or two. Two independent causes, two fixes: the `<img>` is **keyed by story link**, because React was otherwise reusing one element and only changing `src`, and a browser keeps the old bitmap on screen until the new one decodes — the wrong photo under the right headline. That makes it *correct* (a fresh element can only show its own picture or nothing); an `IntersectionObserver` that warms every story's image the first time the carousel scrolls into view makes it *fast*, so the honest version isn't a blank box either. Behind the observer rather than on mount because the section sits below the game window, the ad slot and four marketing blocks — most visits never reach it and shouldn't pay five image downloads for the privilege. The opacity fade is only reachable on a cache miss.

That requirement is what decides the feed list. `formula1.com` (items carry no publish date, so `parseRssItems` correctly drops all of them) and `planetf1.com` (feed URL redirects to a broken page) were already rejected. **RaceFans was dropped when the image filter landed**: measured 2026-08-05, all 20 of its items carry no `<enclosure>`, no `<media:content>` and no `<media:thumbnail>` — its images live in the HTML body — so every one would now be filtered out, and listing it would spend an hourly crawl of someone else's server on items that can never be shown. It comes back the day `parseRssItems` learns to pull the first `<img>` out of `<content:encoded>`.

**The image box is a true 16:9 (`aspect-video`, no `max-h`).** A `max-h-64` used to sit alongside the aspect ratio and beat it, making the real box ~2.7:1 so every photo lost roughly 44% of its height to the crop. The feeds ship 1200×800 (3:2) from the three Motorsport-network sources and 1920×1080 (16:9) from Sky Sports, so 16:9 is the ratio that actually fits them. `NewsSkeleton` mirrors the photo **and** the caption block, or the page below jumps ~76px when the feed lands.

## Ads — AdSense + consent

Single responsive banner in the fixed-height slot under the game window.

- **If no ad can appear, there is no slot** — not a grey box reading "Advertisement", which is a hole in the layout rather than a reservation. The min-height exists to stop an *arriving* ad shifting the page, so it is worth keeping right up until "arriving" stops being possible and worth nothing after. Three cases, at three different moments:
  - **Not configured** (`getAdsenseUnit() === null`) — checked in `AdSlotGate`, beside the live-match check, because they are the same question: is this slot on screen at all. Checked *there* so an unconfigured build never mounts `AdSlot` and so never patches `window.dataLayer.push` through `useAdConsent` for a signal nothing is waiting on. `NEXT_PUBLIC_*` is inlined at build time, so it's a constant per deployment — no flash, no hydration mismatch, and setting both env vars brings the slot back with no other change.
  - **Request failed** — `adsbygoogle.push` threw, which is what an ad blocker looks like from inside the component. Nothing was requested.
  - **Unfilled** — the request went out and AdSense had nothing, reported by stamping `data-ad-status="unfilled"` on the `<ins>` *asynchronously*, so a `MutationObserver` is the only way to hear about it (read once up front too, since the attribute can already be set on a fast connection). Common on a new site, and it leaves the element empty — without this the slot sits at full height showing nothing.

  All three collapse rather than falling back to the placeholder. **Consent is deliberately not one of them**: `useAdConsent` starts at `"denied"` and only flips once Google's CMP replays or collects a decision, so "denied" cannot be told apart from "not resolved yet" — collapsing on it would remove and restore the slot on every visit by a consenting visitor, which is exactly the shift the reservation exists to prevent. `components/ads/AdSlot.test.tsx` (`dom` tier) pins all of it, and its **configured control case is not optional**: without it, "renders nothing when unconfigured" passes equally for a component that renders nothing ever.
- AdSense script via `next/script` `strategy="afterInteractive"`, gated behind consent.
- **EU audience → consent required:** Google Consent Mode v2 + a Google-certified CMP (built-in Google consent messages are the free default). Ad cookies must not load until consent; default all signals to denied.
- **Two** env vars, both required before a real ad renders, both read only through `components/ads/adsenseConfig.ts` and never hardcoded: `NEXT_PUBLIC_ADSENSE_CLIENT` (account-level, `ca-pub-…`) and `NEXT_PUBLIC_ADSENSE_SLOT` (the specific unit, which only exists *after* approval). `getAdsenseUnit()` is the single "are real ads on?" check — it returns the `{ clientId, slotId }` pair or `null` rather than a boolean, so the caller that asks is also the caller that gets the ids to render with. (It replaced a boolean `isAdsenseConfigured()` that ended up with no callers precisely because it didn't narrow — audit §2.1.) Funding Choices (the CMP loader) wants the bare `pub-…` form — hence `getPublisherId()`, which strips the `ca-` prefix. Approval is external and needs the deployed site with real content; until both vars are set there is no slot on the page at all (see the first bullet). All ad logic stays isolated in `components/ads/`.
- **Hide the ad slot during an active duel/knockout match** — a live race is the wrong moment for a banner; show it on daily/infinite, on the /online landing, **while matchmaking and while composing or hosting a custom lobby** (all ordinary browsing — see "Site architecture"), and again on the duel **results** screen, not from staging through intermission. `AdSlotGate` does this by reading `ActiveMatchContext` — the same flag `GameChrome` uses to hide the rest of the shell (see "Site architecture").

### The 2026-08-12 rejection, and the rules that came out of it

AdSense refused the site on two grounds — **"low value content"** and **"Site behaviour: navigation"** — while it was still `driver-pit.vercel.app`. Everything below is a response to one of those two, and each is a rule rather than a fix, because every one of these defects survived four content passes without anybody noticing.

**`/ads.txt` was returning 404 in production, and had been since Pass 7.** `middleware.ts`'s matcher names `sitemap.xml`, `robots.txt` and `manifest.webmanifest` as exclusions; `ads.txt` was missed, so next-intl rewrote it to `/en/ads.txt` and nothing served it. It looks like it should fall through the extension escape at the end of that pattern — that list is assets (`svg|png|…|css|js`) and has never included `txt`. An unreachable ads.txt is how Google concludes the domain does not authorise our publisher id. **Anything added to `public/` with an unlisted extension needs naming in that matcher**, and `composedMiddleware.test.ts` pins all four paths.

**The ad's presentation is a policy requirement, not a style choice.** `AdSlot` wore `rounded-lg border border-border bg-surface` — byte for byte the game window's own container — sat between the game and the chevron'd marketing rows, and rendered the word "Advertisement" as the *content* of that panel when it could not serve. That is an ad dressed as the site's own furniture, in the position navigation occupies, which is what the navigation clause forbids. Nobody had seen it, because the env vars are unset in production and no ad has ever rendered. The rules now: **no border, no surface fill, no radius** on the ad container (a `border-t` hairline brackets it instead); **reserving and presenting are two different elements**, so the height is held by something invisible rather than by a drawn box; and the label is the literal string **"Advertisement"** — one of the only two wordings the policy accepts — placed *outside* the `<ins>`, above it, and rendered **only once a request has actually gone out**.

**Nothing may advertise content that does not exist.** Two things did. **Knockout** was listed as a mode with a "coming soon" pill on the home teaser, `/game-modes` and the `/online` landing, plus a whole FAQ entry emitted as `FAQPage` structured data — all removed. The build seam is untouched (`ONLINE_MODES` keeps the spec, `duel_lobbies.mode` keeps its CHECK, `ModeIcon` keeps the glyph, the copy stays in the catalogues), and `GameModesTeaser.test.tsx` now asserts its absence on both lists, because the pill made it *feel* honest and that is why it survived so long. And the **footer's four social icons all pointed at `href="#"`** — four dead links on every page in both route groups. The rule there: **a platform is listed when its profile exists and is deleted otherwise, never `#`**. Discord was removed under it; X, Instagram and TikTok carry real URLs.

**The site's own contact surface.** There was no `/contact` route at all. `lib/marketing/contact.ts` now owns the address (`driverpit.inc@gmail.com`) and the profile list in one place — deliberately **not** in the message catalogues, since `npm run i18n:translate` rewrites what it is given and an email's local part is exactly the kind of token a model helpfully localises.

## SEO & page metadata

The site had none of this until 2026-08-06: no sitemap, no `robots.txt`, no `metadataBase`, not one `openGraph` tag, no canonical anywhere, and **no metadata at all on the three game routes** — `/daily`, `/infinite` and `/online` all inherited the root's `"DriverPit"` title, so the three most valuable pages on the site were indistinguishable in a result and every shared link rendered as a bare blue line of text.

**One origin, resolved once.** `lib/seo/site.ts` owns `SITE_URL` (`NEXT_PUBLIC_SITE_URL` → Vercel's production domain → `localhost:3000`) and every canonical, the sitemap, `robots.txt` and the OG card read it. `normalizeOrigin` is pure and unit-tested because its failure mode is silent and total — a trailing slash or a leftover path on the env var is prepended to every URL on the site and the only symptom is Search Console reporting canonicals nobody can fetch, weeks later. It is **server-only**: the Vercel fallback is an unprefixed env var, so importing this into a client bundle would resolve the chain to localhost there and produce two answers to "what is our origin".

**Every page's metadata comes from `buildPageMetadata` (`lib/seo/metadata.ts`), and the reason is a Next.js rule that fails quietly.** `title.template` applies to a page's `title` but **not** to `openGraph.title` or `twitter.title`. A page setting only `title` therefore looks right in the browser tab and inherits the *root's* headline on every social share — nine pages, one card headline, nobody notices. The builder composes all three from one input plus the canonical, so they cannot drift.

**Nothing user-facing says "Wordle", and that is a decision, not an oversight.** It is a New York Times trademark, and while every competing F1 game leans on it in titles and descriptions, the ones that have drawn takedowns did so over exactly this kind of use. The searches it would target are reachable through "F1 driver guessing game", "daily F1 puzzle" and the mode-specific long tail instead, which is what the page copy is written for. It was removed from the `/daily` description, `AboutSection` and the README on 2026-08-06; the `docs/audit-*.md` files still contain it and are deliberately left alone, since those are dated records of past reviews rather than live copy.

**Amended 2026-08-15, with the risk accepted explicitly, and widened the same day. The rule is now about SHAPE, not count.** The blanket ban cost the site the one query it cannot otherwise reach — people type "F1 Wordle" for this genre and nothing here matched it. What is permitted is *nominative* use: naming another product to describe how this one compares. What stays forbidden is using the mark as a **source identifier for our own product** — an `<h1>`, a `<title>` or an `og:title` reading "F1 Wordle" — which is the form the takedowns above were aimed at.

Concretely: **the adjectival forms are allowed in body prose and in meta descriptions** — "Wordle-like", "Wordle-style", "if you've played Wordle", and their per-locale equivalents (`al estilo Wordle`, `no estilo Wordle`, `in stile Wordle`, `Wordle-achtig` / `in Wordle-stijl`, `im Wordle-Stil`). **The noun phrase "F1 Wordle" appears in exactly one place** — inside `faq.items.wordleLike`, where it is quoted as the thing people search for and immediately answered with the differences plus a disclaimer ("not affiliated with Wordle or The New York Times").

It sits in **10 strings per locale**, identical placement across all six: `site.description`, `meta.daily/howToPlay/faq/about.description`, `faq.items.wordleLike.q`/`.a`, `marketing.about.teaser`, `marketing.about.whatItIs`, `marketing.howToPlay.intro` — plus `SITE_DESCRIPTION` in `lib/seo/site.ts` (the manifest), which mirrors `site.description`. The FAQ entry is first in `FAQ_KEYS`, so it is also emitted in `/faq`'s `FAQPage` JSON-LD.

**Two constraints on any further expansion.** The wording is *varied on purpose* rather than one phrase repeated — an identical string across ten pages is keyword stuffing, which Google's spam policy names explicitly and which this site can least afford, having already been rejected once for "low value content". And it must stay out of titles: `site.title`, every `meta.*.title`, and every visible heading are clean, and a grep should keep them that way. `components/marketing/contentPages.test.tsx` covers About, How to play and the FAQ, so a key that loses its message fails the `dom` tier rather than shipping a dotted path into a meta description.

**The daily page uses `generateMetadata`, not a static export**, so the title and description carry the puzzle number and today's date — a real freshness signal on the one page whose content genuinely changes daily, at no cost (the number is pure, no query, same 60s ISR cycle). The puzzle *number* says which day it is, never who the driver is; that split is what `lib/game/dailySelection.ts` exists to preserve, and nothing in the metadata may cross it.

**The game is served at `/`, and `/daily` is the 308** (roadmap Pass 5, 2026-08-08). It used to be the other way round, which spent a redirect on the bare domain — the most-linked URL the site has and the one people paste. The redirect survives in the new direction because `/daily` was the sitemap entry, the `VideoGame` entity's `url`, the manifest's `start_url` and whatever was already indexed; a 308 rather than a 307 for the same reason as before, since a temporary redirect tells a crawler the move may be undone.

**Nothing internal may point at `/daily`.** Every link that did — the top-bar logo, `InfoTopBar`'s logo and "Play now", the mode tabs, the footer, the archive index and day pages' "play today", `sanitizeNextPath`'s `DEFAULT_NEXT`, `/auth/reset-password`'s post-save navigation, the manifest's `start_url`, `videoGameJsonLd`'s `url`, the sitemap's priority-1 entry — names `/`. A link to a redirect is a hop a player pays and a signal a crawler discounts, and `npm run seo:audit` fails a sitemap that lists one. `DEFAULT_NEXT` is exported from `lib/auth/oauthCallback.ts` so the sign-in page's initial `next` cannot spell it a second way.

**There is no site-wide `alternates.canonical` any more.** The root layout carried one because `/` was a redirect with no page of its own; now it sets its own through `buildPageMetadata` like everything else. A layout-level canonical is *inherited*, and the only pages left inheriting it would be the two `/auth/*` ones — each then declaring itself a duplicate of the home page while also carrying `noindex`, which is a contradictory pair. No canonical is the honest state there; a wrong one is worse than none.

**The OG card is generated (`app/opengraph-image.tsx`, `next/og`), not a static file.** Satori takes a CSS subset — flexbox only, explicit `display: flex` on anything with more than one child, **no CSS variables** — which is why `lib/game/palette.ts` exists: the literal-hex copy of the design tokens, shared with the share-image canvas (`lib/game/shareImage.ts`) so there are two copies of the palette in the repo (that file and `globals.css`) rather than one per renderer. The fonts are committed under `app/fonts/` as **ttf** (Satori cannot read woff2) and named in `next.config.ts`'s `outputFileTracingIncludes`, because Next traces static imports and a `readFile` path built at runtime is invisible to it — without that entry the card renders locally and 500s in production. **A layout that renders in Chrome is not evidence it renders in Satori**; check it by rendering a PNG, not by reading the JSX.

**The app icons are generated (`npm run icons:generate`, `scripts/generateIcons.ts`) from `public/driverpit-banner.png`, and each is opaque or transparent according to what its consumer demands — NOT uniformly opaque, which is what this said until 2026-08-15.**

The blanket "every icon is opaque" rule overshot and cost the browser tab: an opaque tile renders as a **black box** in a light tab strip, beside everyone else's transparent marks. The subtlety it missed is that **the grey bracket was the thing that needed an opaque background, and the same change removed it** — what remains is pure `#FF6A00`, which has ample contrast on white *and* on dark, so the favicon can be transparent without reviving the washed-out bug. Google renders it on white (orange on white is fine); a tab strip renders it on the OS theme (fine either way). Current split: **`favicon.ico` and `icon.png` transparent**; **`public/icon-maskable.png` and `apple-icon.png` opaque**. The maskable one is genuinely non-negotiable — Android crops it to the launcher's shape and puts a *transparent* maskable icon on a white circle — which is why it is now a **second file** rather than `icon.png` declared twice in the manifest: one file cannot be both, and the previous list had to pick, and picked the tab wrong. It lives in `public/` and not `app/` because Next's file convention claims `app/icon*.png` and would publish it as a second `<link rel="icon">`, reintroducing the black box.

The original three-way defect this script was written for still stands as the reason it exists: They were one byte-identical PNG copied to three names, and each copy was wrong for its slot. `icon.png` was 49% transparent and clipped edge to edge (content bbox `0,39 → 511,472` in a 512² canvas) — Google Search renders a favicon on a **white** results page, so the light-grey half of the mark vanished and the orange half floated alone, which is the washed-out look and is not fixable by picking a different orange; and Google's *mobile* results crop the favicon to a **circle**, which an edge-to-edge mark loses its corners to. `apple-icon.png` carried the same alpha, which iOS composites onto black. And `favicon.ico` was a PNG with an `.ico` extension (first bytes `89 50 4E 47`, not `00 00 01 00`) rather than the multi-resolution container the name promises — it is now a real ICO holding 16/32/48, and **48 is where Google's "a multiple of 48px" guidance is actually satisfied**, since `icon.png` stays 512 for the manifest's sake.

Two constraints on that script, both found by breaking them. **The PNGs embedded in the `.ico` must be RGBA**: Next builds that file through Turbopack, whose ICO decoder is Rust's `image` crate, and a non-RGBA embedded PNG fails with *"Format error decoding Ico: The PNG is not in RGBA format!"* — which 500s **every route**, not just the icon. `apple-icon.png` is the one file that drops the channel, for Apple's guidance. And **the mark sits at 66% of each canvas**, which is not a taste call: it is the largest scale at which this mark's aspect ratio fits inside the 80% safe circle Android maskable crops to (338×217 has a 201px half-diagonal against a 205px radius). Push it wider and the outer stems of the P and the T get shaved off on Android and in mobile search. The grey bracket from the full lockup is deliberately left out — it is a hairline that becomes a grey haze around the letters below ~48px, and 16px is the size a desktop results row actually uses.

There is deliberately **no CI diff test** on these, unlike the flag subset: sharp's resampling is not byte-stable across libvips versions, so it would fail on a runner upgrade rather than on a real change, and nothing routinely triggers a regeneration. Run it when the brand artwork changes. Google caches favicons for weeks, so a corrected icon does not reach the results page quickly.

**Every page names that card explicitly (`OG_IMAGE`, `lib/seo/site.ts`), because Next's file convention does not survive `buildPageMetadata`.** The convention attaches `opengraph-image.tsx` by merging it into the *segment's* resolved metadata — but a deeper segment that exports an `openGraph` object **replaces** the resolved one outright (`target.openGraph = resolveOpenGraph(source.openGraph, …)`), and the static-file merge only re-adds an image for a segment holding an image file of its own. Every page here sets `openGraph` for its per-page `og:title`, so all nine dropped the card and shipped with **no `og:image` at all**: the route existed, returned a correct PNG, and nothing referenced it. Found by `npm run seo:audit` on 2026-08-07 and fixed by defaulting `image` in the builder; `app/opengraph-image.tsx` derives its own `size`/`alt` from the same constant, so the declared dimensions can't drift from the rendered PNG. **Anything that sets `openGraph` outside the builder inherits this trap.**

**`npm run seo:audit` (`scripts/seoAudit.ts`) reads the deployed site back and checks all of the above.** Not one of these tags fails loudly when wrong — the pages render and the markup is simply incorrect, and Search Console reports it weeks later or never. It takes its target from `SEO_AUDIT_URL` (falling back to `NEXT_PUBLIC_SITE_URL`) and **refuses to run rather than default to localhost**, since an audit that silently retargets itself reports green about the wrong site. The rules are pure and unit-tested in `scripts/seoAuditChecks.ts`; the load-bearing one is that every URL the deployment declares about itself — sitemap `<loc>`, canonical, `og:image` — must be on the origin the *operator* named, because a deployment with the wrong `NEXT_PUBLIC_SITE_URL` is perfectly self-consistent and entirely wrong. Two things its parser knows that a reader will not: **Next 15 streams metadata**, so the whole block lands ~30KB past `</head>` for anything outside Next's `htmlLimitedBots` list (reading `<head>` alone reported all nine pages as untagged), and a sitemap URL is fetched with `redirect: "manual"`, since following redirects makes a sitemap full of 308s look like one full of 200s. Deliberately **not** in `ci.yml`: it needs a deployed origin, and a job that goes red because a deploy is in flight is a job people learn to ignore.

**`noindex` and a robots disallow are not interchangeable, and `/auth/*` is where that bites.** Those pages are `"use client"` and cannot export metadata, so the directive comes from `app/auth/layout.tsx`, whose only job is to carry it. They are deliberately **not** disallowed in `robots.ts`: a disallowed URL can still be indexed contentless from its inbound links — `/auth/sign-in` has six — and a crawler forbidden from fetching the page can never read a noindex on it, so setting both cancels out. Allow the crawl, refuse the index.

**The FAQ's questions live in `lib/marketing/faqContent.ts`, as data.** `/faq` renders that array visibly *and* as `FAQPage` JSON-LD, and Google requires those to match — one array is the only way to guarantee it. `FaqTeaser` keeps its own shorter list and is not folded in: its answers are rewritten short for the home page rather than truncated, so it is different content, and the structured data belongs on the full page anyway.

**Discovery is pushed as well as crawled: `npm run indexnow` (`scripts/indexNow.ts` + the pure `lib/seo/indexNow.ts`).** The archive gains an indexable page every midnight UTC with nobody deploying, which is the case a young site's crawl budget handles worst — so a nightly workflow POSTs the changed URLs to IndexNow, reaching Bing, Yandex, Seznam and Naver in one request. **Google does not participate and there is no equivalent push for it**; the Google half is Search Console, by hand, once. Five things are load-bearing:

- **The key is committed, not a secret.** The protocol requires the same value to be fetchable at `/<key>.txt`, so `public/<key>.txt` is a public file by specification and hiding the constant would only add a second place for it to drift from the filename. `indexNow.test.ts` pins the file against `INDEXNOW_KEY` — rotate one without the other and every submission is 403 while the site looks perfectly fine. Root placement is required too: a key served from a subdirectory limits submissions to URLs beneath it.
- **`middleware.ts`'s matcher now escapes `txt` wholesale** rather than naming a fifth file. The key file's *name is the key*, so listing it would put a rotatable value inside a regex where a rotation breaks it silently — the exact shape of the `ads.txt` bug, which 404'd in production for four months. Nothing this app routes ends in `.txt`.
- **The diff is against stored state, never a "lastmod within N days" window.** A day enters the sitemap only once somebody completes a board on it (`lib/recap/dayEligibility.ts`), which can be long after the date it carries — so a date window would skip precisely the late arrivals. The state lives in the Actions cache; a cache miss means "submit everything", which is the wasteful direction rather than the silent one.
- **The key file is verified before anything is submitted.** A 403 from the endpoint reads as "wrong key" when on this site the likelier cause is the file being locale-rewritten out of existence, and the error says so.
- **Dry run by default** (`indexnow` plans, `indexnow:commit` submits), with the flag inside the package.json script string — PowerShell drops a bare `--`, and here the stripped form must land on the harmless side. State is written **only after a successful real submit**, so rehearsing the command cannot cost the site its next batch, and a failed POST leaves those URLs queued for the next run.

**Ownership verification is env-driven (`siteVerification()`, `lib/seo/site.ts`).** `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` carry the `content` **value**, never the whole `<meta>` tag — pasting the tag produces a nested invalid one that verification fails on, reported only as "we couldn't find the tag". Absent ⇒ nothing is emitted, deliberately: an empty-string env var would emit `content=""`, which both services read as present-but-wrong, a worse failure than absent. A DNS TXT record is still the stronger proof for Google (whole domain, survives a hosting move); this exists so the meta route needs no code change.

Two honest limits on the structured data, recorded so nobody expands it expecting more: Google restricted FAQ rich results to government and health sites in 2023, so that block is worth its ~1KB for Bing and for entity resolution, not for a snippet; and **`aggregateRating` must never be added** — there are no ratings, and fabricated ones are a manual-action offence rather than a grey area. `lib/seo/structuredData.test.ts` asserts its absence.

### The daily recap

**A finished day is a publishable object, and `getDailyRecap(date)` (`lib/db/dailyRecap.ts`) is the only way to get one.** Nothing new is recorded for it: `daily_progress.guesses` has been the ordered `int[]` of every guess by every player since drizzle/0029, so the players, the solve rate, the 1–6 distribution, the five most-guessed drivers and the most common opener are all one query with CTEs away. It is the foundation for Pass 3's `/archive/[date]` pages, and it is deliberately **a plain query on the trusted Drizzle connection, not an RPC** — both consumers are server-side, and a `SECURITY DEFINER` "everything about a day" function would be one PostgREST call from the browser, needing a grant decision to be its own defence.

**Its date check is the security boundary and it lives in SQL.** `t.date < (now() at time zone 'utc')::date`, against the **database** clock — the same one `daily_submit_guess` resolves the UTC day from. In Node it would be a second clock, and a server running a few minutes fast would hand today's answer to everyone for those minutes. Malformed, unknown and unfinished all return `null` and are deliberately indistinguishable from outside. `lib/db/dailyRecap.test.ts` (database tier) pins it with a **fully populated fixture day 400 days in the future**, not merely with "today": asserting only on today passes on any database where today's target has not been pinned yet, which is most of them. Both halves were checked by deleting the comparison and watching the suite return the live answer.

Two rules the numbers themselves carry. **Ties break deterministically** (count desc, then driver id) in `topGuesses` and `commonOpener`, or the same finished day renders two different images on two requests — a caching bug and a credibility one. And the most-guessed count is `DISTINCT (player, driver)`, so it means "players who guessed them" even for rows predating drizzle/0049's repeat-guess rejection; a share above 100% is the kind of error nobody thinks to look for.

**`components/recap/RecapCard.tsx` renders it, and `/api/recap/[date]/image?format=portrait|wide` is the route.** Portrait (1080×1350) is the poster and carries everything; wide (1200×630) is the link-preview card Pass 3 will point its `og:image` at, and stops after the answer and the three headline numbers — a six-bar chart is not legible at feed size. `MIN_RECAP_SAMPLE` (25, exported from the card) withholds the distribution and most-guessed blocks below that many players; the space goes to an unboxed "a new driver every day" block rather than to a bordered panel, because an empty container reads as a failed render.

**Satori will clip text rather than shrink it, and that is what `fitTextSize` (`lib/recap/format.ts`) exists for.** Every box on the card is fixed, so a value that does not fit is not squeezed — it is cut off, or centred so far that it overprints its own tile label. It searches downward through sizes doing an exact greedy monospace wrap, with two constraints, because the two failures are different: a **word is never broken** (that is "Ferrari" rendering as `Ferrar` / `i` at 36px in a 134px tile, which any height-only test accepts) and the **wrapped lines must fit the height** (that is "United States of America" printing over `NATION`). A closed-form area estimate was the first cut and is wrong in the direction that hurts — word wrapping wastes the tail of every line, so it under-counts lines for exactly the values that overflow. The driver name gets the same treatment against a fixed one-line box, so the card's vertical budget never depends on who won the day.

### The archive

**`/archive/[date]` is one indexable page per finished day, and it is the only asset here that compounds.** Everything else in the roadmap is a fixed amount of work; this grows by a page a night, forever, and each one carries data nobody else has. `/archive` is the paginated index — without it every day page is an orphan reachable only from the one before it — and the **footer** carries the site-wide link into it, since an index nothing links to cannot do its job. Pages live in the **`(info)` route group**, so they get InfoTopBar and the footer and no third kind of chrome; `InfoTopBar`'s active-link lookup now returns null rather than falling back to `LINKS[0]`, or the collapsed mobile trigger would read "About" on every archive page.

**Page 1 is `/archive` and `parseArchivePage` refuses `"1"`.** `/archive/page/1` would be a second URL serving the same rows, which is the duplicate-content own-goal canonicals exist to prevent; the cheapest fix is not minting the second URL. A page past the end 404s rather than rendering an empty list — an empty 200 is a soft 404 and lets a crawler wander into `/archive/page/900`.

**The paging rules live in `lib/recap/archivePaging.ts`, and `ARCHIVE_PAGE_SIZE` is 10.** It was 40 in a component that imports `lib/db/dailyRecap`, which dragged a postgres client into the `node` test tier for four pure functions; they are arithmetic over a URL and a row count and they now sit beside the suite that already tested them. Ten rows is a screen, so a page is something a reader reads rather than scrolls past — but it makes a year of archive 37 pages instead of 10, and prev/next alone would put the oldest day 36 clicks from the newest. `archivePageWindow` is what pays for that: first page, last page, and a window either side of the current one, so the whole archive is two clicks deep from anywhere. A run of exactly **one** hidden page prints its number rather than an ellipsis — "1 … 3" spends the same width as "1 2 3" to say less.

**The archive has a search, and it is additive: `ArchiveSearch` WRAPS the server-rendered page of rows rather than replacing it.** `children` is that page plus its pagination, and it is what renders whenever the box is empty — which is every request a crawler ever makes — so the crawlable list is never a client-side copy of itself and the archive still works with JavaScript off. Deliberately **not** a `?q=` param: `searchParams` opts every archive index page out of ISR, and it would mint an unbounded set of crawlable URLs serving near-identical lists, which is the thin-content problem `lib/recap/dayEligibility.ts` was written to undo. The index it searches is the whole of `listArchiveSearchIndex()` shipped to the client once — the same trade the guess autocomplete makes with the driver pool, with the payload arithmetic and the ceiling stated in `lib/recap/archiveSearch.ts`. That query is the **seventh** copy of `UTC_TODAY` in `lib/db/dailyRecap.ts`, and it is not optional there either: without it, typing today's date would name today's driver.

**A bare number is not a substring search, and that is the one rule in the matcher that is not obvious.** Every date in the archive contains a `2`, so `entry.date.includes("2")` returns the entire archive and buries the puzzle the reader actually named. Digits therefore mean a puzzle number, or — at exactly four of them — a year, and nothing else; a `#` prefix means the puzzle number and only that. Anything carrying a letter or a separator (`july`, `2026-07`, `31/07/2026`) is safe to match as a substring and is. The fold is `normalizeSearchText`, shared with the game's own search, so the archive can always find a driver the guess input can.

**`ArchiveDayRow` is one component in both places a day is listed** — the server-rendered list and the search results — which is why it takes a preformatted `dateLabel` rather than a locale. That string is also what a typed month is matched against, so what a reader sees and what their query is tested against are the same string by construction. The index used to render dates through `formatRecapDate`, which is locale-independent on purpose (it feeds the Satori card), so every non-English archive page listed its dates in English beside a day page that wrote them correctly.

**The date boundary is now six queries wide, and `UTC_TODAY` in `lib/db/dailyRecap.ts` is its one definition.** `getDailyRecap`, `listArchiveDays`, `listArchiveDates`/`countArchiveDays`, `getLatestArchiveDate` and the two driver-page queries (`listDriverArchiveEvidence`, `getDriverPage`) are each a way to ask "what was the answer on date X", so all six live in that one file under the comment explaining why, and each embeds the same fragment. A guard that held in one and not the others would put today's answer on the index, in the sitemap, and in the prev/next link off yesterday — and on a driver page under their own name, which is the sharpest of the six. `lib/db/dailyRecap.test.ts` pins every entry point against a fully populated fixture day 400 days in the *future*.

**`getArchiveDayContext` averages the OTHER days' solve rates, and it is a mean of per-day rates rather than a pooled one.** The question the summary asks is "was this day harder than a typical day", so pooling would let one busy day set the baseline for all of them, and including the day itself would flatten exactly the difference being reported — badly, while the archive is small.

**The auto-written paragraph (`lib/recap/summary.ts`) is what stops these being thin pages, and it is built around three rules in order of how much damage breaking them does.** (1) **Every sentence must be entailed by the numbers** — generated prose that sounds insightful and claims something the data does not support is worse than a bare table, because it is wrong at scale in a confident voice. (2) **A fact the sample cannot support is not said at all**; the first draft called one person's first guess "the most popular opening guess" and reported a 1–1 tie broken by driver id as "more players tried X than Y", so every population-level sentence now carries a minimum and a one-player day gets one sentence about that one board. (3) **No fact and no driver is named twice** — the first draft also produced "Most boards opened with Alexander Albon, and the wrong name that came up most often was Alexander Albon". Sentences are shapes *chosen by the data*, differing in what they lead with (the driver, the count, a clause), and the middle sentence is picked from ranked candidates so two days with the same solve rate still read differently. Both defects were found by running it against real days before anything was built on top of it; do that again after any change.

**The day page's `og:image` points at Pass 2's `/api/recap/[date]/image?format=wide` rather than an `opengraph-image.tsx` of its own.** Next's file convention attaches a card by merging it into the segment's resolved metadata, and `buildPageMetadata` sets `openGraph`, which replaces that outright — so the URL has to be named explicitly either way, and naming the route that already exists beats a second Satori route with a second `outputFileTracingIncludes` entry rendering identical bytes.

**`AnswerBoardRow` renders nationality as TEXT, never the `Flag` glyph.** This is a document whose job is to be the authoritative answer for "who was the driver on 31 July", so the country belongs in the HTML rather than in a background-image class readable only by a tooltip — and "show flags" is a per-player localStorage setting that a server-rendered cached page has no way to honour. Unlike the poster, `RecapStats` is **not** gated on `MIN_RECAP_SAMPLE`: the card's guard exists because a chart travels as an image with no context, whereas a page shows the raw counts beside every bar and says how big the sample was, and hiding a quiet day's only substance would leave an indexable page with nothing on it.

**The sitemap is `revalidate = 3600` and its archive and driver halves both fail soft.** It reads `daily_targets`, so it can no longer be a build-time static file; and if either read throws it logs and returns what it has rather than propagating, because a sitemap that 500s takes the nine original pages down with it and teaches Search Console to distrust the file. Day entries carry a real `lastModified` and `changeFrequency: yearly` — a finished day is frozen, and saying so is the most useful thing a crawler can be told about hundreds of near-identical URLs. Driver entries carry **no** `lastModified`: a driver page changes when its subject is the answer again or when the seed refreshes their wins, neither of which that query knows, and a fabricated timestamp is how a sitemap's dates stop being believed at all.

**A day nobody played is not offered to the index, and `lib/recap/dayEligibility.ts` is that rule** (2026-08-12). The driver pages got this gate when they were built; the archive never did, and the measurement that forced it is stark — of 18 finished days in production, **13 had nobody complete a board**, and the best of the remaining 5 had two players. So thirteen indexable pages read, in full, *"Nobody recorded a guess on puzzle #25. The answer was Jules Bianchi"* plus a five-cell table, and each was published in six languages. That was the bulk of the site's indexable surface and it is the substance of the AdSense "low value content" rejection.

The predicate is deliberately the same idea as `playedAppearances` — `completed > 0`, spelled for a day instead of for a driver — and it is applied by **both** the day page's `generateMetadata` (`noIndex`) and `app/sitemap.ts` (the filter), because a sitemap advertising a URL that then serves `noindex` is worse than one that omits it. `listArchiveDayEvidence` returns the *count* and never applies the threshold, for `pageEligibility.ts`'s reason: a `HAVING` clause would be a second definition of the rule, in SQL, that the page could silently disagree with. **This is not a 404 and not a delisting** — the day still renders, still sits in the archive index, and still carries prev/next, so no inbound link dies and the index does not lie about which days exist. A day that gets a player qualifies on its own, with no deploy.

The **index pages are not filtered**, and that asymmetry is deliberate: the archive is a list of every finished day, and it is the path a crawler follows inward. It is the individual empty day that has nothing to say, not the list of them.

### Driver pages

**`/drivers/[slug]` exists only for a driver this site has something of its own to say about, and `lib/drivers/pageEligibility.ts` is the whole of that rule.** Read it before widening anything: several hundred pages of F1DB career data on a domain with no authority is doorway content, and it would drag down the archive pages that are actually earning. The rule is **an appearance as the daily answer on a finished day at least one player completed**, and each half of that was chosen against measured numbers (2026-08-08, production): the ranked pool is 103 drivers, 47 of whom have a win/podium/pole/title and 14 of whom have been the answer — but 8 of the 14 finished days had *no players at all*, so a bare appearance is a date and a link to an equally empty archive page. Publishing on the career record instead would have shipped 47 pages whose every fact is F1DB's and Wikipedia's, which is the "name substituted into a template" test this pass has to pass. **It admits 5 drivers today, and that is the intended outcome** — the set grows on its own as finished days accumulate, with no code change.

Three structural consequences:

- **The threshold is a pure predicate, never a `HAVING` clause.** Four callers apply it — `generateStaticParams`, the page's own `notFound()`, the sitemap, and the archive day page deciding whether linking here would land on a 404 — and a rule in SQL would be four rules. The queries answer a broad, obviously-correct question ("which drivers have ever been an answer, and how did those days go") and the predicate decides. That also keeps it out of the TS↔SQL duplication class that would otherwise need a parity suite.
- **The archive day page runs the same predicate over its own single day.** If that one day satisfies the rule then the driver's page exists, whatever else they have done — so the link is exact rather than approximate, and it moves with the rule instead of going stale. This is the only crawlable path into a driver page (there is deliberately no `/drivers` index at five pages), and the driver page links back to every day it lists.
- **In `(info)`, not at `app/drivers/`.** `docs/seo-roadmap.md` sketches the latter; Pass 3 put the archive in that group and these are the same kind of document. A third kind of chrome is what "Site architecture" refuses. The group's parens are stripped, so the URL is still `/drivers/<slug>`. The slug is `drivers.f1db_id` verbatim — F1DB's own, never a second scheme — and both queries filter `f1db_id IS NOT NULL`, because the column is nullable for rows predating drizzle/0043 and the slug *is* the URL.

**`lib/drivers/summary.ts` is the same three-rule generator as the archive's, plus one rule specific to this data: `careerWins` is computed by the seed from race results while `podiums`/`polePositions`/`championshipWins` come straight from F1DB's totals, and the two methodologies are deliberately not cross-checked — so no sentence may phrase one as containing the other unless the numbers in hand permit it.** It was run against the real roster before anything was built on it (the standing instruction from Pass 3), and that run is where four defects surfaced that were invisible in the code: "finished on the podium 1 time", "4 different constructors", "all of them got it" for two players, and present perfect on a driver who retired in 2017. Each has a test. Do it again after any change.

**`driverPersonJsonLd` is `Person`, not `Athlete`** — schema.org has no Athlete type, and an invented one produces a block consumers silently ignore; `jobTitle` carries what the type cannot. `nationality` must be a `Country` entity rather than a string, `deathDate` is omitted rather than null for a living driver, and **`aggregateRating`/`review` are forbidden here more than anywhere else on the site**: this is markup about a real, named, mostly-living person, so a fabricated score is both the manual-action offence and a claim about someone who never asked to be scored. `structuredData.test.ts` asserts their absence on this block as well as the game's.

**What is still open is planned in `docs/seo-roadmap.md`**, as eight passes each doable in one session with no memory of the others — production verification, the daily recap data layer and images, the `/archive/[date]` pages (one indexable page per finished day, built from `daily_progress`, and the only asset here that compounds), crawler hygiene, serving the game at `/`, driver pages, i18n, and the off-page launch kit. `docs/seo-prompts.md` is the paste-ready prompt per pass and holds no detail of its own, so the two cannot drift. That roadmap's "Standing constraints" section is the short list of repo rules that a fresh context otherwise breaks silently; read it before doing SEO work of any kind, including work not listed there.

## Internationalisation

Six locales, `next-intl`, added 2026-08-08 (roadmap Pass 7). `en` is served
**unprefixed** and the other five carry a prefix — `/es`, `/pt-br`, `/it`, `/nl`,
`/de` — so every URL Pass 5 established is unchanged and nothing already indexed
moved. `LOCALES` and everything derived from it live in `lib/i18n/locales.ts`,
which is pure and imports no runtime: five things have to agree about that list
(routing, middleware, `hreflang`, the sitemap, the switcher) and a second copy is
how a locale ends up served but not advertised, or advertised but not served.

**`middleware.ts` composes two middlewares; it does not replace one.** The
Supabase session refresh that predates this and next-intl's locale routing share
one request, in `lib/i18n/composedMiddleware.ts`. **Refresh first, then route**,
and the order is not interchangeable: Supabase refresh tokens *rotate*, so the new
cookies must reach the browser or the session is dead rather than merely stale —
and next-intl builds its response from scratch, discarding anything written to an
earlier one. So the refresh is collected and re-attached to whatever the router
returns, **including a redirect**, which is the case where dropping it is fatal.
The refresh also writes back onto `request.cookies`, because the rewrite forwards
`request.headers` to the route: a refresh that ran after the rewrite would render
that page signed-out. Verified end to end against a real project (a real anonymous
session, `expires_at` moved into the past, then checking the browser was handed a
usable *new* refresh token) on `/`, `/es/faq`, `/de` and the `/en/faq` redirect.

**The matcher's exclusions are load-bearing, in both directions.** Too narrow and
sessions stop refreshing; too wide and next-intl rewrites a fixed-path file into a
locale that serves it. `/sitemap.xml`, `/robots.txt` and `/manifest.webmanifest`
are excluded **by name** because a crawler asks for those exact paths and there is
no `/en/robots.txt` — all three 404'd until they were named, while every page still
rendered. `api` and `auth/callback` are excluded too (fixed paths, and the OAuth
return URL is in Supabase's allowlist). `composedMiddleware.test.ts` pins the
matcher against both directions.

**`localeDetection` and `localeCookie` are off, deliberately.** The URL is the only
thing that decides the locale: no `accept-language` sniffing, no cookie. An
automatic redirect off `/` would put a hop back on the most-linked URL the site
has, and Google's own guidance warns it stops some versions being discovered.

**Crawler discovery is `hreflang` plus the sitemap; the `LanguageSwitcher` is for
people, and it lives in Settings → General.** It was in the footer first, where it
was also a crawlable path between locales; moving it into a modal gives that up,
which is acceptable only because `hreflang` on every page and one `<loc>` per
locale in the sitemap are Google's documented mechanisms and neither depends on
it. It is still **real anchors, not a `<select>`** — they work before hydration,
and a native select renders in OS chrome this UI already rejected elsewhere. It
links to the *same page* in the other language via `usePathname` from
`lib/i18n/navigation`; landing the reader on a translated home page is what makes
a switcher feel broken.

**Every internal link goes through `lib/i18n/navigation`'s `Link`, never
`next/link`.** Routes are stored unprefixed everywhere (the sitemap's list,
`buildPageMetadata`'s `path`, the footer's) and the prefix is added at render.
A hard-coded `/faq` inside a Spanish page is a link *out of* the locale and it
fails silently, because the page it lands on is a real page. **That is the whole
of the "switching language does nothing" bug**: the first pass converted only the
footer, so the mode tabs, both top bars, every "See more →" and every archive row
still used `next/link` and walked the reader straight back to English. The same
applies to `usePathname` — `next/navigation`'s includes the locale prefix, so an
active-tab test against `/` never matched on `/es` and no tab lit up.

**The dom tier stands both of those in (`vitest.setup.dom.ts`).**
`lib/i18n/navigation` calls `createNavigation()` at module scope and
`useTranslations` throws with no provider, so importing almost any component blew
up before its first test. The navigation double delegates `usePathname` to
`next/navigation` — lazily and guarded, because several suites install *partial*
mocks of it and vitest's proxy throws on an undeclared export — and the intl
double resolves against the real English catalogue through `createTranslator`, so
assertions keep naming real strings and a broken plural fails in the suite.

**`hreflang` is emitted in one place, `buildPageMetadata`.** Every locale lists
every other **including itself** (Google drops a cluster whose members omit their
self-reference), plus `x-default` pointing at the unprefixed English URL. A
`noIndex` page advertises no alternates at all — the two `/auth/*` pages would
otherwise send a contradictory pair of signals. `next-intl`'s own
`alternateLinks` header is off, because two emitters would be two answers.
The sitemap emits one `<loc>` **per locale** carrying the same set, from the same
`alternateLanguages` function.

**Only English is offered to the index right now — `INDEXED_LOCALES` in
`lib/seo/metadata.ts` is the whole switch** (2026-08-12). This is a deliberate
retreat from Pass 7 rather than a bug fix. Every URL on the site existed six
times, and five of the six came out of `npm run i18n:translate` — machine
translation, which Google's spam guidance singles out when published without
human review. Multiplying a young site's page count by six that way is the
loudest scaled-content signal available, and it was being sent across the
archive's auto-generated stats pages as well as the hand-written ones. Combined
with the archive gate above, the indexed surface went from ~294 URLs to
roughly 70.

**The translations are still served.** `/es/faq` renders in Spanish, the switcher
still works; the five prefixed locales simply carry `noindex, follow`, advertise
no alternates, and are absent from the sitemap. Three details make that
consistent rather than merely off: `alternateLanguages` draws from
`INDEXED_LOCALES` and **collapses to `undefined` below two entries** (a "cluster"
of one self-reference plus an x-default pointing at the same URL is noise on
every page); the sitemap omits the `<xhtml:link>` block entirely rather than
emitting an empty one; and a non-indexed page keeps a **self-canonical**, because
pointing a Spanish page's canonical at the English one would claim they are the
same page, which is a different and false statement.

**To re-enable, put locales back in that list** — nothing else changes, and it is
a list rather than a boolean precisely so a locale can be promoted one at a time
as its catalogue is read by a human. That is how this should come back.

**Message catalogues are `messages/*.json`, and the summary generators are the
interesting half.** `lib/recap/summary.ts` and `lib/drivers/summary.ts` still
choose sentence *shapes* in TypeScript — that is arithmetic over a recap and is
identical in every language — but return message keys plus values. Two rules
follow: a branch **never concatenates translated fragments** (word order differs,
and a clause glued on with ", and" lands in the wrong half of a German sentence),
and **number words, ordinals and frequency forms are keys, not a table in TS** —
"once"/"twice"/"five times" is three shapes in English and "finished on the podium
1 time" is a defect that already shipped once. Sentence-initial casing gets its own
`numberCap` keys rather than an uppercase step in TypeScript.

**`intlLocale()` maps `en` to `en-GB`, for `Intl` only.** A bare `en` is *American*
English to `Intl`, which rendered "August 7, 2026" and inserted an Oxford comma in
the team list — while this site's own copy says "colour", and `formatRecapDate`
wrote the date the other way on the page next to it. It is never used for
`hreflang`: we format like British English, we do not claim to target the UK.

**Do not translate driver names, team names, or anything from `drivers`.** They
are proper nouns and "Lewis Hamilton" is what someone searches in every locale.
`structuredData.test.ts` asserts it. The generated prose also avoids gendered
agreement in the Romance locales and Dutch — the roster contains female drivers,
so a masculine past participle is wrong rather than merely unidiomatic.

**Every indexable page is translated.** About, How to play, Game modes, the FAQ,
the Support callout and both legal pages are externalised and carried in all six
catalogues. Two conventions those pages established, worth following for anything
added later:

- **A sentence with emphasis or a link inside it stays ONE message**, rendered
  with `t.rich` and `<b>` / `<howToPlay>` / `<f1db>` markers. Splitting it into
  fragments around the markup is the concatenation mistake `lib/recap/summary.ts`
  documents: word order differs per language, and a clause that reads correctly
  either side of a link in English lands in the wrong half of a German sentence.
- **Structure stays in TypeScript, prose goes to the catalogue** — section order,
  tile colours, sample values, and the *number* of bullets in a mode's list. A
  translator rewording a line must not be able to reorder a legend or add a
  bullet; on the legal pages a dropped section is a disclosure that stopped being
  made. Same split as `lib/marketing/faqContent.ts`.

**The legal pages carry `LegalTranslationNotice`**, which renders on every locale
except `en` and says the English text is the operative version. It is above the
content, not below it: a disclosure a reader reaches after relying on a liability
clause has not been made. Keep it if those pages are ever re-translated.

**Still English on every locale:** the in-app UI — the game board's surrounding
chrome, duel, settings and auth (~1,100 words). None of it is indexable, so it
costs nothing in search; it is an experience gap, not an SEO one.

### The catalogues are generated — `npm run i18n:translate`

**`messages/en.json` is the only catalogue a human edits.** The other five are
regenerated from it by `scripts/translateMessages.ts`, and that is the whole
reason they can be trusted: hand-maintained, they had already drifted into
byte-identical copies of English before anyone noticed — six URLs of the same
page under a full `hreflang` set, which is worse for search than not translating
at all. A generated catalogue cannot drift.

**Two things make machine translation safe to ship here, and neither is the model.**
`validateTranslation` (`scripts/translationPlan.ts`) re-parses every returned
string as ICU and compares its placeholder set to English — a translation that
renames `{driver}`, drops a placeholder or breaks a plural block is **rejected and
the previous text kept**, so the failure mode is a stale string rather than a page
that throws. And the run is **incremental**: `messages/.translations.json` records
the hash of the *English source* each translation came from — keyed on the source,
because the only thing that can make a translation stale is the English changing.
A one-word edit re-translates one key. **Commit that manifest**; without it every
run re-translates everything.

The validator deliberately compares placeholder **names**, not plural
*categories* — categories are language-specific (Polish needs `few`, Spanish does
not need English's split), so demanding identical ones would reject correct
translations.

**Dry run by default.** `npm run i18n:translate` plans and makes **no API calls**;
`npm run i18n:translate:commit` translates and writes. The flag lives inside the
package.json script string for the reason `db:seed` documents — PowerShell drops a
bare `--`, so `npm run i18n:translate -- --commit` stays a dry run (measured).
Unlike the seed, the dry run does not do the work and roll back: doing so would
spend real money to show a diff. Missing `ANTHROPIC_API_KEY` is a hard failure,
never a silent skip.

`I18N_RETRANSLATE=all` regenerates every string rather than the stale ones — the
switch for replacing a hand-written catalogue wholesale. Output is written in
**English's key order** so the diff is readable; a file that reshuffles itself
every run is a diff nobody reads, which is where a real change hides.

**Read the diff before committing.** Google's spam guidance singles out
machine-translated text published *without human review*; this script is the
drafting step, not the publishing decision.

## Stack

- Next.js 15 (App Router) + TypeScript, **Tailwind v4** (CSS-first `@theme` config in `app/globals.css`, no `tailwind.config.js`)
- Postgres via Supabase, Drizzle ORM (`postgres` driver); migrations in `drizzle/`
- **Supabase Auth** (anonymous + email + Google), `@supabase/ssr` for the cookie-backed server client
- **Supabase Realtime** (broadcast + presence) for matchmaking and live matches
- **Vitest** for tests (`npm test`), in **two projects split by environment**: `node` (`lib/**`, `scripts/**` — pure logic, as it always was) and `dom` (`**/*.test.tsx` — real components rendered in jsdom with Testing Library; `npm run test:dom` for just those). DB integration suites live in the `node` project and are opt-in behind `RUN_DB_INTEGRATION_TESTS=1` so the default run needs no database. The `dom` project exists because six audit resolutions in a row closed with *"not verified in a browser"* — an ARIA promise, a live region's firing rule, a timer's rollover and a mount latch are all facts about a rendered DOM that `tsc` cannot see. **A component test earns its place by pinning behaviour a player or a screen reader can observe** (what the listbox offers, what gets announced, where focus lands, what stays mounted), never a component's internals; write it so it fails against the pre-fix code, and check that it does.
- Avatars are **DiceBear** glyphs generated from a seed string (`lib/avatars.tsx`) — `profiles.avatar_url` stores the seed, not a URL. There is no upload or Storage path. **Storing the seed rather than the picture is what makes the style a one-line swap**: `clay` replaced `bottts-neutral` with no backfill, and seeds chosen under either style (plus `preset-N` values predating the whole system) still render. Two constraints: `clay` needs **`@dicebear/core` >= 10.4** — 10.3 rejects its animation component with a `StyleValidationError` thrown at *module scope*, so a pin-back takes the page down rather than the avatar — and `lib/avatars.test.ts` asserts the output is **static** across every curated seed plus 60 random ones. The style ships an animated variant at `weight: 0`; nothing but that weight keeps a dozen looping avatars off the leaderboard, and a `@dicebear/styles` bump can change it silently.
- Deployed on Vercel. The checks are `tsc --noEmit` (`npm run typecheck`), `npm run lint`, `npm test` and `next build`.
- **ESLint is adopted, and deliberately narrow** (`eslint.config.mjs`, 2026-07-30 — audit §0.5). Four rules and nothing else: `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, `@typescript-eslint/no-explicit-any` (the "No `any`" convention below, enforced) and `@next/next`'s recommended set minus one Pages-Router rule that can only false-positive here. **No style or formatting rules** — `tsc` is the type authority and a house style invented inside a lint adoption is how a lint step becomes one people skip. The scope was chosen by *measuring* each candidate ruleset against the tree first; `eslint.config.mjs` records those numbers and names what was rejected (react-hooks v7's React Compiler preset, 30 violations on patterns this codebase chose on purpose). `reportUnusedDisableDirectives` is an **error**, so a suppression that stops being needed fails the build — the count of `eslint-disable` comments can now only fall unless someone writes one deliberately. Adding a rule means measuring it the same way; a new suppression means a reason at the call site.
- **Backups: `.github/workflows/db-backup.yml`** (2026-08-06). The Supabase free plan has none, and `daily_progress`, every account and every duel rating exist nowhere else. `drizzle/` is already a complete replayable definition of the *schema*, so the rows are the only thing at risk: a nightly `pg_dump` (custom format, `public` + `auth`), GPG-encrypted, uploaded as a 90-day artifact. Three things about it are load-bearing. It takes its own secret, **`BACKUP_DATABASE_URL`, on the SESSION-mode pooler (port 5432)** — `pg_dump` cannot run through PgBouncer transaction mode, which is what 6543 serves, and a separately-named secret cannot silently inherit the scratch database CI writes into. **Encryption is not optional and has no fallback**: this repository is public, artifacts inherit repository visibility, and the dump contains `auth.users` — so a missing `BACKUP_ENCRYPTION_PASSPHRASE` fails the job rather than uploading plaintext. And it **fails loudly on a missing secret**, the opposite of `ci.yml`'s self-skip, for `roster-refresh.yml`'s reason: a backup silently not happening looks exactly like a backup happening. Restore steps are in the workflow header — **rehearse one**, because an untested backup is a hope.
- **CI: `.github/workflows/ci.yml`**, two tiers. `static` (typecheck + lint + `npm test`, both vitest projects) needs nothing and runs everywhere, including fork PRs. `database` + `build` need three repository secrets (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, see `.env.example`) and **self-skip when they're absent** rather than failing red; point them at a **scratch** project, since those suites write real rows. The database tier is what actually runs the opt-in suites — the TS↔SQL parity tests, the RPC and matchmaking suites, the custom-lobby and unranked-stats suites, and the grant policy — so it's the difference between those rules being documented and being enforced. `static`'s lint step runs the narrow adopted scope described above and nothing wider; widening it means measuring the candidate ruleset against the tree first, in `eslint.config.mjs`, not adding a rule in CI.

## Data

Seeded from **F1DB** (https://github.com/f1db/f1db) — the full historical roster, pulled as `f1db-csv.zip` by `scripts/seed.ts` (`npm run db:seed` to rehearse, `npm run db:seed:commit` to write). The seed is the **only** way driver data gets in or gets updated; there is no other writer to `drivers`.

**It runs itself, weekly.** `.github/workflows/roster-refresh.yml` (2026-08-01) runs `npm run db:seed:auto` — `--commit --strict`, `F1DB_RELEASE=latest` — at 06:00 UTC on Mondays, so wins, teams, `last_active_year` and new drivers land without anyone remembering. It needs one repository secret, **`PRODUCTION_DATABASE_URL`** (the Supabase *pooler* URL), deliberately not the scratch `DATABASE_URL` the CI database tier writes into — this job writes the live roster and must not be able to inherit the wrong connection. Three consequences worth knowing:

- **It fails loudly on a missing secret**, where `ci.yml` self-skips on one. The opposite rule applies here: a silent skip *is* the failure mode — the roster quietly stopping being updated looks exactly like everything being fine, until a comparison is wrong.
- **`--strict` exists because nobody reads the log.** Two things the seed only *reported* become hard failures unattended: an ambiguous natural key (`scripts/rosterPlan.ts#assertPlanUnambiguous`), which would insert a second row for a driver who may already be in the table while the original keeps every `daily_targets`/`duel_rounds`/`daily_progress.guesses` reference; and any unresolved reference id (`scripts/releaseGuards.ts#assertNoLookupMisses`), which puts a raw slug in `nationality`/`last_team` — columns `compare_drivers` compares by string equality, so the affected drivers mis-compare and their flag stops rendering. Both stay non-fatal interactively, where the report is being read and refusing the whole refresh would cost the other 791 drivers their updated wins. `unmatched` rows are deliberately **not** fatal in either mode: they're expected, never deleted, and failing on them would make the schedule permanently red.
- **A manual run is a dry run** unless you tick `commit` in the workflow dispatch form — same fail-closed shape as the script itself. The reconciliation report is written to the run's summary page either way, since that's the part a human would have read locally.

GitHub disables `schedule` triggers after 60 days of repository inactivity (it emails first); any push, or one manual run, re-arms it.

**Which release is an env var, and there is no default.** `F1DB_RELEASE=v2026.11.0` pins a tag; `F1DB_RELEASE=latest` follows upstream and says so in the log. Unset, the seed refuses to run. That is not ceremony — see the next bullet list.

**The seed is an idempotent upsert, and `drivers.id` is never reassigned.** It used to `DELETE FROM drivers` and re-insert, which throws a foreign-key violation against any database that has served one daily — and, forced past that, renumbers a `serial` that `daily_targets`, `duel_rounds` and `infinite_rounds` hold FKs to and that `daily_progress.guesses` stores with no FK at all (audit §5.1, drizzle/0043). Now every row is matched to the release on **`f1db_id`** — F1DB's own driver slug — and `UPDATE`d in place, inside one transaction, with nothing ever deleted:

- **Reconciliation is `scripts/rosterPlan.ts`**, pure and unit-tested. Rows imported before drizzle/0043 carry no slug, so they're adopted by `(full_name, date_of_birth)`; a row whose slug changed upstream is re-keyed rather than duplicated; genuine ambiguity on either side is reported and never guessed at. Rows the release no longer mentions are **kept and reported**, never deleted.
- **The seed fails closed: `npm run db:seed` is a dry run, and writing takes `npm run db:seed:commit`.** It does the whole write either way — the reconciliation report is only worth reading against the real table — and rolls back unless `--commit` was passed. The default was inverted on 2026-07-30 (audit §5.1 residual) because the old shape put the *safe* mode behind the flag, and the flag is the part a shell can eat: **Windows PowerShell 5.1 drops the bare `--`** when it invokes a native command, npm then swallows `--dry-run` as its own config flag, and `process.argv.slice(2)` arrives as `[]`. That silently committed a 792-row roster refresh once. Now the same stripping produces a dry run — measured: `npm run db:seed -- --commit` in PowerShell prints `Mode: DRY RUN`, while `npm run db:seed:commit` (flag inside the script string, nothing to forward) prints `Mode: REAL WRITE`. **A lost `--commit` costs a re-run; a lost `--dry-run` cost a database.** `resolveWriteMode` (`scripts/releaseGuards.ts`, pure + unit-tested) also rejects an unrecognised argument outright rather than shrugging at a typo, and `main()` prints the mode as its first line before the download, because the difference is 792 live rows and should be on screen rather than inferred from a message at the end.
- **The upsert made a loud failure silent, so the loudness was rebuilt** (audit 2026-07-29 §5.2). The old `DELETE` hit a foreign key when a release parsed wrong; an in-place `UPDATE` of 792 rows just commits, and the first symptom is players reporting that the comparisons are wrong. `MIN_ROSTER_RATIO` only catches "most of the feed is missing" — the three dangerous modes all preserve the row count exactly: a renamed `positionText` makes every DNQ/DNS a race start (shifting debut years, `last_active_year` and pool membership), a renamed `positionNumber` zeroes every driver's wins, a renamed `round` makes the last-team tie-break `NaN`. **`scripts/releaseGuards.ts`** (pure, unit-tested, runs in the static CI tier) is the answer: the release pin above, a **header assertion** on every column the seed reads out of all four CSVs, and canaries — Hamilton has ≥ 100 wins, Verstappen's `last_active_year >= currentYear - 1`, and at least one race result still carries a `NON_START_CODES` value. A missing canary slug is a failure, not a skip: it means the driver key scheme moved, which every join in the seed rests on.
- **The two reference-table joins count what they can't resolve** (audit 2026-07-29 §5.2b). The seed stores country and constructor *names*, looked up from ids; both lookups fell back to the raw id (`?? id`) with nothing counted or logged, so a roster could hold `"united-states-of-america"` beside `"United States of America"`. That is a comparison bug, not a cosmetic one: `compare_drivers` compares nationality **and** team by string equality, so two drivers *of the same country* report a nationality **miss** against each other (and `countryCode()` returns null for a slug, so the flag silently vanishes). Every lookup now goes through `resolveName`, which tallies misses — same reason `assertColumns` lives inside `readCsv`: the counting can't be forgotten. The fallback **stays**, because one unresolvable id must not cost the other 791 drivers their refreshed wins; what's new is that misses are reported worst-first on every run, and that a join resolving **nothing** is a hard failure before the transaction opens — that means the id space moved, and it preserves the row count exactly, so `MIN_ROSTER_RATIO` and the header assertion both miss it by construction. Measured against `v2026.11.0`: 40 country ids, 176 constructor ids, **zero** misses.
- **`drivers` carries value `check()` constraints** (drizzle/0047) — non-negative wins, `debut_year <= last_active_year`, seasons within 1950…next year, `date_of_death > date_of_birth`, and born before the debut season (the immutable form of "no future birth date"). They are the per-column half of the same defence and they fail the *seed's own transaction*, so a bad row rolls the whole run back rather than reaching the game. Write-time only — `drivers` is written by the seed and nothing else, so this costs a guess or a board load nothing.
- The seed's writes go through **scalar parameters in batched `VALUES` lists, never one big array or jsonb parameter** — a single large parameter kills the Supabase transaction pooler connection (`write CONNECTION_CLOSED`) where thousands of small ones are fine. There's a measured note on this in `seed.ts`.
- `drivers` is the one table with **RLS disabled**, so its grants *are* its access control. drizzle/0043 revoked the client write set from `anon`/`authenticated`; before that any visitor could `UPDATE`/`DELETE` the whole roster with the public anon key. Reads stay open (the pool is public by design). Same rule as drizzle/0042: **grants and RLS should have to fail together.**

**Not built, and no longer needed:** the **Jolpica-F1** (https://api.jolpi.ca/ergast/f1/) weekly cron that was planned to refresh current wins/teams automatically and double as a Supabase keepalive. The weekly F1DB refresh above does both jobs — it updates the same columns from a source the seed already parses, guards and tests, and its off-season no-op run is the keepalive. Jolpica would be a *second* data source to map onto `drivers` for the same result. There is still no cron route, no `vercel.json`, and no Jolpica code anywhere in the repo; if it is ever built: cache hard, never call it from a request handler.

Attribute definitions: age = current age (age at death if deceased); team = most recently raced constructor; wins = all-time race wins; debut = first race-start year; nationality = country string; driver_code = F1DB 3-letter abbreviation (unique only within what's shown together); previous_teams = every distinct constructor raced for; last_active_year = most recent race-start year, drives pool membership.

**Whether `lib/game/flags.ts` still covers the roster is asked of the roster, not of a copy of the map** (audit 2026-07-29 §5.2c). `flags.test.ts` used to hold a hand-transcribed duplicate of `COUNTRY_CODES`' 40 keys and assert each one resolved — true by construction, and blind to a nationality entering, leaving or being renamed. That question moved to the database tier: `lib/db/driversRosterIntegrity.test.ts` → *"nationality coverage"* runs `SELECT DISTINCT nationality FROM drivers` and asserts every value resolves, that **no two values map to the same country code**, and that none is blank. The second is the sharp one: the seed keeps rows a release no longer mentions, so an upstream country rename leaves the old spelling on the un-refreshed drivers and writes the new one on the rest — one country under two strings, which by string-equality compare is a nationality **miss** between two drivers of the same country. What stays in the static tier is only what needs no database: the map's shape (ISO-shaped codes, no aliases, no untrimmed keys) and `countryCode`'s contract. Same rule as the plpgsql constants — **a claim about the data belongs in the tier that can see the data.**

**`COUNTRY_CODES` is also the cut list for the flag stylesheet, which is generated** (audit 2026-07-30 §1.4 residual). `app/globals.css` used to `@import "flag-icons/css/flag-icons.min.css"` — the whole ~250-country package, in two aspect ratios, on **every** route including `/about` and the legal pages, for a setting that is off by default. Measured against a dev build: 542 country rules, 36,486 of the globals chunk's 91,717 bytes, and 542 SVGs / 5.1 MB emitted. `scripts/generateFlagSubset.ts` now writes `app/flag-icons.subset.css` from the 40 codes the map actually holds — the only classes `components/ui/Flag.tsx` can ever emit, since `countryCode` returns null for everything else — and 4x3 only, because nothing here uses flag-icons' square (`fis`) or box (`fib`) variants. Measured after: 40 rules / 2,600 bytes, chunk 57,790 (gzip 15,247 → 8,958), **40 SVGs / 211 KB**. Two consequences to keep in mind:

- **Adding a nationality to `COUNTRY_CODES` means running `npm run flags:subset`**, and CI says so: `scripts/flagSubset.test.ts` regenerates and diffs the checked-in file, so a stale subset (or a bumped `flag-icons`) fails the static tier. That diff is the whole drift story — the failure mode is a flag that silently doesn't render, which is precisely what the "show flags" setting exists to produce.
- **`Flag`'s class and the stylesheet's selector are a contract nothing type-checks** — `` `fi-${code}` `` is a template string. `components/ui/Flag.test.tsx` renders every mapped nationality and asserts each emitted class is one the subset defines. The base rules are extracted from upstream **verbatim** (minus the two variant selectors) rather than retyped, so an upstream restructure shows up as a diff instead of being quietly preserved.

## Schema

Existing:
```
drivers(id, f1db_id text unique null, full_name, driver_code, nationality, date_of_birth,
        date_of_death, debut_year, career_wins, last_team, previous_teams text[],
        last_active_year,
        championship_wins, podiums, pole_positions)   -- drizzle/0053, Infinite's filter
```
`f1db_id` (drizzle/0043) is F1DB's own driver slug and the seed's upsert key — the reason `id`
survives a re-seed. Nullable only for rows imported before it existed; the seed adopts those by
`(full_name, date_of_birth)` on its next run. No client write grants (see "Data"). Five value
`check()`s (drizzle/0047) reject what can't be true of a real driver, so a mis-parsed release
rolls the seed's transaction back instead of committing — the per-column half of the release
guards in `scripts/releaseGuards.ts`. The three achievement counts (drizzle/0053) carry
non-negative checks of their own and come straight from F1DB's `totalChampionshipWins` /
`totalPodiums` / `totalPolePositions`, unlike `career_wins`, which the seed computes from race
results — two methodologies, deliberately not cross-checked against each other.

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
infinite_rounds(user_id uuid PK FK, driver_id int FK, filter jsonb,
                guess_count int, started_at)         -- server-side infinite round state (replaces the signed cookie).
                                                     -- `filter` (drizzle/0053, was `pool_window`) records the
                                                     -- composed filter the round was drawn from.
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
                                  index itself, rejects a complete/exhausted day, a driver already
                                  in guesses[] (drizzle/0049) and a driver outside the daily pool
                                  (drizzle/0051, before any row is locked); SQL compare_drivers
infinite_start_round(from_year, to_year, nationality, team, achievement)
                                    -> upserts infinite_rounds with a fresh random driver from the
                                       composed filter; re-clamps the span and re-validates the tier
                                       server-side (drizzle/0053)
infinite_submit_guess(driver_id)    -> { tiles, status: won|lost|continue, target? }; enforces the
                                       6-guess cap; target only when status ≠ continue
```

Their three internal helpers are **not** client-callable and must stay that way — `EXECUTE` is
revoked from `PUBLIC`/`anon`/`authenticated` (drizzle/0038, drizzle/0056), so a browser holding the
anon key cannot reach them; the `SECURITY DEFINER` RPCs above call them as the table owner:
```
daily_target_id(date)              -- get-or-pin the day's answer. Reachable over PostgREST, it
                                   -- simply RETURNS the answer, past daily_targets' deny-all RLS.
compare_drivers(guess, target, at) -- the comparison rules; the guess-evaluation core
pick_filtered_driver(filter, exclude)  -- THE only SQL copy of lib/game/driverFilter.ts's
                                   -- predicate (drizzle/0056). Called by infinite_start_round and
                                   -- duel_begin_round; see "Custom lobbies".
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
             ranked bool not null default true,      -- drizzle/0054. False = custom lobby: no Elo,
                                            -- no W/L, no leaderboard. Defaults true, so every
                                            -- pre-existing and matchmade row is rated as before.
             rounds int not null default 3,          -- drizzle/0054, read by duel_close_round's
             round_seconds int not null default 60,  -- last-round test and duel_begin_round's
                                            -- ends_at stamp (drizzle/0055). The defaults are the
                                            -- values those functions used to hardcode.
             filter jsonb null,             -- drizzle/0054. The composed pool this match's targets
                                            -- are drawn from; NULL = the daily 20-year pool, i.e.
                                            -- every ranked duel. Nullable (unlike duel_lobbies'),
                                            -- because "no filter" and "empty filter" differ here.
             created_at, finished_at)
duel_lobbies(code PK,                       -- drizzle/0057. Server-generated, 6 chars from a
                                            -- 31-character unambiguous alphabet. Never client-
                                            -- supplied -- that would let someone squat AAAAAA.
             host_id FK, host_device_id,    -- device id survives an identity swap; the self-join
                                            -- guard, same layer as matchmaking_queue.device_id
             mode text default 'duel',      -- CHECK (mode IN ('duel')) -- the Knockout seam
             rounds, round_seconds, filter jsonb not null,   -- copied onto the match at join
             match_id FK null ON DELETE CASCADE,   -- NULL = open, set = consumed, row gone = gone.
                                            -- No status column: three derivable states, not four
                                            -- that have to agree. CASCADE not SET NULL, so a
                                            -- deleted match can't resurrect its lobby as joinable.
             created_at, last_seen_at)      -- only OPEN lobbies go stale on last_seen_at
duel_rounds(match_id FK, round_index, driver_id FK,
            started_at, ends_at,            -- server timestamps, stamped at ready-gate
            intermission_ends_at null,      -- server-stamped when the round closes
            PRIMARY KEY (match_id, round_index))
duel_round_results(match_id FK, round_index, user_id FK, solved_at null,
                   guess_count,       -- NOT just a stat since drizzle/0058: it
                                      -- decays this round's payout on both the
                                      -- solve and the DNF path
                   best_proximity numeric, points int,
                   last_guess_at null, -- what the guess cooldown spaces against
                   PRIMARY KEY (match_id, round_index, user_id))
```
`score_a`/`score_b` cache confirmed round points for the tug-of-war and winner check; derivable from `duel_round_results`. The 100-point tug-of-war baseline and the live *provisional* score are display/realtime concerns — not persisted per guess (avoid write storms). Player **readiness** is realtime-only (presence/broadcast), never a DB column.

`duel_matches` also carries `CHECK (ranked OR (rating_delta_a IS NULL AND rating_delta_b IS NULL))`, which makes "an unranked match recorded a rating change" unrepresentable the same way `duel_matches_distinct_players_check` does for a self-match — see "Custom lobbies". `duel_lobbies` has **RLS on, no policies and no client grants at all, `SELECT` included** — the only table here where the read is revoked too, because a readable `duel_lobbies` is every open lobby's code behind one anon-key query and the code *is* the access control.

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

Custom lobbies add six more (drizzle/0057), all `SECURITY DEFINER` + `auth.uid()`, all
`GRANT EXECUTE TO authenticated` and nothing else. `duel_lobbies` has no client grants, so these
six *are* its entire access surface:
```
duel_lobby_create(rounds, round_seconds, from_year, to_year, nationality, team,
                  achievement, device_id) -> code text
                                            -- sweeps; deletes the caller's own open lobbies
                                            -- (converge, don't error); re-clamps the config and
                                            -- re-validates the achievement; refuses a filter
                                            -- matching nobody; generates the code in a retry
                                            -- loop on unique_violation
duel_lobby_state(code)                      -> config + host handle, and match_id ONLY to the host
                                            -- or a participant (it names the private channel)
duel_lobby_join(code, device_id)            -> match_or_queue's EXACT row shape, so the client
                                            -- reuses toMatchResult. Every check runs while
                                            -- holding the lobby's FOR UPDATE; idempotent for a
                                            -- participant, refused to anyone else once consumed
duel_lobby_heartbeat(code)                  -> refreshes the caller's own OPEN lobby; false once
                                            -- there is nothing left to beat
duel_lobby_cancel(code)                     -> deletes the caller's own OPEN lobby; idempotent
duel_sweep_stale_lobbies()                  -> called at the top of create and join, no cron
```

The four trusted-connection functions above run on the **trusted Drizzle connection only** and have no `auth.uid()` check of
their own -- `EXECUTE` is revoked from `anon`/`authenticated` (drizzle/0034), so a browser cannot
reach them. The round lifecycle the browser *does* drive goes through thin `SECURITY DEFINER`
authorization wrappers, so it gets the same one-warm-hop path as guesses:
```
duel_begin_round_client(match_id, round_index)   -> auth.uid() participant check, delegates to duel_begin_round
duel_close_round_client(match_id, round_index)   -> auth.uid() participant check, delegates to duel_close_round
duel_round_reveal(match_id, round_index)         -> what round_end/match_end re-verify against (drizzle/0050)
duel_server_time()                               -> DB now(), for the clock-offset ping
```
Wrappers rather than adding the check inside the originals: `duel_close_round` is ~120 lines of
scoring and advancement rules, and rewriting it to add four lines of authorization would put those
rules at risk for no reason. One definition of the logic, one definition of the authorization.

`duel_round_reveal` is a **read**, not a wrapper, and it exists because
`duel_close_round` is idempotent in its *effect* but not in its *response*: exactly one client's
close ever advances, and the already-closed branch deliberately returns NULL for every reveal
column (drizzle/0024) on the assumption that a repeat caller made the first call itself. The client
receiving `round_end` is precisely the one that didn't — which is why "just re-verify against
`duel_close_round_client`" doesn't work and this read had to be added. It returns the round's target,
both sides' points, the running score and the intermission clock **only** once
`duel_rounds.intermission_ends_at` is stamped, which nothing but `duel_close_round` ever writes; the
match-level columns (status, winner, rating deltas) come back either way and say nothing until the
match is over. So a round still in play discloses nothing through it, by construction.

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
when a close actually finished the match. The write itself lives in `applyMatchResult`
(`lib/duel/applyMatchResult.ts`, a plain module) -- the single writer of rating and W/L, and where
the unranked short-circuit sits; see "Custom lobbies". The Elo math is a unit-tested TypeScript function
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

- **`lobby`** (presence + broadcast) — the channel every searching player joins, and the one a waiting custom-lobby host listens on; broadcasts a just-created match to the player who was waiting for it (`MATCHED_EVENT`, see `DuelSearching` and `CustomLobbyWaiting`). Deliberately **public**: it is shared by everyone searching, so scoping it to a participant set isn't a thing the topic can express. Nothing on it is authoritative — a forged `MATCHED_EVENT` just sends a client to a match id it isn't in, which `duel_state` rejects, and a custom host reads the match back through `duel_lobby_state` rather than out of the payload at all.
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

  **A private channel narrows the attacker set to the two participants; it does not empty it — so no payload on it decides anything.** Every event that changes what a client renders is a *trigger*, re-verified against the server before it is acted on: `onForfeit` re-reads `duel_state`; `onRoundStart`'s intermission fast path takes the round clock from the idempotent `duel_begin_round_client` RPC (audit 2026-07-29 §0.2 — the payload says *that* a round started, never *when*); and `onRoundEnd`/`onMatchEnd` read the reveal, both sides' points, the scores, the intermission clock, the winner and the rating deltas back from `duel_round_reveal` (drizzle/0050, audit 2026-07-30 §3.4 residual). `round_end` used to be applied as sent on the grounds that `duel_close_round` had already returned it to the closing client — true of the *closing* client, and the receiving one is exactly the client that never made that call. The fields stay on the wire (a deploy landing mid-match leaves one client on each version), but the receiving side reads only `roundIndex` out of `round_end` and nothing at all out of `match_end`.

  **`ready` is a broadcast, not a presence field** — this is deliberate and must not be "tidied up" back into presence. Presence has a much stricter Supabase rate limit ("Client presence rate limit exceeded") that a *single match* can trip on its own: every ready-gate (pre-match hold, then once per intermission) tracks at least once, on top of the staging channel's own tracking, and a few rounds is enough to get the whole channel force-closed by the server — silently, with no reconnect. Broadcast has no such ceiling in practice (`guess`/`solved` fire constantly all match without issue). Presence is kept for the one thing it's genuinely needed for: **join/leave membership** for disconnect detection, via a single `track()` per subscription, never repeated.

  `ratingDeltaA/B` on `match_end` are nullable on purpose: the rating write is a separate call from closing the round (see "Ratings are the deliberate exception"), so if it hasn't landed the opponent shows no delta rather than a fabricated "+0". The results panel reads the authoritative values from `duel_matches` regardless.

## Architecture constraints

- `lib/game/compare.ts` and `lib/game/duelScoring.ts` (speed + accuracy + proximity + live-score helpers) are pure and unit-tested. Don't touch compare's rules unless a task says to. **Both are mirrored in plpgsql and both are pinned by a parity suite** — `compare.sqlParity.test.ts` and `duelScoring.sqlParity.test.ts`. The duel one is the more urgent of the pair, because both sides are live *simultaneously*: the TypeScript drives the tug-of-war bar the player watches, the SQL writes the authoritative score, so drift makes the bar lie. It pins the **live** definition rather than a transcription — the arithmetic is extracted from `pg_get_functiondef()` and executed, so a weight changed in a future migration fails the suite without anyone remembering the file exists. Neither of these is a caller-free "dead" module; deleting `compare()`/`isWin()`/`speedPoints()` deletes the spec side of a running check.
- **Every constant duplicated into plpgsql has a parity suite, not a comment.** Five rules are mirrored TS↔SQL because a Postgres function can't import TypeScript: the compare ladder, the duel scoring weights (which since drizzle/0058 include `GUESS_DECAY`, `FREE_GUESSES`, `MIN_SOLVE_MS` and `GUESS_COOLDOWN_SERVER_MS` — all pinned by the same suite, the first three by **executing** the live expressions rather than matching their text), `DAILY_POOL_WINDOW`'s cutoff, `MAX_GUESSES`, and the driver-filter predicate. Two former duplications are simply **gone**, which is better than pinned: `MAX_ROUNDS`/`ROUND_MS` became `duel_matches` columns (drizzle/0054/0055), and the filter predicate collapsed from two SQL copies to one shared function (drizzle/0056). All five are now pinned (`compare.sqlParity`, `duelScoring.sqlParity`, `poolWindow.sqlParity`, `infiniteFilter.sqlParity`) and run in the database CI tier. **A new duplicated constant gets an assertion there in the same change that creates it** — a keep-in-sync comment is what let the pool cutoff go unguarded, and its failure mode (a daily answer outside the pool the board autocompletes) is silent to everyone including the player. See "Driver pools".
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
- **Auth is two contexts, split on the `identityStatus`/`status` seam.** A component that needs only identity uses `useAuthIdentity()` and does not re-render when profile/stats change; the identity value must stay primitives + stable callbacks, or the split silently reverts. See "Auth state is reactive, everywhere".
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