"use client";

import { useEffect, useRef, useState } from "react";

import type { Profile } from "@/components/auth/AuthProvider";
import type { DriverOption } from "@/components/game/DriverAutocomplete";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { DuelRevealedDriver } from "@/lib/db/duelRpc";
import {
  beginRound,
  closeRound,
  forfeitMatch,
  getDuelRoundState,
  getDuelState,
  requestRematch,
} from "@/lib/duel/actions";
import { MAX_ROUNDS } from "@/lib/duel/liveMatch";
import type { MatchResult } from "@/lib/duel/matchmaking";
import type { RoundEndPayload, RoundStartPayload } from "@/lib/duel/realtimeEvents";
import { submitDuelGuessRpc } from "@/lib/duel/submitGuess";
import { useDuelChannel } from "@/lib/duel/useDuelChannel";
import { proximityPoints } from "@/lib/game/duelScoring";
import {
  DISCONNECT_GRACE_MS,
  DUEL_POLL_INTERVAL_MS,
  READY_TIMEOUT_MS,
  RESUME_RETRIES_BEFORE_FORCE_BEGIN,
  RESUME_RETRY_MS,
} from "@/lib/game/duelTiming";

import { useActiveMatch } from "./ActiveMatchContext";
import type { RankedGuess } from "./ClosestGuessesBoard";
import { DuelIntermission } from "./DuelIntermission";
import { DuelResults } from "./DuelResults";
import { MatchFoundReveal } from "./MatchFoundReveal";
import type { RoundResult } from "./RoundResultCards";
import { RoundPlay } from "./RoundPlay";
import { useServerCountdown } from "./useServerCountdown";

interface LocalRound {
  roundIndex: number;
  startedAt: string;
  endsAt: string;
}

