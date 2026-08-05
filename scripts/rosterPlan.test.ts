import { describe, expect, it } from "vitest";

import {
  assertPlanUnambiguous,
  assertUniqueF1dbIds,
  planRoster,
  type ExistingDriver,
  type IncomingDriver,
} from "./rosterPlan";

// Audit 2026-07-27 §5.1. The seed used to DELETE the whole drivers table and
// re-insert it, which throws a foreign-key violation against any database that
// has served a daily -- and, forced past that, renumbers every `serial` id
// while daily_targets, duel_rounds, infinite_rounds and daily_progress.guesses
// still point at the old ones.
//
// The replacement is an upsert on F1DB's slug, so what has to hold is: every
// incoming driver resolves to AT MOST ONE existing row, and it never resolves
// to the wrong one. These cases are that property, including the two shapes
// that only appear once (the first run after drizzle/0043) or rarely (an
// upstream slug rename).

function existing(
  id: number,
  f1dbId: string | null,
  fullName: string,
  dateOfBirth: string,
): ExistingDriver {
  return { id, f1dbId, fullName, dateOfBirth };
}

function incoming(
  f1dbId: string,
  fullName: string,
  dateOfBirth: string,
): IncomingDriver {
  return { f1dbId, fullName, dateOfBirth };
}

const MAX = incoming("max-verstappen", "Max Verstappen", "1997-09-30");
const LEWIS = incoming("lewis-hamilton", "Lewis Hamilton", "1985-01-07");
const JOS = incoming("jos-verstappen", "Jos Verstappen", "1972-03-04");

