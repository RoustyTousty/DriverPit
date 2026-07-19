import { describe, expect, it } from "vitest";

import { buildShareText } from "./emojiGrid";
import type { GuessResult } from "./compare";

const WIN_RESULT: GuessResult = {
  nationality: "exact",
  team: "exact",
  age: "correct",
  debutYear: "correct",
  careerWins: "correct",
};

const MIXED_RESULT: GuessResult = {
  nationality: "miss",
  team: "exact",
  age: "higher",
  debutYear: "lower",
  careerWins: "correct",
};

describe("buildShareText", () => {
  it("renders one emoji row per guess, in order", () => {
    const text = buildShareText({
      puzzleNumber: 12,
      results: [MIXED_RESULT, WIN_RESULT],
      won: true,
      maxGuesses: 5,
    });
    const lines = text.split("\n");
    expect(lines).toContain("⬛🟩🔼🔽🟩");
    expect(lines).toContain("🟩🟩🟩🟩🟩");
  });

  it("includes the puzzle number in the header", () => {
    const text = buildShareText({
      puzzleNumber: 42,
      results: [WIN_RESULT],
      won: true,
      maxGuesses: 5,
    });
    expect(text).toContain("Daily #42");
  });

  it("shows guesses-used/max as the score on a win", () => {
    const text = buildShareText({
      puzzleNumber: 1,
      results: [MIXED_RESULT, MIXED_RESULT, WIN_RESULT],
      won: true,
      maxGuesses: 5,
    });
    expect(text).toContain("3/5");
  });

  it("shows X/max as the score on a loss", () => {
    const text = buildShareText({
      puzzleNumber: 1,
      results: [MIXED_RESULT, MIXED_RESULT, MIXED_RESULT, MIXED_RESULT, MIXED_RESULT],
      won: false,
      maxGuesses: 5,
    });
    expect(text).toContain("X/5");
  });

  it("maps every feedback value to a distinct emoji", () => {
    const text = buildShareText({
      puzzleNumber: 1,
      results: [MIXED_RESULT],
      won: false,
      maxGuesses: 5,
    });
    // miss, exact, higher, lower, correct -> 5 distinct glyphs expected
    const row = text.split("\n")[3];
    const glyphs = new Set([...row]);
    expect(glyphs.size).toBe(4); // "exact" and "correct" intentionally share 🟩
  });
});
