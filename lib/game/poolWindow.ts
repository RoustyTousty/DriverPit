export type PoolWindow = "current-season" | "10-years" | "20-years" | "30-years" | "legacy";

// Daily and Duel always use this window — fixed, not user-selectable. Infinite
// no longer has one at all: it composes its pool from a year range plus
// nationality/team/achievement criteria (lib/game/driverFilter.ts, drizzle/0053),
// so these windows are now purely daily/duel's.
//
// The cutoff this constant implies is DUPLICATED IN plpgsql, because a Postgres
// function can't import it: daily_target_id, duel_begin_round and
// daily_submit_guess all hardcode it (all three last set by drizzle/0052, which
// widened the window from 10 years to 20). Changing it here and nowhere else
// moves only the autocomplete, leaving a target the player can't type.
// `poolWindow.sqlParity.test.ts` (database CI tier) pins all of them to this
// file — see its header for the failure it exists to catch.
export const DAILY_POOL_WINDOW: PoolWindow = "20-years";

// `tier` is the short display name for the window; `label` is the longer
// description shown alongside it (marketing copy, the seed's report). The full
// ladder outlives Infinite's picker because the seed reports against it and the
// parity suite walks it.
export const POOL_WINDOWS: { value: PoolWindow; tier: string; label: string }[] = [
  { value: "current-season", tier: "Amateur", label: "Current season only" },
  { value: "10-years", tier: "Regular", label: "Last 10 years" },
  { value: "20-years", tier: "Professional", label: "Last 20 years" },
  { value: "30-years", tier: "Veteran", label: "Last 30 years" },
  { value: "legacy", tier: "Legend", label: "Every driver, ever" },
];

// null = no cutoff, every driver who's ever started a race is in the pool.
export function poolCutoffYear(window: PoolWindow, referenceYear: number): number | null {
  switch (window) {
    case "current-season":
      return referenceYear;
    case "10-years":
      return referenceYear - 10;
    case "20-years":
      return referenceYear - 20;
    case "30-years":
      return referenceYear - 30;
    case "legacy":
      return null;
  }
}
