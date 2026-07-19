import "dotenv/config";

import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { gte } from "drizzle-orm";

import { client, db } from "../lib/db";
import { drivers } from "../lib/db/schema";
import { poolCutoffYear } from "../lib/game/poolWindow";

const F1DB_CSV_URL =
  "https://github.com/f1db/f1db/releases/latest/download/f1db-csv.zip";

// F1DB positionText codes meaning the driver never actually started the race
// (did not qualify / did not practice / did not start / excluded pre-race).
// Verified against F1DB's own totalRaceEntries − totalRaceStarts delta.
const NON_START_CODES = new Set(["DNQ", "DNPQ", "DNP", "DNS", "EX"]);

const INSERT_BATCH_SIZE = 500;
const SAMPLE_SIZE = 20;

type CsvRow = Record<string, string>;

async function downloadCsvZip(): Promise<AdmZip> {
  const res = await fetch(F1DB_CSV_URL);
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
  return parse(entry.getData().toString("utf-8"), {
    columns: true,
    skip_empty_lines: true,
  }) as CsvRow[];
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

  return byDriver;
}

async function main() {
  console.log(`Downloading latest F1DB release from ${F1DB_CSV_URL} ...`);
  const zip = await downloadCsvZip();

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

  const values: (typeof drivers.$inferInsert)[] = [];
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

    const nationality =
      countryNameById.get(row.nationalityCountryId) ??
      row.nationalityCountryId;
    const lastTeam = agg.lastConstructorId
      ? (constructorNameById.get(agg.lastConstructorId) ??
        agg.lastConstructorId)
      : null;
    const previousTeams = [...agg.constructorIds].map(
      (id) => constructorNameById.get(id) ?? id,
    );

    values.push({
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

  console.log("Clearing existing drivers table ...");
  await db.delete(drivers);

  console.log(`Inserting ${values.length} drivers ...`);
  for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
    await db.insert(drivers).values(values.slice(i, i + INSERT_BATCH_SIZE));
  }

  const currentYear = new Date().getUTCFullYear();
  const defaultPoolCutoff = poolCutoffYear("10-years", currentYear)!;
  const defaultPoolDrivers = await db
    .select()
    .from(drivers)
    .where(gte(drivers.lastActiveYear, defaultPoolCutoff));

  console.log(`\nTotal drivers: ${values.length}`);
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
