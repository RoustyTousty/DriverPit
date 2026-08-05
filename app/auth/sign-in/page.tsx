"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AuthPanel } from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import { sanitizeNextPath } from "@/lib/auth/oauthCallback";
import driverpitBanner from "@/public/driverpit-banner.png";

// The app's login / sign-up page. Every "Save your progress" prompt on the site
// points here, and Settings -> Profile links here instead of embedding the form
// it used to hold.
//
// Deliberately outside both route groups, exactly like /auth/reset-password: it
// is not a game window (no mode tabs, no ad slot, no marketing) and not an info
// page (no InfoTopBar nav into content). It is a single-purpose step in an auth
// flow. What it does keep is the logo as a link, because a page with no top bar
// and no way back is a dead end -- and this one is reachable from six places.
//
// Three states, and the middle one is the one that is easy to forget: EVERY
// visitor already has a session (AuthProvider signs first-time visitors in
// anonymously), so "signed in" is not the test -- `isGuest` is. A full account
// landing here has arrived after confirming an email address, or by typing the
// URL, and what it needs is confirmation plus the way out, not a form.
export default function SignInPage() {
  const { user, profile, isGuest, identityStatus } = useAuth();

  // ?next= -- where to return the player once they are done. Read in a MOUNT
  // EFFECT from window.location.search, the same way /online reads ?join=:
  // taking `searchParams` as a page prop would opt this route out of static
  // rendering, and useSearchParams() would drag a Suspense boundary in for a
  // value only the client ever needs. Deliberately NOT stripped from the URL
  // afterwards (unlike ?join=), because nothing here fires on arrival -- it is
  // only a destination, and keeping it means a refresh still knows it.
  //
  // Through sanitizeNextPath, so a crafted value degrades to /daily rather than
  // becoming an open redirect: this ends up inside the `redirectTo` handed to
  // Supabase.
  const [next, setNext] = useState("/daily");
  useEffect(() => {
    setNext(sanitizeNextPath(new URLSearchParams(window.location.search).get("next")));
  }, []);

  // Gates on the IDENTITY half only, not on `profile`. The two resolve
  // separately and identity lands first (that split is why /daily's board
  // doesn't wait on stats), so gating on the profile would hold a form behind a
  // fetch it doesn't use -- and would hang here for good if that fetch failed.
  // The signed-in branch below reads `user.email`, which arrives with identity.
  const resolving = identityStatus === "loading";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <Link
        href={next}
        className="flex justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Image src={driverpitBanner} alt="DriverPit" priority className="h-11 w-auto" />
      </Link>

      <div className="rounded-lg border border-border bg-surface p-6">
        {resolving ? (
          <p className="py-6 text-center text-sm text-text-muted">Loading…</p>
        ) : isGuest ? (
          <>
            <h1 className="text-xl font-semibold text-text">Save your progress</h1>
            {/* Names the actual stake rather than selling an account in the
                abstract. The upgrade is a LINK, not a swap -- the guest keeps
                the identity they have been playing on -- and that is the one
                thing a player is most likely to be wrong about, so it is the
                thing this sentence says. */}
            <p className="mt-2 mb-5 text-sm text-text-muted">
              Your streak, stats and duel rating are on this device only. Create an account to carry them to any
              browser — nothing you&rsquo;ve already played is lost.
            </p>
            <AuthPanel next={next} />
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-text">You&rsquo;re signed in</h1>
            <p className="mt-2 text-sm text-text-muted">
              Signed in as{" "}
              <span className="text-text">{user?.email ?? profile?.displayName ?? profile?.username ?? "your account"}</span>
              . Your progress follows this account across devices.
            </p>
            <Link
              href={next}
              className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Back to DriverPit
            </Link>
          </>
        )}
      </div>

      {isGuest && !resolving && (
        // The way out, for someone who followed a nudge and changed their mind.
        // Muted and below the card: it is the option we are not recommending,
        // but leaving it off would make the page feel like a wall.
        <Link
          href={next}
          className="self-center rounded-md text-xs font-semibold text-text-muted underline underline-offset-2 transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Keep playing as a guest
        </Link>
      )}
    </main>
  );
}
