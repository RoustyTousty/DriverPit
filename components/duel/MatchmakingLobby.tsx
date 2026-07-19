"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import type { DriverOption } from "@/components/game/DriverAutocomplete";
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

export function MatchmakingLobby({
  eligibleDrivers,
  onCancel,
}: {
  eligibleDrivers: DriverOption[];
  onCancel: () => void;
}) {
  const { user, profile } = useAuth();
  const [onlineCount, setOnlineCount] = useState(1);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        setError("Something went wrong finding a match. Try again.");
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

  if (match && profile) {
    return <DuelMatch me={profile} match={match} eligibleDrivers={eligibleDrivers} />;
  }

  return (
    <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div>
        <p className="text-sm font-semibold text-text">Searching for an opponent…</p>
        <p className="text-xs text-text-muted">{onlineCount} online</p>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
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
