"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  PASSWORD_MIN_LENGTH,
  describeAuthError,
  normalizeEmail,
  validateEmail,
  validateNewPassword,
  type AuthErrorLike,
} from "@/lib/auth/credentials";
import { RESET_PASSWORD_PATH } from "@/lib/auth/routes";
import { getDuelCommitments } from "@/lib/duel/duelCommitments";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// The whole of the app's email/password + Google auth UI, and the only place it
// exists. It used to live inline in Settings -> Profile; it now renders on
// /auth/sign-in, a page of its own, because the flow does not fit in a modal:
// creating an account sends the player to their inbox, signing in may send them
// to a password manager, and a recovery link lands on a page rather than a
// dialog. Profile keeps the things that are genuinely settings (avatar, display
// name, sign out) and links here.
//
// Extracted verbatim rather than rewritten. Every load-bearing rule in here was
// established by an audit and is pinned by AuthPanel.test.tsx -- one updateUser
// call carrying BOTH attributes, sign-in through AuthProvider, no
// validateNewPassword on the sign-in tab, commitments confirmed before either.

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

// Which of the two things a guest can do with an email address. They are tabs
// rather than one clever form because they are genuinely different intents with
// different failure modes -- "this email is taken" is an error on one and the
// whole point of the other -- and because someone arriving with an account
// already knows which one they want. Same tablist as SettingsModal and
// CustomLobby, so a tab looks like a tab everywhere.
type EmailTab = "signup" | "signin";

