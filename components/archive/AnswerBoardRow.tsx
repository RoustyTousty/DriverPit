import { ColumnLabels, DriverCodeBadge, Tile } from "@/components/game/GuessGrid";
import type { DailyRecapTarget } from "@/lib/db/dailyRecap";
import { tileValueLabel, type TileColumn } from "@/lib/game/tileLabel";

// The answer as one row of the real board.
//
// Built from `components/game/`'s own Tile, DriverCodeBadge and ColumnLabels
// rather than from markup of its own -- CLAUDE.md's rule that a second copy of
// a board row is the thing to refuse. Every tile is "exact" because every tile
// on the answer's own row IS exact: this is the row a solver saw.
//
// `tileValueLabel` and not `guessTileLabels`, which is the same split the duel
// reveal makes: there is no verdict to announce here, only a value, and a
// screen reader being told "Nationality United Kingdom, exact match" on a row
// nobody guessed would be describing a comparison that never happened.
export function AnswerBoardRow({ target }: { target: DailyRecapTarget }) {
  const team = target.lastTeam ?? "—";
  // Nationality as TEXT, never the Flag glyph the board can swap in.
  //
  // Two reasons, and the first is the whole point of the page. This is a
  // document whose job is to be the authoritative answer for "who was the
  // DriverPit driver on 31 July" — the country belongs in the HTML, not in a
  // background-image class with the word available only to a tooltip and a
  // screen reader. The second: flags are a per-player setting read from
  // localStorage, and this page is server-rendered and cached, so there is no
  // setting here to honour and picking one for everybody would be a guess.
  const columns: { column: TileColumn; value: string | number }[] = [
    { column: "nationality", value: target.nationality },
    { column: "team", value: team },
    { column: "age", value: target.age },
    { column: "debutYear", value: target.debutYear },
    { column: "careerWins", value: target.careerWins },
  ];

  return (
    <div className="flex flex-col gap-2">
      <ColumnLabels />
      <div className="flex gap-1">
        <DriverCodeBadge code={target.driverCode} driverName={target.fullName} />
        {columns.map((column) => (
          <Tile
            key={column.column}
            feedback="exact"
            label={tileValueLabel(column.column, column.value)}
            title={String(column.value)}
          >
            {column.value}
          </Tile>
        ))}
      </div>
    </div>
  );
}
