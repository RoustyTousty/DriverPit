import { memo } from "react";

import { Flag } from "@/components/ui/Flag";
import type { DriverSummary } from "@/lib/db/queries";
import type { ExactFeedback, GuessResult, OrderedFeedback, TeamFeedback } from "@/lib/game/compare";
import { countryCode } from "@/lib/game/flags";
import { guessTileLabels, type TileColumn } from "@/lib/game/tileLabel";

import { GuessAnnouncer } from "./GuessAnnouncer";

type Feedback = ExactFeedback | OrderedFeedback | TeamFeedback;

const COLUMN_LABELS = ["Nation", "Team", "Age", "Debut", "Wins"];
// As narrow as the rotated 3-letter code actually needs — the previous w-6/
// w-7 was oversized and ate into the five data tiles' width more than
// necessary. Module-local: every element that has to match this width (the
// real row's badge, the empty slot, the pending shimmer, the column labels)
// lives in this file, so there's no second copy of the geometry to drift.
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
  label,
  title,
  children,
}: {
  feedback: Feedback;
  closeness?: number;
  delayMs?: number;
  // The tile's whole meaning in one sentence, built by lib/game/tileLabel.ts.
  // Applied as role="img" + aria-label, which makes the tile ATOMIC to a
  // screen reader: the label is announced and the contents (the raw value,
  // the Flag's own aria-label, the arrow chip) are skipped, so nothing is
  // said twice. Optional because the marketing legend's tiles are captioned
  // in visible prose already -- those keep their contents readable as-is.
  label?: string;
  // The unclipped value, for a SIGHTED reader (audit 2026-07-30 §4.7). The
  // value span below is line-clamp-2, and a narrow phone clips "Scuderia
  // AlphaTauri" or "United States of America" with nothing to recover it --
  // `label` fixed that in speech only.
  //
  // It goes on the span, NOT on this outer div, and that placement is the
  // whole point: `title` on an element that already has an aria-label becomes
  // its accessible DESCRIPTION, so the value would be announced a second time
  // right after the label that already said it. Inside role="img" the span is
  // presentational, so the tooltip exists for the mouse and not for the
  // accessibility tree. (Hover/long-press only -- `title` has no touch
  // affordance, so this recovers the value, it doesn't make it discoverable.)
  title?: string;
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
      role={label ? "img" : undefined}
      aria-label={label}
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
      <span title={title} className="relative z-10 line-clamp-2 w-full min-w-0 break-words">
        {children}
      </span>
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
//
// The code is a *visual* shorthand for the name, and rotated text at that, so
// a screen reader got "V E R" (or "em dash") with no context. role="img" +
// the driver's actual name restores what the sighted reading already had:
// which driver this row is about. Callers that already say the name in
// adjacent prose (ResultCard, the duel reveal) omit `driverName` and get the
// code spelled out instead of repeating it.
export function DriverCodeBadge({ code, driverName }: { code: string | null; driverName?: string | null }) {
  const label = driverName ?? (code ? `Driver code ${code}` : "No driver code");

  return (
    <div
      role="img"
      aria-label={label}
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

// Shimmer placeholder for a guess that's been submitted but hasn't resolved
// yet (CLAUDE.md's "Instant guesses": optimistic render, shimmer -> fill).
// Same outer shape as a real GuessRow -- code badge plus five flex-1 tiles --
// so nothing shifts when the authoritative row (a fresh GuessRow mount, which
// plays Tile's own reveal animation) replaces it.
//
// THE one shimmer, shared by all three modes: the fixed daily/infinite grid
// below and the duel board's ranked layout
// (components/duel/ClosestGuessesBoard.tsx). Don't reintroduce a per-mode copy
// -- duel carried a byte-identical duplicate for a while, which is exactly how
// the two boards' geometry drifts apart.
export function PendingGuessRow() {
  return (
    <div className="flex gap-1" aria-hidden="true">
      <div className={`min-h-14 ${CODE_COLUMN_WIDTH} shrink-0 animate-pulse rounded-lg bg-surface-2 motion-reduce:animate-none`} />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="min-h-14 flex-1 animate-pulse rounded-lg bg-surface-2 motion-reduce:animate-none" />
      ))}
    </div>
  );
}

