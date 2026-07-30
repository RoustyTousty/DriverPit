import "dotenv/config";

import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { gte, sql } from "drizzle-orm";

import { client, db } from "../lib/db";
import { drivers } from "../lib/db/schema";
import { poolCutoffYear } from "../lib/game/poolWindow";
import {
  assertColumns,
  assertLookupsResolved,
  assertRosterSanity,
  describeLookupMisses,
  describeWriteMode,
  newLookupTally,
  resolveName,
  resolveRelease,
  resolveWriteMode,
} from "./releaseGuards";
import {
  assertUniqueF1dbIds,
  planRoster,
  type ExistingDriver,
  type IncomingDriver,
  type RosterPlan,
} from "./rosterPlan";

// F1DB positionText codes meaning the driver never actually started the race
// (did not qualify / did not practice / did not start / excluded pre-race).
// Verified against F1DB's own totalRaceEntries − totalRaceStarts delta.
const NON_START_CODES = new Set(["DNQ", "DNPQ", "DNP", "DNS", "EX"]);

const INSERT_BATCH_SIZE = 500;
const SAMPLE_SIZE = 20;

// A floor on how far the roster may shrink in one run, checked inside the
// transaction so tripping it rolls everything back. The seed now UPDATES rows
// in place, so a release that parses badly no longer fails loudly on a foreign
// key -- it quietly rewrites 792 rows instead. This catches only the crude
// version of that (most of the feed missing). The silent per-column failures
// are caught earlier and per-column: releaseGuards.ts (the pin, the header
// assertion, the canary drivers) and drizzle/0047's CHECK constraints, which
// abort this same transaction on a value that can't be true of a real driver.
const MIN_ROSTER_RATIO = 0.9;

const MAX_REPORTED_ROWS = 10;

/** Thrown to roll a dry run back. Never an error condition. */
class DryRunRollback extends Error {}

type CsvRow = Record<string, string>;

// Every row the seed builds has a slug -- `f1db_id` is nullable in the schema
// only for rows that predate drizzle/0043 (see the column's comment there) --
// and a win count, which is optional on insert only because the column carries
// a default. Both are always computed here, and releaseGuards.ts reads them.
type DriverInsert = typeof drivers.$inferInsert & {
  f1dbId: string;
  careerWins: number;
};

