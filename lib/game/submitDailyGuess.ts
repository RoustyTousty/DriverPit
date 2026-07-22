import type { GuessResult } from "@/lib/game/compare";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Same shape as lib/db/queries.ts#DriverSummary, redeclared here rather than
// imported -- that module pulls in the raw Postgres connection
// (lib/db/index.ts), which must never end up in a client bundle. Same
// reasoning as lib/duel/submitGuess.ts's own local copy.
export interface DailyGuessedDriverSummary {
  id: number;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
}

export type SubmitDailyGuessResult =
  | { ok: true; guessedDriver: DailyGuessedDriverSummary; result: GuessResult; won: boolean }
  | { ok: false; error: string };

// PostgREST's JSON encoding of the RETURNS TABLE row -- numeric columns come
// back as real JS numbers, same as duel_submit_guess (see
// lib/duel/submitGuess.ts's comment on this, verified against the live
// project).
interface DailySubmitGuessRow {
  won: boolean;
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
}

// One warm hop straight to Supabase's PostgREST layer -- no Vercel function
// in the path (see drizzle/0028_daily_infinite_fast_guess_rpc.sql), the
// same client-callable pattern as lib/duel/submitGuess.ts#submitDuelGuessRpc.
// Replaces the old app/(game)/daily/actions.ts#submitDailyGuess Server
// Action, which paid a full Vercel cold start on every single guess.
// Doesn't throw -- returns `{ok:false, error}` instead, matching the old
// action's contract exactly so DailyGame.tsx didn't need a try/catch added.
//
// NOTE: `next dev` compiles routes on first hit, which has nothing to do
// with this RPC's actual round-trip time -- always sanity-check latency
// against a production build (`next build && next start`), never dev.
export async function submitDailyGuess(guessedDriverId: number): Promise<SubmitDailyGuessResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("daily_submit_guess", { p_guess_driver_id: guessedDriverId })
    .single();
  if (error) return { ok: false, error: error.message };
  const row = data as DailySubmitGuessRow;

  return {
    ok: true,
    won: row.won,
    guessedDriver: {
      id: row.guessed_driver_id,
      fullName: row.guessed_full_name,
      driverCode: row.guessed_driver_code,
      nationality: row.guessed_nationality,
      team: row.guessed_team,
      age: row.guessed_age,
      debutYear: row.guessed_debut_year,
      careerWins: row.guessed_career_wins,
    },
    result: {
      nationality: row.nationality,
      team: row.team,
      age: row.age,
      ageCloseness: row.age_closeness ?? undefined,
      debutYear: row.debut_year,
      debutYearCloseness: row.debut_year_closeness ?? undefined,
      careerWins: row.career_wins,
      careerWinsCloseness: row.career_wins_closeness ?? undefined,
    },
  };
}
