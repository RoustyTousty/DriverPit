import { DAILY_POOL_WINDOW } from "@/lib/game/poolWindow";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// The shared channel every /duel visitor subscribes to -- Presence for the
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
    .rpc("match_or_queue", { p_pool_window: DAILY_POOL_WINDOW })
    .single();
  if (error) throw error;
  return toMatchResult(data as MatchOrQueueRow);
}

export async function leaveQueue(userId: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  await supabase.from("matchmaking_queue").delete().eq("user_id", userId);
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
