import { DAILY_POOL_WINDOW } from "@/lib/game/poolWindow";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { getDeviceId } from "./deviceId";
import { DEFAULT_ROUNDS } from "./liveMatch";

// The shared channel every /online visitor subscribes to -- Presence for the
// online count, broadcast for pushing a just-created match to the player
// who was waiting for it (see MatchmakingLobby). Not "duel:{matchId}" --
// nobody knows the matchId yet at this point.
export const LOBBY_CHANNEL = "lobby";
export const MATCHED_EVENT = "matched";

// Row shape as returned by PostgREST for the match_or_queue() RPC (exact
// column names, snake_case) -- mapped below to the camelCase shape the app
// uses, same convention as AuthProvider's hand-written row interfaces (no
// `supabase gen types` wiring in this repo yet).
interface MatchOrQueueRow {
  match_id: number | null;
  opponent_id: string | null;
  opponent_username: string | null;
  opponent_display_name: string | null;
  opponent_avatar_url: string | null;
  opponent_rating: number | null;
  opponent_duel_wins: number | null;
  opponent_duel_losses: number | null;
  you_are: "a" | "b" | null;
  match_created_at: string | null;
}

export interface MatchResult {
  matchId: number;
  opponentId: string;
  opponentUsername: string;
  opponentDisplayName: string | null;
  opponentAvatarUrl: string;
  opponentRating: number | null;
  opponentDuelWins: number;
  opponentDuelLosses: number;
  youAre: "a" | "b";
  matchCreatedAt: string;
  // Per-match config off duel_matches (drizzle/0054). Both are DISPLAY-ONLY on
  // the client, and that is the invariant to keep: `rounds` prints the "Round N
  // / M" label and `ranked` decides whether the results panel shows a rating
  // delta. Neither decides when the match ends or whether stats move -- those
  // are duel_close_round's and applyMatchResult's calls, made from the row.
  // A wrong value here misprints a label; it cannot desync or misreport a match.
  ranked: boolean;
  rounds: number;
}

function toMatchResult(row: MatchOrQueueRow): MatchResult | null {
  if (row.match_id === null || row.opponent_id === null) return null;
  return {
    matchId: row.match_id,
    opponentId: row.opponent_id,
    opponentUsername: row.opponent_username ?? "",
    opponentDisplayName: row.opponent_display_name,
    opponentAvatarUrl: row.opponent_avatar_url ?? "opponent",
    opponentRating: row.opponent_rating,
    opponentDuelWins: row.opponent_duel_wins ?? 0,
    opponentDuelLosses: row.opponent_duel_losses ?? 0,
    youAre: row.you_are ?? "a",
    matchCreatedAt: row.match_created_at ?? new Date().toISOString(),
    // Not read off the row, and it doesn't need to be: match_or_queue creates
    // its matches without naming any config column, so every match that comes
    // back through here took the defaults -- ranked, DEFAULT_ROUNDS. Stating
    // that is cheaper than a DROP FUNCTION + CREATE to widen a RETURNS TABLE
    // (CREATE OR REPLACE cannot), which would also cost a restated grant
    // decision. A custom match never arrives through this mapper; it comes back
    // from duel_lobby_join, which will carry its own config (phase 4).
    ranked: true,
    rounds: DEFAULT_ROUNDS,
  };
}

// Calls the atomic pairing RPC (see drizzle/0012_matchmaking_rpc.sql) --
// returns a match if the caller is already in one (idempotent) or just got
// paired with a waiting opponent, otherwise null (still searching, now
// enqueued). Safe to call repeatedly while waiting: each call re-runs the
// same atomic search with a freshly widened rating band.
export async function matchOrQueue(): Promise<MatchResult | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("match_or_queue", { p_pool_window: DAILY_POOL_WINDOW, p_device_id: getDeviceId() })
    .single();
  if (error) throw error;
  return toMatchResult(data as MatchOrQueueRow);
}

// Explicit dequeue -- call on EVERY exit from searching (unmount, cancel,
// navigating away, and critically inside signOutAndReset() before the session
// is torn down). Idempotent server-side (drizzle/0032): safe twice,
// safe when never queued, safe racing a pairing that already removed the row.
// Takes no user id -- the RPC derives it from auth.uid(), so a client can only
// ever dequeue itself.
export async function leaveQueue(): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("duel_leave_queue");
  if (error) throw error;
}

// Liveness beat while searching. A no-op server-side when not queued, so a beat
// that lands after a pairing can't resurrect anything.
export async function queueHeartbeat(): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("duel_queue_heartbeat");
  if (error) throw error;
}

// Dequeue during page teardown (beforeunload/pagehide). supabase-js issues a
// normal fetch, which the browser is free to cancel once the document goes
// away -- so this posts to the same PostgREST RPC endpoint directly with
// `keepalive`, which survives teardown. Best-effort by design: if it never
// lands, the heartbeat above stops and the row goes stale within
// QUEUE_STALE_MS anyway. That's the point of having both layers.
export function leaveQueueOnUnload(accessToken: string): void {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/duel_leave_queue`;
  try {
    void fetch(url, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${accessToken}`,
      },
      body: "{}",
    });
  } catch {
    // Teardown is not a place to surface errors -- the staleness window covers
    // us if this fails.
  }
}

// Broadcast payload sent by whichever client's matchOrQueue() call just
// created the match (always the "joiner", never the player who was already
// waiting) -- the only way the waiting side finds out before their own next
// poll. Carries everything the reveal screen needs about the sender so the
// recipient never has to round-trip for it.
export interface MatchedBroadcastPayload {
  forUserId: string;
  matchId: number;
  matchCreatedAt: string;
  youAre: "a" | "b";
  opponentId: string;
  opponentUsername: string;
  opponentDisplayName: string | null;
  opponentAvatarUrl: string;
  // The sender's own rating/duel record -- from the recipient's point of
  // view, that's their opponent's. Sent from the sender's already-known
  // stats (useAuth()) rather than round-tripping through match_or_queue
  // again, same reasoning as every other field here.
  opponentRating: number | null;
  opponentDuelWins: number;
  opponentDuelLosses: number;
}
