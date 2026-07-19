"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import type { DriverOption } from "@/components/game/DriverAutocomplete";
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
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { DuelMatch } from "./DuelMatch";

const POLL_INTERVAL_MS = 4_000;

// Dashed-outline stand-in for the opponent slot while none is matched yet --
// same size/shape as AvatarGlyph so it drops into the identical "me VS
// them" layout MatchFoundReveal uses once a real opponent avatar lands,
// making the transition from searching to matched feel continuous instead
// of swapping to a different screen.
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

export function MatchmakingLobby({
  eligibleDrivers,
  onCancel,
}: {
  eligibleDrivers: DriverOption[];
  onCancel: () => void;
}) {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [onlineCount, setOnlineCount] = useState(1);
  const [match, setMatch] = useState<MatchResult | null>(null);
  // Mirrors `match` synchronously so the poll/broadcast callbacks below
  // (captured once per effect run) can tell "already matched" apart from
  // stale state without re-subscribing the channel on every match update.
  const matchRef = useRef<MatchResult | null>(null);
  const pendingRef = useRef(false);

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
      setMatch(found);
    }

    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineCount(Object.keys(channel.presenceState()).length);
      })
      .on("broadcast", { event: MATCHED_EVENT }, ({ payload }) => {
        const data = payload as MatchedBroadcastPayload;
        if (data.forUserId !== userId) return;
        handleMatched({
          matchId: data.matchId,
          opponentId: data.opponentId,
          opponentUsername: data.opponentUsername,
          opponentDisplayName: data.opponentDisplayName,
          opponentAvatarUrl: data.opponentAvatarUrl,
          youAre: data.youAre,
          matchCreatedAt: data.matchCreatedAt,
        });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ userId });
        }
      });

    async function attempt() {
      if (pendingRef.current || matchRef.current) return;
      pendingRef.current = true;
      try {
        const result = await matchOrQueue();
        pendingRef.current = false;
        if (!result || matchRef.current) return;
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
    const interval = setInterval(() => void attempt(), POLL_INTERVAL_MS);

    return () => {
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

  // The finished match is no longer `status = 'active'`, so the very next
  // poll tick's matchOrQueue() call naturally searches fresh -- no remount
  // or new effect needed, just clearing what we already matched.
  function handleFindNewOpponent() {
    matchRef.current = null;
    setMatch(null);
  }

  if (match && profile) {
    return (
      <DuelMatch
        me={profile}
        match={match}
        eligibleDrivers={eligibleDrivers}
        onFindNewOpponent={handleFindNewOpponent}
      />
    );
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
        </div>

        <span className="text-lg font-bold text-text-muted">VS</span>

        <div className="flex flex-1 flex-col items-center gap-2">
          <EmptyAvatarSlot />
          <p className="max-w-full truncate text-sm text-text-muted">Waiting…</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p className="text-xs text-text-muted">{onlineCount} online</p>
      </div>

      <button
        type="button"
        onClick={handleCancel}
        className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text"
      >
        Cancel
      </button>
    </div>
  );
}