async function downloadCsvZip(url: string): Promise<AdmZip> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download F1DB release: ${res.status} ${res.statusText}`,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return new AdmZip(buffer);
}

function readCsv(zip: AdmZip, fileName: string): CsvRow[] {
  const entry = zip.getEntry(fileName);
  if (!entry) {
    throw new Error(`F1DB release is missing expected file: ${fileName}`);
  }
  const rows = parse(entry.getData().toString("utf-8"), {
    columns: true,
    skip_empty_lines: true,
  }) as CsvRow[];

  // A missing *file* already threw above; a missing *column* used to sail
  // straight through as `undefined` and become plausible-looking data.
  assertColumns(fileName, rows);
  return rows;
}

interface DriverAggregate {
  debutYear: number | null;
  careerWins: number;
  lastYear: number;
  lastRound: number;
  lastConstructorId: string | null;
  constructorIds: Set<string>;
}

function aggregateRaceResults(rows: CsvRow[]): Map<string, DriverAggregate> {
  const byDriver = new Map<string, DriverAggregate>();
  let nonStartRows = 0;

  for (const row of rows) {
    let agg = byDriver.get(row.driverId);
    if (!agg) {
      agg = {
        debutYear: null,
        careerWins: 0,
        lastYear: -Infinity,
        lastRound: -Infinity,
        lastConstructorId: null,
        constructorIds: new Set(),
      };
      byDriver.set(row.driverId, agg);
    }

    const year = Number(row.year);
    const round = Number(row.round);
    const started = !NON_START_CODES.has(row.positionText);
    if (!started) nonStartRows += 1;

    if (started) {
      if (agg.debutYear === null || year < agg.debutYear) {
        agg.debutYear = year;
      }
      if (
        year > agg.lastYear ||
        (year === agg.lastYear && round > agg.lastRound)
      ) {
        agg.lastYear = year;
        agg.lastRound = round;
        agg.lastConstructorId = row.constructorId;
      }
      agg.constructorIds.add(row.constructorId);
    }

    if (row.positionNumber === "1") {
      agg.careerWins += 1;
    }
  }

  // The column can survive a release that changes what goes IN it, and that is
  // the audit's worst silent mode: if no positionText matches NON_START_CODES
  // any more, every DNQ/DNS becomes a race start and the whole roster's debut
  // years, last_active_year and pool membership move. Free -- the loop above
  // already visits every row.
  if (nonStartRows === 0) {
    throw new Error(
      `Sanity check failed: not one of ${rows.length} race results carries a ` +
        `non-start positionText (${[...NON_START_CODES].join(", ")}). Those ` +
        `codes changed meaning, so every DNQ/DNS would count as a race start. ` +
        `Nothing written.`,
    );
  }

  return byDriver;
}

function reportPlan(plan: RosterPlan, existingCount: number): void {
  const matched =
    existingCount - plan.adoptions.length - plan.unmatched.length;
  console.log(
    `Reconciled against ${existingCount} existing row(s): ` +
      `${matched} matched by f1db_id, ${plan.adoptions.length} adopted by name + ` +
      `date of birth, ${plan.inserts.length} new, ${plan.unmatched.length} not in ` +
      `this release.`,
  );

  const renames = plan.adoptions.filter((a) => a.previousF1dbId !== null);
  for (const rename of renames) {
    console.log(
      `  re-keyed: ${rename.fullName} "${rename.previousF1dbId}" -> "${rename.f1dbId}"`,
    );
  }

  for (const row of plan.unmatched.slice(0, MAX_REPORTED_ROWS)) {
    console.warn(
      `  ! kept but not in this release: #${row.id} ${row.fullName} (${row.dateOfBirth})`,
    );
  }
  if (plan.unmatched.length > MAX_REPORTED_ROWS) {
    console.warn(`  ! ...and ${plan.unmatched.length - MAX_REPORTED_ROWS} more.`);
  }
  if (plan.unmatched.length > 0) {
    // Never deleted: duel_rounds, daily_targets and infinite_rounds hold FKs to
    // these ids, and daily_progress.guesses holds them with no FK at all.
    console.warn(
      "  ! Those rows are left untouched. Investigate before assuming they're gone " +
        "upstream -- a renamed slug on a driver whose name ALSO changed looks " +
        "exactly like this, and would have inserted a duplicate.",
    );
  }

  for (const clash of plan.ambiguous) {
    console.warn(
      `  ! ambiguous natural key ${clash.naturalKey}: existing #${clash.existingIds.join(", #")} ` +
        `vs incoming ${clash.incomingF1dbIds.join(", ")} -- inserted as new rather than guessed at.`,
    );
  }
}

