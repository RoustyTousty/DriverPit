import type { ExactFeedback, GuessResult, OrderedFeedback, TeamFeedback } from "./compare";

// Everything a tile *means* is carried by colour, opacity and an aria-hidden
// arrow glyph, so a screen reader used to announce a whole guess row as
// "VER Dutch Red Bull 28 2015 65" -- the guessed driver's own data, with zero
// indication of exact/miss/historical/higher/lower. That's WCAG 1.4.1 (Use of
// Color) and 1.1.1 (Non-text Content); docs/audit-2026-07-27.md §4.1.
//
// This turns each tile into one self-contained sentence. `Tile` applies it as
// role="img" + aria-label, which makes the tile atomic so the visible value
// isn't announced a second time -- and, when "Show flags" is on, restores the
// nationality that the flag glyph replaced.
//
// Pure and unit-tested (tileLabel.test.ts) like the rest of lib/game: the
// phrasing is the spoken half of the comparison rules, so it belongs beside
// them rather than inlined per component, where the daily board, the duel
// board and the intermission reveal would each grow their own wording.

export type TileFeedback = ExactFeedback | OrderedFeedback | TeamFeedback;

export type TileColumn = "nationality" | "team" | "age" | "debutYear" | "careerWins";

// Spelled out rather than reusing GuessGrid's abbreviated visual headers
// ("Nation", "Debut", "Wins") -- there's no column-header context in speech,
// and the duel intermission's reveal row has no headers at all.
const COLUMN_NAME: Record<TileColumn, string> = {
  nationality: "Nationality",
  team: "Team",
  age: "Age",
  debutYear: "Debut year",
  careerWins: "Career wins",
};

// "higher" means the TARGET's value is higher than the guess (compare.ts), so
// every phrase here describes the target, never the guess. Only the three
// numeric columns can be ordered; nationality/team resolve to undefined.
const ORDERED_PHRASE: Partial<Record<TileColumn, Record<"higher" | "lower", string>>> = {
  age: { higher: "The target is older", lower: "The target is younger" },
  debutYear: { higher: "The target debuted later", lower: "The target debuted earlier" },
  careerWins: { higher: "The target has more wins", lower: "The target has fewer wins" },
};

// The closeness wash is a continuous 0-1 tint; three named bands are the most
// a sentence can usefully carry. compare.ts squares the linear falloff, so
// these sit higher than they look: 0.25 is already half the attribute's range
// away (15 years of age, 10 years of debut), which is not "close".
const VERY_CLOSE = 0.6;
const CLOSE = 0.25;

function closenessSuffix(closeness: number | undefined): string {
  if (closeness === undefined) return "";
  if (closeness >= VERY_CLOSE) return ", very close";
  if (closeness >= CLOSE) return ", close";
  return ", far off";
}

// A driver with no constructor on record is "" (compare.ts's Driver) or "—"
// (what the guess RPCs return, and what the tile renders). An em dash is read
// as "dash" or as nothing at all, so it gets said in words.
const ABSENT_VALUES = new Set(["", "-", "—"]);

function valueText(column: TileColumn, value: string | number): string {
  const text = String(value).trim();
  if (!ABSENT_VALUES.has(text)) return text;
  return column === "team" ? "no team on record" : "not on record";
}

function verdict(column: TileColumn, feedback: TileFeedback, closeness?: number): string {
  switch (feedback) {
    case "exact":
    case "correct":
      return "Correct";
    case "historical":
      return "Not the target's current team, but they raced for it in the past";
    case "higher":
    case "lower": {
      const phrase = ORDERED_PHRASE[column];
      if (!phrase) return feedback === "higher" ? "The target's value is higher" : "The target's value is lower";
      return `${phrase[feedback]}${closenessSuffix(closeness)}`;
    }
    case "miss":
      if (column === "nationality") return "Not the target's nationality";
      if (column === "team") return "Not a team the target has raced for";
      return "No match";
  }
}

/** The column and its value, with no verdict -- for a tile that reveals the
 *  answer rather than comparing against it (the duel intermission). */
export function tileValueLabel(column: TileColumn, value: string | number): string {
  return `${COLUMN_NAME[column]}: ${valueText(column, value)}`;
}

export function tileAriaLabel(
  column: TileColumn,
  value: string | number,
  feedback: TileFeedback,
  closeness?: number,
): string {
  return `${tileValueLabel(column, value)}. ${verdict(column, feedback, closeness)}.`;
}

/** The five values a guess row shows. Structural on purpose so lib/game stays
 *  free of lib/db's DriverSummary (which satisfies it). */
export interface GuessTileValues {
  nationality: string;
  team: string;
  age: number;
  debutYear: number;
  careerWins: number;
}

// The single place the column <-> GuessResult field pairing is written down.
// Keyed by column rather than returned as a positional array so a caller can't
// silently hang the age label off the debut-year tile.
export function guessTileLabels(driver: GuessTileValues, result: GuessResult): Record<TileColumn, string> {
  return {
    nationality: tileAriaLabel("nationality", driver.nationality, result.nationality),
    team: tileAriaLabel("team", driver.team, result.team),
    age: tileAriaLabel("age", driver.age, result.age, result.ageCloseness),
    debutYear: tileAriaLabel("debutYear", driver.debutYear, result.debutYear, result.debutYearCloseness),
    careerWins: tileAriaLabel("careerWins", driver.careerWins, result.careerWins, result.careerWinsCloseness),
  };
}

// Left-to-right, so what's spoken is in the order the row is read.
const ANNOUNCED_COLUMNS: readonly TileColumn[] = [
  "nationality",
  "team",
  "age",
  "debutYear",
  "careerWins",
];

// The whole submitted guess as one sentence-run, for the polite live region
// components/game/GuessAnnouncer.tsx renders (audit 2026-07-29 §4.1). Labelling
// the tiles made the board *readable*; it left the EVENT silent, so a screen
// reader user submitted a guess, heard nothing, and had to navigate back into
// the grid to find out what happened.
//
// It re-uses guessTileLabels rather than paraphrasing it, which is the point:
// the spoken row and the spoken tiles can't drift, and a rule change in
// compare.ts moves both. The leading count is what the sighted board gets from
// position in the grid ("N guesses left" is right above it).
export function guessAnnouncement(
  driverName: string,
  driver: GuessTileValues,
  result: GuessResult,
  position: { guessNumber: number; maxGuesses: number },
): string {
  const labels = guessTileLabels(driver, result);
  const head = `Guess ${position.guessNumber} of ${position.maxGuesses}: ${driverName}.`;
  return [head, ...ANNOUNCED_COLUMNS.map((column) => labels[column])].join(" ");
}
