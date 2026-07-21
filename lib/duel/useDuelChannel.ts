"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { duelChannelName } from "./liveMatch";
import {
  FORFEIT_EVENT,
  GUESS_EVENT,
  MATCH_END_EVENT,
  READY_EVENT,
  REMATCH_EVENT,
  ROUND_END_EVENT,
  ROUND_START_EVENT,
  SOLVED_EVENT,
  type ForfeitPayload,
  type GuessPayload,
  type MatchEndPayload,
  type ReadyPayload,
  type RematchPayload,
  type RoundEndPayload,
  type RoundStartPayload,
  type SolvedPayload,
} from "./realtimeEvents";

export interface DuelChannelHandlers {
  onRoundStart?: (payload: RoundStartPayload) => void;
  onGuess?: (payload: GuessPayload) => void;
  onSolved?: (payload: SolvedPayload) => void;
  onRoundEnd?: (payload: RoundEndPayload) => void;
  onMatchEnd?: (payload: MatchEndPayload) => void;
  onForfeit?: (payload: ForfeitPayload) => void;
  // The opponent's requestRematch created the new match (sent on this, the
  // OLD match's, channel) -- transition to it.
  onRematch?: (payload: RematchPayload) => void;
  // Presence join/leave for the *opponent* specifically -- surfaced so a
  // later prompt can drive the disconnect-grace-period timer
  // (DISCONNECT_GRACE_MS, lib/game/duelTiming.ts) off real leave events
  // rather than polling presence state itself.
  onOpponentJoin?: () => void;
  onOpponentLeave?: () => void;
}

export interface DuelChannelState {
  // This client's own subscription is live (SUBSCRIBED, not just "created").
  connected: boolean;
  // I've called sendReady() -- mirrors what I've broadcast, not a
  // server-confirmed round-trip.
  ready: boolean;
  opponentConnected: boolean;
  opponentReady: boolean;
  sendReady: () => void;
  // Clears this client's own ready flag back to false -- for a ready-gate
  // that repeats more than once per match (CLAUDE.md's Duel "Intermission":
  // "a ready-gate (sendReady() again) before duel_begin_round(next)").
  // Without this, a stale `ready: true` left over from round 1's gate would
  // trivially satisfy round 2's gate the instant it starts, with neither
  // side actually re-confirming they're back.
  resetReady: () => void;
  broadcastGuess: (payload: Omit<GuessPayload, "playerId">) => void;
  broadcastSolved: (payload: Omit<SolvedPayload, "playerId">) => void;
  broadcastRoundStart: (payload: RoundStartPayload) => void;
  broadcastRoundEnd: (payload: RoundEndPayload) => void;
  broadcastMatchEnd: (payload: MatchEndPayload) => void;
  // Announces this client's own forfeit -- after duel_forfeit on explicit
  // exit (so the opponent hears immediately instead of on their next
  // poll), or best-effort from beforeunload/pagehide where the RPC may
  // never get to run (the receiver then verifies against the server before
  // treating it as real -- see DuelMatch's onForfeit).
  broadcastForfeit: () => void;
  broadcastRematch: (payload: RematchPayload) => void;
}

