import { describe, expect, it } from "vitest";

import { getDailyPuzzleNumber, pickDailyDriverId } from "./dailySelection";

describe("getDailyPuzzleNumber", () => {
  it("numbers the epoch date as puzzle 1", () => {
    expect(getDailyPuzzleNumber("2026-07-18")).toBe(1);
  });

  it("increments by one per day", () => {
    expect(getDailyPuzzleNumber("2026-07-19")).toBe(2);
    expect(getDailyPuzzleNumber("2026-08-17")).toBe(31);
  });
});

describe("pickDailyDriverId", () => {
  const pool = [10, 20, 30, 40, 50];

  it("throws on an empty pool", () => {
    expect(() => pickDailyDriverId("2026-07-19", [])).toThrow();
  });

  it("always returns a driver from the pool", () => {
    for (let i = 0; i < 60; i++) {
      const date = `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;
      expect(pool).toContain(pickDailyDriverId(date, pool));
    }
  });

  it("is deterministic for the same date and pool", () => {
    const a = pickDailyDriverId("2026-07-19", pool);
    const b = pickDailyDriverId("2026-07-19", pool);
    expect(a).toBe(b);
  });

  it("doesn't depend on the input pool's ordering", () => {
    const shuffled = [30, 10, 50, 20, 40];
    expect(pickDailyDriverId("2026-07-19", pool)).toBe(pickDailyDriverId("2026-07-19", shuffled));
  });

  it("covers more than one driver across a run of days", () => {
    const picks = new Set<number>();
    for (let i = 0; i < 120; i++) {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      picks.add(pickDailyDriverId(date, pool));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("still works with a single-driver pool", () => {
    expect(pickDailyDriverId("2026-07-19", [42])).toBe(42);
  });
});
