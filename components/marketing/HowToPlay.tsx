import { Tile } from "@/components/game/GuessGrid";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Type a guess",
    body: "Start typing a driver's name in the box and pick from the suggestions. Every guess has to be a real driver.",
  },
  {
    title: "Read the five tiles",
    body: "Each guess compares nationality, team, age, debut year, and career wins to the mystery driver.",
  },
  {
    title: "Narrow it down",
    body: "Color, arrows, and shading tell you how close you were — use that to pick your next guess.",
  },
  {
    title: "Solve it",
    body: "You get six guesses. Match all five tiles green and you've got it.",
  },
];

const LEGEND: {
  feedback: "exact" | "historical" | "miss" | "higher" | "lower";
  value: string;
  closeness?: number;
  label: string;
}[] = [
  { feedback: "exact", value: "Ferrari", label: "Exact match" },
  { feedback: "historical", value: "McLaren", label: "Raced for them before, not currently" },
  { feedback: "miss", value: "British", label: "No match at all" },
  { feedback: "higher", value: "39", closeness: 0.15, label: "Numeric miss, wide off" },
  { feedback: "lower", value: "2007", closeness: 0.85, label: "Numeric miss, close" },
];

const COLUMN_RULES: { label: string; rule: string }[] = [
  { label: "Nationality", rule: "Exact match only — green or grey, no in-between." },
  { label: "Team", rule: "Green for their current team, dim orange if they've raced for it before, grey otherwise." },
  { label: "Age", rule: "Numeric. A miss shows an arrow for higher/lower, shading toward orange the closer you were." },
  { label: "Debut year", rule: "Same numeric rules as age." },
  { label: "Career wins", rule: "Same numeric rules as age." },
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

const TIPS: string[] = [
  "Guess something broad first — it splits the field even if it misses, since every tile carries some information.",
  "A dim orange team tile is a real clue, not a miss — you've probably got the right driver, just the wrong season.",
  "The brighter a numeric tile glows, the closer that guess was — chase the brightest tile first.",
  "Six guesses goes fast. Save at least one or two for narrowing down, not just first impressions.",
];

export function HowToPlay() {
  return (
    <section id="how-to-play" className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold text-text">How to play</h2>
        <p className="text-sm text-text-muted">
          Guess the mystery Formula 1 driver in six tries. Suggestions are scoped to the active
          driver pool, but a name from outside it still works if you type the whole thing —
          after each guess, the driver&apos;s F1DB code appears on the left of the row.
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-weak text-xs font-bold text-accent">
              {index + 1}
            </span>
            <p className="text-sm text-text-muted">
              <span className="font-semibold text-text">{step.title}.</span> {step.body}
            </p>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">Tile legend</p>
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
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">What each column means</p>
        <dl className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-2 p-4 sm:grid-cols-2">
          {COLUMN_RULES.map((column) => (
            <div key={column.label}>
              <dt className="text-sm font-semibold text-text">{column.label}</dt>
              <dd className="text-sm text-text-muted">{column.rule}</dd>
            </div>
          ))}
        </dl>
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

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">Tips</p>
        <ul className="flex flex-col gap-1.5">
          {TIPS.map((tip) => (
            <li key={tip} className="flex gap-2 text-sm text-text-muted">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
