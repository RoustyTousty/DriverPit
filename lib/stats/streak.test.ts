import { describe, expect, it } from "vitest";

import { currentStreakAsOf, nextCurrentStreak } from "./streak";

describe("nextCurrentStreak", () => {
  it("extends the streak on a win the day after the last result", () => {
    expect(
      nextCurrentStreak({
        previousStreak: 4,
        lastDailyDate: "2026-07-25",
        date: "2026-07-26",
        won: true,
      }),
    ).toBe(5);
  });

  it("restarts at 1 when a day was missed -- the original bug", () => {
    expect(
      nextCurrentStreak({
        previousStreak: 7,
        lastDailyDate: "2026-07-20",
        date: "2026-07-26",
        won: true,
      }),
    ).toBe(1);
  });

  it("restarts at 1 when exactly one day was skipped", () => {
    expect(
      nextCurrentStreak({
        previousStreak: 7,
        lastDailyDate: "2026-07-24",
        date: "2026-07-26",
        won: true,
      }),
    ).toBe(1);
  });

  it("resets to 0 on a loss, however consecutive", () => {
    expect(
      nextCurrentStreak({
        previousStreak: 9,
        lastDailyDate: "2026-07-25",
        date: "2026-07-26",
        won: false,
      }),
    ).toBe(0);
  });

  it("starts a streak at 1 for a first-ever result", () => {
    expect(
      nextCurrentStreak({ previousStreak: 0, lastDailyDate: null, date: "2026-07-26", won: true }),
    ).toBe(1);
  });

  it("does not continue an unanchored (legacy-migrated) streak", () => {
    expect(
      nextCurrentStreak({ previousStreak: 12, lastDailyDate: null, date: "2026-07-26", won: true }),
    ).toBe(1);
  });

  it("continues a streak the day after a loss reset it", () => {
    expect(
      nextCurrentStreak({
        previousStreak: 0,
        lastDailyDate: "2026-07-25",
        date: "2026-07-26",
        won: true,
      }),
    ).toBe(1);
  });

  it("counts consecutive days across a month boundary", () => {
    expect(
      nextCurrentStreak({
        previousStreak: 3,
        lastDailyDate: "2026-07-31",
        date: "2026-08-01",
        won: true,
      }),
    ).toBe(4);
  });
});

describe("currentStreakAsOf", () => {
  it("keeps a streak whose last result is today", () => {
    expect(currentStreakAsOf(6, "2026-07-26", "2026-07-26")).toBe(6);
  });

  it("keeps a streak whose last result is yesterday -- today isn't missed yet", () => {
    expect(currentStreakAsOf(6, "2026-07-25", "2026-07-26")).toBe(6);
  });

  it("zeroes a streak once a whole day has been skipped", () => {
    expect(currentStreakAsOf(6, "2026-07-24", "2026-07-26")).toBe(0);
  });

  it("zeroes a long-abandoned streak", () => {
    expect(currentStreakAsOf(30, "2026-01-01", "2026-07-26")).toBe(0);
  });

  it("zeroes an unanchored streak", () => {
    expect(currentStreakAsOf(6, null, "2026-07-26")).toBe(0);
  });

  it("treats a last result 'in the future' as alive (client clock behind the DB)", () => {
    expect(currentStreakAsOf(6, "2026-07-27", "2026-07-26")).toBe(6);
  });

  it("survives a month boundary", () => {
    expect(currentStreakAsOf(6, "2026-07-31", "2026-08-01")).toBe(6);
  });
});
