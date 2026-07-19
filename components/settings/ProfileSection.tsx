"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function ProfileSection() {
  const { user, profile, loading, refresh, signOut } = useAuth();
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState(() => profile?.displayName ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleEmailUpgrade(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ email });
    setPending(false);
    setMessage(
      error
        ? `Something went wrong: ${error.message}`
        : "Check your email for a confirmation link to finish saving your progress.",
    );
  }

  async function handleGoogleUpgrade() {
    setPending(true);
    setMessage(null);
    const next = window.location.pathname;
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    // On success this navigates away to Google -- only the error path
    // returns control to this component.
    if (error) {
      setPending(false);
      setMessage(`Something went wrong: ${error.message}`);
    }
  }

  async function handleSaveDisplayName(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    setPending(true);
    setMessage(null);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() || null })
      .eq("id", user.id);
    setPending(false);
    if (error) {
      setMessage(`Something went wrong: ${error.message}`);
      return;
    }
    setMessage("Display name saved.");
    await refresh();
  }

  async function handleSignOut() {
    setPending(true);
    await signOut();
    setPending(false);
  }

  if (loading || !profile || !user) {
    return <p className="py-6 text-center text-sm text-text-muted">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <AvatarGlyph username={profile.username} avatarUrl={profile.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold text-text">{profile.username}</p>
          <p className="truncate text-xs text-text-muted">
            {profile.isGuest ? "Playing as guest" : (user.email ?? "Signed in")}
          </p>
        </div>
      </div>

      {profile.isGuest ? (
        <>
          <div className="rounded-lg border border-accent-weak bg-accent-weak/40 p-3">
            <p className="text-sm font-semibold text-accent">Save your progress</p>
            <p className="text-xs text-text-muted">
              Create an account so your stats and streak follow you across devices.
            </p>
          </div>

          <form onSubmit={handleEmailUpgrade} className="flex flex-col gap-2">
            <label htmlFor="profile-email" className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              Email
            </label>
            <div className="flex gap-2">
              <input
                id="profile-email"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </form>

          <div className="flex items-center gap-3 text-xs text-text-muted">
            <div className="h-px flex-1 bg-border" />
            or
            <div className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            onClick={handleGoogleUpgrade}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text transition hover:bg-surface-2 motion-safe:active:scale-[0.98] disabled:opacity-50"
          >
            Continue with Google
          </button>

          {message && <p className="text-sm text-text-muted">{message}</p>}
        </>
      ) : (
        <>
          <form onSubmit={handleSaveDisplayName} className="flex flex-col gap-2 border-t border-border pt-4">
            <label htmlFor="profile-display-name" className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              Display name
            </label>
            <div className="flex gap-2">
              <input
                id="profile-display-name"
                type="text"
                maxLength={32}
                placeholder={profile.username}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={pending}
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] disabled:opacity-50"
              >
                Save
              </button>
            </div>
            {message && <p className="text-sm text-text-muted">{message}</p>}
          </form>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={pending}
            className="self-start rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text disabled:opacity-50"
          >
            Sign out
          </button>
        </>
      )}
    </div>
  );
}
