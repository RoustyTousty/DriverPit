import { Tile } from "@/components/game/GuessGrid";

const LEGEND: {
  feedback: "exact" | "historical" | "miss" | "higher" | "lower";
  value: string;
  closeness?: number;
  label: string;
}[] = [
  { feedback: "exact", value: "Ferrari", label: "Exact match — nationality or the driver's current team." },
  { feedback: "historical", value: "McLaren", label: "Team only: not their current team, but one they've raced for before." },
  { feedback: "miss", value: "British", label: "No match at all." },
  { feedback: "higher", value: "39", closeness: 0.15, label: "Numeric miss, wide off — the real value is higher." },
  { feedback: "lower", value: "2007", closeness: 0.85, label: "Numeric miss, close — the brighter the tile, the nearer your guess." },
];

const EXAMPLE_COLUMNS: {
  label: string;
  feedback: "miss" | "historical" | "higher" | "lower";
  closeness?: number;
  value: string | number;
}[] = [
  { label: "Nation", feedback: "miss", value: "German" },
  { label: "Team", feedback: "historical", value: "Aston Martin" },
  { label: "Age", feedback: "higher", closeness: 0.2, value: 39 },
  { label: "Debut", feedback: "lower", closeness: 0.75, value: 2007 },
  { label: "Wins", feedback: "lower", closeness: 0.3, value: 53 },
];

export function HowToPlay() {
  return (
    <section id="how-to-play" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">How to play</h2>

      <p className="text-sm text-text-muted">
        Guess the mystery Formula 1 driver in six tries. Every guess has to be a real driver —
        start typing in the box above the grid and pick from the matches. Suggestions are scoped to
        the active driver pool for better hints, but you can still submit a name from outside it if
        you type the whole thing. After each guess, the driver&apos;s F1DB code appears on the left
        of the row, and five tiles compare them to the mystery driver: nationality, team, age, debut
        year, and career wins.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {LEGEND.map((item) => (
          <div key={item.label} className="flex flex-col gap-1.5">
            <Tile feedback={item.feedback} closeness={item.closeness}>
              {item.value}
            </Tile>
            <p className="text-xs text-text-muted">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface-2 p-4">
        <p className="text-sm text-text">
          <span className="font-semibold">Nationality</span> is exact-match only.{" "}
          <span className="font-semibold">Team</span> has a third state on top of that: a dim orange
          tile means the mystery driver has raced for that team before, just not currently.{" "}
          <span className="font-semibold">Age</span>, <span className="font-semibold">debut year</span>, and{" "}
          <span className="font-semibold">career wins</span> are numeric, so a miss also shows an
          arrow for whether the real number is higher or lower than your guess — and the tile itself
          shades from grey toward bright orange the closer your guess was.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-text">Worked example</p>
        <p className="text-xs text-text-muted">You guessed Sebastian Vettel:</p>
        <div className="flex flex-col gap-1">
          <div className="flex gap-1.5 px-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
            {EXAMPLE_COLUMNS.map((column) => (
              <div key={column.label} className="flex-1 text-center">
                {column.label}
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            {EXAMPLE_COLUMNS.map((column) => (
              <Tile key={column.label} feedback={column.feedback} closeness={column.closeness}>
                {column.value}
              </Tile>
            ))}
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Nationality miss — the mystery driver isn&apos;t German. Team is a historical near-miss —
          they&apos;ve raced for Aston Martin before, just not currently. The up arrow means the
          mystery driver is older than Vettel; the down arrows mean they debuted earlier and have
          fewer career wins — and the brighter Debut tile means that guess landed closer than the
          dim Wins guess did.
        </p>
      </div>

      <p className="text-sm text-text-muted">
        You get six guesses. Match all five tiles green and you&apos;ve solved it.
      </p>
    </section>
  );
}
