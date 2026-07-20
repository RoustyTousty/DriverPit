"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { Profile } from "@/components/auth/AuthProvider";
import type { DriverOption } from "@/components/game/DriverAutocomplete";
import { useToast } from "@/components/ui/Toast";
import {
  getDuelRoundState,
  requestRematch,
  submitDuelGuess,
  tryAdvanceRound,
  type TryAdvanceRoundResult,
} from "@/lib/duel/actions";
import {
  MATCH_END_EVENT,
  OPPONENT_PROGRESS_EVENT,
  REMATCH_READY_EVENT,
  ROUND_START_EVENT,
  SCORE_UPDATE_EVENT,
  duelChannelName,
  type MatchEndPayload,
  type OpponentProgressPayload,
  type RematchReadyPayload,
  type RoundStartPayload,
  type ScoreUpdatePayload,
} from "@/lib/duel/liveMatch";
import type { MatchResult } from "@/lib/duel/matchmaking";
import { guessHeat } from "@/lib/game/duelScoring";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { useActiveMatch } from "./ActiveMatchContext";
import type { RankedGuess } from "./ClosestGuessesBoard";
import { MatchFoundReveal } from "./MatchFoundReveal";
import { RoundResultCards, type RoundResult } from "./RoundResultCards";
import { RoundPlay } from "./RoundPlay";
import { useServerCountdown } from "./useServerCountdown";

const POLL_INTERVAL_MS = 5_000;

interface LocalRound {
  roundIndex: number;
  startedAt: string;
  endsAt: string;
}

type Phase = "loading" | "playing" | "finished";
type RematchState = "idle" | "requested";

const EMPTY_OPPONENT_PROGRESS = { guessCount: 0, bestHeat: 0, solved: false };

