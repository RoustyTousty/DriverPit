import { sql } from "drizzle-orm";

// Relative, not the `@/` alias: vitest resolves this module directly (see
// rank.test.ts) and doesn't carry tsconfig's path mapping.
import { leaderboard } from "../db/schema";

// The two rank expressions getLeaderboard selects alongside the viewer's own
// row (audit 2026-07-29 §1.6). Not "position within the fetched rows" -- a
// count of everyone with a strictly higher metric, so a viewer far outside the
// top slots still gets their real rank.
//
// They live here, out of the "use server" module, for one reason: the outer
// column reference has to be table-qualified, that requirement is invisible in
// the result, and rank.test.ts can only pin it if the expression is importable.
//
// WHY THE QUALIFICATION MATTERS. `ranked` is the same relation, so it has a
// `duel_rating` of its own; Postgres resolves an unqualified reference to the
// innermost FROM, making the predicate `ranked.duel_rating >
// ranked.duel_rating` -- false for every row, count 0, and EVERY viewer comes
// back rank 1. Nothing errors. It is also the reason these are hand-written
// strings rather than `${leaderboard.duelRating}`: drizzle renders a column
// inside a `sql` template unqualified, which is exactly the broken form.
//
// `::int` because count() is bigint, which the postgres driver returns as a
// string -- uncast, `rank` would be `"3"` and render as such.
export const duelRankSql = sql<number>`(
  SELECT count(*) + 1 FROM ${leaderboard} AS ranked
  WHERE ranked.duel_rating > leaderboard.duel_rating
)::int`;

export const streakRankSql = sql<number>`(
  SELECT count(*) + 1 FROM ${leaderboard} AS ranked
  WHERE ranked.current_streak > leaderboard.current_streak
)::int`;
