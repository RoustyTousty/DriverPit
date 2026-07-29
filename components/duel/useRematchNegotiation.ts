"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { declineRematch, requestRematch } from "@/lib/duel/actions";
import type { DuelChannelState } from "@/lib/duel/useDuelChannel";

import type { Phase, RematchState } from "./duelMatchTypes";

// The three-broadcast rematch negotiation, extracted from DuelMatch (audit
// 2026-07-27 §2.3). CLAUDE.md's "Rematch is mutual consent, not a re-queue":
// duel_matches.rematch_requested_by is the whole mechanism, and the three
// broadcasts are what stop it feeling broken.
//
//   rematch_request  "I asked, and I'm first"  -- without it the opponent's
//                    results screen shows a plain Rematch button with no sign
//                    anyone is waiting on them.
//   rematch_decline  "no"                      -- without it a refusal is
//                    indistinguishable from a slow opponent and the asker waits
//                    forever. Terminal for this results screen.
//   rematch          "the new match exists"    -- carries newMatchId; sent by
//                    whichever client's requestRematch actually created it.
//
// Conflating any two of them is the bug this shape exists to avoid.
export interface RematchNegotiation {
  rematchState: RematchState;
  /** The Rematch button. */
  request: () => void;
  /** The Decline button. Terminal -- neither side is offered it again here. */
  decline: () => void;
  /** duel:{matchId} `rematch_request` from the opponent. */
  onOpponentRequest: () => void;
  /** duel:{matchId} `rematch_decline` from the opponent. */
  onOpponentDecline: () => void;
  /** Moving to a new match: clear the offer so the fresh results screen starts idle. */
  reset: () => void;
}

export function useRematchNegotiation({
  matchId,
  phase,
  phaseRef,
  channel,
  opponentHandle,
  onRematchCreated,
}: {
  matchId: number;
  phase: Phase;
  phaseRef: React.RefObject<Phase>;
  channel: DuelChannelState;
  opponentHandle: string;
  onRematchCreated: (newMatchId: number) => void;
}): RematchNegotiation {
  const toast = useToast();
  const [rematchState, setRematchState] = useState<RematchState>("idle");

  // Presence starts false and only becomes true once the channel syncs, so
  // "not connected" on its own can't distinguish "they left" from "we haven't
  // heard yet". Latching that we saw them at least once makes a later absence
  // mean something.
  const opponentEverConnectedRef = useRef(false);
  useEffect(() => {
    if (channel.opponentConnected) opponentEverConnectedRef.current = true;
  }, [channel.opponentConnected]);

  // Results screen only: has the opponent left the match entirely? A rematch
  // needs BOTH players sitting on their results panel, so once they're gone
  // there's nothing to wait for and the screen should say so instead of
  // offering (or worse, hanging on) a rematch that can never resolve.
  useEffect(() => {
    if (phase !== "finished") return;
    if (!channel.connected) return; // can't tell whose network dropped
    if (channel.opponentConnected) {
      // They're back (or never left) -- drop the dead-end state, but never
      // clobber a request either side already made, or un-decline a refusal.
      setRematchState((prev) => (prev === "opponentGone" ? "idle" : prev));
      return;
    }
    if (!opponentEverConnectedRef.current) return;
    // Leaving overrides everything, including a pending request from either
    // side: whatever was being waited on can no longer resolve.
    setRematchState((prev) => (prev === "declined" ? prev : "opponentGone"));
  }, [phase, channel.connected, channel.opponentConnected]);

  const onOpponentRequest = useCallback(() => {
    if (phaseRef.current !== "finished") return;
    // Only from a clean slate. Never downgrade "requested" (we both asked at
    // once -- one side's requestRematch is already creating the match and
    // REMATCH_EVENT is seconds away, so prompting to accept would invite a
    // second pointless click), and never resurrect a "declined" screen.
    setRematchState((prev) => (prev === "idle" ? "opponentRequested" : prev));
    toast.info(`${opponentHandle} wants a rematch`);
  }, [phaseRef, toast, opponentHandle]);

  const onOpponentDecline = useCallback(() => {
    if (phaseRef.current !== "finished") return;
    setRematchState("declined");
    toast.info(`${opponentHandle} declined the rematch`);
  }, [phaseRef, toast, opponentHandle]);

  // Terminal on purpose: neither side is offered the rematch again on this
  // results screen. The broadcast tells the asker immediately; the Server
  // Action clears the stored intent so a later change of mind can't create a
  // match the other player was told wasn't happening.
  const decline = useCallback(() => {
    setRematchState("declined");
    channel.broadcastRematchDecline();
    void (async () => {
      const res = await declineRematch(matchId);
      if (!res.ok) toast.error(res.error);
    })();
  }, [channel, matchId, toast]);

  const request = useCallback(() => {
    setRematchState("requested");
    void (async () => {
      const res = await requestRematch(matchId);
      if (!res.ok) {
        toast.error(res.error);
        setRematchState("idle");
        return;
      }
      if (res.newMatchId !== null) {
        // This call created the match (second requester) -- tell the
        // still-waiting first requester on the OLD match's channel before this
        // client resubscribes to the new one, then transition. Both sides meet
        // on duel:{newMatchId} for the rematch ready-gate.
        channel.broadcastRematch({ newMatchId: res.newMatchId });
        onRematchCreated(res.newMatchId);
        return;
      }

      // First to ask: intent is recorded but there's nobody to pair with yet.
      // This broadcast is the ONLY thing that tells the opponent --
      // requestRematch just writes rematch_requested_by to the database, which
      // their client has no reason to re-read. Without it their results screen
      // shows a plain "Rematch" button and the invite is invisible.
      channel.broadcastRematchRequest();
    })();
  }, [channel, matchId, toast, onRematchCreated]);

  const reset = useCallback(() => setRematchState("idle"), []);

  return { rematchState, request, decline, onOpponentRequest, onOpponentDecline, reset };
}