export function DuelMatch({
  me,
  myRating,
  match,
  eligibleDrivers,
  onFindNewOpponent,
}: {
  me: Profile;
  myRating: number | null;
  match: MatchResult;
  eligibleDrivers: DriverOption[];
  onFindNewOpponent: () => void;
}) {
  const { setActive } = useActiveMatch();
  const toast = useToast();

  const [activeMatch, setActiveMatch] = useState(match);
  const [phase, setPhase] = useState<Phase>("loading");
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [round, setRound] = useState<LocalRound | null>(null);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [myGuesses, setMyGuesses] = useState<RankedGuess[]>([]);
  const [completedRounds, setCompletedRounds] = useState<RoundResult[]>([]);
  const [opponentProgress, setOpponentProgress] = useState(EMPTY_OPPONENT_PROGRESS);
  const [mySolved, setMySolved] = useState(false);
  const [pendingGuess, setPendingGuess] = useState(false);
  // Only for the "match failed to load" case -- there's genuinely nothing
  // else to render then. Guess/rematch failures go to the toast system
  // instead (see handleGuess/handleRematch) so they don't hijack this
  // screen out from under whatever's already showing (e.g. the finished-
  // match summary).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rematchState, setRematchState] = useState<RematchState>("idle");

  const channelRef = useRef<RealtimeChannel | null>(null);
  const roundIndexRef = useRef(-1);
  const expiredHandledRef = useRef<number | null>(null);
  const nextGuessIdRef = useRef(0);
  const scoreARef = useRef(0);
  const scoreBRef = useRef(0);
  const mySolvedRef = useRef(false);

  const isPlayerA = activeMatch.youAre === "a";
  const remainingToStart = useServerCountdown(round?.startedAt ?? null, clockOffsetMs);
  const remainingToEnd = useServerCountdown(round?.endsAt ?? null, clockOffsetMs);
  const isPreRound = round !== null && remainingToStart > 0;

  useEffect(() => {
    scoreARef.current = scoreA;
  }, [scoreA]);
  useEffect(() => {
    scoreBRef.current = scoreB;
  }, [scoreB]);
  useEffect(() => {
    mySolvedRef.current = mySolved;
  }, [mySolved]);

  // A live race is the wrong moment for a banner (CLAUDE.md) -- on for the
  // reveal countdown through the last round, off once loading or finished.
  useEffect(() => {
    setActive(phase === "playing");
    return () => setActive(false);
  }, [phase, setActive]);

  function recordCompletedRound(newScoreA: number, newScoreB: number) {
    const previousRoundIndex = roundIndexRef.current;
    if (previousRoundIndex < 0) return; // first round adopted, nothing preceded it
    const myOldScore = isPlayerA ? scoreARef.current : scoreBRef.current;
    const myNewScore = isPlayerA ? newScoreA : newScoreB;
    setCompletedRounds((prev) => [
      ...prev,
      { roundIndex: previousRoundIndex, solved: mySolvedRef.current, points: myNewScore - myOldScore },
    ]);
  }

  function adoptRound(data: RoundStartPayload) {
    if (data.roundIndex <= roundIndexRef.current) return; // stale/duplicate broadcast
    recordCompletedRound(data.scoreA, data.scoreB);
    roundIndexRef.current = data.roundIndex;
    setRound(data);
    setScoreA(data.scoreA);
    setScoreB(data.scoreB);
    setMyGuesses([]);
    setMySolved(false);
    setOpponentProgress(EMPTY_OPPONENT_PROGRESS);
  }

  function broadcast(event: string, payload: unknown) {
    try {
      void channelRef.current?.send({ type: "broadcast", event, payload });
    } catch (err) {
      // Best-effort -- the periodic poll and each client's own local
      // countdown are the real fallback, not this send succeeding.
      console.error(`duel broadcast failed (match ${activeMatch.matchId}, event ${event})`, err);
    }
  }

  function applyAdvanceResult(res: TryAdvanceRoundResult) {
    if (!res.ok || !res.advanced) return;
    if (res.matchFinished) {
      recordCompletedRound(res.scoreA, res.scoreB);
      setScoreA(res.scoreA);
      setScoreB(res.scoreB);
      setWinnerId(res.winnerId);
      setPhase("finished");
      broadcast(MATCH_END_EVENT, { winnerId: res.winnerId, scoreA: res.scoreA, scoreB: res.scoreB } satisfies MatchEndPayload);
    } else {
      const payload: RoundStartPayload = { ...res.round, scoreA: res.scoreA, scoreB: res.scoreB };
      adoptRound(payload);
      broadcast(ROUND_START_EVENT, payload);
    }
  }

  function transitionToRematch(newMatchId: number) {
    setPhase("loading");
    setRound(null);
    setWinnerId(null);
    setMyGuesses([]);
    setCompletedRounds([]);
    setOpponentProgress(EMPTY_OPPONENT_PROGRESS);
    setMySolved(false);
    setRematchState("idle");
    roundIndexRef.current = -1;
    setActiveMatch((prev) => ({ ...prev, matchId: newMatchId }));
  }

  // Mount once per activeMatch.matchId: calibrate clock offset off a single
  // round trip, load current round state, and subscribe to this match's
  // broadcast channel. Rematching reassigns activeMatch.matchId, which
  // re-runs this whole effect against the new match.
  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(duelChannelName(activeMatch.matchId));
    channelRef.current = channel;

    channel
      .on("broadcast", { event: ROUND_START_EVENT }, ({ payload }) => {
        adoptRound(payload as RoundStartPayload);
      })
      .on("broadcast", { event: SCORE_UPDATE_EVENT }, ({ payload }) => {
        const data = payload as ScoreUpdatePayload;
        setScoreA(data.scoreA);
        setScoreB(data.scoreB);
      })
      .on("broadcast", { event: OPPONENT_PROGRESS_EVENT }, ({ payload }) => {
        const data = payload as OpponentProgressPayload;
        if (data.roundIndex !== roundIndexRef.current) return; // stale, already on a new round
        setOpponentProgress({ guessCount: data.guessCount, bestHeat: data.bestHeat, solved: data.solved });
      })
      .on("broadcast", { event: MATCH_END_EVENT }, ({ payload }) => {
        const data = payload as MatchEndPayload;
        recordCompletedRound(data.scoreA, data.scoreB);
        setScoreA(data.scoreA);
        setScoreB(data.scoreB);
        setWinnerId(data.winnerId);
        setPhase("finished");
      })
      .on("broadcast", { event: REMATCH_READY_EVENT }, ({ payload }) => {
        transitionToRematch((payload as RematchReadyPayload).newMatchId);
      })
      .subscribe();

    void (async () => {
      const t0 = Date.now();
      const state = await getDuelRoundState(activeMatch.matchId);
      const t1 = Date.now();
      if (cancelled) return;
      if (!state.ok) {
        setLoadError(state.error);
        return;
      }

      setClockOffsetMs(new Date(state.serverNow).getTime() - (t0 + t1) / 2);

      if (state.matchStatus === "finished") {
        setScoreA(state.scoreA);
        setScoreB(state.scoreB);
        setWinnerId(state.winnerId);
        setPhase("finished");
        return;
      }

      adoptRound({
        roundIndex: state.roundIndex,
        startedAt: state.startedAt,
        endsAt: state.endsAt,
        scoreA: state.scoreA,
        scoreB: state.scoreB,
      });
      setMySolved(state.mySolved);
      setPhase("playing");
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch.matchId]);

  // The round timer expiring is exactly the "timer expired" half of
  // "client observes both players done or the timer expired" -- fire the
  // idempotent advance attempt once per round, whether or not I solved.
  useEffect(() => {
    if (phase !== "playing" || !round || remainingToEnd > 0) return;
    if (expiredHandledRef.current === round.roundIndex) return;
    expiredHandledRef.current = round.roundIndex;
    void tryAdvanceRound(activeMatch.matchId).then(applyAdvanceResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingToEnd, phase, round, activeMatch.matchId]);

  // Safety-net poll: covers a missed broadcast (dropped connection,
  // backgrounded tab) without needing a server-side sweep for v1 -- calling
  // tryAdvanceRound when nothing has actually changed is a cheap no-op.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = setInterval(() => {
      void tryAdvanceRound(activeMatch.matchId).then(applyAdvanceResult);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, activeMatch.matchId]);

  async function handleGuess(driver: DriverOption) {
    setPendingGuess(true);
    const res = await submitDuelGuess(activeMatch.matchId, driver.id);
    setPendingGuess(false);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }

    const nextGuesses = [...myGuesses, { id: nextGuessIdRef.current++, guessedDriver: res.guessedDriver, result: res.result }];
    setMyGuesses(nextGuesses);

    const bestHeat = Math.max(0, ...nextGuesses.map((g) => guessHeat(g.result)));
    if (round) {
      broadcast(OPPONENT_PROGRESS_EVENT, {
        roundIndex: round.roundIndex,
        guessCount: nextGuesses.length,
        bestHeat,
        solved: res.won,
      } satisfies OpponentProgressPayload);
    }

    if (res.won) {
      setMySolved(true);
      setScoreA(res.scoreA);
      setScoreB(res.scoreB);
      broadcast(SCORE_UPDATE_EVENT, { scoreA: res.scoreA, scoreB: res.scoreB } satisfies ScoreUpdatePayload);
      const advanceRes = await tryAdvanceRound(activeMatch.matchId);
      applyAdvanceResult(advanceRes);
    }
  }

  async function handleRematch() {
    setRematchState("requested");
    const res = await requestRematch(activeMatch.matchId);
    if (!res.ok) {
      toast.error(res.error);
      setRematchState("idle");
      return;
    }
    if (res.newMatchId !== null) {
      broadcast(REMATCH_READY_EVENT, { newMatchId: res.newMatchId } satisfies RematchReadyPayload);
      transitionToRematch(res.newMatchId);
    }
    // else: requested, waiting on the REMATCH_READY_EVENT listener above.
  }

  if (loadError) {
    return <p className="py-10 text-center text-sm text-red-400">{loadError}</p>;
  }

  if (phase === "loading") {
    return <p className="py-10 text-center text-sm text-text-muted">Loading match…</p>;
  }

  if (phase === "finished") {
    const myFinalScore = isPlayerA ? scoreA : scoreB;
    const opponentFinalScore = isPlayerA ? scoreB : scoreA;
    const isDraw = winnerId === null;
    const iWon = winnerId === me.id;

    return (
      <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
        <p className={`text-2xl font-bold ${iWon ? "text-accent" : "text-text"}`}>
          {isDraw ? "Draw" : iWon ? "You won!" : "You lost"}
        </p>
        <p className="font-mono text-lg tabular-nums text-text-muted">
          {myFinalScore} — {opponentFinalScore}
        </p>
        <RoundResultCards results={completedRounds} />

        <div className="flex w-full flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={() => void handleRematch()}
            disabled={rematchState === "requested"}
            className="w-full rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] disabled:opacity-50"
          >
            {rematchState === "requested" ? "Waiting for opponent…" : "Rematch"}
          </button>
          <button
            type="button"
            onClick={onFindNewOpponent}
            className="w-full rounded-lg border border-border px-4 py-3 text-base font-semibold text-text transition hover:bg-surface-2"
          >
            Find new opponent
          </button>
        </div>
      </div>
    );
  }

  if (!round) {
    return <p className="py-10 text-center text-sm text-text-muted">Loading match…</p>;
  }

  if (isPreRound) {
    if (round.roundIndex === 0) {
      return (
        <MatchFoundReveal
          me={me}
          myRating={myRating}
          opponent={{
            username: activeMatch.opponentUsername,
            displayName: activeMatch.opponentDisplayName,
            avatarUrl: activeMatch.opponentAvatarUrl,
            rating: activeMatch.opponentRating,
          }}
          remainingMs={remainingToStart}
        />
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm text-text-muted">Round {round.roundIndex + 1} starting…</p>
        <div className="font-mono text-4xl font-bold tabular-nums text-text">
          {Math.ceil(remainingToStart / 1000)}
        </div>
      </div>
    );
  }

  return (
    <RoundPlay
      roundIndex={round.roundIndex}
      remainingMs={remainingToEnd}
      myScore={isPlayerA ? scoreA : scoreB}
      opponentScore={isPlayerA ? scoreB : scoreA}
      myGuesses={myGuesses}
      completedRounds={completedRounds}
      opponentProgress={opponentProgress}
      eligibleDrivers={eligibleDrivers}
      onGuess={(driver) => void handleGuess(driver)}
      disabled={pendingGuess}
      mySolved={mySolved}
    />
  );
}
