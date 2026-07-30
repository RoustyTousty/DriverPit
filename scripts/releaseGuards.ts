// The loud half of the seed, restored (audit 2026-07-29 §5.2, extended by §5.2b).
//
// The old seed did `DELETE FROM drivers` and re-inserted, so a release that
// parsed wrong hit a foreign key and stopped. §5.1 replaced that with an
// in-place upsert -- correctly, because `drivers.id` is a serial that three
// tables hold FKs to and that `daily_progress.guesses` stores bare. The cost is
// that the same bad release now UPDATEs 792 live rows and commits. `seed.ts`'s
// MIN_ROSTER_RATIO catches "most of the feed is missing" and none of the three
// failure modes the audit tabulates, because all three preserve the row count
// exactly:
//
//   positionText renamed    -> NON_START_CODES.has(undefined) is false, so every
//                              DNQ/DNS counts as a race start. Debut years shift
//                              earlier, last_active_year later, pool membership
//                              changes.
//   positionNumber renamed  -> career_wins becomes 0 for every driver.
//   round renamed           -> Number(undefined) is NaN, the last-team tie-break
//                              never fires, last_team is wrong.
//
// Everything here is pure so it runs in the static CI tier, which is the point:
// a check nobody has exercised is not a check. The per-column half of the same
// defence is drizzle/0047's CHECK constraints, which fail the transaction.

const RELEASE_ENV_VAR = "F1DB_RELEASE";

/** A tag known to parse correctly here -- named in the error, not defaulted to. */
const KNOWN_GOOD_RELEASE = "v2026.11.0";

// ---------------------------------------------------------------------------
// Which mode the seed runs in (audit 2026-07-29 §5.1 residual)
//
// The seed used to write for real by default and take `--dry-run` to hold back.
// That is the wrong way round for a script that UPDATEs 792 live rows in place,
// because the safe form is the one that can go missing: Windows PowerShell 5.1
// drops the bare `--` when it invokes a native command, npm then swallows
// `--dry-run` as its own config flag, and `process.argv.slice(2)` reaches the
// script as `[]`. That is not hypothetical -- it committed a production roster
// refresh on 2026-07-30, and the only visible symptom was the ABSENCE of the
// "rolled back" line at the end.
//
// So the default is now the harmless one and writing is opt-in: a lost
// `--commit` costs a re-run, a lost `--dry-run` cost a database. `db:seed:commit`
// carries the flag inside the package.json script string, where no shell gets to
// forward it and nothing can strip it.
//
// Unrecognised arguments are a hard stop rather than a shrug. Failing closed
// already makes `--commmit` safe, but silently safe is how a typo turns into
// "the seed doesn't work any more" three runs later.
// ---------------------------------------------------------------------------

export const COMMIT_FLAG = "--commit";
export const DRY_RUN_FLAG = "--dry-run";

export interface WriteMode {
  /** True only when the operator explicitly asked for the write to be kept. */
  commit: boolean;
}

