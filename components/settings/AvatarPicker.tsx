"use client";

import { useEffect, useRef, useState } from "react";

import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { useToast } from "@/components/ui/Toast";
import { CURATED_AVATAR_SEEDS, randomAvatarSeed } from "@/lib/avatars";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

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
  const containerRef = useRef<HTMLDivElement>(null);

  // Two-phase open so the panel transitions in rather than popping.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) closeMenu();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
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
    <div className="relative" ref={containerRef}>
      <button
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

      {open && (
        <div
          role="menu"
          aria-label="Choose an avatar"
          className={`absolute top-full left-0 z-20 mt-2 w-72 origin-top-left rounded-lg border border-border bg-surface p-3 shadow-lg transition duration-150 motion-reduce:transition-none ${
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
          <div className="grid max-h-64 grid-cols-5 gap-1.5 overflow-y-auto pr-0.5">
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
        </div>
      )}
    </div>
  );
}
