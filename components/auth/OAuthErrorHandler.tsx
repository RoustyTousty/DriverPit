"use client";

import { useEffect, useRef } from "react";

import { useToast } from "@/components/ui/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Surfaces the outcome of an OAuth round trip once control lands back in
// the app -- app/auth/callback's route handler appends either `?oauth=
// success` or `?error_code=...` to the redirect (forwarding the latter from
// its own exchangeCodeForSession() failure, or -- for failures that never
// reach that exchange at all, like a failed linkIdentity(), which GoTrue
// instead reports via a URL hash fragment the server never sees -- from a
// small client-side script that reads the hash itself). Either way it lands
// as a query param by the time this runs. Runs once on mount and cleans the
// URL so a refresh can't re-trigger it.
//
// The one failure worth calling out specially is `identity_already_exists`:
// a guest trying to link a Google account already claimed by a different
// DriverPit account (e.g. signing in from a new device). That's not really
// a dead end -- it just means they should be signed *into* that existing
// account instead, so this immediately retries as a plain sign-in. Shown as
// an `info` toast rather than `error`: it's an in-progress recovery, not a
// failure, and a red "something's wrong" toast right before it quietly
// succeeds reads as more broken than it is.
export function OAuthErrorHandler() {
  const toast = useToast();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    const query = new URLSearchParams(window.location.search);
    const errorCode = query.get("error_code") ?? query.get("error");
    const succeeded = query.get("oauth") === "success";
    if (!errorCode && !succeeded) return;

    handledRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);

    if (succeeded) {
      toast.success("Signed in with Google.");
      return;
    }

    if (errorCode === "identity_already_exists") {
      toast.info("That Google account is already linked to your other DriverPit account — signing you in there…");
      const supabase = createSupabaseBrowserClient();
      void supabase.auth
        .signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`,
          },
        })
        .then(({ error }) => {
          if (error) toast.error(`Something went wrong signing you in: ${error.message}`);
        });
      return;
    }

    toast.error("Something went wrong signing in with Google. Please try again.");
  }, [toast]);

  return null;
}
