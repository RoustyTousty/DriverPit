"use client";

import { useAuth } from "@/components/auth/AuthProvider";

function StatTile({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-2">
      <span className="font-mono text-xl font-bold tabular-nums text-text">{value}</span>
      <span className="text-center text-[10px] tracking-wide text-text-muted uppercase">{label}</span>
    </div>
  );
}

export function StatisticsSection() {
  const { stats, loading } = useAuth();

  if (loading) {
    return <p className="py-6 text-center text-sm text-text-muted">Loading…</p>;
  }

  const gamesPlayed = stats?.gamesPlayed ?? 0;
  const wins = stats?.wins ?? 0;
  const currentStreak = stats?.currentStreak ?? 0;
  const maxStreak = stats?.maxStreak ?? 0;
  const guessDistribution = stats?.guessDistribution ?? [0, 0, 0, 0, 0];
  const lastResult = stats?.lastResult ?? null;
  const duelRating = stats?.duelRating ?? 1000;
  const duelWins = stats?.duelWins ?? 0;
  const duelLosses = stats?.duelLosses ?? 0;

  const winPct = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
  // Bar width is each bin's share of total wins (a real distribution), not
  // scaled to whichever bin happens to be the mode -- otherwise two bins
  // tied at 1 win each (out of 2 total) both render as a full 100% bar
  // instead of the 50/50 split they actually represent.
  const totalWins = guessDistribution.reduce((sum, count) => sum + count, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-2">
        <StatTile value={gamesPlayed} label="Played" />
        <StatTile value={`${winPct}%`} label="Win %" />
        <StatTile value={currentStreak} label="Streak" />
        <StatTile value={maxStreak} label="Max streak" />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
          Guess distribution
        </p>
        <div className="flex flex-col gap-1.5">
          {guessDistribution.map((count, index) => {
            const guessNumber = index + 1;
            const isLastResult = lastResult?.won && lastResult.guessCount === guessNumber;
            const widthPct = count === 0 ? 0 : Math.max((count / Math.max(totalWins, 1)) * 100, 6);

            return (
              <div key={guessNumber} className="flex items-center gap-2">
                <span className="w-3 shrink-0 font-mono text-xs text-text-muted">{guessNumber}</span>
                <div className="h-5 flex-1 overflow-hidden rounded border border-border bg-surface-2">
                  <div
                    className={`h-full rounded transition-[width] motion-reduce:transition-none ${
                      isLastResult ? "bg-correct" : "bg-text-muted/45"
                    }`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-text">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
        {lastResult?.won && (
          <p className="mt-2 text-[11px] text-text-muted">Green marks your most recent win.</p>
        )}
      </div>

      {gamesPlayed === 0 && (
        <p className="text-center text-xs text-text-muted">
          Play the daily puzzle to start building stats.
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">Duel record</p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile value={duelRating} label="Rating" />
          <StatTile value={duelWins} label="Wins" />
          <StatTile value={duelLosses} label="Losses" />
        </div>
      </div>
    </div>
  );
}
