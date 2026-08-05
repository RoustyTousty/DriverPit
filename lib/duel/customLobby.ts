import type { DriverFilter } from "@/lib/game/driverFilter";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { getDeviceId } from "./deviceId";
import type { MatchResult } from "./matchmaking";

// The six duel_lobbies RPCs (drizzle/0057), called straight from the browser as
// one warm PostgREST hop -- the same path every other duel call takes.
//
// duel_lobbies has no client grants and no RLS policy at all, so these six
// SECURITY DEFINER functions are the entire access surface to the table. None
// of them takes a user id: each derives the caller from auth.uid(), so a client
// can only ever host, beat or cancel its own lobby.
//
// Codes are NEVER supplied by this module. duel_lobby_create generates one
// server-side; a client-chosen code would let someone squat AAAAAA and
// intercept whoever typed it.

// The alphabet the server draws from -- 31 characters, no 0/O/1/I/L, so a code
// read off a screen and retyped cannot be ambiguous. Mirrored here ONLY to
// validate input in the join box (which characters can possibly be part of a
// code); the generator is the SQL one and this is never used to build a code.
export const LOBBY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LOBBY_CODE_LENGTH = 6;

/**
 * What a person may have typed or pasted: lowercase, spaces from a copy, dashes
 * from a link. Uppercases and strips everything that cannot be part of a code.
 * The RPCs normalize identically server-side -- this exists so the input box can
 * show the cleaned value and enable Join at the right moment, not as the
 * authority.
 *
 * A PASTED SHARE LINK IS UNWRAPPED FIRST, and that case is not exotic: "Copy
 * link" is the primary button on the host's screen, so the thing most likely to
 * arrive in a chat -- and therefore most likely to be pasted here -- is the
 * whole URL. Stripping punctuation out of
 * "https://driverpit.app/online?join=ABC234" leaves "HTTPSDRIVERPIT..." and
 * takes its first six characters, which is a plausible-looking code that is not
 * the one in the link.
 *
 * The slice happens LAST, after stripping. Any earlier -- a maxLength on the
 * input, say -- and a seven-character "ABC-234" truncates to "ABC-23" and
 * normalizes to five characters, silently losing the end of a valid code.
 */
export function normalizeLobbyCode(input: string): string {
  const fromLink = /[?&]join=([^&\s]+)/i.exec(input);
  const source = fromLink ? fromLink[1] : input;
  return source.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, LOBBY_CODE_LENGTH);
}

/** Could this be a real code? Length plus alphabet -- the join button's gate. */
export function isCompleteLobbyCode(code: string): boolean {
  const normalized = normalizeLobbyCode(code);
  return (
    normalized.length === LOBBY_CODE_LENGTH &&
    [...normalized].every((character) => LOBBY_CODE_ALPHABET.includes(character))
  );
}

export interface CustomLobbyState {
  code: string;
  mode: string;
  rounds: number;
  roundSeconds: number;
  filter: DriverFilter;
  hostId: string;
  hostUsername: string;
  hostDisplayName: string | null;
  hostAvatarUrl: string;
  hostRating: number | null;
  // Null for anyone who is neither the host nor a participant -- a guessed or
  // forwarded code must not reveal the match id, which names the private
  // realtime channel. Also null while the lobby is simply still open.
  matchId: number | null;
  isHost: boolean;
}

interface LobbyStateRow {
  code: string;
  mode: string;
  rounds: number;
  round_seconds: number;
  filter: DriverFilter;
  host_id: string;
  host_username: string;
  host_display_name: string | null;
  host_avatar_url: string;
  host_rating: number | null;
  match_id: number | null;
  is_host: boolean;
}

// duel_lobby_join returns MATCH_OR_QUEUE'S EXACT ROW SHAPE, which is the point:
// the mapper below is the same shape as matchmaking.ts's toMatchResult, so
// DuelRoot receives a custom match through the identical onFound seam as a
// matchmade one.
interface LobbyJoinRow {
  match_id: number;
  opponent_id: string;
  opponent_username: string | null;
  opponent_display_name: string | null;
  opponent_avatar_url: string | null;
  opponent_rating: number | null;
  opponent_duel_wins: number | null;
  opponent_duel_losses: number | null;
  you_are: "a" | "b";
  match_created_at: string;
}

export type CreateLobbyResult = { ok: true; code: string } | { ok: false; error: string };
export type JoinLobbyResult = { ok: true; match: MatchResult } | { ok: false; error: string };

// Errors come back as { ok: false, error } rather than throwing, matching
// lib/duel/roundLifecycle.ts and lib/duel/submitGuess.ts -- one way of handling
// a failed duel call. The RPC's own message is surfaced: they are written to be
// read by a player ("That lobby has expired", "You cannot join your own lobby"),
// and each names a different thing the person can do about it.

