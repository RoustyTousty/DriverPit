export function DuelLanding({ onSelectDuel }: { onSelectDuel: () => void }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      <button
        type="button"
        onClick={onSelectDuel}
        className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface-2 p-4 text-left transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="text-base font-bold text-text">Duel</span>
        <span className="text-sm text-text-muted">
          Race a matchmade opponent across 3 rounds. Fastest correct guess wins each round.
        </span>
      </button>

      <div className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface p-4 text-left opacity-60">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-base font-bold text-text">Knockout</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
            Coming soon
          </span>
        </div>
        <span className="text-sm text-text-muted">
          20 players, one target, F1-qualifying-style elimination over 3 rounds.
        </span>
      </div>
    </div>
  );
}
