"use client";

import { Modal } from "@/components/ui/Modal";

// Wraps every live-match view (pre-round, playing, intermission) with the Exit
// control + its confirm modal -- one unobtrusive control, same spot in every
// beat, gone once the match is over. Extracted from DuelMatch (audit §2.3).
export function DuelExitControl({
  open,
  onOpenChange,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      {/* px-4 matches the inner padding every wrapped view uses, so the
          full-width button lines up with the content above it rather than
          running to the card's edges. Full width (not centered auto-width)
          keeps it identical in shape to Back to modes and the lobby's Cancel
          -- one "leave" control, one look, three screens. Stays text-xs
          though: this one interrupts a live match, so it should read as the
          quietest of the three. */}
      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="w-full rounded-lg px-4 py-1.5 text-xs font-semibold text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Exit match
        </button>
      </div>
      <Modal open={open} onClose={() => onOpenChange(false)} title="Forfeit the match?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            Leaving now counts as a loss — your opponent takes the win and your rating drops.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.98]"
            >
              Forfeit
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Keep playing
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
