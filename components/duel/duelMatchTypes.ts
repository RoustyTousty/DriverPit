import type { DuelRevealedDriver } from "@/lib/db/duelRpc";

// The vocabulary the duel match machine is written in, in one place so the
// hooks that make up that machine (useDuelLifecycle, useDuelScoreboard,
// useRematchNegotiation) and the component that renders it can share types
// without importing each other. Audit 2026-07-27 §2.3.

export type Phase = "loading" | "playing" | "intermission" | "finished";

// Every state the rematch offer can be in, so the results screen can say which
// one it's in rather than showing one button that means four different things.
// "opponentRequested" is the case that had no signal at all before: the
// opponent's requestRematch only wrote intent to the DB, so this client showed
// a plain "Rematch" button with no hint anyone was waiting on it.
export type RematchState =
  | "idle"
  | "requested" // I asked; waiting on them
  | "opponentRequested" // they asked; I can accept or decline
  | "declined" // either side said no -- terminal for this results screen
  | "opponentGone"; // they left; nothing to wait for

// How the match reached "finished" -- drives the results panel's subtitle
// ("You forfeited" / "Opponent left — you win.") and whether Rematch makes
// sense to offer.
export type MatchEndReason = "completed" | "forfeitMe" | "forfeitOpponent";

export interface LocalRound {
  roundIndex: number;
  startedAt: string;
  endsAt: string;
}

// Everything the intermission screen (DuelIntermission) needs, built either
// from this client's own closeRound response (it triggered the transition)
// or from a received round_end/match_end broadcast (the opponent did) --
// see checkRoundTransition and the onRoundEnd/onMatchEnd handlers in
// useDuelLifecycle. winnerId/ratingDelta* are only meaningful when
// isLastRound; on the receiving side they start null and are filled in by
// onMatchEnd, which arrives moments after round_end over the same connection.
export interface IntermissionState {
  roundIndex: number;
  nextRoundIndex: number | null;
  isLastRound: boolean;
  targetDriver: DuelRevealedDriver;
  pointsA: number;
  pointsB: number;
  scoreA: number;
  scoreB: number;
  startScoreA: number;
  startScoreB: number;
  intermissionEndsAt: string;
  winnerId: string | null;
  ratingDeltaA: number | null;
  ratingDeltaB: number | null;
}

// The opponent, abstracted -- never their guessed driver, never the target.
// Guess count and a 0-1 heat are the whole of what crosses the wire.
export interface OpponentProgress {
  guessCount: number;
  bestHeat: number;
  provisionalPoints: number;
  solved: boolean;
  solvedPoints: number | null;
}

export const EMPTY_OPPONENT_PROGRESS: OpponentProgress = {
  guessCount: 0,
  bestHeat: 0,
  provisionalPoints: 0,
  solved: false,
  solvedPoints: null,
};
