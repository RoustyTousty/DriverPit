import { Spinner } from "@/components/ui/Spinner";

// The one "this board isn't ready yet" treatment, shared by daily's hydration
// and infinite's round start: the real game window renders underneath at its
// real size, and this blurs it out with the duel lobby's loading circle
// centered on top. One loading language across every mode, same as the guess
// row itself.
//
// Covers the WHOLE game window -- title, subtitle, controls, board -- not just
// the board. The card is the unit that's loading, and blurring only part of it
// reads as two separate states side by side. Callers put `relative` on their
// outermost div (the `{children}` of the rounded-lg card in
// app/(game)/layout.tsx) so inset-0 lands on the card's own edges.
//
// Why a blur rather than the per-control skeletons this replaced: the pieces
// that were being faked (a ghosted input, pool switcher, "New driver" button,
// daily's "Loading today's board…" standing in for the guess counter) all live
// at different points in the layout, so loading read as four separate things
// twitching independently. Blurring the real controls says it once, and --
// importantly for daily -- makes an empty board unreadable rather than merely
// disabled, which is what keeps the hydration gate from ever looking like a
// fresh playable board (CLAUDE.md: "No replay flash").
//
// NOT for an in-flight guess: that stays the PendingGuessRow shimmer in
// GuessGrid, which is a *row-level* placeholder on a board you're still playing.
// This is page/round-level -- the whole board is unusable while it's up.
//
// Blocks pointer events over the board by covering it. Keyboard focus doesn't
// stop at an overlay though, so callers must still `disabled` the controls
// underneath; the blur is the signal, not the enforcement.
export function LoadingOverlay({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-bg/40 backdrop-blur-[3px]"
    >
      <Spinner size="md" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
