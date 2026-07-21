import type { GuessResult } from "@/lib/game/compare";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Same shape as lib/db/queries.ts#DriverSummary, redeclared here rather than
// imported -- that module pulls in the raw Postgres connection (lib/db/index.ts),
// which must never end up in a client bundle. Type-only imports are erased at
// build time and would technically be safe, but a local copy keeps this file's
// only dependency the browser Supabase client.
export interface DuelGuessedDriverSummary {
  id: number;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
}

export interface DuelGuessResult {
  solved: boolean;
  points: number | null;
  bestHeat: number;
  scoreA: number;
  scoreB: number;
  guessedDriver: DuelGuessedDriverSummary;
  result: GuessResult;
}

// PostgREST's JSON encoding of the RETURNS TABLE row -- numeric columns come
// back as genuine JS numbers (verified directly against the live project
// before writing this: a numeric column round-trips through supabase.rpc()
// as `typeof x === "number"`, not a string), so no string-parsing needed.
interface DuelSubmitGuessRow {
  solved: boolean;
  points: number | null;
  best_heat: number;
  score_a: number;
  score_b: number;
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
// anywhere in the path (see drizzle/0022_duel_submit_guess_rpc.sql), the
// same client-callable pattern as lib/duel/matchmaking.ts#matchOrQueue.
// Throws on rejection (round not active, already solved this round, not a
// match participant, unknown driver) -- callers catch and surface via the
// toast system, same as any other client-side Supabase call.
//
// NOTE: `next dev` compiles routes/pages on first hit, which has nothing to
// do with this RPC's actual round-trip time -- always sanity-check latency
// against a production build (`next build && next start`), never dev.
export async function submitDuelGuessRpc(
  matchId: number,
  roundIndex: number,
  guessDriverId: number,
): Promise<DuelGuessResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("duel_submit_guess", {
      p_match_id: matchId,
      p_round_index: roundIndex,
      p_guess_driver_id: guessDriverId,
    })
    .single();
  if (error) throw error;
  const row = data as DuelSubmitGuessRow;

  return {
    solved: row.solved,
    points: row.points,
    bestHeat: row.best_heat,
    scoreA: row.score_a,
    scoreB: row.score_b,
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
