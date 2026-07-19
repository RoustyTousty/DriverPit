"use client";

import { useEffect, useRef } from "react";

import { useToast } from "@/components/ui/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Google's identity-link failure (this Google account is already linked to
// a *different* DriverPit account -- e.g. the guest upgrading is a fresh
// anonymous session, but they'd already linked this same Google account
// from a previous browser/session) can only be detected after the full
// OAuth round trip, since Supabase has to actually see the Google account
// before it can know it's already claimed. That means it never surfaces as
// a synchronous error from ProfileSection's linkIdentity() call -- instead
// Supabase appends error info to the redirect back here as a URL *hash*
// fragment, which is client-only and never visible to the
// app/auth/callback route handler. Runs once on mount, surfaces whichever
// failure happened as a toast, and cleans the URL so a refresh can't
// re-trigger it.
export function OAuthErrorHandler() {
  const toast = useToast();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const errorCode = hashParams.get("error_code");
    const queryError = new URLSearchParams(window.location.search).get("error");
    if (!errorCode && !queryError) return;

    handledRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);

    if (errorCode === "identity_already_exists") {
      toast.error("That Google account is already linked to a different DriverPit account. Signing you in to it…");
      const supabase = createSupabaseBrowserClient();
      void supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`,
        },
      });
      return;
    }

    toast.error("Something went wrong signing in with Google. Please try again.");
  }, [toast]);

  return null;
}
