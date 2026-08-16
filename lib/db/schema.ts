import { boolean, check, date, index, integer, jsonb, numeric, pgTable, pgView, primaryKey, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import type { DriverFilter } from "../game/driverFilter";

// The one table with RLS disabled, so its grants ARE its access control
// (drizzle/0043). Its `check()`s are the per-column half of the seed's defence
// against a mis-parsed F1DB release: scripts/releaseGuards.ts catches a renamed
// column or a dead canary before the write, and these catch a value that can't
// be true of a real driver, inside the seed's own transaction (drizzle/0047,
// audit 2026-07-29 §5.2d).
export const drivers = pgTable(
  "drivers",
  {
    id: serial("id").primaryKey(),
    // F1DB's own driver slug ("lewis-hamilton") -- the stable natural key the
    // seed upserts on, so a re-seed updates rows IN PLACE. `id` is a serial that
    // daily_targets, duel_rounds and infinite_rounds hold FKs to and that
    // daily_progress.guesses stores bare (no FK, so it would break silently), so
    // it must never be reassigned; the old delete-and-reinsert seed did exactly
    // that. See drizzle/0043 and scripts/rosterPlan.ts.
    //
    // Nullable only for rows that predate drizzle/0043 -- the seed adopts them by
    // (full_name, date_of_birth) on its next run. NULLs are exempt from UNIQUE in
    // Postgres, which is what makes that intermediate state representable.
    f1dbId: text("f1db_id").unique(),
    fullName: text("full_name").notNull(),
    // F1DB's official 3-letter driver abbreviation. Nullable: coverage isn't
    // guaranteed across the full historical roster (only the modern/well-
    // documented majority of it).
    driverCode: text("driver_code"),
    nationality: text("nationality").notNull(),
    dateOfBirth: date("date_of_birth").notNull(),
    dateOfDeath: date("date_of_death"),
    debutYear: integer("debut_year").notNull(),
    careerWins: integer("career_wins").notNull().default(0),
    lastTeam: text("last_team"),
    // Every distinct constructor this driver has ever raced for, current team
    // included. Used to show a "used to drive for them" hint on a team miss.
    previousTeams: text("previous_teams").array().notNull().default([]),
    // The most recent year they started a race. Drives which pool windows
    // (current season / last 10-30 years / legacy) a driver falls into —
    // see lib/game/poolWindow.ts. Every driver in this table has raced at
    // least once, so this is always set.
    lastActiveYear: integer("last_active_year").notNull(),
    // The three achievement tiers Infinite's filter offers beyond `careerWins`
    // (drizzle/0053). Straight from F1DB's totalChampionshipWins /
    // totalPodiums / totalPolePositions -- unlike `careerWins`, which the seed
    // computes itself from race results, these are the feed's own totals.
    // Default 0, so they read as "no achievements" between the migration
    // landing and the next seed run rather than as NULL.
    championshipWins: integer("championship_wins").notNull().default(0),
    podiums: integer("podiums").notNull().default(0),
    polePositions: integer("pole_positions").notNull().default(0),
  },
  // Write-time only -- `drivers` is written by scripts/seed.ts and nothing
  // else, so none of this is on a guess or board-load path. See drizzle/0047
  // for why each one is phrased the way it is.
  (table) => [
    check("drivers_career_wins_check", sql`${table.careerWins} >= 0`),
    check(
      "drivers_season_order_check",
      sql`${table.debutYear} <= ${table.lastActiveYear}`,
    ),
    check(
      "drivers_season_range_check",
      sql`${table.debutYear} >= 1950 AND ${table.lastActiveYear} <= EXTRACT(YEAR FROM CURRENT_DATE)::int + 1`,
    ),
    check(
      "drivers_death_after_birth_check",
      sql`${table.dateOfDeath} IS NULL OR ${table.dateOfDeath} > ${table.dateOfBirth}`,
    ),
    check(
      "drivers_born_before_debut_check",
      sql`${table.dateOfBirth} < make_date(${table.debutYear}, 1, 1)`,
    ),
    check("drivers_championship_wins_check", sql`${table.championshipWins} >= 0`),
    check("drivers_podiums_check", sql`${table.podiums} >= 0`),
    check("drivers_pole_positions_check", sql`${table.polePositions} >= 0`),
  ],
);

// `id` is `auth.users.id` (Supabase Auth). The FK to auth.users, the
// signup trigger that inserts this row, and its RLS policies all live in
// the hand-written drizzle/0006_*.sql migration -- auth.users isn't part
// of this Drizzle schema, so drizzle-kit can't express or manage that
// relationship itself. See CLAUDE.md "Accounts & auth".
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  // A DiceBear seed string (see lib/avatars.tsx), not a real image URL --
  // there's no upload/Storage path. Defaults to the user's own id (set by
  // the signup trigger, so every guest gets a distinct character for
  // free) and is re-pickable afterward via Settings -> Profile.
  avatarUrl: text("avatar_url").notNull(),
  isGuest: boolean("is_guest").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userStats = pgTable("user_stats", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  gamesPlayed: integer("games_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  maxStreak: integer("max_streak").notNull().default(0),
  // Index i holds the count of wins solved in i + 1 guesses -- same shape
  // as the old localStorage StatsState.guessDistribution.
  guessDistribution: jsonb("guess_distribution")
    .$type<number[]>()
    .notNull()
    .default([0, 0, 0, 0, 0, 0]),
  // Powers the Statistics modal's "this bar is your latest win" highlight.
  // Null until a first result is recorded.
  lastResult: jsonb("last_result").$type<{ won: boolean; guessCount: number } | null>(),
  // The UTC day of the most recently recorded daily result (drizzle/0037).
  // What makes current_streak break on a MISSED day and not just a lost one:
  // the write path only extends the streak when this is the day before, and
  // every reader treats the stored streak as 0 unless this is today or
  // yesterday. See lib/stats/streak.ts for both rules. Null = no server-side
  // daily history (or a legacy localStorage merge, which carries no dates),
  // which counts as no live streak.
  lastDailyDate: date("last_daily_date"),
  // Set the first (and only) time lib/stats/actions.ts#migrateLocalStats folds
  // this account's pre-accounts localStorage stats in (drizzle/0041). The "once"
  // guard used to be readStats() clearing localStorage client-side, which an
  // attacker calling the action in a loop simply doesn't run -- and every call
  // ADDED again (audit 2026-07-27 §3.7). Deliberately on user_stats, which has
  // no client write policy at all, rather than on profiles, which still carries
  // a table-wide client UPDATE policy (§3.6): a marker the client can clear
  // isn't a marker. Null = the merge hasn't happened (or the account predates
  // the column, in which case it's still available exactly once).
  localStatsMergedAt: timestamp("local_stats_merged_at", { withTimezone: true }),
  duelRating: integer("duel_rating").notNull().default(1000),
  duelWins: integer("duel_wins").notNull().default(0),
  duelLosses: integer("duel_losses").notNull().default(0),
});

// One row per (user, day) a daily result was recorded. Exists as the
// server-side idempotency guard for lib/stats/actions.ts#recordDailyResult --
// without it, that action would be REPLAYABLE from devtools to inflate
// user_stats. Note the limit of what it does, since the original comment here
// overstated it and that gap was a live hole: a PK guard stops a replay, not a
// FORGERY. It cannot tell an honest write from an invented one, and being
// first-write-wins it would let an invented one suppress the honest result for
// that day. What stops forgery is that recordDailyResult no longer accepts an
// outcome at all -- it reads won/guess_count/date off daily_progress
// (audit 2026-07-27 §3.2). The two defences are complementary; neither replaces
// the other. Doubles as a real per-day history if a "your recent results" UI
// ever wants one, but nothing reads it that way yet.
export const dailyResults = pgTable(
  "daily_results",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    won: boolean("won").notNull(),
    guessCount: integer("guess_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.date] })],
);

// Server-authoritative per-day board state -- what makes a day's board
// follow the account across devices (CLAUDE.md "Daily persistence & sync").
// `guesses` is the ordered list of guessed driver ids for a (user, UTC day):
// the guesses ARE the state. Tile results are deliberately never stored --
// they're recomputed by running compare_drivers() over `guesses` against the
// day's pinned target on hydration (the daily_state RPC, drizzle/0030), so
// there's one source of truth for comparison rules and no way for a client to
// inject fabricated tiles. `completed`/`won` gate the target reveal and the
// "one playthrough per day" rule. Distinct from daily_results (a write-once
// stats idempotency guard) -- this is live, mutable board state. Self-SELECT
// under RLS with no client write policy at all (drizzle/0029): every append
// goes through the SECURITY DEFINER daily_submit_guess RPC (drizzle/0030),
// which runs as the table owner and bypasses RLS.
export const dailyProgress = pgTable(
  "daily_progress",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // The UTC day, always resolved server-side from the DB clock -- never
    // supplied by the client (a client-set date is a one-line puzzle re-roll).
    date: date("date").notNull(),
    // Ordered guessed driver ids -- the actual answers, not tiles.
    guesses: integer("guesses").array().notNull().default([]),
    completed: boolean("completed").notNull().default(false),
    // Null until the day is complete; then true (solved) or false (ran out).
    won: boolean("won"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.date] })],
);

