"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Profile } from "@/components/auth/AuthProvider";
import type { DriverOption } from "@/components/game/DriverAutocomplete";
import { useToast } from "@/components/ui/Toast";
import type { DuelRevealedDriver } from "@/lib/db/duelRpc";
import { applyMatchRatings, forfeitMatch, getDuelRoundState, getDuelState } from "@/lib/duel/actions";
import type { MatchResult } from "@/lib/duel/matchmaking";
import type { RoundEndPayload, RoundStartPayload } from "@/lib/duel/realtimeEvents";
import { beginRound, closeRound } from "@/lib/duel/roundLifecycle";
import { fetchRoundReveal } from "@/lib/duel/roundReveal";
import { submitDuelGuessRpc } from "@/lib/duel/submitGuess";
import { useDuelChannel, type DuelChannelState } from "@/lib/duel/useDuelChannel";
import { dnfPoints, weightedProximity } from "@/lib/game/duelScoring";
import {
  DISCONNECT_GRACE_MS,
  DUEL_POLL_INTERVAL_MS,
  GUESS_COOLDOWN_MS,
  READY_TIMEOUT_MS,
  RESUME_RETRIES_BEFORE_FORCE_BEGIN,
  RESUME_RETRY_MS,
} from "@/lib/game/duelTiming";

import { useActiveMatch } from "./ActiveMatchContext";
import type { IntermissionState, LocalRound, MatchEndReason, Phase } from "./duelMatchTypes";
import { useDuelScoreboard, type DuelScoreboard } from "./useDuelScoreboard";
import { useLightsCountdown } from "./useLightsCountdown";
import { useRematchNegotiation, type RematchNegotiation } from "./useRematchNegotiation";
import { useServerCountdown } from "./useServerCountdown";

// THE duel state machine: phase transitions, the realtime channel, the
// ready-gates, round advancement, forfeit and disconnect. Everything DuelMatch
// used to be except the pixels (audit 2026-07-27 §2.3 -- it was 1031 lines with
// 18 useState, ~10 useRef and 15 useEffect in one component, the single biggest
// file in the repo).
//
// Split behaviour-from-render rather than by feature area, because the machine
// genuinely is one machine: the channel's handlers call the transition
// functions, the transition functions broadcast on the channel, and a resume
// has to be able to land on any beat. Cutting THAT apart would produce hooks
// with twenty parameters each. What comes out cleanly is the two pieces with
// their own vocabulary and no round-transition logic in them -- the scoreboard
// (useDuelScoreboard) and the rematch negotiation (useRematchNegotiation) --
// which this hook composes.
//
// CLAUDE.md's Knockout seam lives here: the phase machine, the ready-gates and
// the server-stamped round timing below are the "reusable live match core", and
// what is 2-player-specific is the `isPlayerA` / opponentId plumbing rather
// than the sequence itself.
export interface DuelLifecycle {
  activeMatch: MatchResult;
  phase: Phase;
  round: LocalRound | null;
  intermission: IntermissionState | null;
  loadError: string | null;
  winnerId: string | null;
  endReason: MatchEndReason;
  isPlayerA: boolean;
  opponentHandle: string;
  pendingGuess: boolean;

  channel: DuelChannelState;
  scoreboard: DuelScoreboard;
  rematch: RematchNegotiation;

  /** Pre-round: the lights are still running, so the board must not be live yet. */
  isPreRound: boolean;
  lights: ReturnType<typeof useLightsCountdown>;
  remainingToEnd: number;
  /**
   * Local `Date.now()` deadline the guess input stays disabled until -- the
   * client half of drizzle/0058's guess cooldown. 0 when nothing is cooling.
   *
   * A timestamp rather than a boolean, and deliberately: RoundPlay already
   * re-renders on the round clock's 10Hz tick, so it can just compare this
   * against the current time and needs no timer of its own to re-enable.
   */
  guessCooldownUntil: number;

  // The rematch staging screen's ready-gate.
  awaitingLobbyGate: boolean;
  lobbyHoldComplete: boolean;
  lobbyGateTimedOut: boolean;
  onLobbyHoldComplete: () => void;

  exitModalOpen: boolean;
  setExitModalOpen: (open: boolean) => void;
  confirmExit: () => void;

  /** Permanently stable, for the memoized DriverAutocomplete under RoundPlay. */
  onGuess: (driver: DriverOption) => void;
  proceedFromIntermission: () => void;
}

