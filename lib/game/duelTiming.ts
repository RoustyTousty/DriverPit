// Tunable timing constants for the ready-gated duel lifecycle (CLAUDE.md's
// "Duel (real-time race)" -> "Timing constants"): lobby -> countdown ->
// active -> intermission -> (loop rounds) -> finished, or abandoned. These
// back the duel_begin_round / duel_close_round / duel_state / duel_forfeit
// RPCs (lib/db/duelRpc.ts) and the ready-gate logic that calls them.
// Every duel duration lives here -- nothing in components/duel or
// lib/duel hardcodes one -- with a single documented exception: the SQL
// literals inside drizzle/0021's functions (COUNTDOWN_MS/ROUND_MS/
// INTERMISSION_MS mirrors), which plpgsql can't import and each carry a
// keep-in-sync comment pointing back at this file.

// Min time the "searching" UI shows before a match resolves, so the lobby
// never flash-skips even when a match is found instantly.
export const LOBBY_MIN_SEARCH_MS = 1_000;

// How long "Match found" + avatars/ratings/records hold before the
// lights-out countdown starts.
export const MATCH_FOUND_HOLD_MS = 2_500;

// F1 lights-out countdown into a round (round 1, and the shorter
// mini-countdowns after each intermission) -- duel_begin_round stamps
// started_at = now() + COUNTDOWN_MS.
export const COUNTDOWN_MS = 4_000;

// Held past the moment the lights-out countdown reaches GO, before the
// caller actually hands off to the live round view (components/duel's
// useLightsCountdown). Long enough for the final light's own CSS fade
// (LightsCountdown, 300ms) to visibly finish and "GO!" to register,
// instead of the view switching away mid-fade. Not reduced-motion-gated
// (like MATCH_FOUND_HOLD_MS/INTERMISSION_MS above) -- it's a deliberate
// read beat, not an animation.
export const COUNTDOWN_GO_HOLD_MS = 450;

// Per-round guessing window, server-stamped: duel_begin_round sets
// ends_at = started_at + ROUND_MS. Keep in sync with the SQL literal in
// drizzle/0021_duel_lifecycle_rpcs.sql#duel_begin_round.
export const ROUND_MS = 60_000;

// Reveal + points count-up + mini-countdown between rounds --
// duel_close_round stamps intermission_ends_at = now() + INTERMISSION_MS.
// Keep in sync with the SQL literal in
// drizzle/0021_duel_lifecycle_rpcs.sql#duel_close_round.
export const INTERMISSION_MS = 6_000;

// Fallback if a client never reports ready. The ready-gate itself is
// realtime/presence-only (never a DB column) -- this just bounds how long
// the gate waits before proceeding without it.
export const READY_TIMEOUT_MS = 4_000;

// Reconnect window before a dropped opponent is treated as forfeited.
export const DISCONNECT_GRACE_MS = 10_000;

// How often DuelSearching re-runs match_or_queue while waiting (each call
// atomically re-searches with a freshly widened rating band).
export const MATCHMAKE_POLL_INTERVAL_MS = 4_000;

// Safety-net poll cadence inside a live match (missed-broadcast recovery:
// round close during play, next-round adoption during intermission). Each
// tick is an idempotent no-op when nothing actually changed.
export const DUEL_POLL_INTERVAL_MS = 5_000;

// The mount loader's retry cadence when a reload lands between rounds
// (status 'intermission', next round not stamped yet), and how many quiet
// retries before concluding BOTH clients reloaded mid-intermission --
// nobody's ready-gate survived to call duel_begin_round -- and stamping
// the round itself. 4 x 2s comfortably outlasts a live opponent's own
// intermission + ready-gate (~INTERMISSION_MS + READY_TIMEOUT_MS from
// close), so a still-present opponent always stamps first.
export const RESUME_RETRY_MS = 2_000;
export const RESUME_RETRIES_BEFORE_FORCE_BEGIN = 4;

// The intermission's "+N" round-points count-up (components/duel/useCountUp).
export const POINTS_COUNT_UP_MS = 1_000;
