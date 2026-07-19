export type GameModeId = "daily" | "infinite" | "duel" | "knockout";

// One consistent stroke style (viewBox 24, strokeWidth 1.75) matching every
// other icon in the app (TopBar, share button, etc.), not a mixed icon set.
// Shared between the home teaser and the full /game-modes page so the two
// never drift into different iconography for the same mode.
const PATHS: Record<GameModeId, React.ReactNode> = {
  daily: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  infinite: <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.26-8-12.357-8-5.095 0-5.095 8 0 8 5.096 0 7.262-8 12.357-8z" />,
  duel: <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />,
  knockout: <path d="M4 22V4M4 4h14l-3 4 3 4H4" />,
};

export function ModeIcon({ mode, className = "h-5 w-5" }: { mode: GameModeId; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className} aria-hidden="true">
      {PATHS[mode]}
    </svg>
  );
}
