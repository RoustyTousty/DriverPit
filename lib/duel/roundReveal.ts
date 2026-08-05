import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// "What actually happened in round N?" -- asked of the server, over the same
// warm one-hop PostgREST path as the guesses and the round lifecycle
// (lib/duel/roundLifecycle.ts), never of the opponent.
//
// This exists because the round_end and match_end broadcasts used to be applied
// exactly as sent (audit 2026-07-30 §3.4 residual). drizzle/0046 made
// duel:{matchId} private, so the sender can only be the other participant --
// but in a rated 1v1 that is precisely the party with a motive: a forged
// round_end ended the victim's live round on an attacker-chosen reveal, points,
// scores and intermission length. Now the broadcast says only *that* the round
// ended, and this says what happened in it.
//
// The `closed` flag is the security property, and it is not the caller's word:
// duel_round_reveal derives it from duel_rounds.intermission_ends_at, which
// only duel_close_round ever stamps. Until a round is genuinely closed there is
// no target, no points and no clock in the response -- so a forged round_end
// mid-round comes back with nothing to apply.
//
// Errors come back as { ok: false, error } rather than throwing, matching
// roundLifecycle.ts and submitGuess.ts so callers keep one way of handling a
// failed duel call.

export interface RoundRevealDriver {
  id: number;
  fullName: string;
  driverCode: string | null;
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
}

// Always populated: the match-level state, which is what match_end
// re-verifies against. winnerId and the deltas are null until the match is
// actually over -- and the deltas stay null for a moment after that, since
// applyMatchRatings is a separate call from closing the round (drizzle/0034).
interface RoundRevealMatchState {
  matchStatus: string;
  currentRound: number;
  winnerId: string | null;
  ratingDeltaA: number | null;
  ratingDeltaB: number | null;
}

export type RoundRevealResult =
  | ({ ok: true; closed: false } & RoundRevealMatchState)
  | ({
      ok: true;
      closed: true;
      // The running score as of the END of this round (summed from
      // duel_round_results, not read off duel_matches -- see the RPC's own
      // note on why those two differ once the next round is under way).
      scoreA: number;
      scoreB: number;
      // This round's own earned points, per side.
      pointsA: number;
      pointsB: number;
      intermissionEndsAt: string;
      targetDriver: RoundRevealDriver;
    } & RoundRevealMatchState)
  | { ok: false; error: string };

interface RoundRevealRow {
  closed: boolean;
  match_status: string;
  current_round: number;
  winner_id: string | null;
  rating_delta_a: number | null;
  rating_delta_b: number | null;
  score_a: number | null;
  score_b: number | null;
  points_a: number | null;
  points_b: number | null;
  intermission_ends_at: string | null;
  target_driver_id: number | null;
  target_full_name: string | null;
  target_driver_code: string | null;
  target_nationality: string | null;
  target_team: string | null;
  target_age: number | null;
  target_debut_year: number | null;
  target_career_wins: number | null;
}

export async function fetchRoundReveal(matchId: number, roundIndex: number): Promise<RoundRevealResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("duel_round_reveal", { p_match_id: matchId, p_round_index: roundIndex })
    .single();

  if (error) return { ok: false, error: error.message || "Failed to read the round result." };

  const row = data as RoundRevealRow;
  const match: RoundRevealMatchState = {
    matchStatus: row.match_status,
    currentRound: row.current_round,
    winnerId: row.winner_id,
    ratingDeltaA: row.rating_delta_a,
    ratingDeltaB: row.rating_delta_b,
  };

  if (!row.closed) return { ok: true, closed: false, ...match };

  return {
    ok: true,
    closed: true,
    ...match,
    // Non-null on this branch by construction: the RPC populates every reveal
    // column in the same RETURN that sets closed = true.
    scoreA: row.score_a!,
    scoreB: row.score_b!,
    pointsA: row.points_a!,
    pointsB: row.points_b!,
    intermissionEndsAt: row.intermission_ends_at!,
    targetDriver: {
      id: row.target_driver_id!,
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
