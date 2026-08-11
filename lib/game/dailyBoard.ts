import type { GuessResult } from "./compare";

// The wire contract for the daily board, shared by the two RPC wrappers
// (lib/game/dailyStateRpc.ts, lib/game/submitDailyGuessRpc.ts) and the board
// itself (app/(game)/DailyGame.tsx).
//
// Types only. This module used to also hold the TypeScript board *builder*
// (buildDailyBoard / dailyCompletion / replayLocalGuesses) from when hydration
// ran through a Server Action on the Drizzle connection. The board is now
// rebuilt inside the daily_state() RPC (drizzle/0030), which recomputes tiles
// via the parity-tested SQL compare_drivers -- so the TS builder had no callers
// left and was removed rather than kept as a second, drifting definition of the
// same thing. daily_state() returns exactly the DailyBoardState shape below,
// which is why its keys are camelCase in SQL.

// One rendered guess row. `tiles` is the recomputed comparison result -- it is
// NEVER persisted (CLAUDE.md "Daily persistence & sync"); the stored state is
// the guessed driver ids alone. The guessed driver's own display values ride
// along so a hydrated board renders through the exact same GuessRow as live
// play, with no second lookup client-side.
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

// The one shape both daily_state() and daily_submit_guess() resolve to, so a
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