export async function createCustomLobby(config: {
  rounds: number;
  roundSeconds: number;
  filter: DriverFilter;
}): Promise<CreateLobbyResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("duel_lobby_create", {
    p_rounds: config.rounds,
    p_round_seconds: config.roundSeconds,
    p_from_year: config.filter.fromYear,
    p_to_year: config.filter.toYear,
    p_nationality: config.filter.nationality,
    p_team: config.filter.team,
    p_achievement: config.filter.achievement,
    // Survives an identity swap, unlike auth.uid() -- the host half of the
    // self-join guard.
    p_device_id: getDeviceId(),
  });

  if (error) return { ok: false, error: error.message || "Could not create the lobby." };
  return { ok: true, code: data as string };
}

// Returns null for a code that does not exist, or whose lobby has gone stale --
// the RPC returns no row for both, deliberately, so a joiner cannot use this to
// tell "wrong code" from "expired lobby" by probing. The join call distinguishes
// them, to someone who actually has the code.
export async function getCustomLobbyState(code: string): Promise<CustomLobbyState | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("duel_lobby_state", { p_code: normalizeLobbyCode(code) })
    .maybeSingle();

  if (error || !data) return null;
  const row = data as LobbyStateRow;
  return {
    code: row.code,
    mode: row.mode,
    rounds: row.rounds,
    roundSeconds: row.round_seconds,
    filter: row.filter,
    hostId: row.host_id,
    hostUsername: row.host_username,
    hostDisplayName: row.host_display_name,
    hostAvatarUrl: row.host_avatar_url,
    hostRating: row.host_rating,
    matchId: row.match_id,
    isHost: row.is_host,
  };
}

/**
 * Joins the lobby and returns the created match in MatchResult shape.
 *
 * `rounds` is passed in from the CustomLobbyState the caller already fetched to
 * render the preview, because duel_lobby_join deliberately returns
 * match_or_queue's exact row shape and that shape has no round count -- widening
 * it would mean DROP FUNCTION + CREATE and a restated grant decision, and buys
 * nothing. Safe to take from the client here, and only here, because of the
 * invariant in lib/duel/liveMatch.ts: a client-side round count feeds the
 * cosmetic "Round N / M" label and NOTHING else. When the match actually ends is
 * duel_close_round's decision, read off the match row it already holds. A wrong
 * value misprints a label; it cannot desync or misreport a match.
 */
export async function joinCustomLobby(code: string, rounds: number): Promise<JoinLobbyResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("duel_lobby_join", { p_code: normalizeLobbyCode(code), p_device_id: getDeviceId() })
    .single();

  if (error) return { ok: false, error: error.message || "Could not join that lobby." };

  const row = data as LobbyJoinRow;
  const match: MatchResult = {
    matchId: row.match_id,
    opponentId: row.opponent_id,
    opponentUsername: row.opponent_username ?? "",
    opponentDisplayName: row.opponent_display_name,
    opponentAvatarUrl: row.opponent_avatar_url ?? "opponent",
    opponentRating: row.opponent_rating,
    opponentDuelWins: row.opponent_duel_wins ?? 0,
    opponentDuelLosses: row.opponent_duel_losses ?? 0,
    youAre: row.you_are,
    matchCreatedAt: row.match_created_at,
    // Never `true` on this path: duel_lobby_join is the only thing that creates
    // a custom match and it hardcodes ranked = false on the row. The results
    // screen re-reads it from duel_matches through getDuelResults anyway, so
    // this is what the panel shows before that lands, not what it trusts.
    ranked: false,
    rounds,
  };
  return { ok: true, match };
}

// Liveness while the host waits. Returns false once there is nothing left to
// beat (cancelled, consumed by a joiner, or swept), which is the client's
// signal to stop the interval -- the same contract duel_heartbeat has.
export async function customLobbyHeartbeat(code: string): Promise<boolean> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("duel_lobby_heartbeat", {
    p_code: normalizeLobbyCode(code),
  });
  if (error) return false;
  return data === true;
}

// Idempotent: safe twice, safe when never created, safe when a joiner already
// consumed the lobby (that row belongs to a live match and is left alone).
// Called on every exit from the waiting screen and inside signOutAndReset --
// an open lobby is a live server commitment exactly like a queue row, and a
// friend who joins one whose host no longer exists eats a DISCONNECT_GRACE_MS
// forfeit for nothing.
export async function cancelCustomLobby(code: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("duel_lobby_cancel", { p_code: normalizeLobbyCode(code) });
  if (error) throw error;
}

export async function sweepStaleLobbies(): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  await supabase.rpc("duel_sweep_stale_lobbies");
}
