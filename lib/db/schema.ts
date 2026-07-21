import { boolean, check, date, integer, jsonb, numeric, pgTable, pgView, primaryKey, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const drivers = pgTable("drivers", {
  id: serial("id").primaryKey(),
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
});

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
  duelRating: integer("duel_rating").notNull().default(1000),
  duelWins: integer("duel_wins").notNull().default(0),
  duelLosses: integer("duel_losses").notNull().default(0),
});

// One row per (user, day) a daily result was recorded. Exists purely as a
// server-side idempotency guard for lib/stats/actions.ts#recordDailyResult
// -- without it, that action would be replayable from devtools to inflate
// user_stats. Doubles as a real per-day history if a "your recent results"
// UI ever wants one, but nothing reads it that way yet.
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
    // Set by requestRematch() the moment one finished-match participant asks
    // for a rematch; null again once consumed (the second participant's
    // matching request finds it set to the *other* player's id and creates
    // the new match). Mutual-consent gate -- a lone request just waits.
    rematchRequestedBy: uuid("rematch_requested_by").references(() => profiles.id),
  },
  (table) => [
    check(
      "duel_matches_status_check",
      sql`${table.status} IN ('lobby', 'countdown', 'active', 'intermission', 'finished', 'abandoned')`,
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
// otherwise); `points` is the final speedPoints/proximityPoints result (see
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
    guessCount: integer("guess_count").notNull().default(0),
    bestProximity: numeric("best_proximity"),
    points: integer("points").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.roundIndex, table.userId] })],
);

// profiles joined with user_stats, public columns only, full accounts
// only (is_guest = false) -- backs the Leaderboard modal. Hand-written in
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
}).existing();