export function ColumnLabels() {
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

// Shared by daily/infinite (chronological, fixed-length grid below) and the
// duel board (components/duel/ClosestGuessesBoard.tsx, closeness-sorted,
// unlimited length) -- CLAUDE.md's "Duel visual consistency": the duel
// board must be the daily board's row, not a bespoke second one. Don't add
// duel-only decoration (a rank number, etc.) inside this component --
// anything duel-specific belongs in a wrapper around it, never inside it,
// or the two boards drift.
export function GuessRow({
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
  // Every tile's meaning is colour, opacity and an aria-hidden glyph, so the
  // spoken row is built here instead (lib/game/tileLabel.ts, unit-tested).
  const labels = guessTileLabels(guessedDriver, result);
  // `title` only on the two free-text columns. Age/debut/wins are at most four
  // mono digits and cannot clip at any width the board renders at, so a
  // tooltip there would repeat what's already fully visible. Nationality gets
  // one even though it's the shorter of the two, because with "Show flags" on
  // the tile is a flag glyph and no text at all -- the tooltip is then the only
  // way a sighted player who doesn't recognise the flag reads the country.
  const columns: {
    column: TileColumn;
    feedback: Feedback;
    closeness?: number;
    value: React.ReactNode;
    title?: string;
  }[] = [
    {
      column: "nationality",
      feedback: result.nationality,
      value: nationalityValue,
      title: guessedDriver.nationality,
    },
    { column: "team", feedback: result.team, value: guessedDriver.team, title: guessedDriver.team },
    { column: "age", feedback: result.age, closeness: result.ageCloseness, value: guessedDriver.age },
    {
      column: "debutYear",
      feedback: result.debutYear,
      closeness: result.debutYearCloseness,
      value: guessedDriver.debutYear,
    },
    {
      column: "careerWins",
      feedback: result.careerWins,
      closeness: result.careerWinsCloseness,
      value: guessedDriver.careerWins,
    },
  ];

  return (
    <div className="flex gap-1 [perspective:600px]">
      <DriverCodeBadge code={guessedDriver.driverCode} driverName={guessedDriver.fullName} />
      {columns.map((column, index) => (
        <Tile
          key={index}
          feedback={column.feedback}
          closeness={column.closeness}
          delayMs={index * 70}
          label={labels[column.column]}
          title={column.title}
        >
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

// memo()'d because this is the most expensive subtree either board renders --
// up to six rows of a code badge plus five Tiles, each of which builds its own
// aria-label -- and both callers re-render for reasons that leave the grid
// untouched (daily's share-button state and modal, infinite's pool selector and
// round transitions). Audit 2026-07-29 §1.2 named this as the alternative to
// extracting daily's countdown; both are done, since they cover different
// renders. It only pays off while `guesses` keeps its identity, which is why
// both callers hold it in state or a useMemo rather than mapping per render.
export const GuessGrid = memo(function GuessGrid({
  guesses,
  maxGuesses,
  showFlags = false,
  pending = false,
}: {
  guesses: Guess[];
  maxGuesses: number;
  showFlags?: boolean;
  // When true, a shimmer row sits below the real guesses (an in-flight
  // optimistic submit), consuming one empty slot so the grid keeps its height.
  pending?: boolean;
}) {
  const pendingRows = pending ? 1 : 0;
  const emptyCount = Math.max(0, maxGuesses - guesses.length - pendingRows);

  return (
    <div className="flex flex-col gap-2">
      {/* Lives here rather than in DailyGame/InfiniteGame so the two boards
          can't announce differently -- and so a mode added later gets it by
          construction, the same argument as extracting the row itself. It is a
          leaf holding its own state, so the message doesn't re-render the
          grid. */}
      <GuessAnnouncer guesses={guesses} maxGuesses={maxGuesses} pending={pending} />
      <ColumnLabels />
      {guesses.map((guess, index) => (
        <GuessRow key={index} guessedDriver={guess.guessedDriver} result={guess.result} showFlags={showFlags} />
      ))}
      {pending && <PendingGuessRow />}
      {Array.from({ length: emptyCount }).map((_, index) => (
        <EmptyRow key={`empty-${index}`} />
      ))}
    </div>
  );
});

