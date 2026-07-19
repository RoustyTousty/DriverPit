export interface RoundResult {
  roundIndex: number;
  solved: boolean;
  points: number;
}

export function RoundResultCards({ results }: { results: RoundResult[] }) {
  if (results.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {results.map((r) => (
        <div
          key={r.roundIndex}
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
            r.solved ? "border-correct/50 bg-correct/10 text-correct" : "border-border bg-surface-2 text-text-muted"
          }`}
        >
          <span>Round {r.roundIndex + 1}</span>
          <span>{r.solved ? "Solved" : "DNF"}</span>
          <span className="font-mono tabular-nums">+{r.points}</span>
        </div>
      ))}
    </div>
  );
}
