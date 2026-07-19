function heatLabel(heat: number): string {
  if (heat >= 0.75) return "Rival closing in";
  if (heat >= 0.4) return "Rival warming up";
  if (heat > 0) return "Rival still guessing";
  return "No hits yet";
}

// Abstracted read on the opponent's round, never their guessed names or
// the driver -- see lib/duel/liveMatch.ts's OpponentProgressPayload, the
// only thing ever broadcast about them.
export function OpponentFeed({
  guessCount,
  bestHeat,
  solved,
}: {
  guessCount: number;
  bestHeat: number;
  solved: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <span className={`truncate text-xs font-semibold ${solved ? "text-accent" : "text-text-muted"}`}>
          {solved ? "Rival solved it!" : heatLabel(bestHeat)}
        </span>
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${Math.round((solved ? 1 : bestHeat) * 100)}%` }}
          />
        </div>
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-text-muted">
        {guessCount} guess{guessCount === 1 ? "" : "es"}
      </span>
    </div>
  );
}
