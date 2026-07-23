import { calculateAge, compare, isWin, type Driver, type GuessResult } from "./compare";

// Everything buildDailyBoard needs about one driver: the compare() inputs
// (via `extends Driver`) plus the identity shown on the board. Deliberately a
// superset of compare.ts#Driver so a single fetched row satisfies both the
// comparison and the display without a second lookup.
export interface DailyBoardDriver extends Driver {
  id: number;
  fullName: string;
  driverCode: string | null;
}

// One rendered guess row. `tiles` is the recomputed comparison result -- it is
// NEVER persisted (CLAUDE.md "Daily persistence & sync"); it exists only in
// this derived board. The guessed driver's own display values
// (nationality/team/age/debutYear/careerWins) ride along too so a hydrated
// board renders through the exact same GuessRow as live play, with no second
// lookup client-side -- CLAUDE.md: "Hydration returns tiles + guessed driver
// display data."
export interface DailyBoardGuess {
  driverId: number;
  name: string;
  code: string | null;
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
  tiles: GuessResult;
}

export interface DailyBoardTarget {
  driverId: number;
  name: string;
  code: string | null;
}

// The one shape both daily_state() and daily_submit_guess() return, so a
// client always renders exactly what the server says (server-wins model).
export interface DailyBoardState {
  guesses: DailyBoardGuess[];
  completed: boolean;
  won: boolean;
  guessesRemaining: number;
  // Non-null only once the day is complete -- the answer stays hidden during
  // play, matching the daily rule.
  target: DailyBoardTarget | null;
}

// Completion is a pure function of the tiles produced so far: a win is any row
// matching on all five attributes (only ever the last, since a win ends the
// game and no further guess is appended); otherwise the day completes once
// guesses are exhausted. Kept as one shared helper so the write path (whether
// to mark the row complete + record stats) and the read path
// (buildDailyBoard's target gate) derive "done" identically -- no second
// definition to drift.
export function dailyCompletion(
  tiles: readonly GuessResult[],
  maxGuesses: number,
): { completed: boolean; won: boolean } {
  const won = tiles.some(isWin);
  const completed = won || tiles.length >= maxGuesses;
  return { completed, won };
}

// Replays a list of locally-stored guess ids into the authoritative shape a
// daily_progress row would hold: the accepted ids (truncated at a win, capped
// at maxGuesses) plus the re-derived completed/won. Used when migrating
// pre-server local progress -- the local "status" is never trusted; completion
// is recomputed here so a stored row's `completed` flag is always accurate (a
// locally-solved day must land as completed, or the guess path would let it be
// played again). Unknown ids (a driver no longer in the table) are skipped
// rather than aborting. Pure -- unit tested without a database.
export function replayLocalGuesses(params: {
  localGuessIds: readonly number[];
  driverById: ReadonlyMap<number, DailyBoardDriver>;
  target: DailyBoardDriver;
  today: Date;
  maxGuesses: number;
}): { accepted: number[]; completed: boolean; won: boolean } {
  const { localGuessIds, driverById, target, today, maxGuesses } = params;
  const accepted: number[] = [];
  let completed = false;
  let won = false;

  for (const id of localGuessIds) {
    if (completed || accepted.length >= maxGuesses) break;
    const driver = driverById.get(id);
    if (!driver) continue;
    accepted.push(id);
    if (isWin(compare(driver, target, today))) {
      completed = true;
      won = true;
    } else if (accepted.length >= maxGuesses) {
      completed = true;
    }
  }

  return { accepted, completed, won };
}

// Recomputes the whole board from the stored guess ids. Because tiles are
// never stored, running compare() over the ids against today's target here is
// the single source of truth for what the player sees, on the first device or
// the fifth. Pure -- no DB, no auth -- so the append/gating logic is unit
// testable without a database.
export function buildDailyBoard(params: {
  guessIds: readonly number[];
  driverById: ReadonlyMap<number, DailyBoardDriver>;
  target: DailyBoardDriver;
  today: Date;
  maxGuesses: number;
}): DailyBoardState {
  const { guessIds, driverById, target, today, maxGuesses } = params;

  const guesses: DailyBoardGuess[] = guessIds.map((id) => {
    const driver = driverById.get(id);
    if (!driver) {
      throw new Error(`Guessed driver ${id} not found while building the daily board`);
    }
    return {
      driverId: id,
      name: driver.fullName,
      code: driver.driverCode,
      nationality: driver.nationality,
      // `team` on DailyBoardDriver is the raw compare value ("" for a driver
      // with no last team); show the same "—" the live board does.
      team: driver.team || "—",
      age: calculateAge(driver.dateOfBirth, driver.dateOfDeath, today),
      debutYear: driver.debutYear,
      careerWins: driver.careerWins,
      tiles: compare(driver, target, today),
    };
  });

  const { completed, won } = dailyCompletion(
    guesses.map((g) => g.tiles),
    maxGuesses,
  );

  return {
    guesses,
    completed,
    won,
    guessesRemaining: Math.max(0, maxGuesses - guesses.length),
    target: completed
      ? { driverId: target.id, name: target.fullName, code: target.driverCode }
      : null,
  };
}
