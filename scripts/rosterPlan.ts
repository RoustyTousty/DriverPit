// Reconciles the F1DB roster against the rows already in `drivers`, deciding
// which existing row (if any) each incoming driver corresponds to.
//
// This exists because `drivers.id` is a serial that three tables hold FKs to
// and that `daily_progress.guesses` stores bare -- so a re-seed has to UPDATE
// rows in place, never delete and re-insert them (audit 2026-07-27 §5.1,
// drizzle/0043). The upsert key is F1DB's own slug, `f1db_id`, which most rows
// don't have yet: the column was added long after they were imported. Working
// out which existing row a slug belongs to is the whole job here, and it is
// pure so it can be tested without a database.
//
// The rules, in the order they're applied to each incoming driver:
//
//   1. A row already carries this slug -> it's that row. Nothing to do; the
//      upsert's ON CONFLICT updates it.
//   2. No row carries it, but exactly one *claimable* row has the same natural
//      key -> adopt it: write the slug onto that row so the upsert updates it
//      instead of inserting a second copy of the same driver.
//   3. Otherwise -> genuinely new. Insert.
//
// "Claimable" means the row's slug is NULL (pre-0043) or is absent from this
// release (an upstream rename -- the row keeps its id and gets re-keyed). A row
// whose slug is still in the feed is spoken for and can never be adopted away
// from it.
//
// Ambiguity is never guessed at. If two rows on either side share a natural
// key, no adoption is made for it and both sides are reported, because getting
// it wrong means silently rewriting one real driver's history into another's.

/** A row as it exists in `drivers` today. */
export interface ExistingDriver {
  id: number;
  f1dbId: string | null;
  fullName: string;
  /** ISO `YYYY-MM-DD`, as both Postgres `date` and the F1DB CSV render it. */
  dateOfBirth: string;
}

/** A driver parsed out of the current F1DB release. */
export interface IncomingDriver {
  f1dbId: string;
  fullName: string;
  dateOfBirth: string;
}

/** An existing row to re-key, so the upsert lands on it rather than inserting. */
export interface Adoption {
  driverId: number;
  f1dbId: string;
  fullName: string;
  /** Null on the first run after drizzle/0043; a slug on an upstream rename. */
  previousF1dbId: string | null;
}

export interface RosterPlan {
  adoptions: Adoption[];
  /** Slugs with no existing row -- the upsert inserts these. */
  inserts: IncomingDriver[];
  /** Existing rows this release no longer mentions. Reported, never deleted. */
  unmatched: ExistingDriver[];
  /** Natural keys that were too ambiguous to adopt on. */
  ambiguous: {
    naturalKey: string;
    existingIds: number[];
    incomingF1dbIds: string[];
  }[];
}

// A NUL separator rather than a hyphen or a pipe: a driver's name can hold any
// printable character, so a visible separator could be embedded in one name and
// make it collide with a different (name, date of birth) pair.
const KEY_SEPARATOR = "\u0000";

function naturalKey(driver: { fullName: string; dateOfBirth: string }): string {
  return `${driver.fullName}${KEY_SEPARATOR}${driver.dateOfBirth}`;
}

function describeKey(key: string): string {
  const [name, dob] = key.split(KEY_SEPARATOR);
  return `${name} (${dob})`;
}

/**
 * Throws on a duplicate slug in the release. Postgres would reject the batch
 * anyway ("ON CONFLICT DO UPDATE command cannot affect row a second time"),
 * but a named driver beats a constraint name in a stack trace.
 */
export function assertUniqueF1dbIds(incoming: IncomingDriver[]): void {
  const seen = new Set<string>();
  for (const driver of incoming) {
    if (seen.has(driver.f1dbId)) {
      throw new Error(
        `F1DB release contains driver id "${driver.f1dbId}" more than once ` +
          `(${driver.fullName}) -- refusing to seed from it.`,
      );
    }
    seen.add(driver.f1dbId);
  }
}

export function planRoster(
  existing: ExistingDriver[],
  incoming: IncomingDriver[],
): RosterPlan {
  const incomingIds = new Set(incoming.map((d) => d.f1dbId));
  const existingByF1dbId = new Map<string, ExistingDriver>();
  for (const row of existing) {
    if (row.f1dbId !== null) existingByF1dbId.set(row.f1dbId, row);
  }

  // Rows nothing in this release claims by slug, grouped by natural key.
  const claimable = new Map<string, ExistingDriver[]>();
  for (const row of existing) {
    if (row.f1dbId !== null && incomingIds.has(row.f1dbId)) continue;
    const key = naturalKey(row);
    const group = claimable.get(key);
    if (group) group.push(row);
    else claimable.set(key, [row]);
  }

  // Incoming drivers with no existing row of their own, grouped the same way.
  const unresolved = new Map<string, IncomingDriver[]>();
  for (const driver of incoming) {
    if (existingByF1dbId.has(driver.f1dbId)) continue;
    const key = naturalKey(driver);
    const group = unresolved.get(key);
    if (group) group.push(driver);
    else unresolved.set(key, [driver]);
  }

  const adoptions: Adoption[] = [];
  const inserts: IncomingDriver[] = [];
  const ambiguous: RosterPlan["ambiguous"] = [];
  const adopted = new Set<number>();

  for (const [key, candidates] of unresolved) {
    const rows = claimable.get(key) ?? [];

    if (rows.length === 0) {
      inserts.push(...candidates);
      continue;
    }

    // One row, one driver, one answer. Anything else is a coin flip on whose
    // stored history belongs to whom, so it stays an insert and gets reported.
    if (rows.length === 1 && candidates.length === 1) {
      adoptions.push({
        driverId: rows[0].id,
        f1dbId: candidates[0].f1dbId,
        fullName: candidates[0].fullName,
        previousF1dbId: rows[0].f1dbId,
      });
      adopted.add(rows[0].id);
      continue;
    }

    ambiguous.push({
      naturalKey: describeKey(key),
      existingIds: rows.map((r) => r.id),
      incomingF1dbIds: candidates.map((c) => c.f1dbId),
    });
    inserts.push(...candidates);
  }

  const unmatched: ExistingDriver[] = [];
  for (const rows of claimable.values()) {
    for (const row of rows) {
      if (!adopted.has(row.id)) unmatched.push(row);
    }
  }
  unmatched.sort((a, b) => a.id - b.id);

  return { adoptions, inserts, unmatched, ambiguous };
}
