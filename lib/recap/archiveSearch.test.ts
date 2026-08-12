import { describe, expect, it } from "vitest";

import { filterArchiveDays, type ArchiveSearchable } from "./archiveSearch";

// The archive's search rules. Every failure here is a query that silently finds
// nothing -- there is no error state for "the matcher does not understand the
// way you wrote that date", only an empty list that reads as "we have no such
// day", which is a lie about the archive's contents.

const DAYS: ArchiveSearchable[] = [
  { date: "2026-08-02", puzzleNumber: 27, driverName: "Sergio Pérez", dateLabel: "2 August 2026" },
  { date: "2026-07-31", puzzleNumber: 25, driverName: "Jules Bianchi", dateLabel: "31 July 2026" },
  { date: "2026-07-05", puzzleNumber: 20, driverName: "Lewis Hamilton", dateLabel: "5 July 2026" },
  { date: "2025-07-31", puzzleNumber: 2, driverName: "Max Verstappen", dateLabel: "31 July 2025" },
];

const names = (entries: ArchiveSearchable[]) => entries.map((entry) => entry.driverName);

describe("filterArchiveDays", () => {
  it("admits everything for an empty query — 'no filter' means no filter", () => {
    expect(filterArchiveDays(DAYS, "")).toHaveLength(DAYS.length);
    expect(filterArchiveDays(DAYS, "   ")).toHaveLength(DAYS.length);
  });

  it("preserves the order it was given, which is newest first", () => {
    expect(names(filterArchiveDays(DAYS, "2026"))).toEqual([
      "Sergio Pérez",
      "Jules Bianchi",
      "Lewis Hamilton",
    ]);
  });

  it("finds a driver by any part of their name", () => {
    expect(names(filterArchiveDays(DAYS, "hamilton"))).toEqual(["Lewis Hamilton"]);
    expect(names(filterArchiveDays(DAYS, "Lewis"))).toEqual(["Lewis Hamilton"]);
  });

  // The reason this reuses the game's own fold rather than `toLowerCase`: an
  // archive that cannot find a driver the guess input can is broken twice.
  it("finds an accented name typed without the accent, and vice versa", () => {
    expect(names(filterArchiveDays(DAYS, "perez"))).toEqual(["Sergio Pérez"]);
    expect(names(filterArchiveDays(DAYS, "Pérez"))).toEqual(["Sergio Pérez"]);
  });

  it("finds a month by name, across years", () => {
    expect(names(filterArchiveDays(DAYS, "july"))).toEqual([
      "Jules Bianchi",
      "Lewis Hamilton",
      "Max Verstappen",
    ]);
  });

  it("finds a month or a year by its ISO prefix", () => {
    expect(names(filterArchiveDays(DAYS, "2026-07"))).toEqual(["Jules Bianchi", "Lewis Hamilton"]);
    expect(names(filterArchiveDays(DAYS, "2025"))).toEqual(["Max Verstappen"]);
  });

  it("treats the separators people actually type as the same date", () => {
    for (const query of ["2026/07/31", "2026.07.31", "2026-07-31"]) {
      expect(names(filterArchiveDays(DAYS, query))).toEqual(["Jules Bianchi"]);
    }
  });

  // A `#` is an unambiguous statement of intent, so nothing else is considered:
  // without that, the one precise way to name a day is also the noisiest.
  it("matches only the puzzle number behind a #", () => {
    expect(names(filterArchiveDays(DAYS, "#25"))).toEqual(["Jules Bianchi"]);
    expect(names(filterArchiveDays(DAYS, "#2"))).toEqual(["Max Verstappen"]);
    expect(filterArchiveDays(DAYS, "#999")).toEqual([]);
  });

  // Exact, not prefix: "2" matching #2, #20 and #27 alike buries the day that
  // was asked for under every day that starts with the same digit.
  it("matches a bare puzzle number exactly", () => {
    expect(names(filterArchiveDays(DAYS, "20"))).toEqual(["Lewis Hamilton"]);
    expect(names(filterArchiveDays(DAYS, "2"))).toEqual(["Max Verstappen"]);
  });

  // The sharp one. Every date in the archive contains a "2", and most contain a
  // "0" or a "3", so substring-matching a bare number returns the whole archive
  // and hides the one day that was actually named.
  it("does not substring-match a bare number against dates", () => {
    expect(names(filterArchiveDays(DAYS, "2"))).not.toContain("Sergio Pérez");
    expect(filterArchiveDays(DAYS, "31")).toEqual([]);
    expect(filterArchiveDays(DAYS, "0")).toEqual([]);
  });

  // Four digits is the one numeric form that can only be a date.
  it("still reads a four-digit number as a year", () => {
    expect(names(filterArchiveDays(DAYS, "2025"))).toEqual(["Max Verstappen"]);
    expect(filterArchiveDays(DAYS, "2026")).toHaveLength(3);
  });

  it("returns nothing for a query that matches nothing, rather than everything", () => {
    expect(filterArchiveDays(DAYS, "senna")).toEqual([]);
    expect(filterArchiveDays(DAYS, "#")).toHaveLength(DAYS.length);
  });
});
