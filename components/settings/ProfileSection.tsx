"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { signInHref } from "@/lib/auth/routes";
import { getDuelCommitments } from "@/lib/duel/duelCommitments";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { AvatarPicker } from "./AvatarPicker";
import { Link } from "@/lib/i18n/navigation";

// Settings -> Profile: the things about an account that genuinely are settings
// -- avatar, display name, which state you're in, and the way out.
//
// The email/password/Google form used to live here inline. It is now
// /auth/sign-in (components/auth/AuthPanel), and this section links to it. A
// modal is the wrong container for an auth flow: creating an account sends the
// player to their inbox, signing in may send them to a password manager, and a
// recovery link has to land on a page anyway -- so half the flow already
// happened somewhere this dialog couldn't follow. What stayed is what a player
// opens Settings to change.
export function ProfileSection() {
  const { user, profile, loading, refresh, signOutAndReset } = useAuth();
  const toast = useToast();
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Which live server-side commitment signing out is about to abandon, or null
  // when there is nothing at stake and no prompt is needed.
  const [confirm, setConfirm] = useState<"match" | "queue" | "lobby" | null>(null);

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

  // Confirm only when signing out would actually abandon something. A plain
  // sign-out with nothing in flight goes straight through -- a needless "are
  // you sure?" on the common path just trains people to dismiss it.
  function handleSignOutClick() {
    const { matchLive, queued, hostingLobby } = getDuelCommitments();
    if (matchLive || queued || hostingLobby) {
      // Most consequential first: a live match has an opponent mid-game, an
      // open lobby has someone about to follow a link to it, a queue row has
      // nobody waiting on it in particular.
      setConfirm(matchLive ? "match" : hostingLobby ? "lobby" : "queue");
      return;
    }
    void performSignOut();
  }

  async function performSignOut() {
    setConfirm(null);
    setPending(true);
    try {
      await signOutAndReset();
      // Success means the browser is already navigating to "/" -- deliberately
      // leave `pending` set so the button stays disabled through teardown
      // instead of flickering back to enabled.
    } catch (err) {
      // Fails closed: still signed in, nothing was reloaded, and whatever we
      // were trying to release is still ours to release. Say so plainly.
      setPending(false);
      toast.error(
        err instanceof Error
          ? `Couldn't sign out: ${err.message}. You're still signed in — check your connection and try again.`
          : "Couldn't sign out. You're still signed in — check your connection and try again.",
      );
    }
  }

  if (loading || !profile || !user) {
    return <p className="py-6 text-center text-sm text-text-muted">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Identity header as a real card rather than bare text on the modal
          background -- it's the one block that's always present in both
          states, so giving it the site's standard surface + hairline border
          anchors the section instead of letting the avatar float. */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
        <AvatarPicker userId={user.id} currentAvatarUrl={profile.avatarUrl} onSaved={refresh} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-text">{profile.displayName || profile.username}</p>
            {/* CLAUDE.md's Profile requirement: "Show which state the user is
                in." A badge states it outright instead of leaving it to be
                inferred from whether the subtitle happens to be an email.
                Accent only on the full-account state, where it means
                something -- a guest badge in orange would be rewarding the
                state we're asking them to leave. */}
            <span
              className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                profile.isGuest
                  ? "border-border text-text-muted"
                  : "border-accent-weak bg-accent-weak/40 text-accent"
              }`}
            >
              {profile.isGuest ? "Guest" : "Account"}
            </span>
          </div>
          <p className="truncate text-xs text-text-muted">
            {profile.isGuest ? "Progress is saved on this device only" : (user.email ?? "Signed in")}
          </p>
        </div>
      </div>

      {profile.isGuest ? (
        // A guest gets a settings ROW, the shape GeneralSection established --
        // label, one-line description, control on the right -- rather than the
        // form that used to be inlined here. Deliberately not the accent
        // "Save your progress" card: that banner is already at the top of this
        // modal for a guest, and a second copy of it two rows down would be the
        // same ask twice in one dialog.
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">Account</p>
            <p className="text-xs text-text-muted">
              Sign in, or create an account to carry your progress to another device.
            </p>
          </div>
          <Link
            href={signInHref()}
            className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <>
          {/* No border-t here any more: the identity block above is now a
              bordered card, so a rule directly beneath it read as a double
              hairline. The section's own gap does the separating. */}
          <form onSubmit={handleSaveDisplayName} className="flex flex-col gap-2">
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
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={pending || isUnchanged}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {justSaved ? "Saved ✓" : "Save"}
              </button>
            </div>
          </form>

          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={handleSignOutClick}
              disabled={pending}
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        </>
      )}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm === "match"
            ? "Forfeit your match?"
            : confirm === "lobby"
              ? "Cancel your custom game?"
              : "Leave the queue?"
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            {confirm === "match"
              ? "Signing out will forfeit your match — your opponent wins immediately, and the result counts toward your duel record."
              : confirm === "lobby"
                ? "Signing out will cancel the game you're hosting. Anyone you sent the code to won't be able to join."
                : "Signing out will take you out of matchmaking, so you won't be paired with an opponent."}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Stay signed in
            </button>
            <button
              type="button"
              onClick={() => void performSignOut()}
              disabled={pending}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {confirm === "match" ? "Forfeit and sign out" : "Sign out"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
