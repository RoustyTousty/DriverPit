import { MoreLink } from "./MoreLink";
import { ModeIcon, type GameModeId } from "./ModeIcon";

const MODES: { id: GameModeId; name: string; tag?: string; summary: string }[] = [
  { id: "daily", name: "Daily", summary: "One mystery driver a day, same for everyone." },
  { id: "infinite", name: "Infinite", summary: "Unlimited rounds, pick your own driver pool." },
  { id: "duel", name: "Duel", summary: "Race a matchmade opponent across 3 rounds." },
  { id: "knockout", name: "Knockout", tag: "Coming soon", summary: "20 players, one target, elimination over 3 rounds." },
];

export function GameModesTeaser() {
  return (
    <section id="game-modes" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">Game modes</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODES.map((mode) => (
          <div key={mode.name} className="flex gap-3 rounded-lg border border-border bg-surface-2 p-4">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-weak text-accent"
              aria-hidden="true"
            >
              <ModeIcon mode={mode.id} className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text">{mode.name}</span>
                {mode.tag && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                    {mode.tag}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-text-muted">{mode.summary}</p>
            </div>
          </div>
        ))}
      </div>
      <MoreLink href="/game-modes">More about game modes</MoreLink>
    </section>
  );
}
