import { describe, expect, it } from "vitest";

import {
  clampMatchConfig,
  DEFAULT_MATCH_CONFIG,
  describeMatchConfig,
  ROUNDS_BOUNDS,
  ROUNDS_OPTIONS,
  ROUND_SECONDS_BOUNDS,
  ROUND_SECONDS_OPTIONS,
} from "./customMatchConfig";

describe("clampMatchConfig", () => {
  it("leaves an in-range config alone", () => {
    expect(clampMatchConfig({ rounds: 5, roundSeconds: 90 })).toEqual({ rounds: 5, roundSeconds: 90 });
  });

  it("clamps to the bounds rather than rejecting", () => {
    expect(clampMatchConfig({ rounds: 99, roundSeconds: 9999 })).toEqual({
      rounds: ROUNDS_BOUNDS.max,
      roundSeconds: ROUND_SECONDS_BOUNDS.max,
    });
    expect(clampMatchConfig({ rounds: 0, roundSeconds: 1 })).toEqual({
      rounds: ROUNDS_BOUNDS.min,
      roundSeconds: ROUND_SECONDS_BOUNDS.min,
    });
  });

  it("fills a missing field from the default", () => {
    expect(clampMatchConfig({ rounds: 1 })).toEqual({ rounds: 1, roundSeconds: DEFAULT_MATCH_CONFIG.roundSeconds });
    expect(clampMatchConfig({})).toEqual(DEFAULT_MATCH_CONFIG);
  });

  it("rounds a fractional value to an integer -- both columns are integer", () => {
    expect(clampMatchConfig({ rounds: 2.6, roundSeconds: 45.4 })).toEqual({ rounds: 3, roundSeconds: 45 });
  });

  // Infinity would survive Math.min/max as `max`, which reads as "the host
  // chose the longest match" rather than "that input was nonsense".
  it("falls back rather than clamping on a non-finite value", () => {
    expect(clampMatchConfig({ rounds: Number.NaN, roundSeconds: Number.POSITIVE_INFINITY })).toEqual(
      DEFAULT_MATCH_CONFIG,
    );
  });

  // The load-bearing relationship: every option the UI offers must survive the
  // clamp unchanged, or a button would silently produce a different match than
  // the one it names.
  it("passes every offered option through untouched", () => {
    for (const rounds of ROUNDS_OPTIONS) {
      for (const roundSeconds of ROUND_SECONDS_OPTIONS) {
        expect(clampMatchConfig({ rounds, roundSeconds })).toEqual({ rounds, roundSeconds });
      }
    }
  });

  it("offers only values the database bounds admit", () => {
    for (const rounds of ROUNDS_OPTIONS) {
      expect(rounds).toBeGreaterThanOrEqual(ROUNDS_BOUNDS.min);
      expect(rounds).toBeLessThanOrEqual(ROUNDS_BOUNDS.max);
    }
    for (const seconds of ROUND_SECONDS_OPTIONS) {
      expect(seconds).toBeGreaterThanOrEqual(ROUND_SECONDS_BOUNDS.min);
      expect(seconds).toBeLessThanOrEqual(ROUND_SECONDS_BOUNDS.max);
    }
  });

  it("defaults to the matchmade match shape", () => {
    expect(clampMatchConfig(DEFAULT_MATCH_CONFIG)).toEqual(DEFAULT_MATCH_CONFIG);
    expect(ROUNDS_OPTIONS).toContain(DEFAULT_MATCH_CONFIG.rounds);
    expect(ROUND_SECONDS_OPTIONS).toContain(DEFAULT_MATCH_CONFIG.roundSeconds);
  });
});

describe("describeMatchConfig", () => {
  it("summarizes a match in one line", () => {
    expect(describeMatchConfig({ rounds: 3, roundSeconds: 60 })).toBe("3 rounds · 60s each");
    expect(describeMatchConfig({ rounds: 5, roundSeconds: 90 })).toBe("5 rounds · 90s each");
  });

  it("says 'round', not 'rounds', for a one-round match", () => {
    expect(describeMatchConfig({ rounds: 1, roundSeconds: 30 })).toBe("1 round · 30s each");
  });
});
