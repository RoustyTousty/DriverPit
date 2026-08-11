"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { PASSWORD_MIN_LENGTH, describeAuthError, validateNewPassword } from "@/lib/auth/credentials";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Link } from "@/lib/i18n/navigation";

// Where a "Forgot password?" email lands, via /auth/callback -- which does the
// code exchange, so by the time this renders the recovery session is already
// the live one and setting the password is an ordinary updateUser() call.
//
// Deliberately outside both route groups: it is not a game window (no mode
// tabs, no ad slot, no marketing) and not an info page (no InfoTopBar nav
// back into content). It is a single-purpose step in the middle of an auth
// flow, and the one thing it should offer is the way out of it. /auth/sign-in
// is its sibling, for the same reason.
//
// The gate below is `user.is_anonymous`, not "is there a session": every
// visitor has a session, because AuthProvider signs first-time visitors in
// anonymously. A guest reaching this page means the recovery link did not take
// -- expired, already used, or (the common one) opened in a different browser
// from the one that requested it, which PKCE cannot complete because the code
// verifier lives in the requesting browser's storage.
export default function ResetPasswordPage() {
  const { user, identityStatus } = useAuth();
  const toast = useToast();
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateNewPassword(password);
    if (problem) return setError(problem);

    setError(null);
    setPending(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setPending(false);
      setError(describeAuthError(updateError, "Couldn't set your new password. Please try again."));
      return;
    }
    toast.success("Password updated. You're signed in.");
    // Hard navigation rather than a router push, for the same reason sign-out
    // uses one: the session that got us here was minted by a redirect, and a
    // clean boot is the simplest way to be sure everything downstream is
    // reading it. `pending` stays set so the form can't be submitted twice
    // while the browser is on its way.
    window.location.assign("/");
  }

  const resolving = identityStatus === "loading";
  const linkFailed = !resolving && (user?.is_anonymous ?? true);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold text-text">Set a new password</h1>

        {resolving ? (
          <p className="mt-4 text-sm text-text-muted">Checking your link…</p>
        ) : linkFailed ? (
          <>
            <p className="mt-2 text-sm text-text-muted">
              This reset link has expired, has already been used, or was opened in a different browser from the one
              that asked for it. Request a new one from the sign-in page, and open it in the same browser.
            </p>
            <Link
              href={SIGN_IN_PATH}
              className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Go to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-text-muted">
              Choose a new password for <span className="text-text">{user?.email ?? "your account"}</span>.
            </p>

            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-2">
              <label
                htmlFor="new-password"
                className="text-xs font-semibold tracking-wide text-text-muted uppercase"
              >
                New password
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  autoFocus
                  placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError(null);
                  }}
                  disabled={pending}
                  aria-invalid={error !== null}
                  aria-describedby={error ? "new-password-error" : undefined}
                  className="w-full rounded-lg border border-border bg-surface-2 py-2 pr-16 pl-3 text-sm text-text outline-none transition focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  disabled={pending}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              {error && (
                <p id="new-password-error" role="alert" className="text-xs text-red-400">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                Save password
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
