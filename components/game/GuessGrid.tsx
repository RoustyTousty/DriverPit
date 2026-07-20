import { Flag } from "@/components/ui/Flag";
import type { DriverSummary } from "@/lib/db/queries";
import type { ExactFeedback, GuessResult, OrderedFeedback, TeamFeedback } from "@/lib/game/compare";
import { countryCode } from "@/lib/game/flags";

type Feedback = ExactFeedback | OrderedFeedback | TeamFeedback;

const COLUMN_LABELS = ["Nation", "Team", "Age", "Debut", "Wins"];
// As narrow as the rotated 3-letter code actually needs — the previous w-6/
// w-7 was oversized and ate into the five data tiles' width more than
// necessary.
const CODE_COLUMN_WIDTH = "w-7";

// Orange intensity for a near-miss: a fixed subtle wash for "historical"
// team hits, and one scaled by closeness (0-1) for numeric near-misses —
// darker/more opaque the closer the guess was, fading toward the plain
// miss grey the further off it was. Capped well under full opacity so it
// stays a tint, never a solid block covering the text.
const HISTORICAL_ORANGE_OPACITY = 0.35;
const MIN_ORANGE_OPACITY = 0.05;
const MAX_ORANGE_OPACITY = 0.70;

export function Tile({
  feedback,
  closeness,
  delayMs,
  children,
}: {
  feedback: Feedback;
  closeness?: number;
  delayMs?: number;
  children?: React.ReactNode;
}) {
  const isCorrect = feedback === "exact" || feedback === "correct";
  const isHistorical = feedback === "historical";
  const isOrdered = feedback === "higher" || feedback === "lower";
  const arrow = feedback === "higher" ? "↑" : feedback === "lower" ? "↓" : null;

  const orangeOpacity = isHistorical
    ? HISTORICAL_ORANGE_OPACITY
    : isOrdered
      ? MIN_ORANGE_OPACITY + (closeness ?? 0) * (MAX_ORANGE_OPACITY - MIN_ORANGE_OPACITY)
      : 0;

  return (
    <div
      data-tile={isCorrect ? "correct" : undefined}
      className={`animate-tile-reveal motion-reduce:animate-none relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg px-0.5 py-2 text-center font-mono text-xs leading-tight font-semibold tabular-nums sm:text-sm ${
        isCorrect ? "bg-correct text-white" : "bg-miss text-text"
      }`}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      {orangeOpacity > 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-accent"
          style={{ opacity: `min(1, calc(${orangeOpacity} + var(--closeness-boost, 0)))` }}
        />
      )}
      <span className="relative z-10 line-clamp-2 w-full min-w-0 break-words">{children}</span>
      {arrow && (
        <span
          aria-hidden="true"
          className="relative z-10 flex h-4 min-w-4 items-center justify-center rounded bg-bg/40 px-1 text-xs leading-none font-bold text-text sm:h-[18px] sm:min-w-[18px] sm:text-sm"
        >
          {arrow}
        </span>
      )}
    </div>
  );
}

// Vertical label replacing the driver's name above the row — the real F1DB
// 3-letter code. Not guaranteed globally unique (a handful of retired/
// current drivers share a code, e.g. Jos and Max Verstappen both being
// "VER"), but it's always shown attached to one specific guess row, so
// there's no ambiguity about which driver it refers to in context.
function DriverCodeBadge({ code }: { code: string | null }) {
  return (
    <div
      className={`flex min-h-14 ${CODE_COLUMN_WIDTH} shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2`}
    >
      <span className="-rotate-90 font-mono text-[10px] font-bold tracking-widest whitespace-nowrap text-text-muted sm:text-xs">
        {code ?? "—"}
      </span>
    </div>
  );
}

function EmptyCodeSlot() {
  return <div className={`min-h-14 ${CODE_COLUMN_WIDTH} shrink-0 rounded-lg border-2 border-dashed border-border`} />;
}

function EmptyRow() {
  return (
    <div className="flex gap-1">
      <EmptyCodeSlot />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="min-h-14 flex-1 rounded-lg border-2 border-dashed border-border" />
      ))}
    </div>
  );
}

function ColumnLabels() {
  return (
    <div className="flex gap-1 px-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase sm:text-xs">
      <div className={`${CODE_COLUMN_WIDTH} shrink-0`} aria-hidden="true" />
      {COLUMN_LABELS.map((label) => (
        <div key={label} className="flex-1 text-center">
          {label}
        </div>
      ))}
    </div>
  );
}

function GuessRow({
  guessedDriver,
  result,
  showFlags,
}: {
  guessedDriver: DriverSummary;
  result: GuessResult;
  showFlags: boolean;
}) {
  const nationalityValue =
    showFlags && countryCode(guessedDriver.nationality) ? (
      <Flag nationality={guessedDriver.nationality} className="text-2xl" />
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
    <div className="flex gap-1 [perspective:600px]">
      <DriverCodeBadge code={guessedDriver.driverCode} />
      {columns.map((column, index) => (
        <Tile key={index} feedback={column.feedback} closeness={column.closeness} delayMs={index * 70}>
          {column.value}
        </Tile>
      ))}
    </div>
  );
}

export interface Guess {
  guessedDriver: DriverSummary;
  result: GuessResult;
}

export function GuessGrid({
  guesses,
  maxGuesses,
  showFlags = false,
}: {
  guesses: Guess[];
  maxGuesses: number;
  showFlags?: boolean;
}) {
  const emptyCount = maxGuesses - guesses.length;

  return (
    <div className="flex flex-col gap-2">
      <ColumnLabels />
      {guesses.map((guess, index) => (
        <GuessRow key={index} guessedDriver={guess.guessedDriver} result={guess.result} showFlags={showFlags} />
      ))}
      {Array.from({ length: emptyCount }).map((_, index) => (
        <EmptyRow key={`empty-${index}`} />
      ))}
    </div>
  );
}

// For an opponent's guesses in duel mode: colors and arrows only, no driver
// name/code or attribute values — we never learn who they guessed, only
// the tile feedback, which carries no identifying information by
// construction. Keeps a blank spacer where the code badge would go so
// columns still line up with the labels and the player's own grid.
function ResultOnlyRow({ result }: { result: GuessResult }) {
  const feedbacks: { feedback: Feedback; closeness?: number }[] = [
    { feedback: result.nationality },
    { feedback: result.team },
    { feedback: result.age, closeness: result.ageCloseness },
    { feedback: result.debutYear, closeness: result.debutYearCloseness },
    { feedback: result.careerWins, closeness: result.careerWinsCloseness },
  ];

  return (
    <div className="flex gap-1 [perspective:600px]">
      <div className={`${CODE_COLUMN_WIDTH} shrink-0`} aria-hidden="true" />
      {feedbacks.map((column, index) => (
        <Tile key={index} feedback={column.feedback} closeness={column.closeness} delayMs={index * 70} />
      ))}
    </div>
  );
}

export function ResultOnlyGrid({
  results,
  maxGuesses,
}: {
  results: GuessResult[];
  maxGuesses: number;
}) {
  const emptyCount = maxGuesses - results.length;

  return (
    <div className="flex flex-col gap-2">
      <ColumnLabels />
      {results.map((result, index) => (
        <ResultOnlyRow key={index} result={result} />
      ))}
      {Array.from({ length: emptyCount }).map((_, index) => (
        <EmptyRow key={`empty-${index}`} />
      ))}
    </div>
  );
}
