import { and, eq, inArray, sql } from "drizzle-orm";

import { compare, isWin } from "../game/compare";
import { MAX_GUESSES } from "../game/constants";
import {
  buildDailyBoard,
  replayLocalGuesses,
  type DailyBoardDriver,
  type DailyBoardState,
} from "../game/dailyBoard";
import { DAILY_POOL_WINDOW } from "../game/poolWindow";
import { recordDailyResultForUser } from "../stats/recordDailyResult";
import { db } from "./index";
import { getDailyDriverId, type DriverRow } from "./queries";
import { dailyProgress, drivers } from "./schema";

// Server-authoritative daily board (CLAUDE.md "Daily persistence & sync"),
// implemented as functions on the trusted Drizzle connection rather than a
// Postgres RPC. Two non-negotiables drive that choice:
//   - tiles are recomputed with the existing lib/game/compare.ts, the single
//     source of truth for comparison rules -- doing it in SQL would mean a
//     second port to keep in parity (the fast per-guess RPC in drizzle/0028
//     already pays that cost via compare_drivers; the persistence path
//     deliberately does not add another).
//   - completion must "call the existing recordDailyResult path"; that path is
//     TS on the same connection (recordDailyResultForUser).
// A separate "use server" wrapper (dailyProgressActions.ts) resolves the user
// from auth and calls these. These take the user id explicitly so they stay
// unit/integration testable without a Next.js request (cookies) context.

// A drizzle Drivers row carries lastTeam (nullable); compare() wants a plain
// `team` string. Mirrors lib/db/queries.ts#toGameDriver's `?? ""`.
function toBoardDriver(row: DriverRow): DailyBoardDriver {
  return {
    id: row.id,
    fullName: row.fullName,
    driverCode: row.driverCode,
    nationality: row.nationality,
    team: row.lastTeam ?? "",
    previousTeams: row.previousTeams,
    dateOfBirth: row.dateOfBirth,
    dateOfDeath: row.dateOfDeath,
    debutYear: row.debutYear,
    careerWins: row.careerWins,
  };
}

// The UTC day, resolved from the DATABASE clock -- never the caller. A
// client-supplied date is a one-line way to re-roll the day by moving a device
// clock (CLAUDE.md: "The date comes from the database"). Cast to text so it
// comes back as a stable 'YYYY-MM-DD' string, matching the date column's mode.
async function resolveUtcDate(): Promise<string> {
  const rows = await db.execute<{ today: string }>(
    sql`SELECT (now() AT TIME ZONE 'utc')::date::text AS today`,
  );
  return rows[0].today;
}

async function todaysTargetId(date: string): Promise<number> {
  // referenceYear from the DB date (not Node's clock) so the -10y pool cutoff
  // agrees with the resolved day.
  const referenceYear = Number(date.slice(0, 4));
  return getDailyDriverId(DAILY_POOL_WINDOW, referenceYear, date);
}

// Recompute the full board from stored ids: fetch every driver referenced (the
// guesses plus the target) once, then run the pure builder. The target is
// included in the fetch but only surfaced by buildDailyBoard once the day is
// complete.
async function buildBoardFromIds(
  guessIds: number[],
  targetId: number,
): Promise<DailyBoardState> {
  const neededIds = Array.from(new Set([...guessIds, targetId]));
  const rows = await db.select().from(drivers).where(inArray(drivers.id, neededIds));
  const driverById = new Map<number, DailyBoardDriver>(
    rows.map((row) => [row.id, toBoardDriver(row)]),
  );

  const target = driverById.get(targetId);
  if (!target) throw new Error("No puzzle is scheduled for today.");

  return buildDailyBoard({
    guessIds,
    driverById,
    target,
    today: new Date(),
    maxGuesses: MAX_GUESSES,
  });
}

// Hydration: the authoritative board for this user's current UTC day. A user
// with no row yet gets a fresh, empty (playable) board. Read-only.
export async function dailyStateFor(userId: string): Promise<DailyBoardState> {
  const date = await resolveUtcDate();
  const targetId = await todaysTargetId(date);

  const [row] = await db
    .select()
    .from(dailyProgress)
    .where(and(eq(dailyProgress.userId, userId), eq(dailyProgress.date, date)));

  return buildBoardFromIds(row?.guesses ?? [], targetId);
}

export interface DailySubmitOutcome {
  board: DailyBoardState;
  // True only when THIS call appended the guess that completed the day -- the
  // signal the caller uses to know a stats write just happened (already done
  // here) vs. a rejected resubmit.
  justCompleted: boolean;
}

