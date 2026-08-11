"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import type { DriverOption } from "@/components/game/DriverAutocomplete";
import { LoadingOverlay } from "@/components/game/LoadingOverlay";
import { getMyLiveMatch } from "@/lib/duel/actions";
import { setLiveMatchId } from "@/lib/duel/duelCommitments";
import { matchHeartbeat } from "@/lib/duel/matchHeartbeat";
import { useDuelChannel } from "@/lib/duel/useDuelChannel";
import { useServerClock } from "@/lib/duel/useServerClock";
import { DUEL_HEARTBEAT_MS, READY_TIMEOUT_MS } from "@/lib/game/duelTiming";
import type { DriverWithActivity } from "@/lib/db/queries";
import type { MatchResult } from "@/lib/duel/matchmaking";

import { useActiveMatch } from "./ActiveMatchContext";
import { CustomLobby } from "./CustomLobby";
import { DuelCountdown } from "./DuelCountdown";
import { DuelLanding } from "./DuelLanding";
import { DuelMatch } from "./DuelMatch";
import { DuelMatchFound } from "./DuelMatchFound";
import { DuelSearching } from "./DuelSearching";

type Phase = "landing" | "searching" | "custom" | "found" | "countdown" | "in-match";

// The phases in which a real match exists and both players are in it: staging
// ("found" -- matched, avatars revealed), the countdown, and the match itself.
//
// THREE THINGS KEY OFF THIS and they must not drift apart: the site shell
// collapses (ActiveMatchContext), the match is registered as a live commitment
// for sign-out, and the server-side liveness beat runs. All three answer the
// same question -- "is this player in a match right now?" -- and they were
// spelled two different ways, with the shell using the looser `!== "landing"`.
// That made matchmaking and the custom-lobby screens hide the mode tabs, the
// marketing sections, the footer and the ad slot, which is wrong on both:
// waiting for an opponent and composing a lobby are ordinary browsing, and a
// host is very likely to want the rest of the page while they wait. The shell
// belongs to the player until someone is actually across the table.
const MATCH_PHASES: readonly Phase[] = ["found", "countdown", "in-match"];

function isMatchPhase(phase: Phase): boolean {
  return MATCH_PHASES.includes(phase);
}

// The /online loading state -- the resume check, and the brief wait for a
// profile on a resumed match.
//
// Renders the REAL landing screen (the Duel / Knockout mode cards) under the
// same blurred overlay the daily and infinite boards use, rather than a title
// over empty space. Two reasons: /online then loads the way every other mode on
// the site does -- the real thing, veiled -- and the card is already its final
// size, so nothing resizes when the overlay lifts and the same screen becomes
// interactive.
//
// `inert` is what actually makes it non-interactive. The overlay swallows
// pointer events by covering them, but keyboard focus walks straight past an
// overlay -- without this a tab press could reach "Duel" behind the blur and
// start a search while the resume check is still deciding whether this player
// is already in a match. Native React 19 boolean prop, no focus-trap needed.
function LoadingShell() {
  return (
    <div className="relative" aria-busy="true">
      <div inert>
        <DuelLanding onSelectDuel={() => {}} />
      </div>
      <LoadingOverlay label="Loading online modes" />
    </div>
  );
}