export function resolveWriteMode(argv: readonly string[]): WriteMode {
  const unknown = argv.filter(
    (arg) => arg !== COMMIT_FLAG && arg !== DRY_RUN_FLAG,
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unrecognised argument(s): ${unknown.join(", ")}. The seed takes ` +
        `${COMMIT_FLAG} (write and keep it) or ${DRY_RUN_FLAG} (the default: ` +
        `write and roll back).`,
    );
  }

  const commit = argv.includes(COMMIT_FLAG);
  if (commit && argv.includes(DRY_RUN_FLAG)) {
    throw new Error(
      `${COMMIT_FLAG} and ${DRY_RUN_FLAG} contradict each other. Pass one.`,
    );
  }

  return { commit };
}

/**
 * The first line the seed prints, before the download. The flag can be lost in
 * argv passing and the difference is 792 live rows, so which mode this is gets
 * stated up front rather than inferred from a message at the end.
 */
export function describeWriteMode(mode: WriteMode): string {
  return mode.commit
    ? "Mode: REAL WRITE — 792-odd live driver rows will be UPDATEd in place and KEPT."
    : "Mode: DRY RUN — the write runs in full and is then rolled back. " +
        "Use `npm run db:seed:commit` to keep it.";
}

/**
 * Every column the seed reads out of each file. A rename upstream is caught
 * here rather than three transformations later as a plausible-looking number.
 */
export const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  "f1db-drivers.csv": [
    "id",
    "name",
    "abbreviation",
    "nationalityCountryId",
    "dateOfBirth",
    "dateOfDeath",
  ],
  "f1db-countries.csv": ["id", "name"],
  "f1db-constructors.csv": ["id", "name"],
  "f1db-races-race-results.csv": [
    "driverId",
    "year",
    "round",
    "positionText",
    "positionNumber",
    "constructorId",
  ],
};

export interface ResolvedRelease {
  /** The tag, or the literal `"latest"`. */
  release: string;
  url: string;
  pinned: boolean;
}

/**
 * Resolves which F1DB release to import. Unset is a hard stop rather than a
 * default: following `latest` is exactly how a renamed column arrives
 * unannounced, so it has to be something the operator typed.
 */
export function resolveRelease(
  env: Record<string, string | undefined>,
): ResolvedRelease {
  const release = env[RELEASE_ENV_VAR]?.trim();

  if (!release) {
    const pin = `${RELEASE_ENV_VAR}=${KNOWN_GOOD_RELEASE}`;
    const follow = `${RELEASE_ENV_VAR}=latest`.padEnd(pin.length);
    throw new Error(
      `${RELEASE_ENV_VAR} is not set. The seed UPDATEs live driver rows in ` +
        `place, so which release it reads is a deliberate choice, not a ` +
        `default.\n` +
        `  ${pin}  pin a tag (see https://github.com/f1db/f1db/releases)\n` +
        `  ${follow}  follow upstream, accepting that a column rename lands ` +
        `unannounced`,
    );
  }

  if (release === "latest") {
    return {
      release,
      url: "https://github.com/f1db/f1db/releases/latest/download/f1db-csv.zip",
      pinned: false,
    };
  }

  // A slash would let a tag rewrite the path it's interpolated into.
  if (!/^[\w.-]+$/.test(release)) {
    throw new Error(
      `${RELEASE_ENV_VAR}="${release}" is not a valid release tag.`,
    );
  }

  return {
    release,
    url: `https://github.com/f1db/f1db/releases/download/${release}/f1db-csv.zip`,
    pinned: true,
  };
}

/**
 * Asserts a parsed CSV still has the columns the seed reads. `columns: true`
 * gives every row the header row's keys, so one row is the whole header.
 */
