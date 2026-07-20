"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { useToast } from "@/components/ui/Toast";
import { CURATED_AVATAR_SEEDS, randomAvatarSeed } from "@/lib/avatars";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const PANEL_WIDTH = 288; // matches w-72
const PANEL_MAX_HEIGHT = 300; // header + shuffle row + 4 grid rows, for the above/below flip check
const VIEWPORT_MARGIN = 8;

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  );
}

// Clicking the current avatar opens a dropdown grid of DiceBear characters
// (closes on an outside click, Escape, or a successful pick) rather than
// showing every option inline all the time. "Shuffle" swaps the grid for a
// freshly rolled batch, since the seed space is effectively unlimited.
//
// Portaled to <body> and positioned via the trigger's own bounding rect
// (not a plain `absolute` child) so it floats independently of whatever
// scroll container it was opened from -- inside the Settings modal, an
// `absolute` panel would instead force the modal's own body to grow and
// scroll to fit it, stacking this grid's scrollbar inside the modal's,
// which reads as a scroll-wheel-inside-a-scroll-wheel.
export function AvatarPicker({
  userId,
  currentAvatarUrl,
  onSaved,
}: {
  userId: string;
  currentAvatarUrl: string;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [seeds, setSeeds] = useState<string[]>(CURATED_AVATAR_SEEDS);
  const [placement, setPlacement] = useState<{ top: number | null; bottom: number | null; left: number }>({
    top: null,
    bottom: null,
    left: 0,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Roll a fresh batch every time the panel opens (not just on manual
  // Shuffle) so the grid is never the same selection twice in a row.
  useEffect(() => {
    if (open) setSeeds(Array.from({ length: CURATED_AVATAR_SEEDS.length }, randomAvatarSeed));
  }, [open]);

  // Two-phase open so the panel transitions in rather than popping, and
  // recomputed on every open/scroll/resize since the trigger can move
  // independently of this now-portaled panel.
  useLayoutEffect(() => {
    if (!open) return;

    function reposition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < PANEL_MAX_HEIGHT && rect.top > spaceBelow;
      setPlacement({
        top: openUpward ? null : rect.bottom + VIEWPORT_MARGIN,
        bottom: openUpward ? window.innerHeight - rect.top + VIEWPORT_MARGIN : null,
        left: Math.min(Math.max(rect.left, VIEWPORT_MARGIN), window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN),
      });
    }

    reposition();
    const raf = requestAnimationFrame(() => setVisible(true));
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  // Focus trap scoped to just this panel (mirrors ui/Modal.tsx) -- once
  // portaled out to <body>, the panel is no longer inside the Settings
  // modal's own DOM subtree, so its focus trap can no longer see these
  // buttons to include them.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
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

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) closeMenu();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
      previouslyFocused.current?.focus();
    };
  }, [open]);

  function closeMenu() {
    setVisible(false);
    setOpen(false);
  }

  function handleShuffle() {
    setSeeds(Array.from({ length: CURATED_AVATAR_SEEDS.length }, randomAvatarSeed));
  }

  async function handlePick(seed: string) {
    if (seed === currentAvatarUrl || pending) return;
    setPending(true);
    const { error } = await supabase.from("profiles").update({ avatar_url: seed }).eq("id", userId);
    setPending(false);
    if (error) {
      toast.error(`Something went wrong: ${error.message}`);
      return;
    }
    closeMenu();
    await onSaved();
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Change avatar"
        className="group relative rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <AvatarGlyph avatarUrl={currentAvatarUrl} size="lg" />
        <span className="absolute -right-0.5 -bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface bg-accent text-bg transition group-hover:brightness-110">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-2.5 w-2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Choose an avatar"
            style={{
              width: PANEL_WIDTH,
              top: placement.top ?? undefined,
              bottom: placement.bottom ?? undefined,
              left: placement.left,
            }}
            className={`fixed z-50 rounded-lg border border-border bg-surface p-3 shadow-lg transition duration-150 motion-reduce:transition-none ${
              visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">Choose an avatar</p>
              <button
                type="button"
                onClick={handleShuffle}
                disabled={pending}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text disabled:opacity-50"
              >
                <ShuffleIcon />
                Shuffle
              </button>
            </div>
            <div className="grid max-h-56 grid-cols-5 gap-1.5 overflow-y-auto pr-0.5">
              {seeds.map((seed) => {
                const selected = seed === currentAvatarUrl;
                return (
                  <button
                    key={seed}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => void handlePick(seed)}
                    disabled={pending}
                    aria-label={seed}
                    className={`flex items-center justify-center rounded-lg border p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                      selected ? "border-accent bg-accent-weak/40" : "border-border hover:border-accent/50 hover:bg-surface-2"
                    }`}
                  >
                    <AvatarGlyph avatarUrl={seed} size="md" />
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