// Owns CLAUDE.md's Duel "Flow" steps 1-4 (mode select -> lobby/matchmaking
// -> match-found staging -> lights-out countdown) and hands off to
// DuelMatch, the still-stub in-match view, on GO. Also owns the shell/ad-slot
// gate, raised for MATCH_PHASES only (see above) -- including "in-match", and
// that inclusion is load-bearing: on the commit where phase flips to
// "in-match", DuelMatch's own mount effect setActive(true)'s too (it treats
// everything short of "finished" as needing the shell down, including its own
// brief loading fetch -- see that effect's comment), so the two agree instead
// of racing. If this effect excluded "in-match", child-before-parent effect
// ordering on that same commit would let this one stomp DuelMatch's true back
// to false. From there DuelMatch alone flips it back to false once truly
// finished; this effect doesn't fire again until phase changes, so it can't
// re-fight that.
export function DuelRoot({
  eligibleDrivers,
  allDrivers,
  referenceYear,
}: {
  eligibleDrivers: DriverOption[];
  // The full roster, for the custom lobby's filter panel and its live counts.
  // /online serves the same query /infinite does, under the same ISR.
  allDrivers: DriverWithActivity[];
  referenceYear: number;
}) {
  const { user, profile, stats, ensureIdentity } = useAuth();
  const { setActive } = useActiveMatch();

  const [phase, setPhase] = useState<Phase>("landing");

  // Picking a mode is the moment /online genuinely needs an identity — every
  // path out of the landing screen (matchmaking, hosting, joining) writes a row
  // authorized through auth.uid(). Firing it HERE rather than on mount is what
  // keeps a crawl of /online from minting a guest, and it starts the sign-in a
  // whole screen earlier than the first RPC that needs it, so the queue call
  // does not wait on it.
  //
  // Not awaited: DuelSearching and CustomLobby both resolve the identity
  // themselves before their first call, so this is a head start, not a
  // precondition.
  const enterPhase = useCallback(
    (next: Phase) => {
      void ensureIdentity();
      setPhase(next);
    },
    [ensureIdentity],
  );
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [holdComplete, setHoldComplete] = useState(false);
  const [readyTimedOut, setReadyTimedOut] = useState(false);
  // True until the resume check below settles -- keeps the landing screen
  // from flashing for a player who's about to be dropped back into a match.
  const [resuming, setResuming] = useState(true);
  // Round 0 as stamped by DuelCountdown, handed straight to DuelMatch so it can
  // render the board on its first paint instead of re-fetching timings it was
  // just given (see its `initialRound` prop).
  const [initialRound, setInitialRound] = useState<{ roundIndex: number; startedAt: string; endsAt: string } | null>(null);

  const { clockOffsetMs } = useServerClock();

  // /online?join=CODE. Read in a MOUNT EFFECT from window.location.search, then
  // stripped with history.replaceState so a refresh does not re-fire the join.
  //
  // Deliberately not `searchParams` on the page: that opts /online out of ISR
  // entirely, for a query string almost nobody arrives with. And deliberately
  // not useSearchParams(), which drags a Suspense boundary into what is a purely
  // client-side concern. The resume check below still wins -- a player already
  // in a match is put back in it rather than sent to a join screen.
  const [joinCode, setJoinCode] = useState<string | null>(null);
  // A ref as well as state, because the resume effect below reads this from
  // inside an async callback: both effects run on the same mount, so the state
  // setter has not committed by the time getMyLiveMatch resolves, and the
  // callback's closure would still see null.
  const joinCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("join");
    if (!code) return;
    joinCodeRef.current = code;
    setJoinCode(code);
    const url = new URL(window.location.href);
    url.searchParams.delete("join");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

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
      } else if (joinCodeRef.current !== null) {
        // A deep link, and nothing to resume -- go straight to the join screen
        // rather than making someone who followed a link find it themselves.
        setPhase("custom");
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
    setActive(isMatchPhase(phase));
  }, [phase, setActive]);

  // Publish the live match so AuthProvider.signOut() can forfeit it rather than
  // stranding the opponent for DISCONNECT_GRACE_MS. Registered for every phase
  // that has a real match behind it, including the post-match results view --
  // duel_forfeit is a no-op on an already-finished match, so erring broad here
  // costs nothing and erring narrow would miss a real mid-match sign-out.
  useEffect(() => {
    const live = isMatchPhase(phase) ? (match?.matchId ?? null) : null;
    setLiveMatchId(live);
    return () => setLiveMatchId(null);
  }, [phase, match]);

  // Server-side liveness (drizzle/0040). Presence tells the two CLIENTS whether
  // each other are there; this is what tells the DATABASE, which is where the
  // decision that actually writes Elo gets authorized -- forfeitMatch refuses to
  // forfeit a player whose beat isn't stale past DISCONNECT_GRACE_MS.
  //
  // Deliberately here and not in DuelMatch: the beat has to cover every phase in
  // which the opponent's grace timer could fire against you, and that starts at
  // staging (`found`), one component up. It stops by itself once the RPC reports
  // the match terminal, so the results screen isn't writing every 5s while
  // someone thinks about a rematch. Ends up in exactly the same phases
  // setLiveMatchId covers above, for the same reason.
  //
  // Living here is only safe because the match id lives here too: it re-arms on
  // a rematch's new id (handleMatchIdChange) after having stood itself down on
  // the old match's terminal status. That is precisely what it could not do
  // while the id was owned in two places -- see that handler.
  const heartbeatMatchId = isMatchPhase(phase) ? (match?.matchId ?? null) : null;
  useEffect(() => {
    if (heartbeatMatchId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const beat = async () => {
      const result = await matchHeartbeat(heartbeatMatchId);
      // "error" keeps the interval alive on purpose -- a beat lost to a flaky
      // connection must not stand liveness down and make a present player
      // forfeitable. Only a definitive "this match is over" stops it.
      if (!cancelled && result === "terminal") stop();
    };
    void beat();
    timer = setInterval(() => void beat(), DUEL_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [heartbeatMatchId]);

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

  // A rematch (CLAUDE.md "Rematch is mutual consent") pairs the same two players
  // into a NEW duel_matches row, so `match.matchId` has to move with it -- the
  // two effects above are keyed on it.
  //
  // This used to live only inside useDuelLifecycle's own copy of the match, and
  // the consequence was that both of them went inert for the entire rematch
  // (audit 2026-07-29 §0.1): the heartbeat had already stopped itself on the old
  // match's terminal status and never re-armed, so neither player's
  // last_seen_a/b moved past the row's insert-time default -- both were "stale"
  // about four seconds into round 1, and forfeitMatch's server-verified absence
  // check (drizzle/0040), the whole of §3.3's fix, would authorize forfeiting a
  // fully present opponent for real Elo. Signing out mid-rematch forfeited the
  // already-finished match too, stranding the opponent. The id is one value now.
  function handleMatchIdChange(newMatchId: number) {
    setMatch((prev) => (prev ? { ...prev, matchId: newMatchId } : prev));
    // Round 0 of the PREVIOUS match. The rematch stamps its own once its
    // ready-gate passes, so this must not be handed to it as a starting point.
    setInitialRound(null);
  }

  // "Find new opponent" from a RANKED match goes back to matchmaking; from a
  // custom one it goes back to the custom flow. Dropping someone out of a
  // friendly game into public matchmaking is a mode switch they did not ask
  // for -- see DuelResults, which relabels the button to match.
  function handleFindNewOpponent() {
    const wasCustom = match !== null && !match.ranked;
    setMatch(null);
    setInitialRound(null);
    setPhase(wasCustom ? "custom" : "searching");
  }

  // Results-panel "Back to modes" -- back to the /online landing (mode
  // select). The route never changed; only this phase state did.
  function handleBackToModes() {
    setMatch(null);
    setInitialRound(null);
    setPhase("landing");
  }

  if (resuming) {
    return <LoadingShell />;
  }

  if (phase === "landing") {
    return <DuelLanding onSelectDuel={() => enterPhase("searching")} onSelectCustom={() => enterPhase("custom")} />;
  }

  if (phase === "searching") {
    return <DuelSearching onFound={handleFound} onCancel={() => setPhase("landing")} />;
  }

  // One phase, one branch. CustomLobby owns menu/create/waiting/join itself and
  // hands back a MatchResult through the same onFound seam DuelSearching uses,
  // so a custom match reaches staging, the ready-gate, the countdown and the
  // match view by the identical path a matchmade one does.
  if (phase === "custom") {
    return (
      <CustomLobby
        allDrivers={allDrivers}
        referenceYear={referenceYear}
        initialJoinCode={joinCode ?? undefined}
        onMatchFound={handleFound}
        onBack={() => setPhase("landing")}
      />
    );
  }

  if (!match) {
    // Shouldn't happen -- "found"/"countdown"/"in-match" only ever follow
    // handleFound or the resume effect, both of which set it. Falls back
    // to the landing screen rather than rendering nothing if it somehow
    // does.
    return <DuelLanding onSelectDuel={() => enterPhase("searching")} onSelectCustom={() => enterPhase("custom")} />;
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
        onGo={(round) => {
          setInitialRound(round);
          setPhase("in-match");
        }}
      />
    );
  }

  return (
    <DuelMatch
      me={profile}
      myRating={stats?.duelRating ?? null}
      match={match}
      initialRound={initialRound}
      eligibleDrivers={eligibleDrivers}
      clockOffsetMs={clockOffsetMs}
      onMatchIdChange={handleMatchIdChange}
      onFindNewOpponent={handleFindNewOpponent}
      onBackToModes={handleBackToModes}
    />
  );
}
