"use client";

import { useState } from "react";

import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { useToast } from "@/components/ui/Toast";
import { AVATAR_PRESETS } from "@/lib/avatars";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

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

  async function handlePick(presetId: string) {
    if (presetId === currentAvatarUrl || pending) return;
    setPending(true);
    const { error } = await supabase.from("profiles").update({ avatar_url: presetId }).eq("id", userId);
    setPending(false);
    if (error) {
      toast.error(`Something went wrong: ${error.message}`);
      return;
    }
    await onSaved();
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">Avatar</p>
      <div className="grid grid-cols-4 gap-2">
        {AVATAR_PRESETS.map((preset) => {
          const selected = preset.id === currentAvatarUrl;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => void handlePick(preset.id)}
              disabled={pending}
              aria-label={preset.label}
              aria-pressed={selected}
              className={`flex items-center justify-center rounded-lg border p-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                selected ? "border-accent bg-accent-weak/40" : "border-border hover:border-accent/50"
              }`}
            >
              <AvatarGlyph avatarUrl={preset.id} size="lg" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
