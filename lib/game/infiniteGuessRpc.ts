import type { GuessResult } from "@/lib/game/compare";
import type { PoolWindow } from "@/lib/game/poolWindow";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Same shape as lib/db/queries.ts#DriverSummary -- see
// lib/duel/submitGuess.ts's comment on why this is a local copy, not an
// import (that module pulls in the raw Postgres connection, which must never
// reach a client bundle).
export interface InfiniteDriverSummary {
  id: number;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
}

// Replaces app/(game)/infinite/actions.ts#startInfiniteRound -- round state
// used to live in a signed httpOnly cookie (lib/game/session.ts), which
// PostgREST can't see; it's now a row in infinite_rounds keyed by
// auth.uid() (drizzle/0028), so guess evaluation can go through a
// client-callable RPC instead of a Server Action. Throws on failure, same
// as this always did (no explicit error contract existed before either).
export async function startInfiniteRound(poolWindow: PoolWindow): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("infinite_start_round", { p_pool_window: poolWindow });
  if (error) throw error;
}

export type SubmitGuessResult =
  | {
      ok: true;
      guessedDriver: InfiniteDriverSummary;
      result: GuessResult;
      status: "won" | "lost" | "continue";
      target?: InfiniteDriverSummary;
    }
  | { ok: false; error: string };

interface InfiniteSubmitGuessRow {
  status: "won" | "lost" | "continue";
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
  target_nationality: string | null;
  target_team: string | null;
  target_age: number | null;
  target_debut_year: number | null;
  target_career_wins: number | null;
}

// One warm hop straight to Supabase's PostgREST layer -- replaces
// app/(game)/infinite/actions.ts#submitGuess. The RPC (infinite_submit_guess,
// drizzle/0028) forces every target_* column to NULL server-side whenever
// status is 'continue', so there's no path where a mid-round guess response
// carries the real target over the wire -- `target` below is only ever
// populated on 'won'/'lost', matching the old action's contract exactly.
export async function submitGuess(guessedDriverId: number): Promise<SubmitGuessResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("infinite_submit_guess", { p_guess_driver_id: guessedDriverId })
    .single();
  if (error) return { ok: false, error: error.message };
  const row = data as InfiniteSubmitGuessRow;

  return {
    ok: true,
    status: row.status,
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
    target:
      row.target_driver_id === null
        ? undefined
        : {
            id: row.target_driver_id,
            fullName: row.target_full_name!,
            driverCode: row.target_driver_code,
            nationality: row.target_nationality!,
            team: row.target_team!,
            age: row.target_age!,
            debutYear: row.target_debut_year!,
            careerWins: row.target_career_wins!,
          },
  };
}
