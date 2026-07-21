import { CODE_COLUMN_WIDTH, ColumnLabels, GuessRow, type Guess } from "@/components/game/GuessGrid";
import { CLOSEST_BOARD_SIZE } from "@/lib/duel/liveMatch";
import { guessHeat } from "@/lib/game/duelScoring";

// A submission-order id, since guesses are unlimited and get re-sorted by
// closeness every render -- React needs a stable key that survives the
// reorder (array index doesn't) so a guess's entrance animation doesn't
// replay every time a better one slots in above it.
export interface RankedGuess extends Guess {
  id: number;
}

// Shimmer placeholder for a guess that's been submitted but hasn't resolved
// yet (CLAUDE.md's "Instant guesses": optimistic render, shimmer -> fill).
// Exact same outer shape as a real GuessRow -- the code-badge width plus
// five flex-1 tiles -- so nothing shifts size when the real row (a fresh
// GuessRow mount, which plays Tile's own reveal animation) replaces this.
function PendingGuessRow() {
  return (
    <div className="flex gap-1" aria-hidden="true">
      <div
        className={`min-h-14 ${CODE_COLUMN_WIDTH} shrink-0 animate-pulse rounded-lg bg-surface-2 motion-reduce:animate-none`}
      />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="min-h-14 flex-1 animate-pulse rounded-lg bg-surface-2 motion-reduce:animate-none" />
      ))}
    </div>
  );
}

// Ranked by closeness (TikTok-leaderboard style), not submission order --
// replaces the fixed 6-row grid daily/infinite use, since a duel round
// allows unlimited guesses. A better guess slots into position and pushes
// the worst off the visible top CLOSEST_BOARD_SIZE; rank fades toward the
// bottom so a busy round still reads as "best guesses first," not a wall
// of tiles.
//
// Reuses GuessRow (components/game/GuessGrid.tsx) completely unmodified --
// same tiles, same driver-initials badge, same everything -- per CLAUDE.md's
// "Duel visual consistency": the duel board is the daily board plus duel
// chrome (this ranking/fade), never a bespoke second board. No rank number
// is rendered inside or beside the row for exactly that reason; position
// alone conveys rank.
export function ClosestGuessesBoard({
  guesses,
  pending,
  showFlags,
}: {
  guesses: RankedGuess[];
  pending: boolean;
  showFlags: boolean;
}) {
  const ranked = [...guesses].sort((a, b) => guessHeat(b.result) - guessHeat(a.result)).slice(0, CLOSEST_BOARD_SIZE);

  if (ranked.length === 0 && !pending) {
    return <p className="py-4 text-center text-xs text-text-muted">Your guesses will rank here by closeness.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ColumnLabels />
      {pending && <PendingGuessRow />}
      {ranked.map((guess, index) => (
        <div
          key={guess.id}
          className="transition-opacity duration-300 motion-reduce:transition-none"
          style={{ opacity: Math.max(0.55, 1 - index * 0.05) }}
        >
          <GuessRow guessedDriver={guess.guessedDriver} result={guess.result} showFlags={showFlags} />
        </div>
      ))}
    </div>
  );
}
