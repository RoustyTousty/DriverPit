// Tracks a guess RPC that is currently in flight, so sign-out can let it
// settle instead of tearing the session down mid-write.
//
// Daily and infinite guesses go straight to Postgres via supabase.rpc(), and
// daily_submit_guess in particular APPENDS to daily_progress. Signing out while
// one is in flight doesn't cancel the server-side write -- it just means the
// client never learns the outcome, so the board it last rendered disagrees with
// what the database actually stored. Waiting the ~100ms for it to resolve costs
// nothing on a user-initiated action that's about to reload the page anyway.
//
// Module-level for the same reason as lib/duel/duelCommitments.ts: the consumer
// (AuthProvider.signOutAndReset) sits above every game window in the tree.
let pending: Promise<unknown> | null = null;

// Wraps a guess call: records it while it runs and clears it afterward. The
// returned promise is the original one, so callers are unaffected.
export function trackGuess<T>(promise: Promise<T>): Promise<T> {
  // Swallow here only for the *tracking* copy -- the caller's own promise still
  // rejects normally and its own error handling runs. Without this, a failed
  // guess would produce an unhandled rejection from the tracking reference.
  const tracked = promise.catch(() => undefined);
  pending = tracked;
  void tracked.finally(() => {
    if (pending === tracked) pending = null;
  });
  return promise;
}

// Resolves once any in-flight guess has settled (success or failure). Never
// rejects: a guess that failed is the component's problem to report, and must
// never be a reason someone can't sign out.
export async function awaitInFlightGuess(): Promise<void> {
  if (!pending) return;
  await pending;
}
