"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RankedGuess } from "./ClosestGuessesBoard";
import { EMPTY_OPPONENT_PROGRESS, type OpponentProgress } from "./duelMatchTypes";
import type { RoundResult } from "./RoundResultCards";

// Everything a duel match keeps SCORE of, with no knowledge of how a round
// starts or ends: the running totals, my guesses for the current round, what
// the opponent's abstracted progress looks like, and the per-round history the
// results screen reads. Extracted from DuelMatch (audit 2026-07-27 §2.3).
//
// The refs are part of the contract, not an implementation detail. Forfeit and
// disconnect handlers fire from async callbacks that were created renders ago,
// and they need the score as it is NOW, not as it was when they were created.
// Same reason useDuelLifecycle keeps a phaseRef.
export interface DuelScoreboard {
  scoreA: number;
  scoreB: number;
  myGuesses: RankedGuess[];
  mySolved: boolean;
  opponentProgress: OpponentProgress;
  completedRounds: RoundResult[];

  scoreARef: React.RefObject<number>;
  scoreBRef: React.RefObject<number>;
  // Points the server actually returned when I solved the current round -- set
  // at solve time, consumed (and reset) by recordCompletedRound, once a round.
  myRoundPointsRef: React.RefObject<number | null>;
  // Ms from round start to my solve. Already computed for the `solved`
  // broadcast; held here too so RoundPlay's solved card can show me my own time
  // instead of making me wait for the intermission to learn it. Null until I
  // solve, and on a resumed round -- duel_state reports *that* I solved, not
  // when, and inventing a time from the current clock would show a number that
  // isn't mine.
  mySolveMsRef: React.RefObject<number | null>;
  // Confirmed score as of the *start* of the current round -- snapshotted by
  // startRound, deliberately never the live scoreA/scoreB. The moment I solve,
  // duel_submit_guess writes my earned points straight into
  // duel_matches.score_a/b (round-close hasn't happened yet, but the RPC still
  // updates the running total immediately) -- so scoreA/scoreB already include
  // this round's points as soon as I solve it, while liveScore's `provisional`
  // argument *also* represents this round's points. Feeding the live totals
  // into liveScore's `confirmedPoints` would double-count the same round once
  // each way; this snapshot is what belongs there instead. It also doubles as
  // the intermission's tug-bar "settle" start position.
  roundStartScoreARef: React.RefObject<number>;
  roundStartScoreBRef: React.RefObject<number>;
  nextGuessIdRef: React.RefObject<number>;

  setScores: (a: number, b: number) => void;
  setMyGuesses: React.Dispatch<React.SetStateAction<RankedGuess[]>>;
  setMySolved: (solved: boolean) => void;
  /** My solve landed: hold the real points and time for the round cards. */
  markMySolve: (points: number, solveMs: number) => void;
  /** Push the round that just ended onto the history the results screen reads. */
  recordCompletedRound: (roundIndex: number, newScoreA: number, newScoreB: number) => void;
  /** Adopt a fresh round: snapshot its opening scores and clear everything per-round. */
  startRound: (scoreA: number, scoreB: number) => void;
  applyOpponentGuess: (progress: Pick<OpponentProgress, "guessCount" | "bestHeat" | "provisionalPoints">) => void;
  applyOpponentSolved: (points: number) => void;
  /** A rematch: same two players, nothing carried over except the running totals,
   *  which the new match's round 0 overwrites with 0/0 when it is adopted. */
  resetForRematch: () => void;
}

export function useDuelScoreboard(isPlayerA: boolean): DuelScoreboard {
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [myGuesses, setMyGuesses] = useState<RankedGuess[]>([]);
  const [mySolved, setMySolved] = useState(false);
  const [opponentProgress, setOpponentProgress] = useState<OpponentProgress>(EMPTY_OPPONENT_PROGRESS);
  const [completedRounds, setCompletedRounds] = useState<RoundResult[]>([]);

  const scoreARef = useRef(0);
  const scoreBRef = useRef(0);
  const mySolvedRef = useRef(false);
  const myRoundPointsRef = useRef<number | null>(null);
  const mySolveMsRef = useRef<number | null>(null);
  const roundStartScoreARef = useRef(0);
  const roundStartScoreBRef = useRef(0);
  const nextGuessIdRef = useRef(0);

  useEffect(() => {
    scoreARef.current = scoreA;
  }, [scoreA]);
  useEffect(() => {
    scoreBRef.current = scoreB;
  }, [scoreB]);
  useEffect(() => {
    mySolvedRef.current = mySolved;
  }, [mySolved]);

  const setScores = useCallback((a: number, b: number) => {
    setScoreA(a);
    setScoreB(b);
  }, []);

  const markMySolve = useCallback((points: number, solveMs: number) => {
    myRoundPointsRef.current = points;
    mySolveMsRef.current = solveMs;
    setMySolved(true);
  }, []);

  const recordCompletedRound = useCallback(
    (roundIndex: number, newScoreA: number, newScoreB: number) => {
      if (roundIndex < 0) return; // first round adopted, nothing preceded it
      const myOldScore = isPlayerA ? scoreARef.current : scoreBRef.current;
      const myNewScore = isPlayerA ? newScoreA : newScoreB;
      // On a solve, markMySolve's setScores already bumped scoreA/BRef to the
      // post-solve value long before the round actually closes (it can sit
      // waiting on the opponent for the rest of the timer) -- by the time we get
      // here old and new score already match, so the delta below would read 0.
      // Prefer the real points the server returned at solve time; the delta is
      // only correct -- and only needed -- for a DNF, where nothing bumped the
      // ref early.
      const points = myRoundPointsRef.current ?? myNewScore - myOldScore;
      setCompletedRounds((prev) => [...prev, { roundIndex, solved: mySolvedRef.current, points }]);
    },
    [isPlayerA],
  );

  const startRound = useCallback((nextScoreA: number, nextScoreB: number) => {
    myRoundPointsRef.current = null;
    mySolveMsRef.current = null;
    roundStartScoreARef.current = nextScoreA;
    roundStartScoreBRef.current = nextScoreB;
    setScoreA(nextScoreA);
    setScoreB(nextScoreB);
    setMyGuesses([]);
    setMySolved(false);
    setOpponentProgress(EMPTY_OPPONENT_PROGRESS);
  }, []);

  const applyOpponentGuess = useCallback(
    (progress: Pick<OpponentProgress, "guessCount" | "bestHeat" | "provisionalPoints">) => {
      setOpponentProgress((prev) => ({ ...prev, ...progress }));
    },
    [],
  );

  const applyOpponentSolved = useCallback((points: number) => {
    setOpponentProgress((prev) => ({ ...prev, solved: true, solvedPoints: points }));
  }, []);

  const resetForRematch = useCallback(() => {
    setMyGuesses([]);
    setCompletedRounds([]);
    setOpponentProgress(EMPTY_OPPONENT_PROGRESS);
    setMySolved(false);
  }, []);

  return {
    scoreA,
    scoreB,
    myGuesses,
    mySolved,
    opponentProgress,
    completedRounds,
    scoreARef,
    scoreBRef,
    myRoundPointsRef,
    mySolveMsRef,
    roundStartScoreARef,
    roundStartScoreBRef,
    nextGuessIdRef,
    setScores,
    setMyGuesses,
    setMySolved,
    markMySolve,
    recordCompletedRound,
    startRound,
    applyOpponentGuess,
    applyOpponentSolved,
    resetForRematch,
  };
}
