// The one deliberate exception to "orange stays minimal" (CLAUDE.md's
// design system section) -- driven live by aggregate score balance, my
// fill in full accent orange against the opponent's muted fill. Smooth
// width transition; snaps under reduced motion instead of easing.
export function TugOfWarBar({ myScore, opponentScore }: { myScore: number; opponentScore: number }) {
  const total = myScore + opponentScore;
  const myPct = total === 0 ? 50 : Math.round((myScore / total) * 100);

  return (
    <div
      className="relative h-3 w-full overflow-hidden rounded-full bg-surface-2"
      role="img"
      aria-label={`Score balance: you ${myScore}, opponent ${opponentScore}`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${myPct}%` }}
      />
      <div
        className="absolute inset-y-0 right-0 bg-text-muted/40 transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${100 - myPct}%` }}
      />
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-bg/50" aria-hidden="true" />
    </div>
  );
}