export function AuthPanel({
  // Where an auth round trip should land the player. Every emailed link and the
  // Google redirect carry it through /auth/callback, which sanitizes it. NOT
  // window.location.pathname any more: that used to be Settings' own route, and
  // from a dedicated sign-in page it would send a player who just confirmed
  // their address straight back to the sign-in page.
  next,
}: {
  next: string;
}) {
  const { refresh, signInWithPassword, ensureIdentity } = useAuth();
  const toast = useToast();
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [tab, setTab] = useState<EmailTab>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Inline rather than a toast: these are answers to a field the player is
  // looking at, and half of them ("use at least 8 characters") are corrections
  // to make before the form can be submitted again -- a message that slides
  // away after four seconds is the wrong shape for that.
  const [formError, setFormError] = useState<string | null>(null);
  // The address a confirmation link just went to. Persistent for the same
  // reason the errors are: "check your email" has to still be on screen when
  // the player comes back from checking their email.
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // What signing in is about to abandon. Signing IN as someone else releases
  // the same server-side commitments a sign-out does (see
  // AuthProvider.releaseServerCommitments), so nothing may leave until the
  // player has said so.
  const [confirm, setConfirm] = useState<"match" | "queue" | "lobby" | null>(null);

  // Where an emailed link should bring the player back to. Always through
  // /auth/callback, which is the only thing that exchanges the code for a
  // session -- and always carrying `flow`, which is what stops the arrival
  // toast claiming they signed in with Google.
  function callbackUrl(flow: "google" | "email" | "recovery", destination: string) {
    return `${window.location.origin}/auth/callback?flow=${flow}&next=${encodeURIComponent(destination)}`;
  }

  // Guest -> full account, keeping the SAME auth.users row (so the daily in
  // progress, the stats and the duel rating all carry over). This is why it is
  // updateUser() and not signUp(): signUp posts no Authorization header, so it
  // would mint a second, empty account and orphan everything the guest has
  // done. See CLAUDE.md, "Upgrade, don't replace".
  //
  // Email and password go in ONE call, and that is not a convenience: GoTrue
  // refuses to set a password on an anonymous user unless the same request
  // also carries the address it will belong to ("Updating password of an
  // anonymous user without an email or phone is not allowed"). The password
  // takes effect immediately; the address is pending until the emailed link is
  // opened, and only then does auth.users.is_anonymous flip -- which is what
  // the handle_user_updated trigger turns into profiles.is_guest = false.
  async function handleCreateAccount(event: React.FormEvent) {
    event.preventDefault();
    const emailProblem = validateEmail(email);
    if (emailProblem) return setFormError(emailProblem);
    const passwordProblem = validateNewPassword(password);
    if (passwordProblem) return setFormError(passwordProblem);

    const address = normalizeEmail(email);
    setFormError(null);
    setPending(true);
    // THE ONE PLACE deferred identity (roadmap Pass 4a) is a hard precondition
    // rather than a head start. `updateUser` upgrades the anonymous row that is
    // already signed in -- with no session there is nothing to update, and the
    // call fails. Reaching /auth/sign-in without ever touching the game is an
    // ordinary way to arrive (six places link here), so this is a normal path,
    // not an edge case. Creating the guest first keeps "upgrade, don't replace"
    // true even for someone whose very first action on the site is signing up.
    if (!(await ensureIdentity())) {
      setPending(false);
      setFormError("Couldn't reach the server. Check your connection and try again.");
      return;
    }
    const { data, error } = await supabase.auth.updateUser(
      { email: address, password },
      { emailRedirectTo: callbackUrl("email", next) },
    );
    setPending(false);
    if (error) {
      setFormError(describeAuthError(error, "Couldn't create your account. Please try again."));
      return;
    }

    setPassword("");
    // Whether an email was actually sent is the Supabase project's decision,
    // not ours: with "Confirm email" off, GoTrue applies the address on the
    // spot and `is_anonymous` is already false here. Reading it back beats
    // hardcoding either outcome -- "check your inbox" for a link that will
    // never arrive is the worse of the two failures, and it looks exactly like
    // the feature being broken.
    if (data.user?.is_anonymous === false) {
      toast.success("Account created — your progress is saved.");
      // The id didn't change (this is a link, not a swap), so nothing upstream
      // re-fetches the profile on its own; without this the page keeps
      // rendering the guest state until the next load.
      await refresh();
      return;
    }

    setConfirmationSentTo(address);
    toast.success(`Confirmation link sent to ${address}.`);
  }

  // The returning player on a new device (or after a sign-out). Unlike the
  // upgrade above this ABANDONS the anonymous identity currently signed in, so
  // it goes through AuthProvider rather than calling supabase directly -- see
  // signInWithPassword for what it releases first and why it reloads.
  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    const emailProblem = validateEmail(email);
    if (emailProblem) return setFormError(emailProblem);
    // Deliberately NOT validateNewPassword: an account made before this floor
    // existed can hold a shorter password, and telling someone their own
    // password is too short is a dead end.
    if (!password) return setFormError("Enter your password.");

    setFormError(null);
    const { matchLive, queued, hostingLobby } = getDuelCommitments();
    if (matchLive || queued || hostingLobby) {
      setConfirm(matchLive ? "match" : hostingLobby ? "lobby" : "queue");
      return;
    }
    await performSignIn();
  }

  async function performSignIn() {
    setConfirm(null);
    setPending(true);
    try {
      await signInWithPassword(normalizeEmail(email), password);
      // Success means the browser is already navigating -- leave `pending` set
      // so the form stays disabled through teardown.
    } catch (err) {
      setPending(false);
      setFormError(
        describeAuthError(err as AuthErrorLike, "Couldn't sign you in. Check your connection and try again."),
      );
    }
  }

  // Password reset is the other half of offering a password at all: without it
  // a forgotten one locks the account permanently, since there is no support
  // desk behind this. Uses whatever is in the email field -- the player has
  // usually just typed it and failed to sign in with it.
  async function handleForgotPassword() {
    const emailProblem = validateEmail(email);
    if (emailProblem) {
      setFormError("Enter the email address for your account first, then choose Forgot password.");
      return;
    }
    const address = normalizeEmail(email);
    setFormError(null);
    setPending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: callbackUrl("recovery", RESET_PASSWORD_PATH),
    });
    setPending(false);
    if (error) {
      setFormError(describeAuthError(error, "Couldn't send the reset email. Please try again."));
      return;
    }
    // Deliberately not "if that address has an account": Supabase answers the
    // same way either way, so promising more than it delivers would be the
    // misleading part.
    toast.success(`Password reset link sent to ${address}.`);
  }

  // One button under both tabs, and linkIdentity() for both, because it already
  // does the right thing in either case: a Google account nobody has claimed
  // links to this guest (progress preserved), and one that IS claimed comes
  // back as `identity_already_exists`, which OAuthErrorHandler turns into a
  // plain sign-in to that account. signInWithOAuth() on the "Sign in" tab would
  // read better and behave worse -- it silently orphans the guest's progress
  // whenever no account exists yet.
  async function handleGoogle() {
    setFormError(null);
    setPending(true);
    // linkIdentity() links to the session that exists, so it needs one for the
    // same reason handleCreateAccount does. Minting the guest first is also
    // what keeps this button's whole rationale intact for a visitor arriving
    // cold: there has to be a guest for Google to link TO, or the "silently
    // orphans the guest's progress" trade the comment above describes has no
    // meaning on this path.
    if (!(await ensureIdentity())) {
      setPending(false);
      setFormError("Couldn't reach the server. Check your connection and try again.");
      return;
    }
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: callbackUrl("google", next) },
    });
    // On success this navigates away to Google -- only the error path
    // returns control to this component.
    if (error) {
      setPending(false);
      setFormError(describeAuthError(error, "Couldn't reach Google. Please try again."));
    }
  }

  function selectTab(nextTab: EmailTab) {
    setTab(nextTab);
    // The two tabs disagree about what an error means, so carrying one across
    // would leave "that email already has an account" sitting above the form
    // that wants exactly that.
    setFormError(null);
    setConfirmationSentTo(null);
  }

  return (
    // Tighter than a section gap: the tabs, the email form, the "or" and the
    // Google button are all ways to do ONE thing, so they read as a single
    // control group.
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Account"
        className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1"
      >
        {(
          [
            { value: "signup", label: "Create account" },
            { value: "signin", label: "Sign in" },
          ] as const
        ).map((option) => {
          const active = option.value === tab;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="auth-panel-form"
              onClick={() => selectTab(option.value)}
              disabled={pending}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                active ? "bg-accent-weak text-accent" : "text-text-muted hover:text-text"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div id="auth-panel-form" role="tabpanel">
        <form onSubmit={tab === "signup" ? handleCreateAccount : handleSignIn} className="flex flex-col gap-2">
          <label htmlFor="auth-email" className="text-xs font-semibold tracking-wide text-text-muted uppercase">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setFormError(null);
            }}
            disabled={pending}
            aria-invalid={formError !== null}
            aria-describedby={formError ? "auth-panel-error" : undefined}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
          />

          <label
            htmlFor="auth-password"
            className="mt-1 text-xs font-semibold tracking-wide text-text-muted uppercase"
          >
            Password
          </label>
          <div className="relative">
            <input
              id="auth-password"
              type={showPassword ? "text" : "password"}
              // Tells a password manager which of the two this is, which is
              // the difference between it offering to save a new password
              // and offering to fill the existing one.
              autoComplete={tab === "signup" ? "new-password" : "current-password"}
              placeholder={tab === "signup" ? `At least ${PASSWORD_MIN_LENGTH} characters` : "Your password"}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFormError(null);
              }}
              disabled={pending}
              aria-invalid={formError !== null}
              aria-describedby={formError ? "auth-panel-error" : undefined}
              className="w-full rounded-lg border border-border bg-surface-2 py-2 pr-16 pl-3 text-sm text-text outline-none transition focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            {/* A reveal toggle instead of a second "confirm password" field:
                it catches the same typo with one control rather than two,
                and it is the only way to check a password a manager has
                just filled. */}
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              disabled={pending}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          {formError && (
            <p id="auth-panel-error" role="alert" className="text-xs text-red-400">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {tab === "signup" ? "Create account" : "Sign in"}
          </button>

          {tab === "signup" ? (
            confirmationSentTo ? (
              // Persistent, unlike the toast that fired at the same moment:
              // the player is about to leave for their inbox, and this is
              // the sentence they need when they come back.
              <p className="text-xs text-text-muted">
                Check <span className="text-text">{confirmationSentTo}</span> and open the link to finish. Your
                password is already saved — you can sign in with it on any device once the address is confirmed.
              </p>
            ) : (
              <p className="text-xs text-text-muted">
                Keeps everything you&rsquo;ve already played — this account is the one you&rsquo;re using now.
              </p>
            )
          ) : (
            <button
              type="button"
              onClick={() => void handleForgotPassword()}
              disabled={pending}
              className="self-start rounded-md text-xs font-semibold text-text-muted underline underline-offset-2 transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              Forgot password?
            </button>
          )}
        </form>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-semibold tracking-wide text-text-muted uppercase">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Outside the tabs on purpose: with Google there is no difference
          between creating an account and signing in, so making the player
          pick a tab first would be asking a question that has no answer. */}
      <button
        type="button"
        onClick={() => void handleGoogle()}
        disabled={pending}
        // Hover draws an ACCENT outline and leaves the fill alone. It used to add
        // `hover:bg-surface` on top of a `bg-surface-2` rest state, which is
        // *darker* -- surface-2 is the raised token and surface is the window
        // behind it -- so this button got dimmer on hover while every other one
        // on the site gets lighter. With the fill already at the raised token
        // there is no lighter step to move to, so the feedback is the border.
        //
        // Accent rather than a neutral brighten, and it stays within the orange
        // discipline: this is a momentary state on the one interactive control
        // in the block, matching the ring its own focus state already draws.
        className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-semibold text-text transition hover:border-accent motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        <GoogleLogo />
        Continue with Google
      </button>

      {/* Signing in as someone else abandons the current identity's match,
          queue row and lobby exactly as signing out does -- same prompt, same
          stake, and the reason this stays with the form rather than with the
          sign-out button in Settings. */}
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
              ? "Signing in will forfeit your match — your opponent wins immediately, and the result counts toward your duel record."
              : confirm === "lobby"
                ? "Signing in will cancel the game you're hosting. Anyone you sent the code to won't be able to join."
                : "Signing in will take you out of matchmaking, so you won't be paired with an opponent."}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void performSignIn()}
              disabled={pending}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {confirm === "match" ? "Forfeit and sign in" : "Sign in"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