export function assertColumns(fileName: string, rows: Record<string, string>[]): void {
  const required = REQUIRED_COLUMNS[fileName];
  if (!required) return;

  if (rows.length === 0) {
    throw new Error(`F1DB release file ${fileName} parsed to 0 rows.`);
  }

  const present = new Set(Object.keys(rows[0]));
  const missing = required.filter((column) => !present.has(column));
  if (missing.length > 0) {
    throw new Error(
      `F1DB release file ${fileName} is missing column(s) the seed reads: ` +
        `${missing.join(", ")}. Present: ${[...present].join(", ")}. ` +
        `Upstream renamed something -- do not seed until the parse is updated.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reference-table lookups (audit 2026-07-29 §5.2b)
//
// The seed stores country and constructor *names*, which it gets by joining
// F1DB's ids against two reference CSVs. Both joins fell back to the raw id on a
// miss (`?? id`) with nothing counted and nothing logged, so the roster could
// quietly end up holding "united-states-of-america" beside "United States of
// America". Neither column tolerates that:
//
//   nationality -- `compare_drivers` compares it by string EQUALITY, so two
//                  drivers OF THE SAME COUNTRY report a nationality MISS against
//                  each other. `countryCode()` also returns null for a slug, so
//                  the flag silently disappears (lib/game/flags.ts).
//   team        -- compared the same way, for both the exact and the historical
//                  verdict.
//
// The fallback stays: one unresolvable id is upstream referential integrity
// slipping on one driver, and refusing the whole refresh over it would cost the
// other 791 drivers their updated wins and teams. What changes is that it is now
// counted, reported on every run, and hard-failed in the one case that means the
// id space moved rather than that a row is missing.
// ---------------------------------------------------------------------------

/** One reference-table join, and what it could not resolve. */
export interface LookupTally {
  /** The column the names land in, for the report: "nationality", "team". */
  subject: string;
  /** The release file the names come from. */
  fileName: string;
  /** Every distinct id looked up. */
  referenced: Set<string>;
  /** Distinct unresolved ids -> how many lookups each one failed. */
  misses: Map<string, number>;
}

export function newLookupTally(subject: string, fileName: string): LookupTally {
  return { subject, fileName, referenced: new Set(), misses: new Map() };
}

/**
 * Resolves one id through a reference map, recording a miss rather than letting
 * the fallback pass in silence. Every lookup the seed makes goes through here,
 * so the counting cannot be forgotten the way a separate pass over the data
 * could be -- the same reason `assertColumns` lives inside `readCsv`.
 *
 * A blank name counts as a miss too: `drivers.nationality` is NOT NULL, so it
 * would import as an empty string, which is strictly worse than the id it
 * replaced. A name that resolves is returned byte-for-byte.
 */
export function resolveName(
  tally: LookupTally,
  names: Map<string, string>,
  id: string,
): string {
  tally.referenced.add(id);
  const name = names.get(id);
  if (name !== undefined && name.trim() !== "") return name;
  tally.misses.set(id, (tally.misses.get(id) ?? 0) + 1);
  return id;
}

/**
 * Report lines for whatever didn't resolve -- empty when everything did, which
 * is the healthy case (measured: 40 country ids and 176 constructor ids, zero
 * misses, against v2026.11.0). The seed prints these on every run, dry or not,
 * so a miss is read before a commit instead of inferred weeks later from
 * comparisons being wrong.
 */
export function describeLookupMisses(
  tallies: LookupTally[],
  limit: number,
): string[] {
  const lines: string[] = [];

  for (const tally of tallies) {
    if (tally.misses.size === 0) continue;

    const failed = [...tally.misses.values()].reduce((sum, n) => sum + n, 0);
    lines.push(
      `! ${tally.misses.size} of ${tally.referenced.size} ${tally.subject} id(s) ` +
        `had no usable name in ${tally.fileName} (${failed} failed lookup(s)). ` +
        `Imported as the raw id -- and compare_drivers compares ${tally.subject} ` +
        `by string equality, so those drivers mis-compare against correctly ` +
        `named ones.`,
    );

    // Worst first: the id hitting the most rows is the one worth chasing.
    const worst = [...tally.misses.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id, count] of worst.slice(0, limit)) {
      lines.push(
        `  ! unresolved ${tally.subject} id "${id}" (${count} lookup(s))`,
      );
    }
    if (worst.length > limit) {
      lines.push(`  ! ...and ${worst.length - limit} more.`);
    }
  }

  return lines;
}

/**
 * A join that resolved NOTHING is the id space having moved, not a missing row:
 * every driver imports with a raw id where a name belongs, and the row count is
 * preserved exactly -- the failure shape both `MIN_ROSTER_RATIO` and the header
 * assertion miss by construction. Loud, before the transaction opens.
 *
 * Partial misses are deliberately not fatal; `describeLookupMisses` is what
 * makes those visible.
 */
export function assertLookupsResolved(tallies: LookupTally[]): void {
  for (const tally of tallies) {
    if (tally.referenced.size === 0) continue;
    if (tally.misses.size < tally.referenced.size) continue;

    throw new Error(
      `Sanity check failed: not one of the ${tally.referenced.size} ` +
        `${tally.subject} id(s) this release references resolved through ` +
        `${tally.fileName}. The id space moved, so every driver would import ` +
        `with a raw id where a name belongs. Nothing written.`,
    );
  }
}

/** The subset of a built driver row the sanity checks look at. */
export interface SanityDriver {
  f1dbId: string;
  fullName: string;
  careerWins: number;
  debutYear: number;
  lastActiveYear: number;
}

/**
 * Two canary drivers, checked after the parse and before anything is written.
 *
 * They exist because a header assertion only catches a renamed *column*; a
 * changed *value* (new positionText codes, a different winner encoding) keeps
 * every header and still produces the silent modes above. Hamilton's win count
 * is the sharpest available probe of `positionNumber`, and an active driver's
 * `last_active_year` is the sharpest available probe that starts are still
 * being counted at all.
 *
 * A missing slug is itself a failure, not a skip: it means the driver key
 * scheme moved, which is the assumption every one of the seed's joins rests on.
 */
export function assertRosterSanity(
  values: SanityDriver[],
  currentYear: number,
): void {
  const bySlug = new Map(values.map((v) => [v.f1dbId, v]));

  const hamilton = bySlug.get("lewis-hamilton");
  if (!hamilton || hamilton.careerWins < 100) {
    throw new Error(
      `Sanity check failed: expected lewis-hamilton to have >= 100 career wins, ` +
        `got ${hamilton ? hamilton.careerWins : "no such driver in the release"}. ` +
        `A wins count of 0 across the roster means \`positionNumber\` changed ` +
        `meaning. Nothing written.`,
    );
  }

  // -1 rather than 0: this legitimately runs in January before the new season,
  // and a release published between seasons is not a broken release.
  const minActive = currentYear - 1;
  const verstappen = bySlug.get("max-verstappen");
  if (!verstappen || verstappen.lastActiveYear < minActive) {
    throw new Error(
      `Sanity check failed: expected max-verstappen's last active year to be ` +
        `>= ${minActive}, got ${verstappen ? verstappen.lastActiveYear : "no such driver in the release"}. ` +
        `Either race starts stopped being counted (\`positionText\`) or the ` +
        `canary retired -- pick a new one deliberately. Nothing written.`,
    );
  }
}
