"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import type { DriverOption } from "@/components/game/DriverAutocomplete";
import { getMyLiveMatch } from "@/lib/duel/actions";
import { useDuelChannel } from "@/lib/duel/useDuelChannel";
import { useServerClock } from "@/lib/duel/useServerClock";
import { READY_TIMEOUT_MS } from "@/lib/game/duelTiming";
import type { MatchResult } from "@/lib/duel/matchmaking";

import { useActiveMatch } from "./ActiveMatchContext";
import { DuelCountdown } from "./DuelCountdown";
import { DuelLanding } from "./DuelLanding";
import { DuelMatch } from "./DuelMatch";
import { DuelMatchFound } from "./DuelMatchFound";
import { DuelSearching } from "./DuelSearching";

type Phase = "landing" | "searching" | "found" | "countdown" | "in-match";

// Same header + container as app/(game)/online/loading.tsx and
// DuelLanding's own header -- the Suspense fallback, this component's own
// "resuming"/"!profile" loading states, and the eventual landing screen are
// three separate returns that all show up in the same slot in quick
// succession on a cold /online load, so they need to be pixel-identical or
// the page visibly jumps size and title between each one.
function LoadingShell() {
  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">Online</p>
      </header>
      <div className="py-12 text-center text-sm text-text-muted">Loading…</div>
    </div>
  );
}

