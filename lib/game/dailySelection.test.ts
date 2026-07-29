import { describe, expect, it } from "vitest";

import { getDailyPuzzleNumber } from "./dailySelection";

// pickDailyDriverId's suite (and its SQL parity suite) were deleted alongside
// the function in drizzle/0038 -- the day's driver is now an unpredictable
// server-side pick with no TypeScript implementation to test. See
// lib/db/dailyTargetSecrecy.test.ts for what replaced that coverage.

describe("getDailyPuzzleNumber", () => {
  it("numbers the epoch date as puzzle 1", () => {
    expect(getDailyPuzzleNumber("2026-07-18")).toBe(1);
  });

  it("increments by one per day", () => {
    expect(getDailyPuzzleNumber("2026-07-19")).toBe(2);
    expect(getDailyPuzzleNumber("2026-08-17")).toBe(31);
  });
});
