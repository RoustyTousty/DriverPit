import { describe, expect, it } from "vitest";

import { resolveSweepOptions } from "./sweepGuests";

// One rule, and it is the only thing in this script worth a test: which way the
// default falls. Everything else it does is a SQL round trip.
//
// The precedent is scripts/releaseGuards.ts#resolveWriteMode, and the reason is
// the same measured hazard: `npm run x -- --flag` loses the flag entirely under
// PowerShell 5.1, which once turned a seed dry run into a real 792-row write.
// This job deletes accounts, so its safe mode must not depend on anything a
// shell can eat -- hence env vars, and hence deleting being opt-in by an exact
// string rather than by anything truthy.
describe("resolveSweepOptions", () => {
  it("is a dry run unless deletion is asked for exactly", () => {
    for (const raw of [undefined, "", " ", "0", "no", "true", "False", "FALSE", "false ", "1"]) {
      expect(resolveSweepOptions({ SWEEP_DRY_RUN: raw }).dryRun).toBe(true);
    }
  });

  it("deletes only on the exact string", () => {
    expect(resolveSweepOptions({ SWEEP_DRY_RUN: "false" }).dryRun).toBe(false);
  });

  it("defaults the window to 60 days", () => {
    expect(resolveSweepOptions({}).olderThanDays).toBe(60);
  });

  // Matches the GREATEST(..., 7) the SQL applies, so the log cannot describe a
  // window the function would not have used.
  it("never sweeps guests younger than a week, however it is asked", () => {
    for (const raw of ["1", "0", "-30", "3"]) {
      expect(resolveSweepOptions({ SWEEP_OLDER_THAN_DAYS: raw }).olderThanDays).toBeGreaterThanOrEqual(7);
    }
  });

  it("falls back rather than trusting a value that is not a positive integer", () => {
    for (const raw of ["abc", "12.5", "", "-1", "1e3", "9007199254740993"]) {
      expect(resolveSweepOptions({ SWEEP_BATCH_SIZE: raw }).batchSize).toBe(500);
      expect(resolveSweepOptions({ SWEEP_MAX_BATCHES: raw }).maxBatches).toBe(40);
    }
  });

  it("takes a valid override", () => {
    const options = resolveSweepOptions({
      SWEEP_DRY_RUN: "false",
      SWEEP_OLDER_THAN_DAYS: "90",
      SWEEP_BATCH_SIZE: "200",
      SWEEP_MAX_BATCHES: "5",
    });
    expect(options).toEqual({ dryRun: false, olderThanDays: 90, batchSize: 200, maxBatches: 5 });
  });
});
