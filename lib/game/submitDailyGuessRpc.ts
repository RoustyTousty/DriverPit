import type { GuessResult } from "@/lib/game/compare";
import type { DailyBoardGuess, DailyBoardTarget } from "@/lib/game/dailyBoard";
import { trackGuess } from "@/lib/game/inFlightGuess";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// One warm hop straight to Supabase's PostgREST layer -- no Vercel Server
// Action in the path (see drizzle/0030_daily_state_rpc.sql), the same pattern
// as lib/duel/submitGuess.ts and lib/game/infiniteGuessRpc.ts. daily_submit_guess
// appends to daily_progress and evaluates server-side, returning the single
// duel-shaped guess row; the caller appends it to the board it hydrated from
// daily_state (lib/game/dailyStateRpc.ts), exactly as the duel board appends.
//
// NOTE: measure latency against a production build (`next build && next start`),
// never `next dev` -- dev route/RPC compilation is unrelated to the real hop.

export interface DailySubmitResult {
  // The evaluated guess, in the exact DailyBoardState shape so it can be pushed
  // straight onto board.guesses.
  guess: DailyBoardGuess;
  // Board-level flags after this guess. `won` is true only when THIS guess
  // solved the day; `completed` is won-or-exhausted.
  completed: boolean;
  won: boolean;
  guessesRemaining: number;
  // Non-null only on the guess that ends the day -- the answer stays hidden
  // during play, matching the daily rule (the RPC forces these to NULL until
  // completion, so there's no path to leak the target mid-round).
  target: DailyBoardTarget | null;
}

// PostgREST's JSON encoding of the RETURNS TABLE row (snake_case columns) --
// numeric closeness columns round-trip as genuine JS numbers, same as
// lib/duel/submitGuess.ts verified.
interface DailySubmitGuessRow {
  won: boolean;
  completed: boolean;
  guesses_remaining: number;
  guessed_driver_id: number;
  guessed_full_name: string;
  guessed_driver_code: string | null;
  guessed_nationality: string;
  guessed_team: string;
  guessed_age: number;
  guessed_debut_year: number;
  guessed_career_wins: number;
  nationality: GuessResult["nationality"];
  team: GuessResult["team"];
  age: GuessResult["age"];
  age_closeness: number | null;
  debut_year: GuessResult["debutYear"];
  debut_year_closeness: number | null;
  career_wins: GuessResult["careerWins"];
  career_wins_closeness: number | null;
  target_driver_id: number | null;
  target_full_name: string | null;
  target_driver_code: string | null;
}

// Throws on rejection (unknown driver, or an already-complete/exhausted day) --
// callers catch and surface via the toast system, same as any other
// client-side Supabase call.
export async function submitDailyGuessRpc(guessDriverId: number): Promise<DailySubmitResult> {
  return trackGuess(submitDailyGuess(guessDriverId));
}

// Tracked at this boundary rather than in DailyGame so every caller is covered
// automatically -- sign-out waits for an in-flight append instead of tearing
// the session down mid-write (lib/game/inFlightGuess.ts).
async function submitDailyGuess(guessDriverId: number): Promise<DailySubmitResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("daily_submit_guess", { p_guess_driver_id: guessDriverId })
    .single();
  if (error) throw error;
  const row = data as DailySubmitGuessRow;

  return {
    completed: row.completed,
    won: row.won,
    guessesRemaining: row.guesses_remaining,
    guess: {
      driverId: row.guessed_driver_id,
      name: row.guessed_full_name,
      code: row.guessed_driver_code,
      nationality: row.guessed_nationality,
      team: row.guessed_team,
      age: row.guessed_age,
      debutYear: row.guessed_debut_year,
      careerWins: row.guessed_career_wins,
      tiles: {
        nationality: row.nationality,
        team: row.team,
        age: row.age,
        ageCloseness: row.age_closeness ?? undefined,
        debutYear: row.debut_year,
        debutYearCloseness: row.debut_year_closeness ?? undefined,
        careerWins: row.career_wins,
        careerWinsCloseness: row.career_wins_closeness ?? undefined,
      },
    },
    target:
      row.target_driver_id === null
        ? null
        : {
            driverId: row.target_driver_id,
            name: row.target_full_name!,
            code: row.target_driver_code,
          },
  };
}