// The day's pinned target driver, and the ONLY place the day's answer exists.
// Lazily written by the first caller of the day (daily_state /
// daily_submit_guess RPCs, via the daily_target_id() helper), then read by
// everyone else -- so the target is a single indexed read instead of a per-call
// pool scan + pick, and can't silently drift if the pool definition changes
// intra-day (the exact bug lib/game/dailySelection.ts's old precomputed table
// had).
//
// The pick itself is RANDOM, made once server-side (drizzle/0038). It used to
// be a deterministic hash of the date over the id-sorted pool, which meant the
// answer was recomputable in the browser from the pool /daily already ships for
// autocomplete -- pinning a secret is only a secret if the pin is unpredictable
// (audit 2026-07-27 §3.1). RLS is enabled with NO policy at all (drizzle/0030),
// so a direct PostgREST SELECT returns nothing; the only readers are the
// SECURITY DEFINER RPCs, which run as the table owner and bypass RLS, and
// daily_target_id itself has EXECUTE revoked from anon/authenticated. Same
// "default deny" treatment as duel_rounds / infinite_rounds.
export const dailyTargets = pgTable(
  "daily_targets",
  {
    // The UTC day. PK, so exactly one target per day.
    date: date("date").primaryKey(),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
  },
  // Supports the recent-repeat cooldown in daily_target_id's pick, which asks
  // "has this driver been the answer lately?" once per candidate driver.
  (table) => [index("daily_targets_driver_id_idx").on(table.driverId)],
);

