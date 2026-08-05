import Link from "next/link";

import { signInHref } from "@/lib/auth/routes";

// The "Save your progress" nudge, in one place. It existed as four hand-copied
// cards (Settings, the leaderboard, /online, the duel results panel) that had
// already drifted apart in their focus rings, and each of which knew how to
// reach the auth UI in its own way -- two through openSettings("profile"), one
// through an onUpgrade prop threaded down from GameModals.
//
// Now they all do the one thing there is to do: link to the sign-in page. That
// removed the prop-threading entirely, and it is why this needs no "use client"
// of its own -- a nudge is a card and a link, with no state, no context and no
// hooks. (Three of its four callers are client components, so it compiles into
// their bundle either way; the point is that nothing here would break if the
// fourth were not.)
//
// Only the sentence changes per site, because only the sentence should: the
// stake is different in each place ("appear on the leaderboard" vs "keep your
// duel rating"), and a generic line in all four would be the version nobody
// acts on.
export function GuestUpgradePrompt({
  description,
  // Where to send the player back to once they're done. Their current route,
  // normally -- see signInHref.
  next,
}: {
  description: string;
  next?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-accent-weak bg-accent-weak/40 p-3 text-left">
      <div>
        <p className="text-sm font-semibold text-accent">Save your progress</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
      <Link
        href={signInHref(next)}
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        Sign up
      </Link>
    </div>
  );
}
