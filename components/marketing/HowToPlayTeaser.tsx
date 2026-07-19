import { Tile } from "@/components/game/GuessGrid";

import { MoreLink } from "./MoreLink";

const LEGEND: {
  feedback: "exact" | "historical" | "miss" | "higher" | "lower";
  value: string;
  closeness?: number;
  label: string;
}[] = [
  { feedback: "exact", value: "Ferrari", label: "Exact match" },
  { feedback: "historical", value: "McLaren", label: "Raced for them before" },
  { feedback: "miss", value: "British", label: "No match" },
  { feedback: "lower", value: "2007", closeness: 0.85, label: "Close numeric miss" },
];

export function HowToPlayTeaser() {
  return (
    <section id="how-to-play" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">How to play</h2>

      <p className="text-sm text-text-muted">
        Guess the mystery Formula 1 driver in six tries. Every guess compares five attributes —
        nationality, team, age, debut year, career wins — with tiles that shade toward orange the
        closer a numeric guess was.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LEGEND.map((item) => (
          <div key={item.label} className="flex flex-col gap-1.5">
            <Tile feedback={item.feedback} closeness={item.closeness}>
              {item.value}
            </Tile>
            <p className="text-xs text-text-muted">{item.label}</p>
          </div>
        ))}
      </div>

      <MoreLink href="/how-to-play">Full how-to-play guide</MoreLink>
    </section>
  );
}