describe("planRoster", () => {
  it("inserts everything into an empty table", () => {
    const plan = planRoster([], [MAX, LEWIS]);

    expect(plan.inserts).toEqual([MAX, LEWIS]);
    expect(plan.adoptions).toEqual([]);
    expect(plan.unmatched).toEqual([]);
    expect(plan.ambiguous).toEqual([]);
  });

  // The first run after drizzle/0043: 792 real rows, none of which carry a
  // slug yet. If this doesn't adopt, the seed inserts a second copy of every
  // driver and the pool doubles.
  it("adopts pre-0043 rows by name and date of birth", () => {
    const rows = [
      existing(1, null, "Max Verstappen", "1997-09-30"),
      existing(2, null, "Lewis Hamilton", "1985-01-07"),
    ];

    const plan = planRoster(rows, [MAX, LEWIS]);

    expect(plan.adoptions).toEqual([
      {
        driverId: 1,
        f1dbId: "max-verstappen",
        fullName: "Max Verstappen",
        previousF1dbId: null,
      },
      {
        driverId: 2,
        f1dbId: "lewis-hamilton",
        fullName: "Lewis Hamilton",
        previousF1dbId: null,
      },
    ]);
    expect(plan.inserts).toEqual([]);
    expect(plan.unmatched).toEqual([]);
  });

  // Jos and Max share a surname and a driver_code (VER) -- the case
  // GuessGrid.tsx already documents. Different dates of birth, so the natural
  // key separates them and neither steals the other's row.
  it("keeps same-surname drivers apart", () => {
    const rows = [
      existing(1, null, "Max Verstappen", "1997-09-30"),
      existing(2, null, "Jos Verstappen", "1972-03-04"),
    ];

    const plan = planRoster(rows, [JOS, MAX]);

    expect(plan.adoptions).toEqual([
      {
        driverId: 2,
        f1dbId: "jos-verstappen",
        fullName: "Jos Verstappen",
        previousF1dbId: null,
      },
      {
        driverId: 1,
        f1dbId: "max-verstappen",
        fullName: "Max Verstappen",
        previousF1dbId: null,
      },
    ]);
    expect(plan.inserts).toEqual([]);
  });

  // The steady state -- every re-seed after the first. Nothing to adopt,
  // nothing to insert; the upsert just refreshes wins and teams in place.
  it("does nothing structural once every row is keyed", () => {
    const rows = [
      existing(1, "max-verstappen", "Max Verstappen", "1997-09-30"),
      existing(2, "lewis-hamilton", "Lewis Hamilton", "1985-01-07"),
    ];

    const plan = planRoster(rows, [MAX, LEWIS]);

    expect(plan).toEqual({
      adoptions: [],
      inserts: [],
      unmatched: [],
      ambiguous: [],
    });
  });

  it("inserts a genuine rookie alongside the existing roster", () => {
    const rows = [existing(1, "max-verstappen", "Max Verstappen", "1997-09-30")];
    const rookie = incoming("kimi-antonelli", "Andrea Kimi Antonelli", "2006-08-25");

    const plan = planRoster(rows, [MAX, rookie]);

    expect(plan.inserts).toEqual([rookie]);
    expect(plan.adoptions).toEqual([]);
    expect(plan.unmatched).toEqual([]);
  });

  // An upstream slug rename. Without the re-key this inserts a duplicate
  // driver, and the original -- still referenced by daily_targets and
  // duel_rounds -- silently stops being updated.
  it("re-keys a row whose slug changed upstream", () => {
    const rows = [existing(7, "kimi-antonelli", "Andrea Kimi Antonelli", "2006-08-25")];
    const renamed = incoming(
      "andrea-kimi-antonelli",
      "Andrea Kimi Antonelli",
      "2006-08-25",
    );

    const plan = planRoster(rows, [renamed]);

    expect(plan.adoptions).toEqual([
      {
        driverId: 7,
        f1dbId: "andrea-kimi-antonelli",
        fullName: "Andrea Kimi Antonelli",
        previousF1dbId: "kimi-antonelli",
      },
    ]);
    expect(plan.inserts).toEqual([]);
    expect(plan.unmatched).toEqual([]);
  });

  // A row a slug in this release still claims can't be adopted away from it,
  // even when some other driver happens to match its name and birth date.
  it("never adopts a row the release still claims by slug", () => {
    const rows = [existing(1, "max-verstappen", "Max Verstappen", "1997-09-30")];
    const impostor = incoming("max-verstappen-2", "Max Verstappen", "1997-09-30");

    const plan = planRoster(rows, [MAX, impostor]);

    expect(plan.adoptions).toEqual([]);
    expect(plan.inserts).toEqual([impostor]);
  });

  it("reports rows the release no longer mentions, and keeps them", () => {
    const rows = [
      existing(1, "max-verstappen", "Max Verstappen", "1997-09-30"),
      existing(2, null, "Someone Retired", "1930-01-01"),
    ];

    const plan = planRoster(rows, [MAX]);

    expect(plan.unmatched).toEqual([existing(2, null, "Someone Retired", "1930-01-01")]);
    expect(plan.adoptions).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  // Two rows with one name and one birth date. Picking either would rewrite
  // one real driver's history into the other's, so the plan refuses and says
  // so; the incoming rows insert as new and the operator sorts it out.
  it("refuses to guess when two existing rows share a natural key", () => {
    const rows = [
      existing(1, null, "Duplicate Driver", "1990-05-05"),
      existing(2, null, "Duplicate Driver", "1990-05-05"),
    ];
    const dup = incoming("duplicate-driver", "Duplicate Driver", "1990-05-05");

    const plan = planRoster(rows, [dup]);

    expect(plan.adoptions).toEqual([]);
    expect(plan.inserts).toEqual([dup]);
    expect(plan.ambiguous).toEqual([
      {
        naturalKey: "Duplicate Driver (1990-05-05)",
        existingIds: [1, 2],
        incomingF1dbIds: ["duplicate-driver"],
      },
    ]);
    // Reported as ambiguous AND still reported as unadopted -- neither row is
    // quietly dropped from the operator's view.
    expect(plan.unmatched.map((r) => r.id)).toEqual([1, 2]);
  });

  it("refuses to guess when two incoming drivers share a natural key", () => {
    const rows = [existing(1, null, "Duplicate Driver", "1990-05-05")];
    const a = incoming("duplicate-driver-a", "Duplicate Driver", "1990-05-05");
    const b = incoming("duplicate-driver-b", "Duplicate Driver", "1990-05-05");

    const plan = planRoster(rows, [a, b]);

    expect(plan.adoptions).toEqual([]);
    expect(plan.inserts).toEqual([a, b]);
    expect(plan.ambiguous).toEqual([
      {
        naturalKey: "Duplicate Driver (1990-05-05)",
        existingIds: [1],
        incomingF1dbIds: ["duplicate-driver-a", "duplicate-driver-b"],
      },
    ]);
  });

  // Every incoming driver accounts for exactly one row, so the seed can assert
  // the post-upsert row count and roll back if the plan and the table disagree.
  it("resolves each incoming driver to exactly one outcome", () => {
    const rows = [
      existing(1, "max-verstappen", "Max Verstappen", "1997-09-30"),
      existing(2, null, "Lewis Hamilton", "1985-01-07"),
      existing(3, "gone-upstream", "Gone Upstream", "1950-02-02"),
    ];
    const rookie = incoming("kimi-antonelli", "Andrea Kimi Antonelli", "2006-08-25");

    const plan = planRoster(rows, [MAX, LEWIS, rookie]);

    expect(plan.adoptions).toHaveLength(1);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.unmatched.map((r) => r.id)).toEqual([3]);
    // 3 existing + 1 insert = 4 rows, which is exactly the assertion the seed
    // makes inside its transaction.
    expect(rows.length + plan.inserts.length).toBe(4);
  });
});

describe("assertUniqueF1dbIds", () => {
  it("accepts a well-formed release", () => {
    expect(() => assertUniqueF1dbIds([MAX, LEWIS, JOS])).not.toThrow();
  });

  // Postgres would reject the batch anyway ("cannot affect row a second
  // time"), but naming the driver turns a constraint error into a data bug.
  it("names the duplicate rather than leaving it to Postgres", () => {
    expect(() => assertUniqueF1dbIds([MAX, LEWIS, MAX])).toThrow(
      /max-verstappen.*more than once/,
    );
  });
});

// The strict-mode guard the unattended weekly refresh runs behind
// (.github/workflows/roster-refresh.yml -> npm run db:seed:auto). Everything
// above describes a plan an operator READS; this decides which of those plans a
// schedule is allowed to commit with nobody looking.
describe("assertPlanUnambiguous", () => {
  it("passes on a plan that resolved every driver", () => {
    const rows = [existing(1, null, "Max Verstappen", "1997-09-30")];
    const rookie = incoming("kimi-antonelli", "Andrea Kimi Antonelli", "2006-08-25");

    expect(() => assertPlanUnambiguous(planRoster(rows, [MAX, rookie]))).not.toThrow();
  });

  // The case worth stopping for: no adoption is possible, so the incoming
  // driver INSERTS beside a row that may already be them -- and the original
  // keeps every daily_targets / duel_rounds / daily_progress.guesses reference
  // pointing at it while both sit in the pool.
  it("throws on an ambiguous natural key, naming both sides", () => {
    const rows = [
      existing(1, null, "Duplicate Driver", "1990-05-05"),
      existing(2, null, "Duplicate Driver", "1990-05-05"),
    ];
    const dup = incoming("duplicate-driver", "Duplicate Driver", "1990-05-05");

    expect(() => assertPlanUnambiguous(planRoster(rows, [dup]))).toThrow(
      /Duplicate Driver \(1990-05-05\)[\s\S]*#1, #2[\s\S]*duplicate-driver/,
    );
  });

  // Deliberately NOT fatal. Rows a release stops mentioning are expected (a
  // pre-0043 import that was never adopted, a genuinely dropped entry), they are
  // never deleted, and failing here would leave the weekly refresh permanently
  // red -- which is how a scheduled job stops being read.
  it("passes when rows are merely absent from the release", () => {
    const rows = [
      existing(1, "max-verstappen", "Max Verstappen", "1997-09-30"),
      existing(3, "gone-upstream", "Gone Upstream", "1950-02-02"),
    ];

    const plan = planRoster(rows, [MAX]);

    expect(plan.unmatched.map((r) => r.id)).toEqual([3]);
    expect(() => assertPlanUnambiguous(plan)).not.toThrow();
  });
});