export function useDuelLifecycle({
  me,
  match,
  initialRound,
  clockOffsetMs,
  onMatchIdChange,
}: {
  me: Profile;
  match: MatchResult;
  initialRound: LocalRound | null;
  clockOffsetMs: number;
  // A rematch replaces the match id in place. This hook does NOT own that id --
  // see the note on `activeMatch` below.
  onMatchIdChange: (newMatchId: number) => void;
}): DuelLifecycle {
  const { setActive } = useActiveMatch();
  const toast = useToast();

  // THE match id, owned one level up in DuelRoot and read here as a prop -- it
  // is deliberately not copied into state. It used to be (`useState(match)`),
  // and a rematch mutated only this copy: DuelRoot stayed pinned to the finished
  // match for the whole rematch, which silently disabled the liveness heartbeat
  // and setLiveMatchId that live up there (audit 2026-07-29 §0.1). One value,
  // one owner; everything keyed on it, at either level, moves together.
  const activeMatch = match;
  const [phase, setPhase] = useState<Phase>(initialRound ? "playing" : "loading");
  const [round, setRound] = useState<LocalRound | null>(initialRound);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [pendingGuess, setPendingGuess] = useState(false);
  // The guess cooldown's local deadline (drizzle/0058). Mirrored into a ref
  // because handleGuess's own re-entry guard runs from a callback that closed
  // over an older render -- same reason phaseRef exists.
  const [guessCooldownUntil, setGuessCooldownUntil] = useState(0);
  const guessCooldownUntilRef = useRef(0);
  const [intermission, setIntermission] = useState<IntermissionState | null>(null);
  // Only for the "match failed to load" case -- there's genuinely nothing else
  // to render then. Guess/rematch failures go to the toast system instead so
  // they don't hijack this screen out from under whatever's already showing.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<MatchEndReason>("completed");
  const [exitModalOpen, setExitModalOpen] = useState(false);
  // The rematch ready-gate (a rematch match is created as status 'lobby' with
  // no round row -- see requestRematch): true while waiting for both clients to
  // reconfirm ready on the NEW match's channel before duel_begin_round stamps
  // round 0. Same gate pattern as the pre-match staging and each intermission
  // -- the round clock never starts before both players are actually back.
  const [awaitingLobbyGate, setAwaitingLobbyGate] = useState(false);
  const [lobbyGateTimedOut, setLobbyGateTimedOut] = useState(false);
  // The staging screen's MATCH_FOUND_HOLD_MS beat has finished. Ready is sent
  // when this flips, not the moment the channel connects -- same order DuelRoot
  // uses for a fresh match, so a rematch gets the avatars-and-ratings reveal
  // before the countdown rather than racing past it.
  const [lobbyHoldComplete, setLobbyHoldComplete] = useState(false);
  const lobbyReadySentRef = useRef(false);
  const lobbyBeganRef = useRef(false);

  const roundIndexRef = useRef(initialRound?.roundIndex ?? -1);
  // Current phase, readable from async forfeit/disconnect handlers without
  // re-subscribing them on every phase change.
  const phaseRef = useRef<Phase>(initialRound ? "playing" : "loading");
  const expiredHandledRef = useRef<number | null>(null);
  // The round a round_end verification is in flight (or has landed) for, so a
  // repeated broadcast doesn't fire a second read and re-open an intermission
  // that's already on screen. Cleared again on a failed/not-yet-closed read so
  // a later, genuine broadcast can still be acted on.
  const roundEndVerifyRef = useRef<number | null>(null);

  const isPlayerA = activeMatch.youAre === "a";
  const opponentHandle = activeMatch.opponentDisplayName || activeMatch.opponentUsername;

  const scoreboard = useDuelScoreboard(isPlayerA);

  // The match's two clocks. Each stops ticking the moment its own timestamp
  // passes, so `remainingToStart` costs nothing once the lights are out and
  // neither costs anything between rounds -- but both are keyed on `round`,
  // which is why every terminal path below nulls it: leaving the last round's
  // row in state would be indistinguishable from a live round to these hooks,
  // and re-rendering this component plus DuelResults for as long as a player
  // sat on the results screen deciding about a rematch was exactly audit
  // 2026-07-27 §1.0's worst case.
  const remainingToStart = useServerCountdown(round?.startedAt ?? null, clockOffsetMs);
  const remainingToEnd = useServerCountdown(round?.endsAt ?? null, clockOffsetMs);
  // Drives the pre-round lights (own local clock, immune to beginRound's RPC
  // latency) and holds a beat past the real start instant so the fade-in and
  // "GO!" always finish on screen before RoundPlay takes over -- same gate
  // DuelCountdown uses for round 1 of a fresh match, applied here too so a
  // rematch's round 1 and every later round look identical.
  const lights = useLightsCountdown(remainingToStart, round?.startedAt ?? null, round === null);
  const isPreRound = round !== null && !lights.holdComplete;

  // The duel:{matchId} transport (lib/duel/useDuelChannel.ts) -- one
  // subscription for the whole match, not per round; only resets on a rematch's
  // new matchId.
  //
  // The handlers below reference functions and `rematch` declared further down.
  // That is safe and deliberate: useDuelChannel keeps these in a ref it
  // refreshes every render and only ever calls them from a subscription
  // callback, which is always after the render that defined them.
  const channel = useDuelChannel(activeMatch.matchId, me.id, activeMatch.opponentId, {
    onGuess: (payload) => {
      scoreboard.applyOpponentGuess({
        guessCount: payload.guessCount,
        bestHeat: payload.bestHeat,
        provisionalPoints: payload.provisionalPoints,
      });
    },
    onSolved: (payload) => {
      scoreboard.applyOpponentSolved(payload.points);
    },
    onRoundStart: (payload) => {
      if (payload.roundIndex <= roundIndexRef.current) return; // stale/duplicate broadcast

      // The opponent's own ready-gate already won the race and called
      // duel_begin_round -- the round has genuinely started server-side, so
      // catch up immediately instead of insisting on finishing my own gate
      // (which would just leave me drifting behind the timer).
      //
      // The broadcast says *that* it started, never *when*: the clock comes
      // back from the same idempotent RPC my own gate would have called, not
      // off the payload (audit 2026-07-29 §0.2). It used to be taken on trust,
      // and either half of it was a stolen round -- an endsAt already in the
      // past expires the moment it lands and the expiry effect below DNFs me
      // on a round I never saw, a startedAt far in the future leaves isPreRound
      // stuck true while the real server clock runs down. drizzle/0046 shut
      // third parties out of the channel; this is the same forgery from the one
      // party still on it, my opponent. Confirming costs one warm PostgREST hop
      // on a beat where I'm between rounds anyway -- and beginRound is the call
      // this path was always going to make, just triggered by their gate
      // instead of mine.
      if (
        phase === "intermission" &&
        intermission &&
        !intermission.isLastRound &&
        payload.roundIndex === intermission.nextRoundIndex
      ) {
        const { nextRoundIndex, scoreA, scoreB } = intermission;
        void (async () => {
          const begin = await beginRound(activeMatch.matchId, nextRoundIndex!);
          if (!begin.ok) {
            // Not a dead end: the intermission safety-net poll below re-checks
            // the round state on DUEL_POLL_INTERVAL_MS, and my own ready-gate
            // is still running.
            return;
          }
          adoptRound({
            roundIndex: begin.roundIndex,
            startedAt: begin.startedAt,
            endsAt: begin.endsAt,
            scoreA,
            scoreB,
          });
          setIntermission(null);
          setPhase("playing");
        })();
        return;
      }

      // Otherwise this is either round 0 handing off from DuelCountdown (no
      // local round adopted yet) or a broadcast that arrived after I'd already
      // missed the round_end that should have preceded it (a dropped-broadcast
      // edge case) -- either way, the round genuinely exists server-side by now
      // (round_start is only ever sent after a successful duel_begin_round), so
      // refetching full state is safe.
      void refreshRoundState();
    },
    onRoundEnd: (payload) => {
      if (payload.roundIndex !== roundIndexRef.current) return; // not the round I'm currently on
      // Advisory: the payload says *that* the round ended, and its roundIndex
      // is only used to decide which round to ask the server about. Everything
      // it renders -- the reveal, both sides' points, the running scores, the
      // intermission clock -- is read back from duel_round_reveal (audit
      // 2026-07-30 §3.4 residual). Same trust decision §0.2 made for
      // round_start, for the same reason: drizzle/0046 shut third parties out
      // of this channel, but the one party still on it is my opponent in a
      // rated 1v1, and this payload used to be applied exactly as sent.
      void verifyRoundEnd(payload.roundIndex);
    },
    onMatchEnd: () => {
      // Same rule, and the payload is now read for nothing at all: who won and
      // by how much comes off duel_matches. Only ever meaningful once this
      // client's own onRoundEnd (or its own closeRound call) has already opened
      // the last round's intermission -- this just fills in the winner/rating
      // info that round_end is too early to carry. If round_end hasn't arrived
      // yet (they're sent back-to-back over the same connection, so this is
      // rare), the merge below finds no intermission and drops it; the client
      // simply won't show a winner until it independently discovers the match
      // is finished.
      void verifyMatchEnd();
    },
    onRematch: (payload) => {
      // Only meaningful while sitting on the finished screen waiting for the
      // opponent to accept the rematch this client already requested.
      if (phaseRef.current !== "finished") return;
      transitionToRematch(payload.newMatchId);
    },
    onRematchRequest: () => rematch.onOpponentRequest(),
    onRematchDecline: () => rematch.onOpponentDecline(),
    onForfeit: (payload) => {
      if (payload.playerId !== activeMatch.opponentId) return;
      // Advisory only -- verify against the server before ending anything. On
      // explicit exit the opponent called duel_forfeit before broadcasting, so
      // the match is already terminal here and we adopt it immediately. On a
      // beforeunload broadcast the RPC may never have run; the match is still
      // live, and the presence-absence grace timer below stays the arbiter
      // (they may just be reloading).
      void (async () => {
        if (phaseRef.current === "finished") return;
        const state = await getDuelState(activeMatch.matchId);
        if (!state.ok || (state.matchStatus !== "abandoned" && state.matchStatus !== "finished")) return;
        adoptTerminal(state.matchStatus, state.winnerId, state.scoreA, state.scoreB);
      })();
    },
  });

  const rematch = useRematchNegotiation({
    matchId: activeMatch.matchId,
    phase,
    phaseRef,
    channel,
    opponentHandle,
    onRematchCreated: (newMatchId) => transitionToRematch(newMatchId),
  });

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Shared endpoint for every way a match can end out from under the normal
  // round flow: my own forfeit, the opponent's (broadcast or grace-timer), or
  // resuming onto an already-terminal match. Derives the results panel's reason
  // line from who the abandonment favored.
  function adoptTerminal(status: string, terminalWinnerId: string | null, newScoreA: number, newScoreB: number) {
    if (phaseRef.current === "finished") return;
    phaseRef.current = "finished";
    scoreboard.setScores(newScoreA, newScoreB);
    setWinnerId(terminalWinnerId);
    setEndReason(status === "abandoned" ? (terminalWinnerId === me.id ? "forfeitOpponent" : "forfeitMe") : "completed");
    setIntermission(null);
    setRound(null); // see the note on the two countdowns above
    setPhase("finished");
  }

  // Explicit exit (CLAUDE.md: "an Exit control (confirm modal) calls
  // duel_forfeit ... then broadcasts forfeit"). Order matters: settle the match
  // server-side first so the opponent's verify-on-broadcast finds it already
  // terminal.
  async function handleExitConfirm() {
    setExitModalOpen(false);
    const res = await forfeitMatch(activeMatch.matchId);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    channel.broadcastForfeit();
    adoptTerminal(res.status, res.winnerId, scoreboard.scoreARef.current, scoreboard.scoreBRef.current);
  }

  // The disconnect-grace timer's verdict: the opponent left and never came back
  // within DISCONNECT_GRACE_MS -- forfeit on their behalf (idempotent; if the
  // match actually ended normally in the meantime, duel_forfeit reports that
  // settled state instead and we adopt it as-is).
  async function declareOpponentForfeit() {
    if (phaseRef.current === "finished") return;
    const res = await forfeitMatch(activeMatch.matchId, activeMatch.opponentId);
    if (!res.ok) return; // transient failure -- the grace effect re-arms while they're still absent
    adoptTerminal(res.status, res.winnerId, scoreboard.scoreARef.current, scoreboard.scoreBRef.current);
  }

  // A live race is the wrong moment for a banner (CLAUDE.md: "hide the ad slot
  // ... through the whole match"). DuelRoot hands off to this component only
  // once the round is already live (its own lights-out countdown already ran
  // GO), so "loading" here is a brief in-flight fetch squarely inside the match
  // experience, not a separate pre-round beat -- ads stay off through it too,
  // back on only once the match is finished (the results screen is back in the
  // site shell).
  useEffect(() => {
    setActive(phase !== "finished");
    return () => setActive(false);
  }, [phase, setActive]);

  function adoptRound(data: LocalRound & { scoreA: number; scoreB: number }) {
    if (data.roundIndex <= roundIndexRef.current) return; // stale/duplicate
    // Any adopted round means the lobby gate (if one was pending) is moot -- the
    // round exists server-side, however it got stamped.
    setAwaitingLobbyGate(false);
    scoreboard.recordCompletedRound(roundIndexRef.current, data.scoreA, data.scoreB);
    roundIndexRef.current = data.roundIndex;
    setRound({ roundIndex: data.roundIndex, startedAt: data.startedAt, endsAt: data.endsAt });
    scoreboard.startRound(data.scoreA, data.scoreB);
    // The cooldown is per-round on the server too (it spaces against
    // duel_round_results.last_guess_at, and a new round means a new row), so a
    // leftover deadline here would disable the input on a round it never
    // applied to -- the intermission is longer than the cooldown anyway, but a
    // round adopted early by the opponent's gate need not be.
    guessCooldownUntilRef.current = 0;
    setGuessCooldownUntil(0);
  }

  // Re-fetches full authoritative state (round timing, scores, my own solve
  // status) and adopts it -- used both for the initial mount and whenever a
  // round_start broadcast signals a transition happened that this client didn't
  // itself perform (and isn't already mid-intermission for).
  async function refreshRoundState() {
    const state = await getDuelRoundState(activeMatch.matchId);
    if (!state.ok) {
      setLoadError(state.error);
      return;
    }
    if (state.matchStatus === "finished" || state.matchStatus === "abandoned") {
      scoreboard.recordCompletedRound(roundIndexRef.current, state.scoreA, state.scoreB);
      adoptTerminal(state.matchStatus, state.winnerId, state.scoreA, state.scoreB);
      return;
    }
    adoptRound({
      roundIndex: state.roundIndex,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      scoreA: state.scoreA,
      scoreB: state.scoreB,
    });
    scoreboard.setMySolved(state.mySolved);
    setIntermission(null);
    setPhase("playing");
  }

  // Shared by checkRoundTransition (this client triggered the close) and the
  // onRoundEnd handler (the opponent did) -- opens CLAUDE.md's Duel
  // "Intermission" beat: the reveal, point count-up, and tug settle stay on
  // screen for the full server-stamped intermissionEndsAt before a fresh
  // ready-gate (see DuelIntermission) gets to the next round.
  //
  // `isLastRound` IS THE SERVER'S ANSWER, NOT A LOCAL DERIVATION. It used to be
  // `data.roundIndex >= MAX_ROUNDS - 1`, which required a client constant and
  // duel_close_round's own last-round test to agree about how long a match is.
  // With rounds per-match (drizzle/0054) they cannot: the constant is one
  // number and the column is per-row, so the intermission would offer a fourth
  // round of a three-round match, or cut a five-round one short. Both callers
  // already hold the authoritative answer -- closeRound's `matchFinished`
  // (match_status = 'finished') and duel_round_reveal's `matchStatus` -- so
  // they pass it in. Strictly more correct today too, for the same reason
  // drizzle/0050 made round_end a trigger rather than data: this client may
  // never have made the close call whose outcome it is rendering.
  function applyRoundEnd(data: {
    roundIndex: number;
    isLastRound: boolean;
    targetDriver: DuelRevealedDriver;
    pointsA: number;
    pointsB: number;
    scoreA: number;
    scoreB: number;
    intermissionEndsAt: string;
  }) {
    const isLastRound = data.isLastRound;
    setIntermission({
      roundIndex: data.roundIndex,
      nextRoundIndex: isLastRound ? null : data.roundIndex + 1,
      isLastRound,
      targetDriver: data.targetDriver,
      pointsA: data.pointsA,
      pointsB: data.pointsB,
      scoreA: data.scoreA,
      scoreB: data.scoreB,
      startScoreA: scoreboard.roundStartScoreARef.current,
      startScoreB: scoreboard.roundStartScoreBRef.current,
      intermissionEndsAt: data.intermissionEndsAt,
      winnerId: null,
      ratingDeltaA: null,
      ratingDeltaB: null,
    });
    setPhase("intermission");
  }

  // The receiving half of a round close: the opponent's client closed the round
  // and told us so. What it told us is treated as a *trigger*, not as data --
  // the reveal, both sides' points, the running scores and the intermission
  // clock all come back from duel_round_reveal, which will only produce them
  // once duel_rounds.intermission_ends_at is actually stamped (audit
  // 2026-07-30 §3.4 residual).
  //
  // Why not the idempotent duel_close_round_client, which the audit suggested
  // and which §0.2 used for round_start: that function is idempotent in its
  // EFFECT but not in its RESPONSE. Exactly one client's close ever advances,
  // and the already-closed branch deliberately returns NULL for every reveal
  // column (drizzle/0024) on the assumption that a repeat caller already has
  // them from its own first call. The receiving client never made one -- that
  // is the whole reason this broadcast exists -- so there was nothing to
  // re-verify against until drizzle/0050 added a read.
  //
  // A failed or not-yet-closed read is not a dead end, and behaves exactly as a
  // dropped round_end always has: this client stays on the (now expired) round
  // until the opponent's intermission ends and their round_start arrives, whose
  // handler refetches full state. It skips the reveal, which is the correct
  // outcome for a broadcast the server won't corroborate.
  async function verifyRoundEnd(closingRoundIndex: number) {
    if (roundEndVerifyRef.current === closingRoundIndex) return;
    roundEndVerifyRef.current = closingRoundIndex;

    const reveal = await fetchRoundReveal(activeMatch.matchId, closingRoundIndex);
    if (!reveal.ok || !reveal.closed) {
      roundEndVerifyRef.current = null;
      return;
    }
    // A round can have been adopted while the read was in flight (the
    // opponent's intermission is short and their ready-gate may have won the
    // race) -- applying a stale reveal over it would pull the player back out
    // of a live round.
    if (roundIndexRef.current !== closingRoundIndex) return;

    applyRoundEnd({
      roundIndex: closingRoundIndex,
      // The reveal is only produced once the round is genuinely closed, so a
      // 'finished' status here means this WAS the last round -- of this match,
      // whatever length it was configured for.
      isLastRound: reveal.matchStatus === "finished",
      targetDriver: reveal.targetDriver,
      pointsA: reveal.pointsA,
      pointsB: reveal.pointsB,
      scoreA: reveal.scoreA,
      scoreB: reveal.scoreB,
      intermissionEndsAt: reveal.intermissionEndsAt,
    });
    // On the last round the close and the match finish are the same event, so
    // the winner may already be readable here -- the rating deltas usually
    // aren't yet (applyMatchRatings is a separate call the closing client makes
    // after broadcasting round_end), and match_end's own verification fills
    // them in a moment later.
    if (reveal.matchStatus === "finished") {
      setIntermission((prev) =>
        prev && prev.isLastRound
          ? { ...prev, winnerId: reveal.winnerId, ratingDeltaA: reveal.ratingDeltaA, ratingDeltaB: reveal.ratingDeltaB }
          : prev,
      );
    }
  }

  // The receiving half of a match finish. Same rule as verifyRoundEnd: the
  // broadcast is the trigger, duel_matches is the answer. A forged match_end
  // now paints nothing -- the read reports the match still running and this
  // returns without touching the intermission.
  async function verifyMatchEnd() {
    // During the final intermission roundIndexRef still points at the round
    // that just closed (only adoptRound moves it), which is the round whose
    // reveal is on screen.
    const reveal = await fetchRoundReveal(activeMatch.matchId, roundIndexRef.current);
    if (!reveal.ok) return;
    if (reveal.matchStatus !== "finished" && reveal.matchStatus !== "abandoned") return;

    setIntermission((prev) =>
      prev && prev.isLastRound
        ? { ...prev, winnerId: reveal.winnerId, ratingDeltaA: reveal.ratingDeltaA, ratingDeltaB: reveal.ratingDeltaB }
        : prev,
    );
  }

  // Closes out the match's current round (public.duel_close_round, idempotent)
  // whenever this client observes both players done or the timer expired, and
  // opens the intermission -- relaying round_end (and match_end, on the last
  // round) so the opponent's client opens the same intermission without waiting
  // for its own poll.
  async function checkRoundTransition(closingRoundIndex: number) {
    const res = await closeRound(activeMatch.matchId, closingRoundIndex);
    if (!res.ok || !res.advanced) return;

    applyRoundEnd({
      roundIndex: res.roundIndex,
      // This client made the close, so the RPC told it directly whether the
      // match ended on that round.
      isLastRound: res.matchFinished,
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
      // Ratings are the one part of closing a round that isn't a warm RPC --
      // the Elo math is a unit-tested TS function, so it stays server-side
      // (drizzle/0034). Only reached on the last round, where the match is
      // already over and this call blocks nothing the player is waiting on.
      // Idempotent, so both clients calling it is fine.
      const ratings = await applyMatchRatings(activeMatch.matchId);
      const ratingDeltaA = ratings.ok ? ratings.ratingDeltaA : null;
      const ratingDeltaB = ratings.ok ? ratings.ratingDeltaB : null;

      setIntermission((prev) => (prev ? { ...prev, winnerId: res.winnerId, ratingDeltaA, ratingDeltaB } : prev));
      channel.broadcastMatchEnd({
        winnerId: res.winnerId,
        scoreA: res.scoreA,
        scoreB: res.scoreB,
        ratingDeltaA,
        ratingDeltaB,
        // Per-round opponent breakdown isn't tracked locally; RoundResultCards
        // renders from the scoreboard's completedRounds (this client's own
        // view), not from this broadcast.
        breakdown: [],
      });
    }
  }

  // DuelIntermission's onDone -- called once the mini-countdown (and, for a
  // non-final round, the fresh ready-gate) resolves. Decides what "done" means:
  // begin the next round, or move to the match-end screen.
  async function proceedFromIntermission() {
    if (!intermission) return;

    if (intermission.isLastRound) {
      scoreboard.recordCompletedRound(roundIndexRef.current, intermission.scoreA, intermission.scoreB);
      scoreboard.setScores(intermission.scoreA, intermission.scoreB);
      setWinnerId(intermission.winnerId);
      setIntermission(null);
      setRound(null); // see the note on the two countdowns above
      setPhase("finished");
      return;
    }

    const begin = await beginRound(activeMatch.matchId, intermission.nextRoundIndex!);
    if (!begin.ok) {
      toast.error(begin.error);
      return;
    }
    adoptRound({
      roundIndex: begin.roundIndex,
      startedAt: begin.startedAt,
      endsAt: begin.endsAt,
      scoreA: intermission.scoreA,
      scoreB: intermission.scoreB,
    });
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
    scoreboard.resetForRematch();
    setIntermission(null);
    rematch.reset();
    setEndReason("completed");
    setExitModalOpen(false);
    setAwaitingLobbyGate(false);
    setLobbyGateTimedOut(false);
    setLobbyHoldComplete(false);
    lobbyReadySentRef.current = false;
    lobbyBeganRef.current = false;
    roundIndexRef.current = -1;
    roundEndVerifyRef.current = null; // round indices restart at 0 on the new match
    phaseRef.current = "loading";
    // Hands the new id to its owner. Everything below that keys on it (the
    // duel:{matchId} channel, the resume effect, the rematch negotiation) reacts
    // to the prop coming back down -- and so, now, does everything above it that
    // keys on it: the liveness heartbeat and the sign-out forfeit registration.
    onMatchIdChange(newMatchId);
  }

  // Mount once per activeMatch.matchId: rehydrate from duel_state (CLAUDE.md
  // "Resume") -- also runs for a rematch's fresh matchId. Handles every beat a
  // reload can land on: a terminal match adopts its result (never re-enters
  // play), a stamped round adopts the corrected clock, and the between-rounds
  // gap (status 'intermission', next round not stamped) retries until the
  // opponent's ready-gate stamps it -- or, if it never does because BOTH clients
  // reloaded mid-intermission and nobody's gate survived, stamps it itself after
  // RESUME_RETRIES_BEFORE_FORCE_BEGIN quiet retries.
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
        // Skip when this fetch is only confirming the round we were handed and
        // are already playing: adoptRound clears guesses, solve state and
        // opponent progress, and by the time a Server Action returns the player
        // may well have guessed. Genuine resumes start at roundIndexRef -1 and
        // adopt normally.
        if (roundIndexRef.current !== state.currentRound) {
          adoptRound({
            roundIndex: state.currentRound,
            startedAt: state.startedAt,
            endsAt: state.endsAt,
            scoreA: state.scoreA,
            scoreB: state.scoreB,
          });
          scoreboard.setMySolved(state.mySolved);
        }
        setPhase("playing");
        return;
      }
      // Status 'lobby' with no round: a rematch (or a resumed pre-round match)
      // -- round 0 must not be stamped until both clients pass the ready-gate
      // below. The gate effects take over from here.
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

  // Rematch ready-gate, step 1: once the staging screen's hold has played out
  // AND this client's connection to the NEW match's channel is live, report
  // ready and start the fallback timeout -- same shape, and now the same
  // ordering, as the pre-match gate (DuelRoot) and each intermission's
  // (DuelIntermission). Reporting ready on connection alone would resolve the
  // gate while the reveal was still animating in.
  useEffect(() => {
    if (!awaitingLobbyGate || !lobbyHoldComplete || !channel.connected || lobbyReadySentRef.current) return;
    lobbyReadySentRef.current = true;
    channel.sendReady();
    const timeout = setTimeout(() => setLobbyGateTimedOut(true), READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingLobbyGate, lobbyHoldComplete, channel.connected]);

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
      channel.broadcastRoundStart({
        roundIndex: 0,
        startedAt: begin.startedAt,
        endsAt: begin.endsAt,
      } satisfies RoundStartPayload);
      setPhase("playing");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingLobbyGate, channel.ready, channel.opponentReady, lobbyGateTimedOut]);

  // The round timer expiring is exactly the "timer expired" half of "client
  // observes both players done or the timer expired" -- fire the idempotent
  // close attempt once per round, whether or not I solved.
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

  // A second safety net, specific to intermission: if the round_start broadcast
  // for the next round is missed (the opponent's ready-gate won and called
  // duel_begin_round, but we never heard about it), this eventually notices the
  // round is active again and catches up -- a stuck-on-the-reveal-screen client
  // would otherwise have no way out.
  useEffect(() => {
    if (phase !== "intermission" || !intermission || intermission.isLastRound) return;
    const interval = setInterval(() => {
      void (async () => {
        const state = await getDuelRoundState(activeMatch.matchId);
        // A failed fetch here just means the next round genuinely hasn't been
        // stamped yet (no duel_rounds row for it) -- not a real error, so don't
        // setLoadError; just try again next tick.
        if (!state.ok || state.matchStatus !== "active" || state.roundIndex !== intermission.nextRoundIndex) return;
        adoptRound({
          roundIndex: state.roundIndex,
          startedAt: state.startedAt,
          endsAt: state.endsAt,
          scoreA: state.scoreA,
          scoreB: state.scoreB,
        });
        setIntermission(null);
        setPhase("playing");
      })();
    }, DUEL_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, intermission, activeMatch.matchId]);

  // Disconnect detection (CLAUDE.md: "when a client sees the opponent's presence
  // leave and they don't rejoin within DISCONNECT_GRACE_MS, it calls
  // duel_forfeit on the absent player's behalf"). Keyed off presence *absence*
  // rather than only the leave event, which also covers resuming into a match
  // whose opponent already left while this client was away -- there'd be no
  // leave event to hear in that case, just an opponent who never shows up.
  // Rejoining (opponentConnected flipping true) cancels the timer via this
  // effect's cleanup; my own connection dropping also stands the timer down,
  // since an offline client can't tell whose network actually failed.
  //
  // An INTERVAL rather than a one-shot timeout, because the verdict is no longer
  // this client's to make alone: forfeitMatch now independently requires the
  // absent player's own heartbeat to be stale (drizzle/0040), and an opponent
  // who died the instant after beating is stale by a hair less than
  // DISCONNECT_GRACE_MS when the first attempt lands. That refusal used to be
  // terminal -- these deps don't change while someone is absent, so the effect
  // never re-armed and the remaining player sat in a dead match. Retrying on the
  // same cadence costs one rejected call and closes the boundary case; every
  // repeat is idempotent server-side.
  useEffect(() => {
    if (phase === "finished" || phase === "loading") return;
    if (!channel.connected || channel.opponentConnected) return;
    const timer = setInterval(() => void declareOpponentForfeit(), DISCONNECT_GRACE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, channel.connected, channel.opponentConnected]);

  // Best-effort forfeit broadcast on the way out of a live match (CLAUDE.md:
  // "best-effort forfeit broadcast on beforeunload"). Advisory -- the opponent
  // verifies against the server before acting on it (see onForfeit), so a mere
  // reload doesn't cost this player the match; the presence grace window stays
  // the arbiter for whether they come back. pagehide too: iOS Safari doesn't
  // reliably fire beforeunload.
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
    // The cooldown's UI half is RoundPlay disabling the input; this is the
    // re-entry guard behind it, for the paths that don't go through a disabled
    // attribute (an Enter keypress already in flight, a stale memoized
    // onSelect). Silent, not a toast: the player can see the input is waiting.
    if (Date.now() < guessCooldownUntilRef.current) return;

    setPendingGuess(true);
    let res;
    try {
      // One warm hop straight to Supabase's PostgREST -- no Vercel function in
      // the path (see lib/duel/submitGuess.ts). Throws on rejection (round not
      // active, already solved, bad driver id).
      res = await submitDuelGuessRpc(activeMatch.matchId, round.roundIndex, driver.id);
    } catch (err) {
      setPendingGuess(false);
      toast.error(err instanceof Error ? err.message : "Something went wrong submitting your guess.");
      return;
    }
    setPendingGuess(false);

    // Cooldown starts when the response lands, not when the guess was sent --
    // the player has only just seen the tiles, and that is the beat this
    // exists to give them. The server measures from its own write instead and
    // allows GUESS_COOLDOWN_SERVER_MS, which is shorter by about the response
    // leg, so this wait is always the binding one for an honest client.
    const until = Date.now() + GUESS_COOLDOWN_MS;
    guessCooldownUntilRef.current = until;
    setGuessCooldownUntil(until);

    const nextGuesses = [
      ...scoreboard.myGuesses,
      { id: scoreboard.nextGuessIdRef.current++, guessedDriver: res.guessedDriver, result: res.result },
    ];
    scoreboard.setMyGuesses(nextGuesses);

    // A DNF's provisional is the best guess so far DECAYED by the guess count
    // (drizzle/0058) -- what duel_close_round would actually pay if the round
    // ended now. Undecayed, the tug bar would drift up on every wasted guess
    // and then drop at the close, which is the exact failure the parity suite
    // exists to prevent: a bar that says you are winning a round you are not.
    const myProvisional = res.solved
      ? (res.points ?? 0)
      : dnfPoints(Math.max(0, ...nextGuesses.map((g) => weightedProximity(g.result))), nextGuesses.length);
    channel.broadcastGuess({ guessCount: nextGuesses.length, bestHeat: res.bestHeat, provisionalPoints: myProvisional });

    if (res.solved) {
      scoreboard.setScores(res.scoreA, res.scoreB);
      const solveMs = Date.now() + clockOffsetMs - new Date(round.startedAt).getTime();
      scoreboard.markMySolve(res.points ?? 0, solveMs);
      channel.broadcastSolved({ points: res.points ?? 0, solveMs });
      void checkRoundTransition(round.roundIndex);
    }
  }

  // A permanently stable `onSelect` for the memoized DriverAutocomplete under
  // RoundPlay -- without it the input is the one child that re-renders on every
  // countdown tick, since handleGuess closes over the guesses/round and is a new
  // function each render (and `channel` is a new object each render, so a
  // useCallback with honest deps would never be stable either). The ref-latch is
  // the same pattern DuelCountdown's onGo and DuelIntermission's onDone use.
  const handleGuessRef = useRef(handleGuess);
  handleGuessRef.current = handleGuess;
  const onGuess = useCallback((driver: DriverOption) => void handleGuessRef.current(driver), []);

  return {
    activeMatch,
    phase,
    round,
    intermission,
    loadError,
    winnerId,
    endReason,
    isPlayerA,
    opponentHandle,
    pendingGuess,
    channel,
    scoreboard,
    rematch,
    isPreRound,
    lights,
    remainingToEnd,
    guessCooldownUntil,
    awaitingLobbyGate,
    lobbyHoldComplete,
    lobbyGateTimedOut,
    onLobbyHoldComplete: () => setLobbyHoldComplete(true),
    exitModalOpen,
    setExitModalOpen,
    confirmExit: () => void handleExitConfirm(),
    onGuess,
    proceedFromIntermission: () => void proceedFromIntermission(),
  };
}
