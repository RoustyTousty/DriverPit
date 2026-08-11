"use client";

import { useEffect, useRef } from "react";

import { useToast } from "@/components/ui/Toast";
import { sanitizeAuthFlow, type AuthFlow } from "@/lib/auth/oauthCallback";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Surfaces the outcome of an auth round trip once control lands back in the
// app -- app/auth/callback's route handler appends `?auth=<flow>` and, when
// something went wrong, `&error_code=...` (forwarding the latter from its own
// exchangeCodeForSession() failure, or -- for failures that never reach that
// exchange at all, like a failed linkIdentity(), which GoTrue instead reports
// via a URL hash fragment the server never sees -- from a small client-side
// script that reads the hash itself). Either way it lands as a query param by
// the time this runs. Runs once on mount and cleans the URL so a refresh can't
// re-trigger it.
//
// `flow` is what stops the message being wrong: three different journeys come
// back through the same route -- Google, an email-address confirmation, and a
// password reset -- and "Signed in with Google" is false for two of them.
//
// The one failure worth calling out specially is `identity_already_exists`:
// a guest trying to link a Google account already claimed by a different
// DriverPit account (e.g. signing in from a new device). That's not really
// a dead end -- it just means they should be signed *into* that existing
// account instead, so this immediately retries as a plain sign-in. Shown as
// an `info` toast rather than `error`: it's an in-progress recovery, not a
// failure, and a red "something's wrong" toast right before it quietly
// succeeds reads as more broken than it is.
const SUCCESS_MESSAGE: Record<AuthFlow, string | null> = {
  google: "Signed in with Google.",
  email: "Email confirmed — your account is saved.",
  // Nothing: the player has landed on /auth/reset-password with a form in
  // front of them, and "signed in" is not the news. That page speaks for
  // itself, and speaks again once the new password is actually set.
  recovery: null,
};

// A failed code exchange does NOT mean a failed round trip. GoTrue's /verify
// endpoint runs before it redirects here, so by the time an exchange can fail
// the email is already confirmed server-side; what failed is only the PKCE
// hand-off, which needs the verifier stored by the browser that STARTED the
// flow. Opening the link on a different device is the ordinary way to hit
// this, so the message names the next step rather than the fault.
const FAILURE_MESSAGE: Record<AuthFlow, string> = {
  google: "Something went wrong signing in with Google. Please try again.",
  email: "Your email is confirmed. Sign in with your email and password to finish on this device.",
  recovery: "That password reset link didn't open here. Request a new one and open it in this browser.",
};

// Two failures that are worth naming outright, because the generic message
// tells the player to do the one thing that makes each of them worse.
//
// A rate limit is the sharp one: every first-time visitor to this site is signed
// in anonymously, so the project's anonymous-sign-in and sign-in/sign-up limits
// are load-bearing here in a way they aren't in a normal app -- and both are
// counted PER IP, so a developer testing repeatedly, or a CI run of the DB
// integration tier, exhausts the same bucket real visitors draw from. "Please
// try again" spends another request against a bucket that is already empty.
const RATE_LIMIT_CODES = new Set([
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "over_sms_send_rate_limit",
  "too_many_requests",
  "request_timeout",
]);

const PROVIDER_CODES = new Set(["provider_disabled", "provider_email_needs_verification", "signup_disabled"]);

export function OAuthErrorHandler() {
  const toast = useToast();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    const query = new URLSearchParams(window.location.search);
    const errorCode = query.get("error_code") ?? query.get("error");
    const errorDescription = query.get("error_description");
    const flow = sanitizeAuthFlow(query.get("auth"));
    const landed = query.has("auth");
    if (!errorCode && !landed) return;

    handledRef.current = true;
    // Logged BEFORE the URL is cleaned, and logged whether or not the toast
    // ends up naming the cause. This is the only record of why an auth round
    // trip failed that outlives the redirect -- the params are about to be
    // stripped, and the server-side console.error in /auth/callback is only
    // reachable on the branch that got as far as an exchange.
    if (errorCode) {
      console.error("[auth] callback failed", { flow, errorCode, errorDescription });
    }
    window.history.replaceState(null, "", window.location.pathname);

    if (!errorCode) {
      const message = SUCCESS_MESSAGE[flow];
      if (message) toast.success(message);
      return;
    }

    if (flow === "google" && errorCode === "identity_already_exists") {
      toast.info("That Google account is already linked to your other DriverPit account — signing you in there…");
      const supabase = createSupabaseBrowserClient();
      void supabase.auth
        .signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback?flow=google&next=${encodeURIComponent(window.location.pathname)}`,
          },
        })
        .then(({ error }) => {
          if (error) toast.error(`Something went wrong signing you in: ${error.message}`);
        });
      return;
    }

    // A rate limit is worth saying out loud on every flow: it is temporary, it
    // is not the player's fault, and the generic "please try again" is advice
    // that makes it worse.
    if (RATE_LIMIT_CODES.has(errorCode)) {
      toast.error("Too many sign-in attempts from this network. Wait a few minutes and try again.");
      return;
    }

    if (PROVIDER_CODES.has(errorCode)) {
      toast.error("That sign-in method isn't available right now. Try email and password instead.");
      return;
    }

    // `email` reads as informational on purpose -- the account genuinely
    // exists by this point, so a red toast would be reporting a failure that
    // didn't happen.
    if (flow === "email") toast.info(FAILURE_MESSAGE.email);
    // Everything else keeps its copy, plus the code in parentheses. It is not
    // pretty, and it is the difference between a bug report that can be acted
    // on and "Google login doesn't work" -- there is no other channel: the
    // params are stripped a line later and most players will never open a
    // console.
    else toast.error(`${FAILURE_MESSAGE[flow]} (${errorCode})`);
  }, [toast]);

  return null;
}
