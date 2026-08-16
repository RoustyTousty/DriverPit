import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { dailyWinsRankSql, duelRankSql, streakRankSql } from "./rank";

// Static tier -- renders the expressions with drizzle's own dialect, so no
// database and no DATABASE_URL. (Importing lib/db would construct a client;
// lib/db/schema is table definitions only.)
const dialect = new PgDialect();
const render = (expr: typeof duelRankSql) => dialect.sqlToQuery(expr).sql.replace(/\s+/g, " ").trim();

describe("leaderboard rank expressions", () => {
  // The failure this exists for: with the outer column left unqualified,
  // Postgres binds it to the inner alias, the predicate compares a row to
  // itself, and every viewer comes back rank 1 -- no error, no warning, and a
  // plausible-looking number. Verified against a real Postgres before this test
  // was written: over a three-row fixture the unqualified form returns 1/1/1
  // where the qualified form returns 1/2/3.
  it("compares the inner alias against a table-qualified outer column", () => {
    expect(render(duelRankSql)).toContain("ranked.duel_rating > leaderboard.duel_rating");
    expect(render(streakRankSql)).toContain("ranked.max_streak > leaderboard.max_streak");
    expect(render(dailyWinsRankSql)).toContain("ranked.daily_wins > leaderboard.daily_wins");
  });

  // The other silent mis-read on this view: each board has a sibling column
  // one word away that holds an equally plausible number. Ranking the streak
  // board on the (decayed) live streak, or the daily-wins board on duel_wins,
  // parses, runs and returns a wrong rank beside a correctly-ordered board.
  it("ranks each board on the column that board is ordered by, not its sibling", () => {
    expect(render(streakRankSql)).not.toContain("current_streak");
    expect(render(dailyWinsRankSql)).not.toContain("duel_wins");
  });

  it("aliases the inner relation, so the outer name is still there to qualify with", () => {
    expect(render(duelRankSql)).toMatch(/from "leaderboard" as ranked/i);
    expect(render(streakRankSql)).toMatch(/from "leaderboard" as ranked/i);
    expect(render(dailyWinsRankSql)).toMatch(/from "leaderboard" as ranked/i);
  });

  // count() is bigint; the postgres driver returns bigint as a string, so an
  // uncast rank arrives as "3" rather than 3.
  it("casts the count to int, so a rank is a number and not a string", () => {
    expect(render(duelRankSql)).toContain(")::int");
    expect(render(streakRankSql)).toContain(")::int");
    expect(render(dailyWinsRankSql)).toContain(")::int");
  });

  it("counts strictly-higher rows and adds one, so the top row is rank 1", () => {
    expect(render(duelRankSql)).toContain("count(*) + 1");
    expect(render(streakRankSql)).toContain("count(*) + 1");
    expect(render(dailyWinsRankSql)).toContain("count(*) + 1");
  });
});
