import type { Metadata } from "next";

// This layout exists for one reason: `noindex` on the two auth pages.
//
// Both of them are `"use client"`, and a client component cannot export
// `metadata` -- so the directive has to come from a server layout above them.
// It renders children untouched; there is deliberately no chrome here, because
// each auth page owns its own (CLAUDE.md, "Site architecture": these are steps
// inside a flow, in neither route group).
//
// WHY NOINDEX RATHER THAN A robots.txt DISALLOW. They are not interchangeable
// and using the disallow here would be the wrong one. A disallowed URL can still
// be indexed from its inbound links -- /auth/sign-in is linked from six places
// on this site -- it just gets indexed with no content, which is what Search
// Console reports as "Indexed, though blocked by robots.txt". Worse, a crawler
// forbidden from fetching the page can never read a noindex tag on it, so the
// two settings actively cancel out. Allow the crawl, refuse the index.
//
// `follow: true` because the sign-in page links back into the site and there is
// no reason to dead-end that equity.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
