import { DEFAULT_ROUNDS } from "../duel/liveMatch";

// The shape of a custom-lobby match, as the host composes it. Pure, so the
// create screen and the lobby summary share one definition of what the options
// are and what a value out of range becomes.
//
// DELIBERATELY LOOSER THAN THE DATABASE, not identical to it. drizzle/0054's
// CHECK constraints are `rounds BETWEEN 1 AND 5` and `round_seconds BETWEEN 15
// AND 180`; the lists below are the subset the UI offers. Pinning the exact
// offered triple in SQL would duplicate a list TS<->SQL and drag in a parity
// suite (CLAUDE.md: "a new duplicated constant gets an assertion in the same
// change that creates it") to protect a value with nothing at stake -- an
// unranked game the host configured for themselves. So the RPC accepts anything
// inside the bounds, this module decides what a person can click, and the two
// are allowed to differ.
//
// The bounds below ARE the CHECK constraints, and those two pairs must agree:
// clamping to something wider than the constraint turns a slider into a failed
// insert. They are asserted against the live constraints by
// lib/db/customLobby.test.ts (phase 4) rather than restated in a comment.

/** Inclusive. Mirrors duel_matches_rounds_check. */
export const ROUNDS_BOUNDS = { min: 1, max: 5 } as const;
/** Inclusive. Mirrors duel_matches_round_seconds_check. */
export const ROUND_SECONDS_BOUNDS = { min: 15, max: 180 } as const;

/** What the create screen offers, in the order it renders them. */
export const ROUNDS_OPTIONS = [1, 3, 5] as const;
export const ROUND_SECONDS_OPTIONS = [30, 60, 90] as const;

export interface MatchConfig {
  rounds: number;
  roundSeconds: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  // The same match shape a matchmade duel has, so "Custom" opens on something
  // familiar rather than on an arbitrary pick from the options list.
  rounds: DEFAULT_ROUNDS,
  roundSeconds: 60,
};

function clampInt(value: number, min: number, max: number, fallback: number): number {
  // NaN and Infinity both come back as the fallback rather than as a clamp
  // result: Math.min/max would happily turn Infinity into `max`, which silently
  // accepts a nonsense input as if the host had chosen the largest option.
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// Bring any input inside the database's bounds. Used by the create screen so a
// value can never leave the client out of range -- but it is UX, not
// enforcement: PostgREST is reachable without ever loading this module, which is
// why duel_lobby_create re-clamps server-side too (phase 4), exactly as
// infinite_start_round does for its year span.
export function clampMatchConfig(config: Partial<MatchConfig>): MatchConfig {
  return {
    rounds: clampInt(config.rounds ?? DEFAULT_MATCH_CONFIG.rounds, ROUNDS_BOUNDS.min, ROUNDS_BOUNDS.max, DEFAULT_MATCH_CONFIG.rounds),
    roundSeconds: clampInt(
      config.roundSeconds ?? DEFAULT_MATCH_CONFIG.roundSeconds,
      ROUND_SECONDS_BOUNDS.min,
      ROUND_SECONDS_BOUNDS.max,
      DEFAULT_MATCH_CONFIG.roundSeconds,
    ),
  };
}

// One-line summary for the lobby screens ("3 rounds · 60s each"). Singular for
// a one-round match, because "1 rounds" on a shareable screen is the kind of
// detail that makes the rest look unconsidered.
export function describeMatchConfig(config: MatchConfig): string {
  const { rounds, roundSeconds } = config;
  return `${rounds} ${rounds === 1 ? "round" : "rounds"} · ${roundSeconds}s each`;
}
