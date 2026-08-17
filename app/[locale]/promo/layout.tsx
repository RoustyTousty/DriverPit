import type { Metadata } from "next";

// This layout exists for one reason: `noindex` on the three promo slides.
//
// They are internal rendering surfaces for scripts/promo.ts, not pages — there
// is nothing on them a search result should ever show, and the board slide's URL
// carries the answer driver in a query param.
//
// Two things that are already handled elsewhere and should NOT be re-added here:
//
// `/promo` is absent from app/sitemap.ts because that file is a hand-kept ROUTES
// list rather than a filesystem walk (see its header), so a new route is
// excluded by construction. Nothing to do.
//
// It is deliberately NOT disallowed in app/robots.ts either, for the reason
// stated at length in app/[locale]/auth/layout.tsx and in robots.ts itself: a
// disallowed URL can still be indexed contentless from inbound links, and a
// crawler forbidden from fetching the page can never read the noindex on it, so
// the two settings cancel out. Allow the crawl, refuse the index.
//
// `follow: false` here, unlike the auth pages': a promo slide's only outbound
// link is the wordmark image, and there is no equity to pass on.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// No chrome. These slides are composed entirely by PromoFrame — the site's top
// bar, mode tabs, ad slot and footer would all be in the screenshot otherwise,
// which is why this route group sits outside both (game) and (info).
export default function PromoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
