"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { useToast } from "@/components/ui/Toast";
import {
  LOBBY_CHANNEL,
  MATCHED_EVENT,
  leaveQueue,
  matchOrQueue,
  type MatchedBroadcastPayload,
  type MatchResult,
} from "@/lib/duel/matchmaking";
import { LOBBY_MIN_SEARCH_MS, MATCHMAKE_POLL_INTERVAL_MS } from "@/lib/game/duelTiming";
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
  const { user, profile, stats } = useAuth();
  const toast = useToast();
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

  useEffect(() => {
    if (!user) return;
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

    void attempt();
    const interval = setInterval(() => void attempt(), MATCHMAKE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
      if (!matchRef.current) void leaveQueue(userId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function handleCancel() {
    if (user) void leaveQueue(user.id);
    onCancel();
  }

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold tracking-wide text-accent uppercase">Finding an opponent</p>
        <div
          className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>

      <div className="flex w-full items-center justify-center gap-4">
        <div className="flex flex-1 flex-col items-center gap-2">
          {profile && <AvatarGlyph avatarUrl={profile.avatarUrl} size="md" />}
          <p className="max-w-full truncate text-sm font-semibold text-text">
            {profile ? profile.displayName || profile.username : "You"}
          </p>
          <RatingBadge rating={stats?.duelRating ?? null} />
        </div>

        <span className="text-lg font-bold text-text-muted">VS</span>

        <div className="flex flex-1 flex-col items-center gap-2">
          <EmptyAvatarSlot />
          <p className="max-w-full truncate text-sm text-text-muted">Waiting…</p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleCancel}
        className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Cancel
      </button>
    </div>
  );
}