/** Downloads the chosen release and reduces it to the rows we import. */
async function buildRoster(currentYear: number): Promise<DriverInsert[]> {
  const release = resolveRelease(process.env);
  if (!release.pinned) {
    console.warn(
      "! F1DB_RELEASE=latest — importing whatever upstream published most " +
        "recently. The header assertion and sanity checks below are the only " +
        "thing standing between a renamed column and 792 silently rewritten rows.",
    );
  }
  console.log(`Downloading F1DB release ${release.release} from ${release.url} ...`);
  const zip = await downloadCsvZip(release.url);

  const driverRows = readCsv(zip, "f1db-drivers.csv");
  const countryRows = readCsv(zip, "f1db-countries.csv");
  const constructorRows = readCsv(zip, "f1db-constructors.csv");
  const resultRows = readCsv(zip, "f1db-races-race-results.csv");

  console.log(
    `Parsed ${driverRows.length} drivers and ${resultRows.length} race results.`,
  );

  const countryNameById = new Map(countryRows.map((c) => [c.id, c.name]));
  const constructorNameById = new Map(
    constructorRows.map((c) => [c.id, c.name]),
  );
  const aggregates = aggregateRaceResults(resultRows);

  // Both joins below go through `resolveName`, which tallies what it can't
  // resolve instead of falling back to the raw id in silence (audit §5.2b). A
  // slug where a country or team name belongs is a comparison bug, not a
  // cosmetic one -- compare_drivers compares both by string equality.
  const nationalityLookup = newLookupTally("nationality", "f1db-countries.csv");
  const teamLookup = newLookupTally("team", "f1db-constructors.csv");

  const values: DriverInsert[] = [];
  let skippedNoStarts = 0;
  let skippedNoDob = 0;

  for (const row of driverRows) {
    const agg = aggregates.get(row.id);

    // No recorded race start (reserve/test-only entries, or every entry was
    // a DNQ/DNS/etc.). There is no meaningful debut year or last-active
    // year, so they're left out of the imported roster entirely.
    if (!agg || agg.debutYear === null) {
      skippedNoStarts += 1;
      continue;
    }

    if (!row.dateOfBirth) {
      skippedNoDob += 1;
      continue;
    }

    const nationality = resolveName(
      nationalityLookup,
      countryNameById,
      row.nationalityCountryId,
    );
    const lastTeam = agg.lastConstructorId
      ? resolveName(teamLookup, constructorNameById, agg.lastConstructorId)
      : null;
    const previousTeams = [...agg.constructorIds].map((id) =>
      resolveName(teamLookup, constructorNameById, id),
    );

    values.push({
      // F1DB's own slug. The upsert key -- see drizzle/0043 and rosterPlan.ts.
      f1dbId: row.id,
      fullName: row.name,
      driverCode: row.abbreviation || null,
      nationality,
      dateOfBirth: row.dateOfBirth,
      dateOfDeath: row.dateOfDeath || null,
      debutYear: agg.debutYear,
      careerWins: agg.careerWins,
      lastTeam,
      previousTeams,
      lastActiveYear: agg.lastYear,
    });
  }

  console.log(
    `Skipped ${skippedNoStarts} driver(s) with no recorded race starts, ` +
      `${skippedNoDob} driver(s) missing a date of birth.`,
  );

  if (values.length === 0) {
    throw new Error(
      "Parsed 0 importable drivers from the F1DB release — refusing to write.",
    );
  }

  // Silent on a healthy release; on a partial one it names every id that fell
  // back to a slug, which is the whole of §5.2b.
  for (const line of describeLookupMisses(
    [nationalityLookup, teamLookup],
    MAX_REPORTED_ROWS,
  )) {
    console.warn(line);
  }

  // Before the transaction opens, not inside it: a release that fails here has
  // no business reaching the write path at all.
  assertLookupsResolved([nationalityLookup, teamLookup]);
  assertRosterSanity(values, currentYear);

  return values;
}

