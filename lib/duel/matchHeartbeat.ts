import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// The in-match liveness beat (drizzle/0040), called straight from the browser
// as one warm PostgREST hop like every other duel call that isn't rating math.
//
// This is the server's only evidence that a player is still in the match.
// Realtime presence -- which the clients use to decide when to *ask* for a
// disconnect forfeit -- lives in a service Postgres cannot query, so before this
// existed, forfeitMatch had nothing to check "your opponent is absent" against
// and simply believed the caller (audit 2026-07-27 §3.3). Same shape as
// matchmaking_queue's last_seen_at (drizzle/0032), for the same reason: what
// must be proven alive is a row, and a WebSocket is not one.
//
// The RPC writes only the caller's own column (it resolves who that is from
// auth.uid()), so this cannot be used to vouch for an opponent.
export type MatchHeartbeatResult =
  // The match is live and the caller's liveness was refreshed.
  | "live"
  // Finished, abandoned, or not the caller's match -- nothing was written and
  // nothing ever will be. The caller should stop beating.
  | "terminal"
  // Transient. Explicitly NOT "terminal": a beat lost to a flaky connection
  // must not stand the heartbeat down, or one bad request would make a present
  // player forfeitable. Keep beating; the staleness window tolerates two misses.
  | "error";

export async function matchHeartbeat(matchId: number): Promise<MatchHeartbeatResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("duel_heartbeat", { p_match_id: matchId });
  if (error) return "error";
  return data === true ? "live" : "terminal";
}