// The duel:{matchId} transport (CLAUDE.md's "Realtime channels"): broadcast
// for every match event including readiness, presence for connection
// membership only. Everything that touches Supabase Realtime for a live
// match should go through this hook rather than opening a channel directly,
// so the wiring can't drift between whatever screens end up consuming it.
//
// Readiness rides on broadcast (READY_EVENT), not presence `track()`, even
// though CLAUDE.md's schema note ("readiness is realtime-only, presence/
// broadcast") allows either -- found live while building the Intermission
// beat: presence has its own, much stricter Supabase rate limit ("Client
// presence rate limit exceeded"), and a single match trips it on its own.
// Every ready-gate (the pre-match hold in DuelRoot, then once per round's
// intermission here) calls sendReady()/resetReady() at least once; by the
// third round that's enough track() calls on one connection to get the
// whole channel force-closed by the server, silently, with no reconnect --
// every client permanently stuck wherever it was. Broadcast has no such
// ceiling in practice (guess/solved already fire one per guess all match,
// every match, with no issue), so readiness moved there instead; presence
// is kept for the one thing it's actually needed for -- join/leave
// membership -- via a single track() call per subscription, never repeated.
//
// Presence is keyed by user id (`config.presence.key`, not Realtime's
// default random key) so "my presence" vs "the opponent's presence" is a
// direct lookup by a known id -- exactly two participants in a duel, per
// CLAUDE.md -- rather than "whichever key isn't mine."
//
// broadcastRoundStart/broadcastRoundEnd/broadcastMatchEnd: sent by
// whichever client's duel_begin_round/duel_close_round call actually
// performed a round transition, close, or match finish, as a fast-path
// nudge for the other client (which otherwise only finds out on its own
// next safety-net poll or timer expiry). round_start's receiving side
// still re-confirms authoritative state via its own idempotent RPC calls
// rather than trusting the payload outright for anything render-affecting
// (see components/duel/DuelMatch.tsx); round_end's payload is authoritative
// as-is (duel_close_round already returned everything in it to the closing
// client, so the receiving client uses it directly to drive its own
// intermission). forfeit is advisory: the receiver always re-verifies
// against the server (getDuelState) before treating it as real, since a
// beforeunload broadcast can outrun -- or entirely outlive -- the
// leaver's own duel_forfeit call.
//
// matchId/myUserId/opponentUserId accept null so a component that doesn't
// know them yet (e.g. an orchestrator still on its "searching for an
// opponent" phase) can call this hook unconditionally -- required by the
// rules of hooks -- and simply get a no-op, disconnected channel back until
// real ids are available.
export function useDuelChannel(
  matchId: number | null,
  myUserId: string | null,
  opponentUserId: string | null,
  handlers: DuelChannelHandlers = {},
): DuelChannelState {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  // Latest handlers, read at event-fire time -- keeps the subscription
  // effect below stable (doesn't need `handlers` in its deps, which would
  // otherwise resubscribe on every render for callers passing inline
  // functions) while still calling the current-render's callbacks, not a
  // stale mount-time closure.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    setConnected(false);
    setReady(false);
    setOpponentConnected(false);
    setOpponentReady(false);

    if (matchId === null || myUserId === null || opponentUserId === null) return;
    // TS doesn't propagate the null-check above into closures declared
    // below (a documented control-flow-narrowing limitation for function
    // parameters) -- these `const`s carry the narrowed `string`/`number`
    // type into every callback that follows.
    const safeMyUserId = myUserId;
    const safeOpponentUserId = opponentUserId;

    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(duelChannelName(matchId), {
      config: { presence: { key: safeMyUserId } },
    });
    channelRef.current = channel;

    function syncOpponentPresence() {
      const state = channel.presenceState();
      const entries = state[safeOpponentUserId];
      setOpponentConnected(!!entries && entries.length > 0);
    }

    channel
      .on("broadcast", { event: ROUND_START_EVENT }, ({ payload }) => {
        handlersRef.current.onRoundStart?.(payload as RoundStartPayload);
      })
      .on("broadcast", { event: GUESS_EVENT }, ({ payload }) => {
        const data = payload as GuessPayload;
        if (data.playerId === safeMyUserId) return; // same-user second tab, not the opponent
        handlersRef.current.onGuess?.(data);
      })
      .on("broadcast", { event: SOLVED_EVENT }, ({ payload }) => {
        const data = payload as SolvedPayload;
        if (data.playerId === safeMyUserId) return;
        handlersRef.current.onSolved?.(data);
      })
      .on("broadcast", { event: ROUND_END_EVENT }, ({ payload }) => {
        handlersRef.current.onRoundEnd?.(payload as RoundEndPayload);
      })
      .on("broadcast", { event: MATCH_END_EVENT }, ({ payload }) => {
        handlersRef.current.onMatchEnd?.(payload as MatchEndPayload);
      })
      .on("broadcast", { event: FORFEIT_EVENT }, ({ payload }) => {
        const data = payload as ForfeitPayload;
        if (data.playerId === safeMyUserId) return; // same-user second tab
        handlersRef.current.onForfeit?.(data);
      })
      .on("broadcast", { event: REMATCH_EVENT }, ({ payload }) => {
        handlersRef.current.onRematch?.(payload as RematchPayload);
      })
      .on("broadcast", { event: READY_EVENT }, ({ payload }) => {
        const data = payload as ReadyPayload;
        if (data.playerId === safeMyUserId) return;
        setOpponentReady(data.ready);
      })
      .on("presence", { event: "sync" }, syncOpponentPresence)
      .on("presence", { event: "join" }, ({ key }) => {
        if (key === safeOpponentUserId) handlersRef.current.onOpponentJoin?.();
        syncOpponentPresence();
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        if (key === safeOpponentUserId) handlersRef.current.onOpponentLeave?.();
        syncOpponentPresence();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          // Registers presence membership only -- an empty payload is
          // enough for join/leave tracking; readiness rides on broadcast
          // (see this hook's header comment) and never touches track()
          // again for the rest of this subscription's lifetime.
          void channel.track({});
        }
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, myUserId, opponentUserId]);

  function sendReady() {
    setReady(true);
    broadcast(READY_EVENT, { playerId: myUserId ?? "", ready: true } satisfies ReadyPayload);
  }

  function resetReady() {
    setReady(false);
    // Broadcasting the reset (not just clearing local state) matters just
    // as much as sendReady's broadcast: without it, the opponent's last-
    // heard `ready: true` from the *previous* round's gate would still
    // read as true for this one, passing the gate without them actually
    // having re-confirmed anything -- the exact staleness bug presence's
    // "last entry wins" fix (see git history) addressed for the old
    // presence-based version of this same mechanism.
    broadcast(READY_EVENT, { playerId: myUserId ?? "", ready: false } satisfies ReadyPayload);
  }

  function broadcast(event: string, payload: unknown) {
    void channelRef.current?.send({ type: "broadcast", event, payload });
  }

  return {
    connected,
    ready,
    opponentConnected,
    opponentReady,
    sendReady,
    resetReady,
    // myUserId is only ever null before a match exists, at which point
    // channelRef.current is also still null -- broadcast() already no-ops
    // via optional chaining, so the "" fallback here is purely to satisfy
    // the type checker, never actually sent.
    broadcastGuess: (payload) =>
      broadcast(GUESS_EVENT, { ...payload, playerId: myUserId ?? "" } satisfies GuessPayload),
    broadcastSolved: (payload) =>
      broadcast(SOLVED_EVENT, { ...payload, playerId: myUserId ?? "" } satisfies SolvedPayload),
    broadcastRoundStart: (payload) => broadcast(ROUND_START_EVENT, payload),
    broadcastRoundEnd: (payload) => broadcast(ROUND_END_EVENT, payload),
    broadcastMatchEnd: (payload) => broadcast(MATCH_END_EVENT, payload),
    broadcastForfeit: () => broadcast(FORFEIT_EVENT, { playerId: myUserId ?? "" } satisfies ForfeitPayload),
    broadcastRematch: (payload) => broadcast(REMATCH_EVENT, payload),
  };
}