async function writeRoster(
  values: DriverInsert[],
  incoming: IncomingDriver[],
  dryRun: boolean,
): Promise<void> {
  // One transaction for the whole write. Nothing is deleted and no id is ever
  // reassigned: rows are matched to the release by f1db_id and UPDATEd in
  // place, because daily_targets, duel_rounds, infinite_rounds and
  // daily_progress.guesses all store `drivers.id` (audit §5.1).
  await db.transaction(async (tx) => {
    const existing: ExistingDriver[] = await tx
      .select({
        id: drivers.id,
        f1dbId: drivers.f1dbId,
        fullName: drivers.fullName,
        dateOfBirth: drivers.dateOfBirth,
      })
      .from(drivers);

    if (values.length < existing.length * MIN_ROSTER_RATIO) {
      throw new Error(
        `Release has ${values.length} importable drivers but the table holds ` +
          `${existing.length}. That's below the ${MIN_ROSTER_RATIO * 100}% floor, ` +
          `which usually means the release parsed wrong rather than that F1 lost ` +
          `drivers. Rolled back; nothing written.`,
      );
    }

    const plan = planRoster(existing, incoming);
    reportPlan(plan, existing.length);

    // Adopt first, so the upsert below lands on the adopted rows instead of
    // inserting duplicates alongside them.
    //
    // A VALUES list of scalar parameters, batched, rather than the obvious
    // one-parameter forms. Measured against the Supabase transaction pooler
    // (aws-1-*.pooler.supabase.com:6543): a single large parameter kills the
    // connection outright -- `unnest($1::int[], $2::text[])` at 400 rows and
    // `jsonb_to_recordset($1::jsonb)` at 792 both hang for ~20s and come back
    // `write CONNECTION_CLOSED`, while a 500-row multi-row INSERT (5,500
    // scalar parameters, far more bytes) is fine. It's the size of an
    // individual parameter that matters, not the size of the statement.
    for (let i = 0; i < plan.adoptions.length; i += INSERT_BATCH_SIZE) {
      const batch = plan.adoptions.slice(i, i + INSERT_BATCH_SIZE);
      const pairs = sql.join(
        batch.map((a) => sql`(${a.driverId}::integer, ${a.f1dbId}::text)`),
        sql`, `,
      );
      await tx.execute(sql`
        UPDATE public.drivers AS d
        SET f1db_id = a.f1db_id
        FROM (VALUES ${pairs}) AS a(id, f1db_id)
        WHERE d.id = a.id
      `);
    }

    console.log(`Upserting ${values.length} drivers ...`);
    for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
      await tx
        .insert(drivers)
        .values(values.slice(i, i + INSERT_BATCH_SIZE))
        .onConflictDoUpdate({
          target: drivers.f1dbId,
          set: {
            fullName: sql`excluded.full_name`,
            driverCode: sql`excluded.driver_code`,
            nationality: sql`excluded.nationality`,
            dateOfBirth: sql`excluded.date_of_birth`,
            dateOfDeath: sql`excluded.date_of_death`,
            debutYear: sql`excluded.debut_year`,
            careerWins: sql`excluded.career_wins`,
            lastTeam: sql`excluded.last_team`,
            previousTeams: sql`excluded.previous_teams`,
            lastActiveYear: sql`excluded.last_active_year`,
          },
        });
    }

    // The plan said which rows were new; the table has to agree. If it doesn't,
    // an adoption missed and a duplicate driver just landed -- roll back.
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(drivers);
    const expected = existing.length + plan.inserts.length;
    if (count !== expected) {
      throw new Error(
        `Expected ${expected} rows after the upsert (${existing.length} existing + ` +
          `${plan.inserts.length} new) but found ${count}. Rolled back.`,
      );
    }

    if (dryRun) throw new DryRunRollback();
  });
}

async function main() {
  // Argv is read here rather than at module scope so a bad flag lands in
  // main()'s catch, which closes the postgres client -- a throw during import
  // would leave the connection open and the process hanging on it.
  //
  // Writing is opt-in (see resolveWriteMode): the safe mode is the one you get
  // by default, because it is the flag for the safe mode that shells drop.
  const mode = resolveWriteMode(process.argv.slice(2));
  console.log(describeWriteMode(mode));

  const currentYear = new Date().getUTCFullYear();
  const values = await buildRoster(currentYear);

  const incoming = values.map((v) => ({
    f1dbId: v.f1dbId,
    fullName: v.fullName,
    dateOfBirth: v.dateOfBirth,
  }));
  assertUniqueF1dbIds(incoming);

  try {
    await writeRoster(values, incoming, !mode.commit);
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
    console.log(
      "\nDry run — transaction rolled back, nothing written. " +
        "Re-run with `npm run db:seed:commit` to keep it.",
    );
  }

  const defaultPoolCutoff = poolCutoffYear("10-years", currentYear)!;
  const defaultPoolDrivers = await db
    .select()
    .from(drivers)
    .where(gte(drivers.lastActiveYear, defaultPoolCutoff));

  console.log(`\nTotal drivers in release: ${values.length}`);
  console.log(`Default pool (last 10 years): ${defaultPoolDrivers.length} drivers.`);

  const sample = [...defaultPoolDrivers]
    .sort(() => Math.random() - 0.5)
    .slice(0, SAMPLE_SIZE);

  console.log(`\nRandom sample of ${sample.length} drivers from the default pool:\n`);
  for (const d of sample) {
    console.log(
      `  ${(d.driverCode ?? "???").padEnd(4)} ${d.fullName.padEnd(24)} ${(d.nationality ?? "").padEnd(16)} ` +
        `debut ${d.debutYear}  wins ${String(d.careerWins).padStart(3)}  ${d.lastTeam ?? "—"}` +
        `  (${d.previousTeams.length} team${d.previousTeams.length === 1 ? "" : "s"})`,
    );
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  return client.end();
});
