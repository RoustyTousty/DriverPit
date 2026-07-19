import { ModeIcon, type GameModeId } from "./ModeIcon";

interface ModeInfo {
  id: GameModeId;
  name: string;
  tag?: string;
  summary: string;
  points: string[];
}

const MODES: ModeInfo[] = [
  {
    id: "daily",
    name: "Daily",
    summary: "One mystery driver a day, same for everyone.",
    points: [
      "One driver, chosen for everyone, every day",
      "Resets at 00:00 UTC worldwide",
      "Drawn from the Regular pool (last 10 seasons)",
      "6 guesses, tracked in your stats and streak",
    ],
  },
  {
    id: "infinite",
    name: "Infinite",
    summary: "Unlimited rounds, and you choose the driver pool.",
    points: [
      "Unlimited rounds — play as much as you want",
      "You pick the pool, from this season only up to the sport's entire history",
      "6 guesses per round",
      "Nothing saved between rounds except your pool choice",
    ],
  },
  {
    id: "duel",
    name: "Duel",
    summary: "Race a matchmade opponent across 3 rounds.",
    points: [
      "Matchmade automatically against another player",
      "3 rounds, a different driver each round",
      "Unlimited guesses, but racing a countdown timer",
      "Faster correct guesses score more; a close miss still earns a few points",
      "Your duel rating updates when the match ends",
    ],
  },
  {
    id: "knockout",
    name: "Knockout",
    tag: "Coming soon",
    summary: "20 players, one target, elimination over 3 rounds.",
    points: [
      "20 players guess the same driver at once",
      "New clues reveal automatically every few seconds",
      "The slowest 5 players are eliminated each round",
      "3 rounds, one winner",
    ],
  },
];

export function GameModes() {
  return (
    <section id="game-modes" className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-text">Game modes</h2>
      <div className="flex flex-col gap-4">
        {MODES.map((mode) => (
          <div key={mode.name} className="rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-weak text-accent"
                aria-hidden="true"
              >
                <ModeIcon mode={mode.id} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-text">{mode.name}</span>
                  {mode.tag && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                      {mode.tag}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-text-muted">{mode.summary}</p>
              </div>
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
              {mode.points.map((point) => (
                <li key={point} className="flex gap-2 text-sm text-text-muted">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