// Real-time 1v1 duel (replaces the legacy duel_rooms/duel_players room-code
// game -- see CLAUDE.md "Duel (real-time race)"). One row per waiting
// player; the pairing RPC (not yet built) deletes both rows the moment it
// creates a duel_matches row for them.
export const matchmakingQueue = pgTable("matchmaking_queue", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  poolWindow: text("pool_window").notNull(),
  // Snapshot of user_stats.duel_rating at queue time -- the pairing RPC
  // matches on this and widens its window the longer a player waits.
  rating: integer("rating").notNull(),
  status: text("status").notNull().default("waiting"),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  // Liveness heartbeat (drizzle/0032). The searching client refreshes this
  // every QUEUE_HEARTBEAT_MS; match_or_queue ignores rows older than
  // QUEUE_STALE_MS and duel_sweep_stale_queue deletes them, so a row leaked by
  // a crash, a closed tab, or a failed dequeue goes inert on its own instead of
  // staying matchable forever.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  // Stable per-browser id that SURVIVES an identity swap (localStorage, not the
  // session) -- the self-match guard. match_or_queue refuses to pair two rows
  // sharing this, which is what stops "queue, sign out, queue again as the new
  // anonymous identity, duel yourself for rating". NOT NULL on purpose: a null
  // would silently opt a row out of that guard.
  deviceId: text("device_id").notNull(),
});

