"use client";

import type { Profile } from "@/components/auth/AuthProvider";
import type { DriverOption } from "@/components/game/DriverAutocomplete";
import type { MatchResult } from "@/lib/duel/matchmaking";

import { DuelExitControl } from "./DuelExitControl";
import { DuelIntermission } from "./DuelIntermission";
import { DuelMatchFound } from "./DuelMatchFound";
import { DuelResults } from "./DuelResults";
import { LightsCountdown } from "./LightsCountdown";
import { RoundPlay } from "./RoundPlay";
import { useDuelLifecycle } from "./useDuelLifecycle";

// COMPOSITION + RENDER ONLY. The whole state machine -- phase transitions, the
// duel:{matchId} channel, the ready-gates, round advancement, scoring, forfeit,
// disconnect and the rematch negotiation -- lives in useDuelLifecycle and the
// two hooks it composes (useDuelScoreboard, useRematchNegotiation).
//
// That separation is audit 2026-07-27 §2.3, done deliberately BEFORE Knockout:
// CLAUDE.md asks for the live-match core to be reusable for N players, and it
// cannot be reused while it is fused into one component's JSX.
export function DuelMatch({
  me,
  myRating,
  match,
  initialRound,
  eligibleDrivers,
  clockOffsetMs,
  onFindNewOpponent,
  onBackToModes,
}: {
  me: Profile;
  myRating: number | null;
  match: MatchResult;
  // Round 0, already stamped by DuelRoot's countdown. Present only on the
  // fresh-match handoff -- null for a resume or a rematch, which genuinely have
  // to discover where they are. When present it seeds this component's first
  // paint, so the board is on screen the instant the lights go out instead of
  // after a getDuelState round trip re-fetching what was just handed over. That
  // wait was the reason round 1 felt longer than rounds 2 and 3, which never
  // remount -- and it was running down the round clock while it happened.
  initialRound: { roundIndex: number; startedAt: string; endsAt: string } | null;
  eligibleDrivers: DriverOption[];
  // Measured once, in DuelRoot (useServerClock), before this component ever
  // mounts -- reused here rather than re-measuring a second, possibly slightly
  // different offset for the same match.
  clockOffsetMs: number;
  onFindNewOpponent: () => void;
  // Results-panel CTA back to the /online landing (mode select) -- DuelRoot owns
  // that phase state, so it provides the handler.
  onBackToModes: () => void;
}) {
  const duel = useDuelLifecycle({ me, match, initialRound, clockOffsetMs });
  const { activeMatch, scoreboard, channel, intermission, round } = duel;

  const myHandle = me.displayName || me.username;
  const opponentHandle = activeMatch.opponentDisplayName || activeMatch.opponentUsername;

  function withExitControl(view: React.ReactNode) {
    return (
      <DuelExitControl open={duel.exitModalOpen} onOpenChange={duel.setExitModalOpen} onConfirm={duel.confirmExit}>
        {view}
      </DuelExitControl>
    );
  }

  if (duel.loadError) {
    return <p className="py-10 text-center text-sm text-red-400">{duel.loadError}</p>;
  }

  if (duel.phase === "loading") {
    // A rematch gets the real staging screen -- the same avatars-slide-in
    // reveal a freshly matched pair sees (DuelRoot's "found" phase), not a line
    // of text. Its hold is what releases the ready-gate, so the reveal is a beat
    // in the sequence rather than something running alongside it.
    if (duel.awaitingLobbyGate) {
      return withExitControl(
        <DuelMatchFound
          me={me}
          myRating={myRating}
          opponent={{
            username: activeMatch.opponentUsername,
            displayName: activeMatch.opponentDisplayName,
            avatarUrl: activeMatch.opponentAvatarUrl,
            rating: activeMatch.opponentRating,
          }}
          waitingOnOpponent={duel.lobbyHoldComplete && !channel.opponentReady && !duel.lobbyGateTimedOut}
          onHoldComplete={duel.onLobbyHoldComplete}
        />,
      );
    }
    return (
      <p className="py-10 text-center text-sm text-text-muted" aria-live="polite">
        Loading match…
      </p>
    );
  }

  if (duel.phase === "finished") {
    return (
      <DuelResults
        matchId={activeMatch.matchId}
        me={me}
        opponentHandle={opponentHandle}
        opponentAvatarUrl={activeMatch.opponentAvatarUrl}
        winnerId={duel.winnerId}
        myScore={duel.isPlayerA ? scoreboard.scoreA : scoreboard.scoreB}
        theirScore={duel.isPlayerA ? scoreboard.scoreB : scoreboard.scoreA}
        endReason={duel.endReason}
        rematchState={duel.rematch.rematchState}
        onRematch={duel.rematch.request}
        onDeclineRematch={duel.rematch.decline}
        onFindNewOpponent={onFindNewOpponent}
        onBackToModes={onBackToModes}
      />
    );
  }

  if (duel.phase === "intermission" && intermission) {
    return withExitControl(
      <DuelIntermission
        key={intermission.roundIndex}
        me={{
          handle: myHandle,
          avatarUrl: me.avatarUrl,
          roundPoints: duel.isPlayerA ? intermission.pointsA : intermission.pointsB,
        }}
        opponent={{
          handle: opponentHandle,
          avatarUrl: activeMatch.opponentAvatarUrl,
          roundPoints: duel.isPlayerA ? intermission.pointsB : intermission.pointsA,
        }}
        roundIndex={intermission.roundIndex}
        isLastRound={intermission.isLastRound}
        targetDriver={intermission.targetDriver}
        startScoreMine={duel.isPlayerA ? intermission.startScoreA : intermission.startScoreB}
        startScoreOpponent={duel.isPlayerA ? intermission.startScoreB : intermission.startScoreA}
        endScoreMine={duel.isPlayerA ? intermission.scoreA : intermission.scoreB}
        endScoreOpponent={duel.isPlayerA ? intermission.scoreB : intermission.scoreA}
        intermissionEndsAt={intermission.intermissionEndsAt}
        clockOffsetMs={clockOffsetMs}
        channel={channel}
        onDone={duel.proceedFromIntermission}
      />,
    );
  }

  if (!round) {
    return <p className="py-10 text-center text-sm text-text-muted">Loading match…</p>;
  }

  // One pre-round screen for EVERY round, round 0 included. Round 0 used to get
  // a combined view that drew the "Opponent found" header, both avatars AND the
  // lights at once -- so a rematch showed the reveal and the countdown stacked
  // on top of each other, while a fresh match showed them one after the other.
  // The reveal is now its own beat above (the staging screen), leaving this as
  // purely the countdown, identical for every round of every match.
  if (duel.isPreRound) {
    return withExitControl(
      <div className="flex flex-col items-center gap-6 px-4 py-10 text-center">
        <p className="text-sm text-text-muted">Round {round.roundIndex + 1} starting…</p>
        <LightsCountdown litCount={duel.lights.litCount} isGo={duel.lights.isGo} />
      </div>,
    );
  }

  return withExitControl(
    <RoundPlay
      me={{
        handle: myHandle,
        avatarUrl: me.avatarUrl,
        guesses: scoreboard.myGuesses,
        solved: scoreboard.mySolved,
        roundPoints: scoreboard.myRoundPointsRef.current,
        solveMs: scoreboard.mySolveMsRef.current,
      }}
      opponent={{
        handle: opponentHandle,
        avatarUrl: activeMatch.opponentAvatarUrl,
        progress: scoreboard.opponentProgress,
      }}
      roundIndex={round.roundIndex}
      remainingMs={duel.remainingToEnd}
      confirmedScoreA={scoreboard.roundStartScoreARef.current}
      confirmedScoreB={scoreboard.roundStartScoreBRef.current}
      isPlayerA={duel.isPlayerA}
      completedRounds={scoreboard.completedRounds}
      eligibleDrivers={eligibleDrivers}
      onGuess={duel.onGuess}
      pendingGuess={duel.pendingGuess}
    />,
  );
}
