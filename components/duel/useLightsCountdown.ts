"use client";

import { useEffect, useState } from "react";

import {
  COUNTDOWN_GO_HOLD_MS,
  LIGHTS_ALL_LIT_HOLD_MS,
  MAX_LIGHT_ON_INTERVAL_MS,
  MIN_LIGHT_ON_INTERVAL_MS,
} from "@/lib/game/duelTiming";

export const LIGHT_COUNT = 5;

// Sizes the sweep to the time actually left, so the fifth light lands exactly
// LIGHTS_ALL_LIT_HOLD_MS before lights-out no matter how long the round's RPC
// took to come back. A FIXED interval instead left the leftover budget as dead
// air with all five lights on -- about a second of it -- and because that
// leftover shrank as latency grew, the same constants produced a visibly
// different pause on round 1 than on rounds 2 and 3. Deriving it pins the dwell
// and pushes the variance into the sweep, where a few percent is invisible.
function sweepIntervalMs(remainingToLightsOutMs: number): number {
  const sweepWindowMs = remainingToLightsOutMs - LIGHTS_ALL_LIT_HOLD_MS;
  // LIGHT_COUNT - 1: the first light is lit from frame one, so five lights are
  // four intervals apart, not five.
  const raw = sweepWindowMs / (LIGHT_COUNT - 1);
  return Math.min(MAX_LIGHT_ON_INTERVAL_MS, Math.max(MIN_LIGHT_ON_INTERVAL_MS, raw));
}

export interface LightsCountdownState {
  litCount: number;
  isGo: boolean;
  holdComplete: boolean;
}

// Drives every duel pre-round countdown (lights, "GO!", and the hold
// before handing off to the live round). Renders fresh off `Date.now()`
// on every call rather than owning its own interval -- every caller
// already re-renders every ~100ms via its own useServerCountdown tracking
// the same round (needed for the round's own end-of-round timer too, so
// that ticking already runs for the round's whole duration regardless); a
// second independent interval here would just be a redundant timer
// ticking forever after the lights are done. Three problems this solves:
//
// 1. duel_begin_round stamps `started_at` the instant the RPC runs
//    server-side, not when the response gets back to this client -- so
//    deriving the lights' progress from "time since started_at" made the
//    very first paint already show 2-3 lights lit (whatever the RPC round
//    trip cost), never a real 0 -> 5 sequence. Lights here instead run on
//    their OWN local clock, started the first moment this hook sees a
//    round actually pending -- always a full, smooth sequence from the
//    viewer's own perspective, however much latency already happened
//    upstream.
//
// 2. A round whose ceremony already played out somewhere else before this
//    hook ever mounted (round 1 of a fresh match: DuelCountdown, owned by
//    DuelRoot, already ran the whole thing before DuelMatch even mounts)
//    must not run a second one -- if the real clock is already past zero
//    the very first time this hook sees a given `key`, there's nothing
//    left to show; it resolves immediately instead of animating its own
//    0 -> 5 sequence and re-showing a pre-round view that had already been
//    dismissed.
//
// 3. Both players independently call duel_begin_round for the same round
//    (whichever's RPC lands first actually stamps it; the other just
//    reads the same timestamp back) -- so the "losing" client's own round
//    trip can easily land after the real countdown has already elapsed on
//    the server. Gating isGo on "local animation done AND real clock
//    expired" isn't enough on its own: when the real clock is the one that
//    finishes *first*, isGo would fire the instant the local litCount
//    ticks over to 5 -- the same tick the 5th light starts its fade -- so
//    it never gets a chance to actually be seen lit before going dark
//    again. LIGHTS_ALL_LIT_HOLD_MS forces a real, local-clock-timed pause at
//    "all 5 lit" regardless of how the real clock lines up, so the last
//    light is always visibly on for a beat no matter which side of the
//    race this client landed on.
//
// `remainingMs` is time until the round's server-stamped started_at -- the
// moment the BOARD appears, not the moment the lights go out. Lights-out is one
// COUNTDOWN_GO_HOLD_MS earlier, so that's what the sequence below actually
// counts to; the hold that follows then lands the handoff on started_at exactly.
// Subtracted here rather than by each caller so a third one can't forget it and
// quietly start charging players for the GO beat again (see duelTiming.ts).
export function useLightsCountdown(remainingMs: number, key: string | null, loading = false): LightsCountdownState {
  const remainingToLightsOutMs = remainingMs - COUNTDOWN_GO_HOLD_MS;
  const realIsGo = !loading && remainingToLightsOutMs <= 0;
  const alreadyResolvedAtFirstSight = !loading && realIsGo;
  const ceremonyStarting = !loading && !alreadyResolvedAtFirstSight;

  const [trackedKey, setTrackedKey] = useState(key);
  const [skipCeremony, setSkipCeremony] = useState(alreadyResolvedAtFirstSight);
  const [localStartedAt, setLocalStartedAt] = useState<number | null>(
    ceremonyStarting ? Date.now() : null,
  );
  // Captured once, alongside localStartedAt: the sweep is paced against the
  // budget as it stood when the animation began, not recomputed every tick
  // (which would make the lights speed up as the deadline approached).
  const [lightIntervalMs, setLightIntervalMs] = useState(() => sweepIntervalMs(remainingToLightsOutMs));
  const [holdComplete, setHoldComplete] = useState(alreadyResolvedAtFirstSight);
  const [allLitAt, setAllLitAt] = useState<number | null>(null);

  // React's "adjust state when a prop changes" pattern -- resets
  // synchronously during render, before anything paints, so a new round
  // (or one that's already resolved) is never a stale frame of the
  // previous round's ceremony.
  if (key !== trackedKey) {
    setTrackedKey(key);
    setSkipCeremony(alreadyResolvedAtFirstSight);
    setLocalStartedAt(ceremonyStarting ? Date.now() : null);
    setLightIntervalMs(sweepIntervalMs(remainingToLightsOutMs));
    setHoldComplete(alreadyResolvedAtFirstSight);
    setAllLitAt(null);
  }

  // The first light is lit from the very first frame (hence the +1), not after
  // one interval: the number below it names the light that just came on -- L1 =
  // "5" ... L5 = "1" -- so a leading dark beat would have to show a "5" with
  // nothing lit under it, which is exactly the off-by-one this pairing exists to
  // remove. 0 is reachable only while `loading`, where LightsCountdown renders a
  // spinner instead and no light should be on yet.
  const localLitCount =
    localStartedAt === null
      ? 0
      : Math.min(LIGHT_COUNT, 1 + Math.floor((Date.now() - localStartedAt) / lightIntervalMs));

  // Same render-phase-adjustment pattern, capturing the instant the local
  // animation first reaches all 5 lit (not an effect -- an effect would
  // add up to one extra render's worth of lag before the hold even
  // starts).
  if (!skipCeremony && localLitCount >= LIGHT_COUNT && allLitAt === null) {
    setAllLitAt(Date.now());
  }

  const litCount = skipCeremony ? LIGHT_COUNT : localLitCount;
  const allLitHeldLongEnough = skipCeremony || (allLitAt !== null && Date.now() - allLitAt >= LIGHTS_ALL_LIT_HOLD_MS);
  const isGo = skipCeremony || (litCount >= LIGHT_COUNT && realIsGo && allLitHeldLongEnough);

  useEffect(() => {
    if (!isGo || holdComplete) return;
    const timeout = setTimeout(() => setHoldComplete(true), COUNTDOWN_GO_HOLD_MS);
    return () => clearTimeout(timeout);
  }, [isGo, holdComplete]);

  return { litCount, isGo, holdComplete };
}
