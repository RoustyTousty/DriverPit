"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TRANSITION_MS = 200;

type Phase = "closed" | "entering" | "open" | "closing";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const [phase, setPhase] = useState<Phase>("closed");
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Drive the open/close animation as an explicit phase machine so the exit
  // transition gets to play before the modal actually unmounts.
  useEffect(() => {
    if (open) {
      setPhase("entering");
      const raf = requestAnimationFrame(() => setPhase("open"));
      return () => cancelAnimationFrame(raf);
    }
    setPhase((prev) => (prev === "closed" ? "closed" : "closing"));
  }, [open]);

  useEffect(() => {
    if (phase !== "closing") return;
    const timeout = setTimeout(() => setPhase("closed"), TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, [phase]);

  const isRendered = phase !== "closed";

  // Scroll lock while mounted (covers the closing animation too).
  useEffect(() => {
    if (!isRendered) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isRendered]);

  // Focus trap: move focus in on mount, cycle Tab within the panel, restore
  // focus to whatever triggered the modal on the way out.
  useEffect(() => {
    if (!isRendered) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusables?.[0] ?? panelRef.current)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [isRendered, onClose]);

  if (!isRendered) return null;

  const isVisible = phase === "open";

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 transition-opacity duration-200 motion-reduce:transition-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[85vh] w-full max-w-sm flex-col rounded-lg border border-border bg-surface shadow-lg outline-none transition duration-200 motion-reduce:transition-none ${
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 p-5 pb-4">
          <h2 id={titleId} className="text-lg font-bold text-text">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Header stays put; only the body scrolls once content exceeds
            max-h-[85vh] -- a long section (e.g. Settings) no longer runs
            off the bottom of the screen with no way to reach the rest.
            min-h-0 is load-bearing: a flex child defaults to min-height:
            auto, which refuses to shrink below its content size -- without
            it, overflow-y-auto here never actually kicks in, the panel
            grows past max-h-[85vh] instead, and with body scroll locked
            behind it there's no way to reach the rest of the content at
            all (this is what broke page scroll). */}
        <div className="min-h-0 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