// Everything the intermission screen (DuelIntermission) needs, built either
// from this client's own closeRound response (it triggered the transition)
// or from a received round_end/match_end broadcast (the opponent did) --
// see checkRoundTransition and the onRoundEnd/onMatchEnd handlers below.
// winnerId/ratingDelta* are only meaningful when isLastRound; on the
// receiving side they start null and are filled in by onMatchEnd, which
// arrives moments after round_end over the same connection.
interface IntermissionState {
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

type Phase = "loading" | "playing" | "intermission" | "finished";
type RematchState = "idle" | "requested";
// How the match reached "finished" -- drives the results panel's subtitle
// ("You forfeited" / "Opponent left — you win.") and whether Rematch makes
// sense to offer.
export type MatchEndReason = "completed" | "forfeitMe" | "forfeitOpponent";

const EMPTY_OPPONENT_PROGRESS = { guessCount: 0, bestHeat: 0, provisionalPoints: 0, solved: false, solvedPoints: null as number | null };

export function DuelMatch({
  me,
  myRating,
  match,
  eligibleDrivers,
  clockOffsetMs,
  onFindNewOpponent,
  onBackToModes,
}: {
  me: Profile;
  myRating: number | null;
  match: MatchResult;
  eligibleDrivers: DriverOption[];
  // Measured once, in DuelRoot (useServerClock), before this component ever
  // mounts -- reused here rather than re-measuring a second, possibly
  // slightly different offset for the same match.
  clockOffsetMs: number;
  onFindNewOpponent: () => void;
  // Results-panel CTA back to the /duel landing (mode select) -- DuelRoot
  // owns that phase state, so it provides the handler.
  onBackToModes: () => void;
}) {
  const { setActive } = useActiveMatch();
  const toast = useToast();

  const [activeMatch, setActiveMatch] = useState(match);
  const [phase, setPhase] = useState<Phase>("loading");
  const [round, setRound] = useState<LocalRound | null>(null);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [myGuesses, setMyGuesses] = useState<RankedGuess[]>([]);
  const [completedRounds, setCompletedRounds] = useState<RoundResult[]>([]);
  const [opponentProgress, setOpponentProgress] = useState(EMPTY_OPPONENT_PROGRESS);
  const [mySolved, setMySolved] = useState(false);
  const [pendingGuess, setPendingGuess] = useState(false);
  const [intermission, setIntermission] = useState<IntermissionState | null>(null);
  // Only for the "match failed to load" case -- there's genuinely nothing
  // else to render then. Guess/rematch failures go to the toast system
  // instead (see handleGuess/handleRematch) so they don't hijack this
  // screen out from under whatever's already showing (e.g. the finished-
  // match summary).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rematchState, setRematchState] = useState<RematchState>("idle");
  const [endReason, setEndReason] = useState<MatchEndReason>("completed");
  const [exitModalOpen, setExitModalOpen] = useState(false);
  // The rematch ready-gate (a rematch match is created as status 'lobby'
  // with no round row -- see requestRematch): true while waiting for both
  // clients to reconfirm ready on the NEW match's channel before
  // duel_begin_round stamps round 0. Same gate pattern as the pre-match
  // staging and each intermission -- the round clock never starts before
  // both players are actually back.
  const [awaitingLobbyGate, setAwaitingLobbyGate] = useState(false);
  const [lobbyGateTimedOut, setLobbyGateTimedOut] = useState(false);
  const lobbyReadySentRef = useRef(false);
  const lobbyBeganRef = useRef(false);

  const roundIndexRef = useRef(-1);
  // Current phase, readable from async forfeit/disconnect handlers without
  // re-subscribing them on every phase change.
  const phaseRef = useRef<Phase>("loading");
  const expiredHandledRef = useRef<number | null>(null);
  const nextGuessIdRef = useRef(0);
  const scoreARef = useRef(0);
  const scoreBRef = useRef(0);
  const mySolvedRef = useRef(false);
  // Points the server actually returned when I solved the current round --
  // set at solve time in handleGuess, consumed (and reset) in
  // recordCompletedRound below, once per round.
  const myRoundPointsRef = useRef<number | null>(null);
  // Confirmed score as of the *start* of the current round -- snapshotted
  // in adoptRound, deliberately never the live scoreA/scoreB state. The
  // moment I solve, duel_submit_guess writes my earned points straight into
  // duel_matches.score_a/b (round-close hasn't happened yet, but the RPC
  // still updates the running total immediately) -- so scoreA/scoreB
  // already include this round's points as soon as I solve it, while
  // liveScore's `provisional` argument *also* represents this round's
  // points (via mySolved). Feeding live scoreA/scoreB into liveScore's
  // `confirmedPoints` would double-count the same round's points once each
  // way; this snapshot is what actually belongs there instead. It also
  // doubles as the intermission's tug-bar "settle" start position.
  const roundStartScoreARef = useRef(0);
  const roundStartScoreBRef = useRef(0);

  const isPlayerA = activeMatch.youAre === "a";
  const remainingToStart = useServerCountdown(round?.startedAt ?? null, clockOffsetMs);
  const remainingToEnd = useServerCountdown(round?.endsAt ?? null, clockOffsetMs);
  const isPreRound = round !== null && remainingToStart > 0;

  // The duel:{matchId} transport (lib/duel/useDuelChannel.ts) -- one
  // subscription for the whole match, not per round; only resets on a
  // rematch's new matchId.
  const channel = useDuelChannel(activeMatch.matchId, me.id, activeMatch.opponentId, {
    onGuess: (payload) => {
      setOpponentProgress((prev) => ({ ...prev, guessCount: payload.guessCount, bestHeat: payload.bestHeat, provisionalPoints: payload.provisionalPoints }));
    },
    onSolved: (payload) => {
      setOpponentProgress((prev) => ({ ...prev, solved: true, solvedPoints: payload.points }));
    },
    onRoundStart: (payload) => {
      if (payload.roundIndex <= roundIndexRef.current) return; // stale/duplicate broadcast

      // The opponent's own ready-gate already won the race and called
      // duel_begin_round -- the round has genuinely started server-side,
      // so catch up immediately instead of insisting on finishing my own
      // gate (which would just leave me drifting behind the timer).
      if (phase === "intermission" && intermission && !intermission.isLastRound && payload.roundIndex === intermission.nextRoundIndex) {
        adoptRound({ roundIndex: payload.roundIndex, startedAt: payload.startedAt, endsAt: payload.endsAt, scoreA: intermission.scoreA, scoreB: intermission.scoreB });
        setIntermission(null);
        setPhase("playing");
        return;
      }

      // Otherwise this is either round 0 handing off from DuelCountdown (no
      // local round adopted yet) or a broadcast that arrived after I'd
      // already missed the round_end that should have preceded it (a
      // dropped-broadcast edge case) -- either way, the round genuinely
      // exists server-side by now (round_start is only ever sent after a
      // successful duel_begin_round), so refetching full state is safe.
      void refreshRoundState();
    },
    onRoundEnd: (payload) => {
      if (payload.roundIndex !== roundIndexRef.current) return; // not the round I'm currently on
      applyRoundEnd({ ...payload, targetDriver: payload.targetDriverPublic });
    },
    onMatchEnd: (payload) => {
      // Only ever meaningful once this client's own onRoundEnd (or its own
      // closeRound call) has already opened the last round's intermission
      // -- just fills in the winner/rating info that round_end's payload
      // doesn't carry. If round_end hasn't arrived yet (round_end and
      // match_end are sent back-to-back over the same connection, so this
      // is rare), this is dropped; the receiving client simply won't show
      // a winner until it independently discovers the match is finished.
      setIntermission((prev) =>
        prev && prev.isLastRound
          ? { ...prev, winnerId: payload.winnerId, ratingDeltaA: payload.ratingDeltaA, ratingDeltaB: payload.ratingDeltaB }
          : prev,
      );
    },
    onRematch: (payload) => {
      // Only meaningful while sitting on the finished screen waiting for
      // the opponent to accept the rematch this client already requested.
      if (phaseRef.current !== "finished") return;
      transitionToRematch(payload.newMatchId);
    },
    onForfeit: (payload) => {
      if (payload.playerId !== activeMatch.opponentId) return;
      // Advisory only -- verify against the server before ending anything.
      // On explicit exit the opponent called duel_forfeit before
      // broadcasting, so the match is already terminal here and we adopt
      // it immediately. On a beforeunload broadcast the RPC may never have
      // run; the match is still live, and the presence-absence grace timer
      // below stays the arbiter (they may just be reloading).
      void (async () => {
        if (phaseRef.current === "finished") return;
        const state = await getDuelState(activeMatch.matchId);
        if (!state.ok || (state.matchStatus !== "abandoned" && state.matchStatus !== "finished")) return;
        adoptTerminal(state.matchStatus, state.winnerId, state.scoreA, state.scoreB);
      })();
    },
  });

  useEffect(() => {
    scoreARef.current = scoreA;
  }, [scoreA]);
  useEffect(() => {
    scoreBRef.current = scoreB;
  }, [scoreB]);
  useEffect(() => {
    mySolvedRef.current = mySolved;
  }, [mySolved]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Shared endpoint for every way a match can end out from under the
  // normal round flow: my own forfeit, the opponent's (broadcast or
  // grace-timer), or resuming onto an already-terminal match. Derives the
  // results panel's reason line from who the abandonment favored.
  function adoptTerminal(status: string, terminalWinnerId: string | null, newScoreA: number, newScoreB: number) {
    if (phaseRef.current === "finished") return;
    phaseRef.current = "finished";
    setScoreA(newScoreA);
    setScoreB(newScoreB);
    setWinnerId(terminalWinnerId);
    setEndReason(status === "abandoned" ? (terminalWinnerId === me.id ? "forfeitOpponent" : "forfeitMe") : "completed");
    setIntermission(null);
    setPhase("finished");
  }

  // Explicit exit (CLAUDE.md: "an Exit control (confirm modal) calls
  // duel_forfeit ... then broadcasts forfeit"). Order matters: settle the
  // match server-side first so the opponent's verify-on-broadcast finds it
  // already terminal.
  async function handleExitConfirm() {
    setExitModalOpen(false);
    const res = await forfeitMatch(activeMatch.matchId);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    channel.broadcastForfeit();
    adoptTerminal(res.status, res.winnerId, scoreARef.current, scoreBRef.current);
  }

  // The disconnect-grace timer's verdict: the opponent left and never came
  // back within DISCONNECT_GRACE_MS -- forfeit on their behalf (idempotent;
  // if the match actually ended normally in the meantime, duel_forfeit
  // reports that settled state instead and we adopt it as-is).
  async function declareOpponentForfeit() {
    if (phaseRef.current === "finished") return;
    const res = await forfeitMatch(activeMatch.matchId, activeMatch.opponentId);
    if (!res.ok) return; // transient failure -- the grace effect re-arms while they're still absent
    adoptTerminal(res.status, res.winnerId, scoreARef.current, scoreBRef.current);
  }

  // A live race is the wrong moment for a banner (CLAUDE.md: "hide the ad
  // slot ... through the whole match"). DuelRoot now hands off to this
  // component only once the round is already live (its own lights-out
  // countdown already ran GO), so "loading" here is a brief in-flight fetch
  // squarely inside the match experience, not a separate pre-round beat --
  // ads stay off through it too, back on only once the match is finished
  // (the results screen is back in the site shell).
  useEffect(() => {
    setActive(phase !== "finished");
    return () => setActive(false);
  }, [phase, setActive]);

  function recordCompletedRound(newScoreA: number, newScoreB: number) {
    const previousRoundIndex = roundIndexRef.current;
    if (previousRoundIndex < 0) return; // first round adopted, nothing preceded it
    const myOldScore = isPlayerA ? scoreARef.current : scoreBRef.current;
    const myNewScore = isPlayerA ? newScoreA : newScoreB;
    // On a solve, handleGuess's setScoreA/setScoreB already bumped
    // scoreA/BRef to the post-solve value long before the round actually
    // closes (it can sit waiting on the opponent for the rest of the
    // timer) -- by the time we get here old and new score already match,
    // so the delta below would read 0. Prefer the real points the server
    // returned at solve time; the delta is only correct -- and only
    // needed -- for a DNF, where nothing bumped the ref early.
    const points = myRoundPointsRef.current ?? myNewScore - myOldScore;
    setCompletedRounds((prev) => [
      ...prev,
      { roundIndex: previousRoundIndex, solved: mySolvedRef.current, points },
    ]);
  }

  function adoptRound(data: LocalRound & { scoreA: number; scoreB: number }) {
    if (data.roundIndex <= roundIndexRef.current) return; // stale/duplicate
    // Any adopted round means the lobby gate (if one was pending) is moot
    // -- the round exists server-side, however it got stamped.
    setAwaitingLobbyGate(false);
    recordCompletedRound(data.scoreA, data.scoreB);
    myRoundPointsRef.current = null;
    roundStartScoreARef.current = data.scoreA;
    roundStartScoreBRef.current = data.scoreB;
    roundIndexRef.current = data.roundIndex;
    setRound({ roundIndex: data.roundIndex, startedAt: data.startedAt, endsAt: data.endsAt });
    setScoreA(data.scoreA);
    setScoreB(data.scoreB);
    setMyGuesses([]);
    setMySolved(false);
    setOpponentProgress(EMPTY_OPPONENT_PROGRESS);
  }

  // Re-fetches full authoritative state (round timing, scores, my own solve
  // status) and adopts it -- used both for the initial mount and whenever a
  // round_start broadcast signals a transition happened that this client
  // didn't itself perform (and isn't already mid-intermission for).
  async function refreshRoundState() {
    const state = await getDuelRoundState(activeMatch.matchId);
    if (!state.ok) {
      setLoadError(state.error);
      return;
    }
    if (state.matchStatus === "finished" || state.matchStatus === "abandoned") {
      recordCompletedRound(state.scoreA, state.scoreB);
      adoptTerminal(state.matchStatus, state.winnerId, state.scoreA, state.scoreB);
      return;
    }
    adoptRound({ roundIndex: state.roundIndex, startedAt: state.startedAt, endsAt: state.endsAt, scoreA: state.scoreA, scoreB: state.scoreB });
    setMySolved(state.mySolved);
    setIntermission(null);
    setPhase("playing");
  }

  // Shared by checkRoundTransition (this client triggered the close) and
  // the onRoundEnd handler (the opponent did) -- opens CLAUDE.md's Duel
  // "Intermission" beat: the reveal, point count-up, and tug settle stay
  // on screen for the full server-stamped intermissionEndsAt before a
  // fresh ready-gate (see DuelIntermission) gets to the next round.
  function applyRoundEnd(data: {
    roundIndex: number;
    targetDriver: DuelRevealedDriver;
    pointsA: number;
    pointsB: number;
    scoreA: number;
    scoreB: number;
    intermissionEndsAt: string;
  }) {
    const isLastRound = data.roundIndex >= MAX_ROUNDS - 1;
    setIntermission({
      roundIndex: data.roundIndex,
      nextRoundIndex: isLastRound ? null : data.roundIndex + 1,
      isLastRound,
      targetDriver: data.targetDriver,
      pointsA: data.pointsA,
      pointsB: data.pointsB,
      scoreA: data.scoreA,
      scoreB: data.scoreB,
      startScoreA: roundStartScoreARef.current,
      startScoreB: roundStartScoreBRef.current,
      intermissionEndsAt: data.intermissionEndsAt,
      winnerId: null,
      ratingDeltaA: null,
      ratingDeltaB: null,
    });
    setPhase("intermission");
  }

  // Closes out the match's current round (public.duel_close_round,
  // idempotent) whenever this client observes both players done or the
  // timer expired, and opens the intermission -- relaying round_end (and
  // match_end, on the last round) so the opponent's client opens the same
  // intermission without waiting for its own poll.
  async function checkRoundTransition(closingRoundIndex: number) {
    const res = await closeRound(activeMatch.matchId, closingRoundIndex);
    if (!res.ok || !res.advanced) return;

    applyRoundEnd({
      roundIndex: res.roundIndex,
      targetDriver: res.targetDriver,
      pointsA: res.pointsA,
      pointsB: res.pointsB,
      scoreA: res.scoreA,
      scoreB: res.scoreB,
      intermissionEndsAt: res.intermissionEndsAt,
    });

    channel.broadcastRoundEnd({
      roundIndex: res.roundIndex,
      targetDriverPublic: res.targetDriver,
      pointsA: res.pointsA,
      pointsB: res.pointsB,
      scoreA: res.scoreA,
      scoreB: res.scoreB,
      intermissionEndsAt: res.intermissionEndsAt,
    } satisfies RoundEndPayload);

    if (res.matchFinished) {
      setIntermission((prev) =>
        prev ? { ...prev, winnerId: res.winnerId, ratingDeltaA: res.ratingDeltaA, ratingDeltaB: res.ratingDeltaB } : prev,
      );
      channel.broadcastMatchEnd({
        winnerId: res.winnerId,
        scoreA: res.scoreA,
        scoreB: res.scoreB,
        ratingDeltaA: res.ratingDeltaA,
        ratingDeltaB: res.ratingDeltaB,
        // Per-round opponent breakdown isn't tracked locally yet -- nothing
        // reads this field until the results screen exists (a later
        // prompt); RoundResultCards renders from completedRounds (this
        // client's own view), not from this broadcast.
        breakdown: [],
      });
    }
  }

  // DuelIntermission's onDone -- called once the mini-countdown (and, for
  // a non-final round, the fresh ready-gate) resolves. Decides what "done"
  // means: begin the next round, or move to the match-end screen.
  async function proceedFromIntermission() {
    if (!intermission) return;

    if (intermission.isLastRound) {
      recordCompletedRound(intermission.scoreA, intermission.scoreB);
      setScoreA(intermission.scoreA);
      setScoreB(intermission.scoreB);
      setWinnerId(intermission.winnerId);
      setIntermission(null);
      setPhase("finished");
      return;
    }

    const begin = await beginRound(activeMatch.matchId, intermission.nextRoundIndex!);
    if (!begin.ok) {
      toast.error(begin.error);
      return;
    }
    adoptRound({ roundIndex: begin.roundIndex, startedAt: begin.startedAt, endsAt: begin.endsAt, scoreA: intermission.scoreA, scoreB: intermission.scoreB });
    channel.broadcastRoundStart({
      roundIndex: begin.roundIndex,
      startedAt: begin.startedAt,
      endsAt: begin.endsAt,
    } satisfies RoundStartPayload);
    setIntermission(null);
    setPhase("playing");
  }

  function transitionToRematch(newMatchId: number) {
    setPhase("loading");
    setRound(null);
    setWinnerId(null);
    setMyGuesses([]);
    setCompletedRounds([]);
    setOpponentProgress(EMPTY_OPPONENT_PROGRESS);
    setMySolved(false);
    setIntermission(null);
    setRematchState("idle");
    setEndReason("completed");
    setExitModalOpen(false);
    setAwaitingLobbyGate(false);
    setLobbyGateTimedOut(false);
    lobbyReadySentRef.current = false;
    lobbyBeganRef.current = false;
    roundIndexRef.current = -1;
    phaseRef.current = "loading";
    setActiveMatch((prev) => ({ ...prev, matchId: newMatchId }));
  }

  // Mount once per activeMatch.matchId: rehydrate from duel_state
  // (CLAUDE.md "Resume") -- also runs for a rematch's fresh matchId. Unlike
  // the old getDuelRoundState loader this handles every beat a reload can
  // land on: a terminal match adopts its result (never re-enters play), a
  // stamped round adopts the corrected clock, and the between-rounds gap
  // (status 'intermission', next round not stamped) retries until the
  // opponent's ready-gate stamps it -- or, if it never does because BOTH
  // clients reloaded mid-intermission and nobody's gate survived, stamps
  // it itself after RESUME_RETRIES_BEFORE_FORCE_BEGIN quiet retries.
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setLoadError(null);

    async function load(attempt: number) {
      const state = await getDuelState(activeMatch.matchId);
      if (cancelled) return;
      if (!state.ok) {
        setLoadError(state.error);
        return;
      }
      if (state.matchStatus === "finished" || state.matchStatus === "abandoned") {
        adoptTerminal(state.matchStatus, state.winnerId, state.scoreA, state.scoreB);
        return;
      }
      if (state.startedAt !== null && state.endsAt !== null) {
        adoptRound({ roundIndex: state.currentRound, startedAt: state.startedAt, endsAt: state.endsAt, scoreA: state.scoreA, scoreB: state.scoreB });
        setMySolved(state.mySolved);
        setPhase("playing");
        return;
      }
      // Status 'lobby' with no round: a rematch (or a resumed pre-round
      // match) -- round 0 must not be stamped until both clients pass the
      // ready-gate below. The gate effects take over from here.
      if (state.matchStatus === "lobby") {
        setAwaitingLobbyGate(true);
        return;
      }
      // Between rounds. A live opponent's intermission gate stamps the next
      // round well inside these retries; past that, stamp it ourselves.
      if (state.matchStatus === "intermission" && attempt >= RESUME_RETRIES_BEFORE_FORCE_BEGIN) {
        void beginRound(activeMatch.matchId, state.currentRound);
      }
      retryTimer = setTimeout(() => void load(attempt + 1), RESUME_RETRY_MS);
    }

    void load(0);
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch.matchId]);

