// Tunable timing constants for the ready-gated duel lifecycle (CLAUDE.md's
// "Duel (real-time race)" -> "Timing constants"): lobby -> countdown ->
// active -> intermission -> (loop rounds) -> finished, or abandoned. These
// back the duel_begin_round / duel_close_round / duel_state / duel_forfeit
// RPCs (lib/db/duelRpc.ts) and the ready-gate logic that calls them.
// Every duel duration lives here -- nothing in components/duel or
// lib/duel hardcodes one -- with a single documented exception: the SQL
// literals mirroring COUNTDOWN_MS/ROUND_MS/INTERMISSION_MS, which plpgsql can't
// import and each carry a keep-in-sync comment pointing back at this file.
//
// Those literals live in whichever migration last defined the function, NOT in
// the one that introduced it -- a `CREATE OR REPLACE` in a later migration
// silently makes every earlier copy dead text. As of drizzle/0045:
// duel_begin_round is drizzle/0036, duel_close_round is drizzle/0024. Check
// with `grep -n "CREATE OR REPLACE FUNCTION public.duel_" drizzle/*.sql` and
// take the LAST hit before trusting any pointer below.

// Min time the "searching" UI shows before a match resolves, so the lobby
// never flash-skips even when a match is found instantly.
export const LOBBY_MIN_SEARCH_MS = 1_000;

// How long "Match found" + avatars/ratings/records hold before the
// lights-out countdown starts.
export const MATCH_FOUND_HOLD_MS = 2_500;

// F1 lights-out countdown into a round -- duel_begin_round stamps
// started_at = now() + COUNTDOWN_MS. The SAME value for every round.
//
// READ THIS BEFORE CHANGING ANY COUNTDOWN CONSTANT. `started_at` means "the
// board is on screen and this player can act", NOT "the lights went out".
// Lights-out is COUNTDOWN_GO_HOLD_MS *earlier*; clients run the lights to that
// moment and hold GO until started_at. That definition is what keeps the GO
// beat free: both ends_at (= started_at + ROUND_MS) and duel_submit_guess's
// ms-to-solve are measured from started_at, so as long as started_at is the
// instant play actually begins, nobody is charged round time -- or penalised on
// speed points -- for ceremony they were watching.
//
// So the ceremony budget is (COUNTDOWN_MS - COUNTDOWN_GO_HOLD_MS) = 3200ms, and
// the light sweep FILLS it rather than being a fixed length that has to fit
// inside it. useLightsCountdown divides whatever budget is actually left when
// the round lands by the 4 intervals it takes to go from one light to five, so
// the fifth light arrives exactly LIGHTS_ALL_LIT_HOLD_MS before lights-out
// however long the RPC took to come back.
//
// That derivation is the fix for two things at once:
//
//   1. Dead air. With a fixed 700ms interval the sweep finished early and all
//      five lights sat on for the leftover budget -- roughly a second of
//      nothing, which is what "a pause before the lights go out" was.
//   2. Rounds feeling different. That leftover was (budget - sweep - latency),
//      so it shrank as the round trip grew. Round 1 and rounds 2-3 have
//      different latency profiles, so the same constants produced visibly
//      different pauses. Deriving the interval makes the dwell a fixed
//      LIGHTS_ALL_LIT_HOLD_MS and pushes the variance into the sweep, where a
//      ~5% difference in interval is imperceptible.
//
// The old approach needed slack in COUNTDOWN_MS to absorb latency (4700 against
// a 4100 floor); filling the budget removes the need for any, hence 3900.
export const COUNTDOWN_MS = 3_900;

// Bounds on the derived interval, so a pathological budget can't produce a
// strobe or a crawl. At a typical round trip the derivation lands near 700ms,
// which is the pace these were tuned against.
export const MIN_LIGHT_ON_INTERVAL_MS = 150;
export const MAX_LIGHT_ON_INTERVAL_MS = 900;

// How often a countdown re-renders while it is genuinely counting
// (useServerCountdown, useLightsCountdown). Fine enough that the round timer
// never visibly skips a second and that a round closes promptly on expiry.
//
// This is a *render* cadence, so the thing that matters about it isn't the
// number -- it's that both hooks stop ticking the moment they have nothing
// left to count. Neither did until audit 2026-07-27 §1.0: useServerCountdown's
// only stop condition was a null target, so a duel re-rendered at 20-30Hz for
// whole rounds and then indefinitely on the results screen.
export const COUNTDOWN_TICK_MS = 100;