// Append one guess server-side. The guess index is the array position -- the
// caller never sends an index or a count. Rejects (returns current state, does
// not throw) if the day is already complete or the guess cap is reached, which
// is the anti-replay / anti-second-attempt guard. On the completing guess it
// marks the row complete and records stats through the shared idempotency
// guard, so streaks can't be double-counted by a replay or a second device.
export async function dailySubmitGuessFor(
  userId: string,
  guessDriverId: number,
): Promise<DailySubmitOutcome> {
  const date = await resolveUtcDate();
  const targetId = await todaysTargetId(date);

  // Everything that mutates the row happens under a row lock so two devices
  // guessing at once serialize and converge instead of forking the board.
  const { guessIds, justCompleted, won } = await db.transaction(async (tx) => {
    // Ensure the row exists, then take it FOR UPDATE. onConflictDoNothing keeps
    // this safe under the concurrent-first-guess race.
    await tx.insert(dailyProgress).values({ userId, date, guesses: [] }).onConflictDoNothing();

    const [row] = await tx
      .select()
      .from(dailyProgress)
      .where(and(eq(dailyProgress.userId, userId), eq(dailyProgress.date, date)))
      .for("update");

    // The server has already concluded this day: hand back current state
    // untouched. Never append onto a completed day -- that's precisely how a
    // player would get a second attempt.
    if (row.completed || row.guesses.length >= MAX_GUESSES) {
      return { guessIds: row.guesses, justCompleted: false, won: row.won ?? false };
    }

    const [guessRow] = await tx.select().from(drivers).where(eq(drivers.id, guessDriverId));
    if (!guessRow) {
      // Mirrors the fast RPC's rejection of an off-list id.
      throw new Error("Pick a driver from the suggestions list.");
    }
    const [targetRow] = await tx.select().from(drivers).where(eq(drivers.id, targetId));
    if (!targetRow) {
      throw new Error("No puzzle is scheduled for today.");
    }

    const newGuessIds = [...row.guesses, guessDriverId];
    // Win/completion derived from the freshly scored guess -- tiles are never
    // stored, only the resulting completed/won flags are.
    const solved = isWin(compare(toBoardDriver(guessRow), toBoardDriver(targetRow), new Date()));
    const completed = solved || newGuessIds.length >= MAX_GUESSES;

    await tx
      .update(dailyProgress)
      .set({
        guesses: newGuessIds,
        completed,
        won: completed ? solved : null,
        updatedAt: new Date(),
      })
      .where(and(eq(dailyProgress.userId, userId), eq(dailyProgress.date, date)));

    return { guessIds: newGuessIds, justCompleted: completed, won: solved };
  });

  // After the completed row is durable, flow stats through the existing guard.
  // Keyed on the same DB date the board uses, and idempotent, so a retry here
  // (or the cookie-path recordDailyResult) can't inflate the count.
  if (justCompleted) {
    await recordDailyResultForUser(userId, won, guessIds.length, date);
  }

  return { board: await buildBoardFromIds(guessIds, targetId), justCompleted };
}

// Carry pre-existing local daily progress (guessed driver ids from before
// server-side daily progress existed) onto the account for the current UTC day
// -- CLAUDE.md "Precedence and merge". Server precedence is absolute: the local
// guesses are adopted ONLY if there is no daily_progress row for the day yet.
// If a row already exists it wins untouched -- local is never appended onto a
// server row, and never onto a completed day, so this can't hand anyone a
// second attempt.
//
// Completed/won are re-derived here by scoring the local guesses against
// today's target (never trusting the local "status"), so a stored row's
// `completed` flag is always accurate -- otherwise dailySubmitGuessFor's
// reject check could let a locally-solved day be guessed again. Stats are
// deliberately NOT recorded: a completed legacy day is already accounted for by
// the aggregate stats fold-in (lib/stats -> migrateLocalStats), so recording it
// here too would double-count.
export async function migrateLocalDailyFor(
  userId: string,
  localGuessIds: number[],
): Promise<{ migrated: boolean }> {
  if (localGuessIds.length === 0) return { migrated: false };

  const date = await resolveUtcDate();
  const targetId = await todaysTargetId(date);

  const neededIds = Array.from(new Set([...localGuessIds, targetId]));
  const rows = await db.select().from(drivers).where(inArray(drivers.id, neededIds));
  const driverById = new Map<number, DailyBoardDriver>(rows.map((row) => [row.id, toBoardDriver(row)]));
  const target = driverById.get(targetId);
  if (!target) return { migrated: false };

  // Re-derive the authoritative guesses + completed/won by scoring the local
  // ids against today's target (never trusting the local "status").
  const { accepted, completed, won } = replayLocalGuesses({
    localGuessIds,
    driverById,
    target,
    today: new Date(),
    maxGuesses: MAX_GUESSES,
  });
  if (accepted.length === 0) return { migrated: false };

  // The existing-row check plus ON CONFLICT DO NOTHING makes server precedence
  // race-safe: a row that is already there (in any state), or created
  // concurrently, always wins and local is discarded.
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ userId: dailyProgress.userId })
      .from(dailyProgress)
      .where(and(eq(dailyProgress.userId, userId), eq(dailyProgress.date, date)));
    if (existing) return { migrated: false };

    const inserted = await tx
      .insert(dailyProgress)
      .values({ userId, date, guesses: accepted, completed, won: completed ? won : null })
      .onConflictDoNothing()
      .returning({ userId: dailyProgress.userId });

    return { migrated: inserted.length > 0 };
  });
}
