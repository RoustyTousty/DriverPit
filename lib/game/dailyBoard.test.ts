import { describe, expect, it } from "vitest";

import { isWin } from "./compare";
import { buildDailyBoard, dailyCompletion, type DailyBoardDriver } from "./dailyBoard";

// Pure, offline coverage of the daily board's derivation: appending guesses
// builds the right tiles, and the target is gated on completion. The DB/auth
// orchestration that wraps this (lib/db/dailyProgress.ts) is exercised in
// lib/db/dailyProgress.test.ts (opt-in, needs a real Postgres).

const target: DailyBoardDriver = {
  id: 1,
  fullName: "Target Driver",
  driverCode: "TAR",
  nationality: "British",
  team: "Alpha",
  previousTeams: ["Alpha", "Beta"],
  dateOfBirth: "1990-01-01",
  dateOfDeath: null,
  debutYear: 2010,
  careerWins: 20,
};

// Differs from the target on every attribute, and once raced for Beta (the
// target's previous team) so its team feedback is the distinctive "historical".
const other: DailyBoardDriver = {
  id: 2,
  fullName: "Other Driver",
  driverCode: "OTH",
  nationality: "German",
  team: "Beta",
  previousTeams: ["Beta"],
  dateOfBirth: "1995-01-01",
  dateOfDeath: null,
  debutYear: 2015,
  careerWins: 5,
};

const driverById = new Map<number, DailyBoardDriver>([
  [target.id, target],
  [other.id, other],
]);

const TODAY = new Date("2026-07-23T00:00:00.000Z");
const MAX = 6;

describe("dailyCompletion", () => {
  const missTiles = { nationality: "miss", team: "miss", age: "higher", debutYear: "lower", careerWins: "higher" } as const;
  const winTiles = { nationality: "exact", team: "exact", age: "correct", debutYear: "correct", careerWins: "correct" } as const;

  it("is not complete mid-game", () => {
    expect(dailyCompletion([missTiles, missTiles], MAX)).toEqual({ completed: false, won: false });
  });

  it("completes and wins the moment a guess matches on all five", () => {
    expect(dailyCompletion([missTiles, winTiles], MAX)).toEqual({ completed: true, won: true });
  });

  it("completes without a win once guesses are exhausted", () => {
    const three = [missTiles, missTiles, missTiles];
    expect(dailyCompletion(three, 3)).toEqual({ completed: true, won: false });
  });
});

describe("buildDailyBoard", () => {
  it("appends guesses into rows whose tiles come from compare()", () => {
    const board = buildDailyBoard({ guessIds: [other.id], driverById, target, today: TODAY, maxGuesses: MAX });

    expect(board.guesses).toHaveLength(1);
    // Identity + the guessed driver's own display values, so a hydrated row
    // renders through the same GuessRow as live play.
    expect(board.guesses[0]).toMatchObject({
      driverId: other.id,
      name: "Other Driver",
      code: "OTH",
      nationality: "German",
      team: "Beta",
      debutYear: 2015,
      careerWins: 5,
    });
    expect(board.guesses[0].age).toBeTypeOf("number");
    // Feedback is genuinely recomputed against the target, not stored.
    expect(board.guesses[0].tiles).toMatchObject({
      nationality: "miss", // German vs British
      team: "historical", // raced for Beta, the target's previous team
      age: "higher", // target is older
      debutYear: "lower", // target debuted earlier
      careerWins: "higher", // target has more wins
    });
    expect(board.guessesRemaining).toBe(MAX - 1);
  });

  it("preserves guess order across multiple appends", () => {
    const board = buildDailyBoard({
      guessIds: [other.id, other.id],
      driverById,
      target,
      today: TODAY,
      maxGuesses: MAX,
    });
    expect(board.guesses.map((g) => g.driverId)).toEqual([other.id, other.id]);
    expect(board.guessesRemaining).toBe(MAX - 2);
  });

  it("hides the target while the day is in progress", () => {
    const board = buildDailyBoard({ guessIds: [other.id], driverById, target, today: TODAY, maxGuesses: MAX });
    expect(board.completed).toBe(false);
    expect(board.won).toBe(false);
    expect(board.target).toBeNull();
  });

  it("reveals the target once solved, and marks the winning row a win", () => {
    const board = buildDailyBoard({
      guessIds: [other.id, target.id],
      driverById,
      target,
      today: TODAY,
      maxGuesses: MAX,
    });
    expect(board.completed).toBe(true);
    expect(board.won).toBe(true);
    expect(isWin(board.guesses[1].tiles)).toBe(true);
    expect(board.target).toEqual({ driverId: target.id, name: "Target Driver", code: "TAR" });
  });

  it("reveals the target on a loss once guesses run out", () => {
    const board = buildDailyBoard({
      guessIds: [other.id, other.id, other.id],
      driverById,
      target,
      today: TODAY,
      maxGuesses: 3,
    });
    expect(board.completed).toBe(true);
    expect(board.won).toBe(false);
    expect(board.guessesRemaining).toBe(0);
    expect(board.target).toEqual({ driverId: target.id, name: "Target Driver", code: "TAR" });
  });

  it("throws if a stored guess id has no matching driver row", () => {
    expect(() =>
      buildDailyBoard({ guessIds: [999], driverById, target, today: TODAY, maxGuesses: MAX }),
    ).toThrow(/not found/);
  });
});