// The "all five lit" beat before lights-out -- now the WHOLE dwell rather than
// a floor under it, since the sweep is sized to end exactly this far from
// lights-out. Also still the race guard for when the server clock resolves
// before the local animation does (useLightsCountdown's problem 3).
export const LIGHTS_ALL_LIT_HOLD_MS = 400;

// Held past the moment the lights-out countdown reaches GO, before the
// caller actually hands off to the live round view (components/duel's
// useLightsCountdown) -- the lights-are-out beat, long enough for the final
// light's own CSS fade (LightsCountdown, 300ms) to visibly finish and "GO!" to
// register instead of the view switching away mid-fade. Not
// reduced-motion-gated (like MATCH_FOUND_HOLD_MS/INTERMISSION_MS above) -- it's
// a deliberate read beat, not an animation.
//
// This beat sits INSIDE the countdown, not on top of the round: started_at is
// stamped COUNTDOWN_MS out and lights-out happens this long before it, so the
// hold ends exactly as the round clock starts. Changing it therefore shifts
// lights-out, never the player's 60 seconds -- but the ceremony budget above
// shrinks by the same amount, so check the lights still fit.
export const COUNTDOWN_GO_HOLD_MS = 700;

// Per-round guessing window, server-stamped: duel_begin_round sets
// ends_at = started_at + ROUND_MS. Keep in sync with the SQL literal in
// drizzle/0036_duel_countdown_no_slack.sql#duel_begin_round -- the LAST
// definition of that function, not 0021's original (see the header).
export const ROUND_MS = 60_000;

// Reveal + points count-up + mini-countdown between rounds --
// duel_close_round stamps intermission_ends_at = now() + INTERMISSION_MS.
// Keep in sync with the SQL literal in
// drizzle/0024_duel_close_round_reveal.sql#duel_close_round.
export const INTERMISSION_MS = 6_000;

// Fallback if a client never reports ready. The ready-gate itself is
// realtime/presence-only (never a DB column) -- this just bounds how long
// the gate waits before proceeding without it.
export const READY_TIMEOUT_MS = 4_000;

// Reconnect window before a dropped opponent is treated as forfeited.
//
// Used on BOTH sides of that decision, which is the point. The remaining client
// waits this long after presence goes away before asking; forfeitMatch
// (lib/duel/actions.ts) then independently refuses unless the absent player's
// duel_matches.last_seen_a/b is itself older than this. Until drizzle/0040 only
// the client half existed, so "my opponent is gone" was a claim the server took
// on trust -- and one devtools call was a guaranteed win plus real Elo (audit
// 2026-07-27 §3.3).
//
// The two windows are the same value deliberately. A player who dies the
// instant after a heartbeat is stale by exactly this much when the client asks,
// so the very first attempt can land a hair inside the window and be refused --
// which is why DuelMatch's grace timer retries rather than firing once.
export const DISCONNECT_GRACE_MS = 10_000;

// Liveness beat inside a live match (drizzle/0040's duel_heartbeat), the
// in-match twin of QUEUE_HEARTBEAT_MS. Same 3:1 ratio against the window it
// feeds (DISCONNECT_GRACE_MS), so a player survives two missed beats before
// they can be declared absent. Stops on its own once the match is terminal --
// the RPC reports it, so nobody beats through a results screen.
export const DUEL_HEARTBEAT_MS = 5_000;

// How often DuelSearching re-runs match_or_queue while waiting (each call
// atomically re-searches with a freshly widened rating band).
export const MATCHMAKE_POLL_INTERVAL_MS = 4_000;

// Queue liveness (drizzle/0032). The searching client calls
// duel_queue_heartbeat every QUEUE_HEARTBEAT_MS; match_or_queue ignores, and
// duel_sweep_stale_queue deletes, any row whose last_seen_at is older than
// QUEUE_STALE_MS. The gap between them has to tolerate a missed beat or two on
// a slow connection -- at 5s/15s a row survives two consecutive failures before
// going inert, while a genuinely dead row disappears well inside the time it
// takes a human to notice they're still "searching".
// QUEUE_STALE_MS is mirrored as a literal `interval '15 seconds'` in
// drizzle/0032 (plpgsql can't import this file) -- change both together.
export const QUEUE_HEARTBEAT_MS = 5_000;
export const QUEUE_STALE_MS = 15_000;

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
