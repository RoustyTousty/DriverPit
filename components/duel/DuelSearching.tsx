"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { setQueued } from "@/lib/duel/duelCommitments";
import {
  LOBBY_CHANNEL,
  MATCHED_EVENT,
  leaveQueue,
  leaveQueueOnUnload,
  matchOrQueue,
  queueHeartbeat,
  type MatchedBroadcastPayload,
  type MatchResult,
} from "@/lib/duel/matchmaking";
import {
  LOBBY_MIN_SEARCH_MS,
  MATCHMAKE_POLL_INTERVAL_MS,
  QUEUE_HEARTBEAT_MS,
} from "@/lib/game/duelTiming";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { RatingBadge } from "./MatchFoundReveal";

// Dashed-outline stand-in for the opponent slot while none is matched yet --
// same size/shape as AvatarGlyph so it drops into the identical "me VS
// them" layout the match-found staging screen uses once a real opponent
// avatar lands, making the transition feel continuous rather than a jump
// to a different layout.
function EmptyAvatarSlot() {
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border"
      aria-hidden="true"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-text-muted motion-reduce:animate-none" />
    </div>
  );
}

// CLAUDE.md's Duel "Flow" step 2: renders the searching UI first (this
// screen) and enforces LOBBY_MIN_SEARCH_MS before ever calling onFound --
// even a match resolved on the very first matchOrQueue() poll still holds
// here for the full minimum so the lobby always visibly loads in, rather
// than a click-through flash straight to the next screen.
export function DuelSearching({
  onFound,
  onCancel,
}: {
  onFound: (match: MatchResult) => void;
  onCancel: () => void;
}) {
  const { user, session, profile, stats } = useAuth();
  const toast = useToast();
  // The identity this search belongs to. An identity change mid-search is NOT
  // a reason to re-queue under the new id -- see the abort effect below.
  const searchIdentityRef = useRef<string | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  // Mirrors state the poll/broadcast callbacks below (captured once per
  // effect run) need to read synchronously without re-subscribing the
  // channel on every update.
  const matchRef = useRef<MatchResult | null>(null);
  const minHoldElapsedRef = useRef(false);
  const foundRef = useRef(onFound);
  foundRef.current = onFound;

  useEffect(() => {
    const timeout = setTimeout(() => {
      minHoldElapsedRef.current = true;
      if (matchRef.current) foundRef.current(matchRef.current);
    }, LOBBY_MIN_SEARCH_MS);
    return () => clearTimeout(timeout);
  }, []);

  // LAYER 2 -- an identity change during a search ABORTS the search. This is a
  // deliberate exception to the app-wide auth-reactivity rule: readers
  // re-resolve for the new identity, but live server commitments (a queue
  // entry, an active match) are released and abandoned, never re-established
  // under the new id. Re-queueing on the new identity is precisely what let a
  // signed-out player get paired with the row their previous identity left
  // behind -- i.e. duel themselves for real rating.
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (searchIdentityRef.current === null) {
      searchIdentityRef.current = currentId;
      return;
    }
    if (currentId === searchIdentityRef.current) return;

    // Best-effort under the NEW session (the old one can no longer authenticate
    // anything). The row the old identity left is handled by the pre-signOut
    // dequeue, and failing that by the liveness + device_id layers server-side.
    void leaveQueue().catch(() => {});
    cancelRef.current();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // Never start -- or RESTART -- a search under a different identity than the
    // one it began with. The abort effect above is what handles that case;
    // without this guard the effect's own [user] dependency would simply
    // re-queue under the new id, recreating the bug.
    if (searchIdentityRef.current !== null && searchIdentityRef.current !== user.id) return;
    searchIdentityRef.current = user.id;
    // Function *declarations* below (attempt, handleMatched) are hoisted,
    // so TS can't carry the `user` non-null narrowing into their bodies --
    // capture a plain narrowed value instead of repeating `user!.id`.
    const userId = user.id;

    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(LOBBY_CHANNEL, {
      config: { presence: { key: userId } },
    });

    function handleMatched(found: MatchResult) {
      if (matchRef.current) return;
      matchRef.current = found;
      // Only actually hand off once the minimum search hold has elapsed --
      // otherwise the timeout above does it the moment that hold ends.
      if (minHoldElapsedRef.current) foundRef.current(found);
    }

    channel
      .on("broadcast", { event: MATCHED_EVENT }, ({ payload }) => {
        const data = payload as MatchedBroadcastPayload;
        if (data.forUserId !== userId) return;
        handleMatched({
          matchId: data.matchId,
          opponentId: data.opponentId,
          opponentUsername: data.opponentUsername,
          opponentDisplayName: data.opponentDisplayName,
          opponentAvatarUrl: data.opponentAvatarUrl,
          opponentRating: data.opponentRating,
          opponentDuelWins: data.opponentDuelWins,
          opponentDuelLosses: data.opponentDuelLosses,
          youAre: data.youAre,
          matchCreatedAt: data.matchCreatedAt,
        });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ userId });
        }
      });

    let cancelled = false;
    const pendingRef = { current: false };

    async function attempt() {
      if (pendingRef.current || matchRef.current) return;
      pendingRef.current = true;
      try {
        const result = await matchOrQueue();
        pendingRef.current = false;
        if (cancelled || !result || matchRef.current) return;
        handleMatched(result);

        // Only the joiner (the call that found a pre-existing waiting
        // opponent) needs to push -- the opponent has no way to learn
        // about the match otherwise until their own next poll.
        if (result.youAre === "b" && profile) {
          const payload: MatchedBroadcastPayload = {
            forUserId: result.opponentId,
            matchId: result.matchId,
            matchCreatedAt: result.matchCreatedAt,
            youAre: "a",
            opponentId: userId,
            opponentUsername: profile.username,
            opponentDisplayName: profile.displayName,
            opponentAvatarUrl: profile.avatarUrl,
            opponentRating: stats?.duelRating ?? null,
            opponentDuelWins: stats?.duelWins ?? 0,
            opponentDuelLosses: stats?.duelLosses ?? 0,
          };
          await channel.send({ type: "broadcast", event: MATCHED_EVENT, payload });
        }
      } catch (err) {
        pendingRef.current = false;
        console.error("matchOrQueue failed", err);
        toast.error("Something went wrong finding a match. Try again.");
      }
    }

    // Publish the queue commitment so signing out can dequeue first (and warn
    // the player that it will) rather than leaving a matchable row behind.
    setQueued(true);

    void attempt();
    const interval = setInterval(() => void attempt(), MATCHMAKE_POLL_INTERVAL_MS);

    // LAYER 3 -- liveness. An explicit RPC heartbeat rather than deriving it
    // from this component's Realtime presence on the lobby channel: presence
    // tracks a WebSocket, while the thing that must be proven alive is a row in
    // matchmaking_queue. Those two can disagree in both directions (subscribed
    // but never successfully enqueued; enqueued while the socket is briefly
    // reconnecting), and pairing reads the row, not the socket. Writing
    // last_seen_at on the same row the pairing scan filters keeps liveness and
    // matchability in one system with no cross-system skew to reason about.
    const heartbeat = setInterval(() => {
      if (matchRef.current) return; // paired: the row is already gone
      void queueHeartbeat().catch(() => {
        // A dropped beat is survivable -- QUEUE_STALE_MS allows for two.
      });
    }, QUEUE_HEARTBEAT_MS);

    // Tab close / navigation away. Best-effort keepalive POST; if it doesn't
    // land, the heartbeat above simply stops and the row goes stale.
    const token = session?.access_token;
    function handleUnload() {
      if (matchRef.current || !token) return;
      leaveQueueOnUnload(token);
    }
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      cancelled = true;
      setQueued(false);
      clearInterval(interval);
      clearInterval(heartbeat);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      supabase.removeChannel(channel);
      // Unmount = every exit from searching that isn't a pairing: Cancel,
      // navigating away from /online, the identity-change abort above.
      if (!matchRef.current) void leaveQueue().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function handleCancel() {
    void leaveQueue().catch(() => {});
    onCancel();
  }

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center">
      <p className="text-xs font-semibold tracking-wide text-accent uppercase">Finding an opponent</p>

      <div className="flex w-full items-center justify-center gap-4">
        <div className="flex flex-1 flex-col items-center gap-2">
          {profile && <AvatarGlyph avatarUrl={profile.avatarUrl} size="md" />}
          <p className="max-w-full truncate text-sm font-semibold text-text">
            {profile ? profile.displayName || profile.username : "You"}
          </p>
          <RatingBadge rating={stats?.duelRating ?? null} />
        </div>

        {/* Sits in the exact slot DuelMatchFound/MatchFoundReveal put "VS" in,
            so the handoff to the staging screen reads as the spinner *becoming*
            VS -- the matchup resolving -- rather than two unrelated screens
            swapping. Same reason EmptyAvatarSlot above matches AvatarGlyph's
            footprint. This is also the only loading indicator on this screen
            now; a second one next to "Finding an opponent" was saying the same
            thing twice. */}
        <Spinner />

        <div className="flex flex-1 flex-col items-center gap-2">
          <EmptyAvatarSlot />
          <p className="max-w-full truncate text-sm text-text-muted">Waiting…</p>
        </div>
      </div>

      {/* Same quiet full-width text treatment as the duel's other two "leave
          this screen" controls -- Exit match mid-duel and Back to modes on the
          results panel. Backing out of a duel looks the same wherever you do
          it, and none of the three competes with the accent buttons beside
          them. */}
      <button
        type="button"
        onClick={handleCancel}
        className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Cancel
      </button>
    </div>
  );
}