  // Rematch ready-gate, step 1: once this client's connection to the NEW
  // match's channel is live, report ready and start the fallback timeout --
  // same shape as the pre-match gate (DuelRoot) and each intermission's
  // (DuelIntermission).
  useEffect(() => {
    if (!awaitingLobbyGate || !channel.connected || lobbyReadySentRef.current) return;
    lobbyReadySentRef.current = true;
    channel.sendReady();
    const timeout = setTimeout(() => setLobbyGateTimedOut(true), READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingLobbyGate, channel.connected]);

  // Rematch ready-gate, step 2: both ready (or timeout) -> stamp round 0.
  // beginRound is idempotent, so both clients' gates firing is expected --
  // whichever wins stamps, the other adopts the same timestamps.
  useEffect(() => {
    if (!awaitingLobbyGate || lobbyBeganRef.current) return;
    if (!channel.ready || (!channel.opponentReady && !lobbyGateTimedOut)) return;
    lobbyBeganRef.current = true;
    void (async () => {
      const begin = await beginRound(activeMatch.matchId, 0);
      if (!begin.ok) {
        toast.error(begin.error);
        return;
      }
      adoptRound({ roundIndex: 0, startedAt: begin.startedAt, endsAt: begin.endsAt, scoreA: 0, scoreB: 0 });
      channel.broadcastRoundStart({ roundIndex: 0, startedAt: begin.startedAt, endsAt: begin.endsAt } satisfies RoundStartPayload);
      setPhase("playing");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingLobbyGate, channel.ready, channel.opponentReady, lobbyGateTimedOut]);

  // The round timer expiring is exactly the "timer expired" half of
  // "client observes both players done or the timer expired" -- fire the
  // idempotent close attempt once per round, whether or not I solved.
  useEffect(() => {
    if (phase !== "playing" || !round || remainingToEnd > 0) return;
    if (expiredHandledRef.current === round.roundIndex) return;
    expiredHandledRef.current = round.roundIndex;
    void checkRoundTransition(round.roundIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingToEnd, phase, round, activeMatch.matchId]);

  // Safety-net poll: covers a missed broadcast (dropped connection,
  // backgrounded tab) without needing a server-side sweep for v1 -- calling
  // checkRoundTransition when nothing has actually changed is a cheap no-op
  // (duel_close_round's own guard returns advanced: false).
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = setInterval(() => void checkRoundTransition(roundIndexRef.current), DUEL_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, activeMatch.matchId]);

  // A second safety net, specific to intermission: if the round_start
  // broadcast for the next round is missed (the opponent's ready-gate won
  // and called duel_begin_round, but we never heard about it), this
  // eventually notices the round is active again and catches up -- a
  // stuck-on-the-reveal-screen client would otherwise have no way out.
  useEffect(() => {
    if (phase !== "intermission" || !intermission || intermission.isLastRound) return;
    const interval = setInterval(() => {
      void (async () => {
        const state = await getDuelRoundState(activeMatch.matchId);
        // A failed fetch here just means the next round genuinely hasn't
        // been stamped yet (no duel_rounds row for it) -- not a real
        // error, so don't setLoadError; just try again next tick.
        if (!state.ok || state.matchStatus !== "active" || state.roundIndex !== intermission.nextRoundIndex) return;
        adoptRound({ roundIndex: state.roundIndex, startedAt: state.startedAt, endsAt: state.endsAt, scoreA: state.scoreA, scoreB: state.scoreB });
        setIntermission(null);
        setPhase("playing");
      })();
    }, DUEL_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, intermission, activeMatch.matchId]);

  // Disconnect detection (CLAUDE.md: "when a client sees the opponent's
  // presence leave and they don't rejoin within DISCONNECT_GRACE_MS, it
  // calls duel_forfeit on the absent player's behalf"). Keyed off presence
  // *absence* rather than only the leave event, which also covers resuming
  // into a match whose opponent already left while this client was away --
  // there'd be no leave event to hear in that case, just an opponent who
  // never shows up. Rejoining (opponentConnected flipping true) cancels
  // the timer via this effect's cleanup; my own connection dropping also
  // stands the timer down, since an offline client can't tell whose
  // network actually failed.
  useEffect(() => {
    if (phase === "finished" || phase === "loading") return;
    if (!channel.connected || channel.opponentConnected) return;
    const timer = setTimeout(() => void declareOpponentForfeit(), DISCONNECT_GRACE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, channel.connected, channel.opponentConnected]);

  // Best-effort forfeit broadcast on the way out of a live match
  // (CLAUDE.md: "best-effort forfeit broadcast on beforeunload"). Advisory
  // -- the opponent verifies against the server before acting on it (see
  // onForfeit), so a mere reload doesn't cost this player the match; the
  // presence grace window stays the arbiter for whether they come back.
  // pagehide too: iOS Safari doesn't reliably fire beforeunload.
  useEffect(() => {
    if (phase === "finished") return;
    const fire = () => channel.broadcastForfeit();
    window.addEventListener("beforeunload", fire);
    window.addEventListener("pagehide", fire);
    return () => {
      window.removeEventListener("beforeunload", fire);
      window.removeEventListener("pagehide", fire);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function handleGuess(driver: DriverOption) {
    if (!round) return; // guarded by the caller (RoundPlay only renders once a round exists)

    setPendingGuess(true);
    let res;
    try {
      // One warm hop straight to Supabase's PostgREST -- no Vercel function
      // in the path (see lib/duel/submitGuess.ts). Throws on rejection
      // (round not active, already solved, bad driver id).
      res = await submitDuelGuessRpc(activeMatch.matchId, round.roundIndex, driver.id);
    } catch (err) {
      setPendingGuess(false);
      toast.error(err instanceof Error ? err.message : "Something went wrong submitting your guess.");
      return;
    }
    setPendingGuess(false);

    const nextGuesses = [...myGuesses, { id: nextGuessIdRef.current++, guessedDriver: res.guessedDriver, result: res.result }];
    setMyGuesses(nextGuesses);

    const myProvisional = res.solved
      ? (res.points ?? 0)
      : Math.max(0, ...nextGuesses.map((g) => proximityPoints(g.result)));
    channel.broadcastGuess({ guessCount: nextGuesses.length, bestHeat: res.bestHeat, provisionalPoints: myProvisional });

    if (res.solved) {
      myRoundPointsRef.current = res.points ?? 0;
      setMySolved(true);
      setScoreA(res.scoreA);
      setScoreB(res.scoreB);
      const solveMs = Date.now() + clockOffsetMs - new Date(round.startedAt).getTime();
      channel.broadcastSolved({ points: res.points ?? 0, solveMs });
      void checkRoundTransition(round.roundIndex);
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
      // This call created the match (second requester) -- tell the
      // still-waiting first requester on the OLD match's channel before
      // this client resubscribes to the new one, then transition. Both
      // sides meet on duel:{newMatchId} for the rematch ready-gate.
      channel.broadcastRematch({ newMatchId: res.newMatchId });
      transitionToRematch(res.newMatchId);
    }
    // else: requested -- the opponent's own requestRematch call will create
    // the match and broadcast REMATCH_EVENT back (see onRematch).
  }

  // Wraps every live-match view (pre-round, playing, intermission) with the
  // Exit control + its confirm modal -- one unobtrusive control, same spot
  // in every beat, gone once the match is over.
  function withExitControl(view: React.ReactNode) {
    return (
      <>
        {view}
        <div className="flex justify-center pb-3">
          <button
            type="button"
            onClick={() => setExitModalOpen(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Exit match
          </button>
        </div>
        <Modal open={exitModalOpen} onClose={() => setExitModalOpen(false)} title="Forfeit the match?">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              Leaving now counts as a loss — your opponent takes the win and your rating drops.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void handleExitConfirm()}
                className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.98]"
              >
                Forfeit
              </button>
              <button
                type="button"
                onClick={() => setExitModalOpen(false)}
                className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Keep playing
              </button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  if (loadError) {
    return <p className="py-10 text-center text-sm text-red-400">{loadError}</p>;
  }

  if (phase === "loading") {
    return (
      <p className="py-10 text-center text-sm text-text-muted" aria-live="polite">
        {awaitingLobbyGate ? "Rematch found — waiting for both players…" : "Loading match…"}
      </p>
    );
  }

  if (phase === "finished") {
    return (
      <DuelResults
        matchId={activeMatch.matchId}
        me={me}
        opponentHandle={activeMatch.opponentDisplayName || activeMatch.opponentUsername}
        opponentAvatarUrl={activeMatch.opponentAvatarUrl}
        winnerId={winnerId}
        myScore={isPlayerA ? scoreA : scoreB}
        theirScore={isPlayerA ? scoreB : scoreA}
        endReason={endReason}
        rematchPending={rematchState === "requested"}
        onRematch={() => void handleRematch()}
        onFindNewOpponent={onFindNewOpponent}
        onBackToModes={onBackToModes}
      />
    );
  }

  if (phase === "intermission" && intermission) {
    return withExitControl(
      <DuelIntermission
        key={intermission.roundIndex}
        me={{
          handle: me.displayName || me.username,
          avatarUrl: me.avatarUrl,
          roundPoints: isPlayerA ? intermission.pointsA : intermission.pointsB,
        }}
        opponent={{
          handle: activeMatch.opponentDisplayName || activeMatch.opponentUsername,
          avatarUrl: activeMatch.opponentAvatarUrl,
          roundPoints: isPlayerA ? intermission.pointsB : intermission.pointsA,
        }}
        roundIndex={intermission.roundIndex}
        isLastRound={intermission.isLastRound}
        targetDriver={intermission.targetDriver}
        startScoreMine={isPlayerA ? intermission.startScoreA : intermission.startScoreB}
        startScoreOpponent={isPlayerA ? intermission.startScoreB : intermission.startScoreA}
        endScoreMine={isPlayerA ? intermission.scoreA : intermission.scoreB}
        endScoreOpponent={isPlayerA ? intermission.scoreB : intermission.scoreA}
        intermissionEndsAt={intermission.intermissionEndsAt}
        clockOffsetMs={clockOffsetMs}
        channel={channel}
        onDone={() => void proceedFromIntermission()}
      />,
    );
  }

  if (!round) {
    return <p className="py-10 text-center text-sm text-text-muted">Loading match…</p>;
  }

  if (isPreRound) {
    if (round.roundIndex === 0) {
      return withExitControl(
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
        />,
      );
    }
    return withExitControl(
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm text-text-muted">Round {round.roundIndex + 1} starting…</p>
        <div className="font-mono text-4xl font-bold tabular-nums text-text">
          {Math.ceil(remainingToStart / 1000)}
        </div>
      </div>,
    );
  }

  return withExitControl(
    <RoundPlay
      me={{
        handle: me.displayName || me.username,
        avatarUrl: me.avatarUrl,
        guesses: myGuesses,
        solved: mySolved,
        roundPoints: myRoundPointsRef.current,
      }}
      opponent={{
        handle: activeMatch.opponentDisplayName || activeMatch.opponentUsername,
        avatarUrl: activeMatch.opponentAvatarUrl,
        progress: opponentProgress,
      }}
      roundIndex={round.roundIndex}
      remainingMs={remainingToEnd}
      confirmedScoreA={roundStartScoreARef.current}
      confirmedScoreB={roundStartScoreBRef.current}
      isPlayerA={isPlayerA}
      completedRounds={completedRounds}
      eligibleDrivers={eligibleDrivers}
      onGuess={(driver) => void handleGuess(driver)}
      pendingGuess={pendingGuess}
    />,
  );
}
