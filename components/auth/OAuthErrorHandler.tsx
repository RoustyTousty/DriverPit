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

export function OAuthErrorHandler() {
  const toast = useToast();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    const query = new URLSearchParams(window.location.search);
    const errorCode = query.get("error_code") ?? query.get("error");
    const flow = sanitizeAuthFlow(query.get("auth"));
    const landed = query.has("auth");
    if (!errorCode && !landed) return;

    handledRef.current = true;
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

    // `email` reads as informational on purpose -- the account genuinely
    // exists by this point, so a red toast would be reporting a failure that
    // didn't happen.
    if (flow === "email") toast.info(FAILURE_MESSAGE.email);
    else toast.error(FAILURE_MESSAGE[flow]);
  }, [toast]);

  return null;
}
