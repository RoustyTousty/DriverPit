import { Tile, type Guess } from "@/components/game/GuessGrid";
import { Flag } from "@/components/ui/Flag";
import type { ExactFeedback, OrderedFeedback, TeamFeedback } from "@/lib/game/compare";
import { guessHeat } from "@/lib/game/duelScoring";
import { countryCode } from "@/lib/game/flags";
import { CLOSEST_BOARD_SIZE } from "@/lib/duel/liveMatch";

type Feedback = ExactFeedback | OrderedFeedback | TeamFeedback;

// A submission-order id, since guesses are unlimited and get re-sorted by
// closeness every render -- React needs a stable key that survives the
// reorder (array index doesn't) so a guess's entrance animation doesn't
// replay every time a better one slots in above it.
export interface RankedGuess extends Guess {
  id: number;
}

const COLUMN_LABELS = ["Nation", "Team", "Age", "Debut", "Wins"];

function BoardRow({
  rank,
  guess,
  opacity,
  showFlags,
}: {
  rank: number;
  guess: RankedGuess;
  opacity: number;
  showFlags: boolean;
}) {
  const { guessedDriver, result } = guess;
  const nationalityValue =
    showFlags && countryCode(guessedDriver.nationality) ? (
      <Flag nationality={guessedDriver.nationality} className="text-lg" />
    ) : (
      guessedDriver.nationality
    );
  const columns: { feedback: Feedback; closeness?: number; value: React.ReactNode }[] = [
    { feedback: result.nationality, value: nationalityValue },
    { feedback: result.team, value: guessedDriver.team },
    { feedback: result.age, closeness: result.ageCloseness, value: guessedDriver.age },
    { feedback: result.debutYear, closeness: result.debutYearCloseness, value: guessedDriver.debutYear },
    { feedback: result.careerWins, closeness: result.careerWinsCloseness, value: guessedDriver.careerWins },
  ];

  return (
    <div
      className="flex items-center gap-1 transition-opacity duration-300 motion-reduce:transition-none"
      style={{ opacity }}
    >
      <span className="w-4 shrink-0 text-center font-mono text-[10px] font-bold text-text-muted">{rank}</span>
      <div className="flex flex-1 gap-1 [perspective:600px]">
        {columns.map((column, index) => (
          <Tile key={index} feedback={column.feedback} closeness={column.closeness}>
            {column.value}
          </Tile>
        ))}
      </div>
    </div>
  );
}

// Ranked by closeness (TikTok-leaderboard style), not submission order --
// replaces the fixed 5-row grid now that a round allows unlimited guesses.
// A better guess slots into position and pushes the worst off the visible
// top CLOSEST_BOARD_SIZE; rank fades toward the bottom so a busy round
// still reads as "best guesses first," not a wall of tiles.
export function ClosestGuessesBoard({ guesses, showFlags }: { guesses: RankedGuess[]; showFlags: boolean }) {
  const ranked = [...guesses]
    .sort((a, b) => guessHeat(b.result) - guessHeat(a.result))
    .slice(0, CLOSEST_BOARD_SIZE);

  if (ranked.length === 0) {
    return <p className="py-4 text-center text-xs text-text-muted">Your guesses will rank here by closeness.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 px-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
        <span className="w-4 shrink-0" aria-hidden="true" />
        {COLUMN_LABELS.map((label) => (
          <span key={label} className="flex-1 text-center">
            {label}
          </span>
        ))}
      </div>
      {ranked.map((guess, index) => (
        <BoardRow
          key={guess.id}
          rank={index + 1}
          guess={guess}
          opacity={Math.max(0.55, 1 - index * 0.05)}
          showFlags={showFlags}
        />
      ))}
    </div>
  );
}
