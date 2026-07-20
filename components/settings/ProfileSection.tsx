"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { AvatarPicker } from "./AvatarPicker";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

export function ProfileSection() {
  const { user, profile, loading, refresh, signOut } = useAuth();
  const toast = useToast();
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Keeps the field in sync with the saved value -- a plain useState
  // initializer only runs once on mount, so without this the input could
  // render blank (or stale) if `profile` was still loading at that point,
  // making a save look like it did nothing even though it worked.
  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
  }, [profile?.displayName]);

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  async function handleEmailUpgrade(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const { error } = await supabase.auth.updateUser({ email });
    setPending(false);
    if (error) {
      toast.error(`Something went wrong: ${error.message}`);
      return;
    }
    toast.success("Check your email for a confirmation link to finish saving your progress.");
  }

  async function handleGoogleUpgrade() {
    setPending(true);
    const next = window.location.pathname;
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    // On success this navigates away to Google -- only the error path
    // returns control to this component.
    if (error) {
      setPending(false);
      toast.error(`Something went wrong: ${error.message}`);
    }
  }

  const trimmedDisplayName = displayName.trim();
  const isUnchanged = trimmedDisplayName === (profile?.displayName ?? "");

  async function handleSaveDisplayName(event: React.FormEvent) {
    event.preventDefault();
    if (!user || isUnchanged) return;
    setPending(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmedDisplayName || null })
      .eq("id", user.id);
    setPending(false);
    if (error) {
      toast.error(`Something went wrong: ${error.message}`);
      return;
    }
    setJustSaved(true);
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
        <AvatarPicker userId={user.id} currentAvatarUrl={profile.avatarUrl} onSaved={refresh} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{profile.displayName || profile.username}</p>
          <p className="truncate text-xs text-text-muted">
            {profile.isGuest ? "Playing as guest" : (user.email ?? "Signed in")}
          </p>
        </div>
      </div>

      {profile.isGuest ? (
        <>
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
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-semibold text-text transition hover:bg-surface-2/70 motion-safe:active:scale-[0.98] disabled:opacity-50"
          >
            <GoogleLogo />
            Continue with Google
          </button>
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
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setJustSaved(false);
                }}
                disabled={pending}
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={pending || isUnchanged}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] disabled:opacity-50"
              >
                {justSaved ? "Saved ✓" : "Save"}
              </button>
            </div>
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
