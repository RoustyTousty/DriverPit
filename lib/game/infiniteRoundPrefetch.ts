import { driverFilterKey, type DriverFilter } from "@/lib/game/driverFilter";
import { startInfiniteRound } from "@/lib/game/infiniteGuessRpc";

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
// request, keyed by the FILTER so a stale prefetch made under a different
// one is simply discarded rather than reused -- a round started under the
// wrong filter would target a driver the board never offers.
let pending: { key: string; promise: Promise<void> } | null = null;

export function prefetchInfiniteRound(filter: DriverFilter) {
  const key = driverFilterKey(filter);
  if (pending && pending.key === key) return;
  const entry = { key, promise: startInfiniteRound(filter) };
  pending = entry;
  // Speculative work nobody has asked for yet, so its failure has to be
  // absorbed here, and this does two things at once:
  //
  //  - Marks the stored promise as handled. Hovering the tab starts an RPC
  //    that may never be awaited by anyone (the user doesn't navigate, or
  //    navigates with a different filter and the entry is discarded), so
  //    without a handler a failed prefetch is an unhandled rejection from a
  //    mere mouseover. The `catch` is attached to a *derived* promise and the
  //    original is what's stored, so a consumer still sees the rejection --
  //    InfiniteGame must be allowed to fail into its error/Retry state rather
  //    than silently believing a round it never got.
  //  - Drops the failed entry, so the next hover retries. Otherwise the
  //    early-return above would keep handing out one already-rejected promise
  //    forever, and a mount that arrives after the network recovered would
  //    still fail instantly on a stale result.
  void entry.promise.catch(() => {
    if (pending === entry) pending = null;
  });
}

export function consumeInfiniteRoundPrefetch(filter: DriverFilter): Promise<void> | null {
  if (!pending || pending.key !== driverFilterKey(filter)) return null;
  const { promise } = pending;
  pending = null;
  return promise;
}