// Owns CLAUDE.md's Duel "Flow" steps 1-4 (mode select -> lobby/matchmaking
// -> match-found staging -> lights-out countdown) and hands off to
// DuelMatch, the still-stub in-match view, on GO. Also owns the ad-slot
// gate for every one of those pre-round phases plus the handoff itself --
// CLAUDE.md: "Hide the ad slot ... through the whole match." Deliberately
// true for every phase except "landing" (including "in-match"): on the
// commit where phase flips to "in-match", DuelMatch's own mount effect
// setActive(true)'s too (it treats everything short of "finished" as
// needing ads off, including its own brief loading fetch -- see that
// effect's comment), so the two agree instead of racing -- if this effect
// excluded "in-match", child-before-parent effect ordering on that same
// commit would let this one stomp DuelMatch's true back to false. From
// there DuelMatch alone flips it back to false once truly finished; this
// effect doesn't fire again until phase changes, so it can't re-fight that.
export function DuelRoot({ eligibleDrivers }: { eligibleDrivers: DriverOption[] }) {
  const { user, profile, stats } = useAuth();
  const { setActive } = useActiveMatch();

  const [phase, setPhase] = useState<Phase>("landing");
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [holdComplete, setHoldComplete] = useState(false);
  const [readyTimedOut, setReadyTimedOut] = useState(false);
  // True until the resume check below settles -- keeps the landing screen
  // from flashing for a player who's about to be dropped back into a match.
  const [resuming, setResuming] = useState(true);

  const { clockOffsetMs } = useServerClock();

  // Resume (CLAUDE.md "Reconnect/resume"): a reloaded client with a live
  // match rejoins it instead of landing on mode select. Status 'lobby'
  // means the pre-round ready-gate never completed, so re-enter staging
  // (the gate machinery just runs again); anything else goes straight to
  // the match view, which re-derives its own beat -- active round with
  // corrected clock, between-rounds gap, or a terminal result -- from
  // duel_state. Finished/abandoned matches are never returned here, so a
  // fresh visit can't re-enter one.
  useEffect(() => {
    let cancelled = false;
    void getMyLiveMatch().then((res) => {
      if (cancelled) return;
      if (res.ok && res.match) {
        setMatch(res.match);
        setPhase(res.matchStatus === "lobby" ? "found" : "in-match");
      }
      setResuming(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only actually connects while there's a real match to stage/count down
  // for -- null during landing/searching, and deliberately reset to null
  // again once "in-match" hands off, so this channel closes right as
  // DuelMatch opens its own subscription to the same duel:{matchId} topic
  // instead of two independent subscriptions overlapping.
  const channelMatchId = phase === "found" || phase === "countdown" ? (match?.matchId ?? null) : null;
  const channel = useDuelChannel(channelMatchId, user?.id ?? null, match?.opponentId ?? null);

  useEffect(() => {
    setActive(phase !== "landing");
  }, [phase, setActive]);

  function handleFound(found: MatchResult) {
    setMatch(found);
    setHoldComplete(false);
    setReadyTimedOut(false);
    setPhase("found");

    // The staging screen must show the opponent's rating/record before
    // round 1 (CLAUDE.md's grid-start reveal). The joiner's copy comes from
    // match_or_queue (DB, always populated), but the *waiting* player's
    // comes from the joiner's MATCHED_EVENT broadcast -- a snapshot of the
    // joiner's own useAuth() stats, which a fresh guest may not have
    // loaded yet (null). Backfill from the server (duel_state reads
    // user_stats directly) so the badge appears a beat later instead of
    // never.
    if (found.opponentRating === null) {
      void getMyLiveMatch().then((res) => {
        if (!res.ok || !res.match || res.match.matchId !== found.matchId) return;
        const fresh = res.match;
        setMatch((prev) =>
          prev && prev.matchId === found.matchId
            ? { ...prev, opponentRating: fresh.opponentRating, opponentDuelWins: fresh.opponentDuelWins, opponentDuelLosses: fresh.opponentDuelLosses }
            : prev,
        );
      });
    }
  }

  function handleHoldComplete() {
    setHoldComplete(true);
    channel.sendReady();
  }

  // Fallback if the opponent never reports ready (CLAUDE.md's
  // READY_TIMEOUT_MS) -- starts once *I've* sent my own ready, per
  // duelTiming.ts's framing ("fallback if a client never reports ready").
  useEffect(() => {
    if (!holdComplete) return;
    const timeout = setTimeout(() => setReadyTimedOut(true), READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [holdComplete]);

  const readyGatePassed = holdComplete && channel.ready && (channel.opponentReady || readyTimedOut);
  const readyGatePassedRef = useRef(false);
  useEffect(() => {
    if (phase === "found" && readyGatePassed && !readyGatePassedRef.current) {
      readyGatePassedRef.current = true;
      setPhase("countdown");
    }
    if (phase !== "found") readyGatePassedRef.current = false;
  }, [phase, readyGatePassed]);

  function handleFindNewOpponent() {
    setMatch(null);
    setPhase("searching");
  }

  // Results-panel "Back to modes" -- back to the /online landing (mode
  // select). The route never changed; only this phase state did.
  function handleBackToModes() {
    setMatch(null);
    setPhase("landing");
  }

  if (resuming) {
    return <LoadingShell />;
  }

  if (phase === "landing") {
    return <DuelLanding onSelectDuel={() => setPhase("searching")} />;
  }

  if (phase === "searching") {
    return <DuelSearching onFound={handleFound} onCancel={() => setPhase("landing")} />;
  }

  if (!match) {
    // Shouldn't happen -- "found"/"countdown"/"in-match" only ever follow
    // handleFound or the resume effect, both of which set it. Falls back
    // to the landing screen rather than rendering nothing if it somehow
    // does.
    return <DuelLanding onSelectDuel={() => setPhase("searching")} />;
  }

  if (!profile) {
    // A resumed match can be ready before AuthProvider has loaded the
    // profile -- brief; don't bounce to the landing screen over it.
    return <LoadingShell />;
  }

  if (phase === "found") {
    return (
      <DuelMatchFound
        me={profile}
        myRating={stats?.duelRating ?? null}
        opponent={{
          username: match.opponentUsername,
          displayName: match.opponentDisplayName,
          avatarUrl: match.opponentAvatarUrl,
          rating: match.opponentRating,
        }}
        waitingOnOpponent={holdComplete && !channel.opponentReady && !readyTimedOut}
        onHoldComplete={handleHoldComplete}
      />
    );
  }

  if (phase === "countdown") {
    return (
      <DuelCountdown
        matchId={match.matchId}
        roundIndex={0}
        clockOffsetMs={clockOffsetMs}
        onGo={() => setPhase("in-match")}
      />
    );
  }

  return (
    <DuelMatch
      me={profile}
      myRating={stats?.duelRating ?? null}
      match={match}
      eligibleDrivers={eligibleDrivers}
      clockOffsetMs={clockOffsetMs}
      onFindNewOpponent={handleFindNewOpponent}
      onBackToModes={handleBackToModes}
    />
  );
}
