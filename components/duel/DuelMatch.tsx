"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { Profile } from "@/components/auth/AuthProvider";
import type { DriverOption } from "@/components/game/DriverAutocomplete";
import type { Guess } from "@/components/game/GuessGrid";
import {
  getDuelRoundState,
  submitDuelGuess,
  tryAdvanceRound,
  type TryAdvanceRoundResult,
} from "@/lib/duel/actions";
import type { MatchResult } from "@/lib/duel/matchmaking";
import {
  MATCH_END_EVENT,
  ROUND_START_EVENT,
  SCORE_UPDATE_EVENT,
  duelChannelName,
  type MatchEndPayload,
  type RoundStartPayload,
  type ScoreUpdatePayload,
} from "@/lib/duel/liveMatch";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { MatchFoundReveal } from "./MatchFoundReveal";
import { RoundPlay } from "./RoundPlay";
import { useServerCountdown } from "./useServerCountdown";

const POLL_INTERVAL_MS = 5_000;

interface LocalRound {
  roundIndex: number;
  startedAt: string;
  endsAt: string;
}

type Phase = "loading" | "playing" | "finished";

export function DuelMatch({
  me,
  match,
  eligibleDrivers,
}: {
  me: Profile;
  match: MatchResult;
  eligibleDrivers: DriverOption[];
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [round, setRound] = useState<LocalRound | null>(null);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [myGuesses, setMyGuesses] = useState<Guess[]>([]);
  const [mySolved, setMySolved] = useState(false);
  const [pendingGuess, setPendingGuess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const roundIndexRef = useRef(-1);
  const expiredHandledRef = useRef<number | null>(null);

  const isPlayerA = match.youAre === "a";
  const remainingToStart = useServerCountdown(round?.startedAt ?? null, clockOffsetMs);
  const remainingToEnd = useServerCountdown(round?.endsAt ?? null, clockOffsetMs);
  const isPreRound = round !== null && remainingToStart > 0;

  function adoptRound(data: RoundStartPayload) {
    if (data.roundIndex <= roundIndexRef.current) return; // stale/duplicate broadcast
    roundIndexRef.current = data.roundIndex;
    setRound(data);
    setMyGuesses([]);
    setMySolved(false);
    setError(null);
  }

  function broadcast(event: string, payload: unknown) {
    try {
      void channelRef.current?.send({ type: "broadcast", event, payload });
    } catch (err) {
      // Best-effort -- the periodic poll and each client's own local
      // countdown are the real fallback, not this send succeeding.
      console.error(`duel broadcast failed (match ${match.matchId}, event ${event})`, err);
    }
  }

  function applyAdvanceResult(res: TryAdvanceRoundResult) {
    if (!res.ok || !res.advanced) return;
    if (res.matchFinished) {
      setScoreA(res.scoreA);
      setScoreB(res.scoreB);
      setWinnerId(res.winnerId);
      setPhase("finished");
      broadcast(MATCH_END_EVENT, { winnerId: res.winnerId, scoreA: res.scoreA, scoreB: res.scoreB } satisfies MatchEndPayload);
    } else {
      setScoreA(res.scoreA);
      setScoreB(res.scoreB);
      adoptRound(res.round);
      broadcast(ROUND_START_EVENT, res.round satisfies RoundStartPayload);
    }
  }

  // Mount once per match: calibrate clock offset off a single round trip,
  // load current round state, and subscribe to the match's broadcast
  // channel for round-start / score-update / match-end pushed by whichever
  // client's action call actually causes them.
  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(duelChannelName(match.matchId));
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
      .on("broadcast", { event: MATCH_END_EVENT }, ({ payload }) => {
        const data = payload as MatchEndPayload;
        setScoreA(data.scoreA);
        setScoreB(data.scoreB);
        setWinnerId(data.winnerId);
        setPhase("finished");
      })
      .subscribe();

    void (async () => {
      const t0 = Date.now();
      const state = await getDuelRoundState(match.matchId);
      const t1 = Date.now();
      if (cancelled) return;
      if (!state.ok) {
        setError(state.error);
        return;
      }

      setClockOffsetMs(new Date(state.serverNow).getTime() - (t0 + t1) / 2);
      setScoreA(state.scoreA);
      setScoreB(state.scoreB);

      if (state.matchStatus === "finished") {
        setWinnerId(state.winnerId);
        setPhase("finished");
        return;
      }

      adoptRound({ roundIndex: state.roundIndex, startedAt: state.startedAt, endsAt: state.endsAt });
      setMySolved(state.mySolved);
      setPhase("playing");
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.matchId]);

  // The round timer expiring is exactly the "timer expired" half of
  // "client observes both players done or the timer expired" -- fire the
  // idempotent advance attempt once per round, whether or not I solved.
  useEffect(() => {
    if (phase !== "playing" || !round || remainingToEnd > 0) return;
    if (expiredHandledRef.current === round.roundIndex) return;
    expiredHandledRef.current = round.roundIndex;
    void tryAdvanceRound(match.matchId).then(applyAdvanceResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingToEnd, phase, round, match.matchId]);

  // Safety-net poll: covers a missed broadcast (dropped connection,
  // backgrounded tab) without needing a server-side sweep for v1 -- calling
  // tryAdvanceRound when nothing has actually changed is a cheap no-op.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = setInterval(() => {
      void tryAdvanceRound(match.matchId).then(applyAdvanceResult);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, match.matchId]);

  async function handleGuess(driver: DriverOption) {
    setError(null);
    setPendingGuess(true);
    const res = await submitDuelGuess(match.matchId, driver.id);
    setPendingGuess(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    setMyGuesses((prev) => [...prev, { guessedDriver: res.guessedDriver, result: res.result }]);

    if (res.won) {
      setMySolved(true);
      setScoreA(res.scoreA);
      setScoreB(res.scoreB);
      broadcast(SCORE_UPDATE_EVENT, { scoreA: res.scoreA, scoreB: res.scoreB } satisfies ScoreUpdatePayload);
      const advanceRes = await tryAdvanceRound(match.matchId);
      applyAdvanceResult(advanceRes);
    }
  }

  if (phase === "loading") {
    return <p className="py-10 text-center text-sm text-text-muted">Loading match…</p>;
  }

  if (error && phase !== "playing") {
    return <p className="py-10 text-center text-sm text-red-400">{error}</p>;
  }

  if (phase === "finished") {
    const myFinalScore = isPlayerA ? scoreA : scoreB;
    const opponentFinalScore = isPlayerA ? scoreB : scoreA;
    const isDraw = winnerId === null;
    const iWon = winnerId === me.id;

    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className={`text-2xl font-bold ${iWon ? "text-accent" : "text-text"}`}>
          {isDraw ? "Draw" : iWon ? "You won!" : "You lost"}
        </p>
        <p className="font-mono text-lg tabular-nums text-text-muted">
          {myFinalScore} — {opponentFinalScore}
        </p>
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
          opponent={{
            username: match.opponentUsername,
            displayName: match.opponentDisplayName,
            avatarUrl: match.opponentAvatarUrl,
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
      eligibleDrivers={eligibleDrivers}
      onGuess={(driver) => void handleGuess(driver)}
      disabled={pendingGuess}
      mySolved={mySolved}
      error={error}
    />
  );
}