// A custom-lobby invitation: a short-lived row holding a match config and the
// code a friend types to join it (drizzle/0057). Joining creates an ordinary
// duel_matches row with ranked = false plus this config, and from that instant
// every existing duel component, RPC and channel runs unchanged.
//
// NO STATUS COLUMN, deliberately. The three states are derivable -- open
// (`matchId` null), consumed (`matchId` set), gone (row deleted) -- and a
// fourth thing to keep in agreement with those three is exactly how a row ends
// up claiming to be open while holding a match id.
//
// No client grants and no RLS policy at all: every access goes through a
// SECURITY DEFINER + auth.uid() RPC, the matchmaking_queue shape. A readable
// duel_lobbies would be every open code behind one anon-key query.
export const duelLobbies = pgTable(
  "duel_lobbies",
  {
    // Server-generated, 6 characters from a 31-character unambiguous alphabet
    // (no 0/O/1/I/L). Never client-supplied -- that would let someone squat
    // AAAAAA and intercept whoever typed it.
    code: text("code").primaryKey(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // The self-join guard, and why it is separate from hostId: signing out
    // mints a fresh anonymous identity, so the user ids genuinely differ and
    // only the device can tell "someone else" from "the same person, again".
    // Same layer, same reason, as matchmakingQueue.deviceId.
    hostDeviceId: text("host_device_id").notNull(),
    // Knockout's seam. Disabled in the UI; the CHECK is what stops a second
    // mode arriving before it is built.
    mode: text("mode").notNull().default("duel"),
    rounds: integer("rounds").notNull(),
    roundSeconds: integer("round_seconds").notNull(),
    // NOT NULL here, unlike duelMatches.filter -- a custom lobby always
    // composes one, and null on the match row means the daily 20-year pool.
    filter: jsonb("filter").$type<DriverFilter>().notNull(),
    // ON DELETE CASCADE rather than SET NULL: a deleted match must not
    // resurrect its lobby as joinable.
    matchId: integer("match_id").references(() => duelMatches.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Refreshed every CUSTOM_LOBBY_HEARTBEAT_MS by the waiting host. Only OPEN
    // lobbies go stale on it -- a consumed one stops beating the moment its
    // match starts, and is aged out by createdAt instead.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("duel_lobbies_code_shape_check", sql`${table.code} ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'`),
    check("duel_lobbies_mode_check", sql`${table.mode} IN ('duel')`),
    // The same bounds duelMatches carries, because these are copied onto a
    // match at join time and would otherwise fail there instead of here.
    check("duel_lobbies_rounds_check", sql`${table.rounds} BETWEEN 1 AND 5`),
    check("duel_lobbies_round_seconds_check", sql`${table.roundSeconds} BETWEEN 15 AND 180`),
  ],
);

// One row per user with an in-progress Infinite round -- replaces the
// signed httpOnly cookie (lib/game/session.ts) that used to hold this,
// which PostgREST can't see. Moving it server-side like this is what lets
// guess evaluation go through a fast, client-callable RPC
// (infinite_submit_guess) instead of a Next.js Server Action, the same
// win duel_submit_guess already gets. Starting a new round always
// overwrites this row (ON CONFLICT DO UPDATE in infinite_start_round), so
// nothing here ever needs a TTL sweep the way matchmaking_queue might.
export const infiniteRounds = pgTable("infinite_rounds", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  driverId: integer("driver_id")
    .notNull()
    .references(() => drivers.id),
  // The filter that produced this round (drizzle/0053), replacing the single
  // `pool_window` string Infinite used to pick from. Written by
  // infinite_start_round and read by nobody -- it records a round's provenance,
  // exactly as pool_window did.
  filter: jsonb("filter").notNull().default({}),
  guessCount: integer("guess_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});

export const duelMatches = pgTable(
  "duel_matches",
  {
    id: serial("id").primaryKey(),
    playerA: uuid("player_a")
      .notNull()
      .references(() => profiles.id),
    playerB: uuid("player_b")
      .notNull()
      .references(() => profiles.id),
    // Full lifecycle per CLAUDE.md's "Duel (real-time race)": lobby ->
    // countdown -> active -> intermission -> (loop rounds) -> finished, or
    // abandoned (forfeit/disconnect) from any state.
    status: text("status").notNull().default("active"),
    currentRound: integer("current_round").notNull().default(1),
    // Cached aggregate score, mirrored from duel_round_results -- drives the
    // tug-of-war bar without recomputing a sum on every read.
    scoreA: integer("score_a").notNull().default(0),
    scoreB: integer("score_b").notNull().default(0),
    winnerId: uuid("winner_id").references(() => profiles.id),
    // Rating change applied to each player when the match finished, cached
    // here (rather than only in user_stats, which just holds the current
    // total) so the results screen can show "+/-N" without re-deriving it
    // from a before/after snapshot. Null until the match finishes.
    ratingDeltaA: integer("rating_delta_a"),
    ratingDeltaB: integer("rating_delta_b"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // Per-player liveness inside the match (drizzle/0040), refreshed by
    // duel_heartbeat() every DUEL_HEARTBEAT_MS from whichever client is holding
    // this match on screen. The server's ONLY evidence that a player is still
    // there: presence lives in a Realtime channel Postgres can't see, so before
    // this, "your opponent is absent" was a claim the remaining client made and
    // the server took at face value -- one devtools call
    // `forfeitMatch(id, opponentId)` mid-match was a guaranteed win and real Elo
    // (audit 2026-07-27 §3.3). Now forfeiting SOMEONE ELSE requires their column
    // to be stale past DISCONNECT_GRACE_MS; forfeiting yourself never does.
    // Defaults to now() at insert so a freshly created match can't be claimed
    // stale before either client has had a chance to beat.
    lastSeenA: timestamp("last_seen_a", { withTimezone: true }).notNull().defaultNow(),
    lastSeenB: timestamp("last_seen_b", { withTimezone: true }).notNull().defaultNow(),
    // Set by requestRematch() the moment one finished-match participant asks
    // for a rematch; null again once consumed (the second participant's
    // matching request finds it set to the *other* player's id and creates
    // the new match). Mutual-consent gate -- a lone request just waits.
    rematchRequestedBy: uuid("rematch_requested_by").references(() => profiles.id),

    // --- per-match config (drizzle/0054, custom lobbies phase 1) -----------
    //
    // Does this match move duel_rating / duel_wins / duel_losses? False only
    // for a custom-lobby match, which is a friendly game between two people
    // who swapped a code. applyMatchResult (lib/duel/applyMatchResult.ts) is
    // the single writer of all three columns and reads this flag OFF THE ROW
    // IT ALREADY LOCKED -- never as a parameter, per CLAUDE.md's "Server
    // Actions never accept an outcome": which matches count is not something
    // a client gets to say. Defaults true, so every existing row and every
    // matchmade row is rated exactly as before.
    ranked: boolean("ranked").notNull().default(true),
    // How many rounds this match plays, and how long each one lasts. Written
    // at match creation and read by the round lifecycle where it already holds
    // the row (phase 2 -- duel_begin_round stamps ends_at from round_seconds,
    // duel_close_round's last-round test reads rounds). Nothing reads them
    // yet; the defaults are the constants those functions currently hardcode
    // (MAX_ROUNDS 3, ROUND_MS 60000 in lib/game/duelTiming.ts).
    rounds: integer("rounds").notNull().default(3),
    roundSeconds: integer("round_seconds").notNull().default(60),
    // The composed driver filter this match's targets are drawn from, in
    // lib/game/driverFilter.ts's shape. NULL means the daily 20-year pool --
    // i.e. every ranked duel, which is why this is nullable rather than
    // defaulting to an empty object like infinite_rounds.filter does: "no
    // filter" and "an empty filter" pick from different pools here.
    filter: jsonb("filter").$type<DriverFilter>(),
  },
  (table) => [
    check(
      "duel_matches_status_check",
      sql`${table.status} IN ('lobby', 'countdown', 'active', 'intermission', 'finished', 'abandoned')`,
    ),
    // Bounds, not the exact 1/3/5 and 30/60/90 the create screen will offer --
    // see drizzle/0054 for why duplicating that list into SQL would cost more
    // than it buys.
    check("duel_matches_rounds_check", sql`${table.rounds} BETWEEN 1 AND 5`),
    check("duel_matches_round_seconds_check", sql`${table.roundSeconds} BETWEEN 15 AND 180`),
    // Makes "an unranked match recorded a rating change" unrepresentable, the
    // same way duel_matches_distinct_players_check (drizzle/0032) does for a
    // self-match. The short-circuit in applyMatchResult is the mechanism; this
    // is what notices if someone reorders it, because a silent non-write is
    // invisible when it breaks -- the leaderboard just quietly starts
    // absorbing friendly games.
    check(
      "duel_matches_unranked_no_rating_check",
      sql`${table.ranked} OR (${table.ratingDeltaA} IS NULL AND ${table.ratingDeltaB} IS NULL)`,
    ),
  ],
);

// One row per round per match, server-stamped -- both clients count down to
// `endsAt`, never trusting their own clock. round_index is 0-based (3
// rounds: 0, 1, 2).
export const duelRounds = pgTable(
  "duel_rounds",
  {
    matchId: integer("match_id")
      .notNull()
      .references(() => duelMatches.id, { onDelete: "cascade" }),
    roundIndex: integer("round_index").notNull(),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // Server-stamped the moment duel_close_round() closes this round --
    // both clients count down to the same instant before the ready-gated
    // next round begins. Null while the round is still active.
    intermissionEndsAt: timestamp("intermission_ends_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.roundIndex] })],
);

// One row per (match, round, player) -- the scored outcome of that player's
// round, win or DNF. `bestProximity` is only meaningful on a DNF (null
// otherwise); `points` is the final solvePoints/dnfPoints result (see
// lib/game/duelScoring.ts).
export const duelRoundResults = pgTable(
  "duel_round_results",
  {
    matchId: integer("match_id")
      .notNull()
      .references(() => duelMatches.id, { onDelete: "cascade" }),
    roundIndex: integer("round_index").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    solvedAt: timestamp("solved_at", { withTimezone: true }),
    // Not just a stat: guess_count is what decays this round's payout on both
    // paths (drizzle/0058) -- duel_submit_guess reads it to scale a solve's
    // speed bonus, duel_close_round to scale a DNF's proximity.
    guessCount: integer("guess_count").notNull().default(0),
    bestProximity: numeric("best_proximity"),
    points: integer("points").notNull().default(0),
    // What the guess cooldown spaces against (drizzle/0058) -- the previous
    // guess's server timestamp, refreshed by every duel_submit_guess. Null
    // until this player's first guess of the round.
    lastGuessAt: timestamp("last_guess_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.roundIndex, table.userId] })],
);

// profiles joined with user_stats, public columns only, full accounts
// only (is_guest = false) -- backs the Leaderboard modal's three boards.
// `currentStreak` is NOT the raw stored column: the view zeroes it when the
// last daily result is older than yesterday (drizzle/0037). Nothing ranks on
// it since drizzle/0060 (the streak board ranks the lifetime `maxStreak`), but
// the decay stays because the column does -- CREATE OR REPLACE VIEW can append
// a column and not drop one. `dailyWins` is user_stats.wins, renamed here so
// it can't be confused with `duelWins` in a rank subquery. Hand-written in
// drizzle/0009_leaderboard_view.sql (same reasoning as the 0006 auth
// trigger/RLS: DDL drizzle-kit can't express on its own), so this is
// `.existing()` -- a queryable reference, not something drizzle-kit should
// try to CREATE.
export const leaderboard = pgView("leaderboard", {
  id: uuid("id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url").notNull(),
  duelRating: integer("duel_rating").notNull(),
  duelWins: integer("duel_wins").notNull(),
  duelLosses: integer("duel_losses").notNull(),
  currentStreak: integer("current_streak").notNull(),
  maxStreak: integer("max_streak").notNull(),
  dailyWins: integer("daily_wins").notNull(),
}).existing();
