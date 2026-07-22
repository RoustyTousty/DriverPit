import { startInfiniteRound } from "@/lib/game/infiniteGuessRpc";
import type { PoolWindow } from "@/lib/game/poolWindow";

// Link prefetching (default on for next/link) only warms the Infinite
// route's RSC payload -- it can't cover the mount-triggered server action
// that actually picks the round's driver (InfiniteGame's effect calls
// startInfiniteRound after hydrating), since that's a mutation, not a
// cacheable route segment. That action is why switching to Infinite has
// historically paid more visible latency than Daily/Duel, which don't
// need a per-visit random pick.
//
// Hovering or focusing the Infinite tab is a strong intent signal, so
// ModeTabs fires this speculatively at that moment instead of waiting for
// the click -- overlapping the action's latency with however long the user
// takes to actually navigate. InfiniteGame's mount effect then calls
// consumeInfiniteRoundPrefetch instead of starting its own redundant
// request, keyed by pool window so a stale prefetch for a different
// window is simply discarded rather than reused.
let pending: { window: PoolWindow; promise: Promise<void> } | null = null;

export function prefetchInfiniteRound(window: PoolWindow) {
  if (pending && pending.window === window) return;
  pending = { window, promise: startInfiniteRound(window) };
}

export function consumeInfiniteRoundPrefetch(window: PoolWindow): Promise<void> | null {
  if (!pending || pending.window !== window) return null;
  const { promise } = pending;
  pending = null;
  return promise;
}
