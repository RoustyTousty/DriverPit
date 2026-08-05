# Custom lobbies — architecture plan

**Drafted 2026-08-02. Not yet built.**

A fourth entry under `/online`, below Duel and Knockout: **Custom**. A host composes a
match (rounds, round length, and behind an "Advanced" button the full Infinite-style driver
filter), gets a short code and a shareable link, and a friend joins with it. The two play an
ordinary duel that **does not touch ratings, duel W/L, or the leaderboard**.

---

## 0. The shape, in one sentence

A custom lobby is a short-lived `duel_lobbies` row holding a config and a code. Joining it
creates an ordinary `duel_matches` row with `ranked = false` plus that config, and from that
instant **every existing duel component, RPC and realtime channel runs unchanged**.

That framing is the whole safety argument. The duel engine has had four separate audit
findings about one value living in two places (§0.1's match id, §3.3's absence claim, §3.4's
trusted payloads, §0.2's round clock). A parallel "custom match" code path would invite a
fifth. There is no second lifecycle, no second scoring path, no second channel — only a
flag and three config columns that the existing lifecycle reads off the row it already
holds.

---

## 1. Stats isolation

**The requirement:** winning or losing a custom duel must not move `duel_rating`,
`duel_wins`, `duel_losses`, or any leaderboard position.

### The choke point

Every duel write to `user_stats` goes through exactly one function:
`applyMatchResult` in `lib/duel/actions.ts`. Both callers reach it —
`applyMatchRatings` (normal finish) and `forfeitMatch` (forfeit / disconnect / sign-out).
Verified: there is no second writer anywhere in the repo.

It already takes the match row `FOR UPDATE` for its idempotency guard, so the flag is free
where it is needed:

```ts
const [match] = await tx.select().from(duelMatches).where(eq(duelMatches.id, matchId)).for("update");
if (!match) return { ratingDeltaA: 0, ratingDeltaB: 0 };

// Unranked (custom lobby): no Elo, no W/L, no rating_delta. Read off the row --
// never accepted as a parameter, per CLAUDE.md's "Server Actions never accept an
// outcome": the client does not get to say which matches count.
if (!match.ranked) return { ratingDeltaA: 0, ratingDeltaB: 0 };
```

Placed **after** the lock and **before** the `user_stats` reads, so the unranked branch
writes nothing at all and is trivially re-entrant.

### Four layers, because a silent non-write is invisible when it breaks

| Layer | What it buys |
|---|---|
| `duel_matches.ranked boolean NOT NULL DEFAULT true` | Every existing row and every matchmade row stays ranked. No backfill, no migration risk. |
| `CHECK (ranked OR (rating_delta_a IS NULL AND rating_delta_b IS NULL))` | Makes "an unranked match recorded a rating change" **unrepresentable**, the same way `duel_matches_distinct_players_check` does for self-matches. Catches the realistic regression: someone reorders `applyMatchResult`. |
| `lib/db/customMatchUnranked.test.ts` (database tier) | The only thing that will ever notice a regression. See §7. |
| Results UI reads `ranked` | Renders "Unranked · rating unaffected", never a fabricated `+0`. |

A CHECK cannot reach `user_stats` (there is no FK from a stats row to a match), so the
constraint plus the single choke point plus the test is the correct level of defence. Going
further would mean a trigger, which buys nothing the test does not.

### The sharp edge — rematch carry-forward

`requestRematch` (`lib/duel/actions.ts`) creates the rematch row with only
`{ playerA, playerB, status: "lobby", currentRound: 0 }`. It **must** copy `ranked`,
`rounds`, `round_seconds` and `filter` from the old match.

Miss it and the rematch of a friendly game silently becomes a rated 3-round 20-year duel —
off a **primary results-screen CTA**, which is exactly the shape of audit 2026-07-29 §0.1.
This case goes in `customMatchUnranked.test.ts`.

### Copy

Suppress the guest upgrade prompt on an unranked win in `DuelResults` — "Create an account
to keep your duel rating and record" is false there.

---

## 2. Per-match config

Four columns on `duel_matches`, read where the round lifecycle already holds the row:

```
ranked        boolean NOT NULL DEFAULT true
rounds        integer NOT NULL DEFAULT 3    CHECK (rounds BETWEEN 1 AND 5)
round_seconds integer NOT NULL DEFAULT 60   CHECK (round_seconds BETWEEN 15 AND 180)
filter        jsonb   NULL                  -- null = the daily 20-year pool (ranked duels)
```

### Two findings that make this far cheaper than it looks

**Round length is already parameterised in the scoring path.** `duel_submit_guess` derives
`v_round_ms` from `ends_at - started_at` (drizzle/0044, and drizzle/0022/0025 before it), and
`speedPoints` is never called from client code — `ROUND_MS` appears in `components/` and
`lib/` only inside comments. So a per-match round length needs exactly one change:

```sql
-- duel_begin_round
v_ends_at := v_started_at + make_interval(secs => v_match.round_seconds);
```

`duelScoring.sqlParity.test.ts` is untouched; the weights it pins do not move.

**`MAX_ROUNDS` has exactly two real consumers**: the `Round 1 / 3` label in
`components/duel/RoundPlay.tsx`, and `isLastRound` in `components/duel/useDuelLifecycle.ts`.

### `isLastRound` should stop being a client constant

`closeRound` already returns `matchFinished` / `nextRoundIndex`, and `duel_round_reveal`
returns `matchStatus`. Deriving "was that the last round?" from the server response instead
of `roundIndex >= MAX_ROUNDS - 1` makes configurable rounds correct **by construction**
rather than by two constants agreeing — and it is more correct today, too.

Server side, `duel_close_round`'s `IF p_round_index >= 2` becomes `>= v_match.rounds - 1`.

With that done, `rounds` on the client has one remaining consumer — the cosmetic round
label — so a stale value there can never desync the match. State that as an invariant in
the code.

### Bounds, not a ladder

The UI offers 1 / 3 / 5 rounds and 30 / 60 / 90 seconds. The RPC accepts anything inside the
CHECK constraints. Validating against the exact triple would duplicate a list TS↔SQL and
drag in a parity suite (CLAUDE.md: "a new duplicated constant gets an assertion in the same
change that creates it") for a value where nothing is at stake — it is an unranked game the
host configured for themselves.

`lib/game/customMatchConfig.ts` holds the offered options, the clamp and a
`describeMatchConfig()` for the lobby summary. Pure, unit-tested, and deliberately *looser*
than the CHECK rather than identical to it.

### Signature trap — do not touch the existing RPC return shapes

`CREATE OR REPLACE FUNCTION` cannot change a `RETURNS TABLE` shape. Adding columns to
`duel_state`, `duel_round_reveal` or `match_or_queue` means `DROP FUNCTION` + `CREATE` + a
restated grant decision — the trap drizzle/0053 documents for `infinite_start_round`.

Not needed. `getMyLiveMatch`, `getDuelResults` and `getDuelState` are Server Actions that
already read `duel_matches` through Drizzle; the new columns come off the row for free.

---

## 3. The driver filter — one SQL copy, not two

**This is the most consequential call in the plan.**

`matchesDriverFilter` (`lib/game/driverFilter.ts`) is already mirrored in plpgsql inside
`infinite_start_round`, pinned behaviourally by `lib/db/infiniteFilter.sqlParity.test.ts`.
Naively, `duel_begin_round` becomes a **third** copy of a five-column predicate whose failure
mode is silent: a target the player cannot type, in a live 1v1.

Instead, extract the predicate once:

```sql
CREATE FUNCTION public.pick_filtered_driver(p_filter jsonb, p_exclude integer[])
RETURNS integer
-- The predicate from lib/game/driverFilter.ts#matchesDriverFilter, plus
-- ORDER BY random() LIMIT 1. THE only SQL copy.
```

- `infinite_start_round` is repointed at it. Its existing parity suite is the safety net for
  that refactor — if the extraction changes behaviour, that suite fails.
- `duel_begin_round` calls it when `filter IS NOT NULL`, and falls through to the unchanged
  20-year `last_active_year` pick otherwise.

One SQL definition of the predicate, forever. Same reasoning as the `duel_*_client` wrappers
in drizzle/0034: one definition of the logic, one definition of the authorization.

### `p_exclude` earns its place

`duel_begin_round` does not currently dedupe targets across a match's rounds. Invisible in a
250-driver pool; glaring in a 6-driver custom filter. Exclude drivers already used in this
match, and **fall back to allowing repeats when the filter is smaller than the round count**
— a tiny pool should degrade, not error mid-match.

Lobby creation refuses a filter matching zero drivers, exactly as `infinite_start_round`
does.

### `duel_submit_guess` stays existence-only

CLAUDE.md's reasoning holds unchanged: win-by-identity means an out-of-filter guess can never
win, and duel guesses are unlimited, so a bad guess costs the player seconds and nothing
else. Adding a filter check there would mean a second copy of the whole predicate on the hot
path. Leave a comment so nobody "fixes" it.

---

## 4. `duel_lobbies` and its RPCs

```
duel_lobbies(
  code           text PRIMARY KEY,            -- server-generated, 6 chars
  host_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  host_device_id text NOT NULL,               -- self-join guard; survives an identity swap
  mode           text NOT NULL DEFAULT 'duel' CHECK (mode IN ('duel')),   -- Knockout seam
  rounds         integer NOT NULL,
  round_seconds  integer NOT NULL,
  filter         jsonb NOT NULL,
  match_id       integer REFERENCES duel_matches(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
)
```

**No `status` column.** The three states are derivable: **open** (`match_id IS NULL`, fresh),
**consumed** (`match_id IS NOT NULL`), **gone** (row deleted). A status column would be a
fourth thing to keep in agreement with the other three.

`ON DELETE CASCADE` on `match_id`, not `SET NULL` — a deleted match must not resurrect its
lobby as joinable.

**RLS on, no policies, no client grants.** Every access goes through a `SECURITY DEFINER` +
`auth.uid()` RPC. Same shape as `matchmaking_queue`, for the same reason: what must be proven
is a row, and the only supported way to touch it is a vetted function.

### The RPCs

| RPC | Contract |
|---|---|
| `duel_lobby_create(rounds, round_seconds, from_year, to_year, nationality, team, achievement, device_id) → code text` | Sweeps stale rows; deletes the caller's own open lobbies (converge, don't error); re-clamps years and re-validates the achievement server-side, reusing `infinite_start_round`'s clamp verbatim; refuses a filter matching nobody. Requires a non-blank `device_id`, same as `match_or_queue`. |
| `duel_lobby_state(code) → config + host handle + match_id?` | Powers the joiner's preview and the host's poll. Returns `match_id` **only** to the host or a match participant. |
| `duel_lobby_join(code, device_id) → match_or_queue's exact row shape` | `FOR UPDATE` on the lobby. Refuses unknown / stale / already-consumed codes and `host_id = auth.uid() OR host_device_id = p_device_id`. Creates the match `ranked = false, status = 'lobby', current_round = 0` with the config copied across, sets `lobby.match_id`. Idempotent: a participant calling again (double-click, reload) gets the same match back. |
| `duel_lobby_heartbeat(code)` | Refreshes `last_seen_at` on the caller's own open lobby. No-op otherwise. |
| `duel_lobby_cancel(code)` | Deletes the caller's own open lobby. Idempotent; safe twice, safe when never created. |
| `duel_sweep_stale_lobbies()` | Called at the top of create and join. No cron needed — same pattern as `duel_sweep_stale_queue`. |

**Returning `match_or_queue`'s exact row shape from the join** means the client reuses the
existing `toMatchResult` mapper and the `MatchResult` type, and `DuelRoot` receives a custom
match through the identical `onFound` seam as a matchmade one. That is most of why the client
diff stays small.

### Codes

Alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — 31 characters, no `0/O/1/I/L`. Six characters is
31⁶ ≈ 887 million.

Generated **server-side** inside the RPC, in a retry loop catching `unique_violation`. A
client-supplied code would let someone squat `AAAAAA` and intercept lobbies. Join normalizes
case, whitespace and dashes before lookup.

### Liveness — deliberately not the queue's 15 seconds

Backgrounded-tab `setInterval` throttles to roughly one call per minute in Chrome, and hosts
**will** alt-tab to paste the code into Discord. The queue's window would kill a live lobby
while its host was doing exactly what the feature is for.

```
CUSTOM_LOBBY_HEARTBEAT_MS   20_000    survives background throttling
CUSTOM_LOBBY_STALE_MS      120_000    survives two throttled beats
CUSTOM_LOBBY_POLL_MS         2_500    the host's safety-net poll
CUSTOM_LOBBY_MAX_AGE_MS  1_800_000    hard cap; nothing lives forever
```

All in `lib/game/duelTiming.ts` (CLAUDE.md: every duel duration lives in that one file), with
the usual keep-in-sync comment on the SQL literals.

### Grants

Six new functions and one new relation ⇒ **six + one entries in
`lib/db/schemaGrants.test.ts`, in the same change**. All six are `SECURITY DEFINER` +
`auth.uid()`, `REVOKE EXECUTE ... FROM PUBLIC, anon` then `GRANT ... TO authenticated`
(never a bare `REVOKE FROM PUBLIC` — see CLAUDE.md's "Schema" note and drizzle/0039).

The suite failing until those entries exist is the mechanism working as intended.

---

## 5. Client structure

`DuelRoot` gains **one** phase, `"custom"`. Everything inside it is a self-contained
component that reports a `MatchResult` upward — the same contract `DuelSearching` already
has, so `DuelRoot`'s diff stays to a phase string, a route param read, and one branch.

### New files

```
components/duel/CustomLobby.tsx          menu | create | waiting | join (owns its sub-phase)
components/duel/CustomLobbyCreate.tsx    rounds + round length; "Advanced" opens the filter
components/duel/CustomLobbyWaiting.tsx   code, Copy link / Copy code / Share, count, Cancel
components/duel/CustomLobbyJoin.tsx      code input -> preview -> Join
lib/duel/customLobby.ts                  the six supabase.rpc() wrappers + types
lib/game/customMatchConfig.ts            pure: options, clamp, describeMatchConfig
```

### Modified files

```
components/duel/DuelLanding.tsx      Custom card under Knockout, same card style
components/duel/DuelRoot.tsx         the "custom" phase; deep-link read; rounds passed down
components/duel/DuelResults.tsx      unranked line; CTA set for a custom match
components/duel/RoundPlay.tsx        "Round N / M" from the match, not MAX_ROUNDS
components/duel/useDuelLifecycle.ts  isLastRound from the server response
lib/duel/matchmaking.ts              MatchResult gains { ranked, rounds }
lib/duel/actions.ts                  unranked short-circuit; rematch carry-forward; ranked in results
lib/duel/duelCommitments.ts          open-lobby registration for sign-out
components/auth/AuthProvider.tsx     cancel the lobby in signOutAndReset() step 1
lib/game/duelTiming.ts               the four CUSTOM_LOBBY_* constants
app/(game)/online/page.tsx           full roster fetch (see below)
```

### `DriverFilterModal` is reused unmodified

It already takes `{ open, onClose, drivers, filter, onApply, referenceYear }` and computes
its cascading per-option counts from a roster prop. The custom lobby gets Infinite's exact
filter UX — including the live "142 drivers" count and the cascading pickers — for free. It
sits behind a small secondary "Advanced" button; rounds and round length are the primary
controls on the create screen.

### The roster on `/online`

`app/(game)/online/page.tsx` currently fetches `listPoolDriverOptions(DAILY_POOL_WINDOW, …)`.
It switches to `listAllDriverOptionsWithActivity()` — the same query `/infinite` already
serves under the same 1-hour ISR — because the filter modal needs the full roster for its
counts and the joiner's autocomplete needs the *match's* filtered set, not the 20-year pool.

Cost: the payload grows from roughly 250 to roughly 800 rows on a cached route. Both driver
lists are then derived client-side from pure predicates already in the repo
(`matchesDriverFilter`, `poolCutoffYear`), so there is one source and no "which list am I
on" bug.

### Deep link

`/online?join=ABC123`, read in a **mount effect from `window.location.search`**, then
stripped with `history.replaceState` so a refresh does not re-fire a join attempt.

Deliberately not `searchParams` on the page — that opts `/online` out of ISR entirely — and
deliberately not `useSearchParams()`, which drags a Suspense boundary into a client-only
concern. Copy uses `window.location.origin`, so no env var; `navigator.share` where
available.

### Sign-out

An open lobby is a live server commitment exactly like a queue row. Register it in
`lib/duel/duelCommitments.ts` and cancel it in `signOutAndReset()` **step 1**, while the
outgoing identity can still authenticate the call, and fold it into the existing confirmation
copy. Otherwise a friend joins a lobby whose host no longer exists and eats a
`DISCONNECT_GRACE_MS` forfeit.

### Results screen

- Unranked line in place of the rating delta.
- `Find new opponent` becomes `New custom game` for a custom match — dropping someone from a
  friendly into public matchmaking is a mode switch they did not ask for.
- Rematch is unchanged and carries the config (§1).

---

## 6. Realtime — no new policy needed

**The live match** uses `duel:{matchId}` unchanged. It is a real `duel_matches` row, so
`duel_topic_participant` (drizzle/0046) already scopes the private channel to its two
participants. Nothing to add.

**The host's wait** reuses the existing public `lobby` channel and `MATCHED_EVENT` — the
joiner broadcasts to the host exactly as `DuelSearching`'s joiner already does. That channel
is deliberately public and deliberately non-authoritative, so this needs zero new RLS.

One improvement over the matchmaking path: on receiving the event the host calls
`duel_lobby_state(code)` to resolve the match rather than rendering the payload's opponent
data directly. It is a between-phases beat where latency is free, and it means the host never
renders profile data a stranger typed into a broadcast.

A `CUSTOM_LOBBY_POLL_MS` poll backs it up for a missed broadcast — the same belt-and-braces
as matchmaking's poll beside its broadcast.

---

## 7. Tests

### Static tier (no database)

- `lib/game/customMatchConfig.test.ts` — clamping, the offered options, `describeMatchConfig`.
- `components/duel/CustomLobbyJoin.test.tsx` (`dom`) — the code input normalizes lowercase,
  spaces and dashes, and Join stays disabled until six valid characters. Write it so it fails
  against the pre-fix code and check that it does, per CLAUDE.md's rule for the `dom` tier.

### Database tier (`RUN_DB_INTEGRATION_TESTS=1`)

- **`lib/db/customMatchUnranked.test.ts`** — the headline requirement.
  1. Finish an unranked match → both players' `user_stats` rows are byte-identical before and
     after (rating, wins, losses), and `rating_delta_a/b` stay NULL.
  2. Forfeit an unranked match → same.
  3. A ranked control match still moves all three, so an inverted flag fails the suite.
  4. A rematch of an unranked match is itself unranked and carries the config.
- `lib/db/customLobby.test.ts` — code shape; join creates `ranked = false` with the config
  copied; double-join is idempotent; host self-join refused; consumed code refused to a third
  party; stale lobby unjoinable; cancel idempotent.
- Extend `lib/db/infiniteFilter.sqlParity.test.ts` (or add a sibling) so the shared
  `pick_filtered_driver` is pinned through **both** callers.
- `lib/db/schemaGrants.test.ts` — six function entries plus the `duel_lobbies` relation.

---

## 8. Build order

Each phase is independently verifiable, and the part that matters most lands first with
nothing else in the way.

| # | Phase | Contents |
|---|---|---|
| 1 | **Stats isolation** | Migration (`ranked`/`rounds`/`round_seconds`/`filter` + CHECKs), `applyMatchResult` short-circuit, `requestRematch` carry-forward, `ranked` in `getDuelResults`, `customMatchUnranked.test.ts`, grant entries. **No UI. Existing duels bit-identical.** |
| 2 | **Configurable rounds / length** | `duel_begin_round` reads `round_seconds`, `duel_close_round` reads `rounds`, `isLastRound` from the server, round label. Verified with a hand-inserted row. |
| 3 | **`pick_filtered_driver`** | Extract, repoint `infinite_start_round` (parity suite is the net), teach `duel_begin_round`. |
| 4 | **Lobby table + six RPCs** | Plus `lib/duel/customLobby.ts` and `customLobby.test.ts`. |
| 5 | **UI** | Landing card, `CustomLobby` tree, filter modal reuse, deep link, results copy, sign-out commitment. |
| 6 | **Docs** | The CLAUDE.md section. |

---

## 9. Integrity — considered and dispositioned

- **Self-match** — `duel_matches_distinct_players_check` already makes the same-identity case
  unrepresentable; `host_device_id` covers the sign-out-and-rejoin case that drizzle/0032
  closed for the queue. Unranked removes the farming incentive entirely, so this is about not
  rendering a broken screen rather than about Elo. The accepted side effect stands: two people
  sharing one browser profile cannot play each other.
- **Code brute-force** — 887 million codes, a lifetime under 30 minutes, and the prize is an
  unranked game against a stranger. No rate limit; recorded as considered and declined. If it
  ever matters, a per-user join-attempt throttle is the answer.
- **Guests** — may host and join, consistent with duel today.
- **Abandoned lobby, or a joiner who closes the tab** — the normal disconnect, `duel_heartbeat`
  and forfeit machinery applies unchanged, and the forfeit writes nothing because the match is
  unranked.
- **`matchmaking_queue` is never touched** by this flow. Custom hosts do not queue, so none of
  the four self-match layers are weakened or bypassed.

---

## 10. Two risks worth naming

**Configurable rounds is the only part that ripples into ranked duel code** —
`duel_close_round`'s last-round test, `isLastRound`, and the round label. It is a small and
strictly-better change (deriving "last round" from the server is more correct today too), but
it *is* a change to the live rated path. Phase 2 wants care and a re-run of the existing duel
database suites.

**"Not affecting stats" is invisible when it regresses.** Nothing a player sees changes if
`ranked` stops being read — the leaderboard just quietly starts absorbing friendly games.
That is why the CHECK constraint and the database-tier test are in phase 1 rather than left
as follow-ups. They are the only things that will ever notice.

---

## 11. Out of scope

- **Knockout in a custom lobby.** The `mode` column with `CHECK (mode IN ('duel'))` is the
  seam; the create screen shows Knockout disabled, same as the landing.
- Spectators, best-of series, private *ranked* lobbies, lobby chat.
- Re-entering a finished custom match — same rule as ranked: you cannot.
