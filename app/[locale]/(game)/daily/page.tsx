import { permanentRedirect } from "next/navigation";

import { getPathname } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/locales";

// The daily game lives at `/` now (roadmap Pass 5). This is the other half of
// that move: `/daily` was the URL in the sitemap, in every shared link and in
// whatever Google had already indexed, so it keeps resolving rather than 404ing
// and passes its accumulated signals on.
//
// 308, not 307. `redirect()` issues a temporary redirect, which tells a crawler
// the move may be undone and leaves the old URL holding its own identity --
// exactly the reason `/` was a 308 while it pointed the other way.
//
// Nothing internal points here any more; every link that used to (the logo, the
// mode tabs, the footer, the archive's "play today", the auth flows' default
// destination) names `/` directly, so this exists for inbound links only and a
// hop through it should never be something a player on this site pays.
//
// Pass 7: the destination is resolved through `getPathname` rather than being
// the literal "/". `/es/daily` must land on `/es`, not on the English home --
// a redirect that drops the locale is a redirect that silently un-translates
// the site for anyone following an old link, which is precisely the traffic
// this route exists to keep.
export default async function DailyRedirect({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  permanentRedirect(getPathname({ href: "/", locale }));
}
