import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

// Locale-aware replacements for `next/link` and `next/navigation`. Everything
// in this repo stores routes UNPREFIXED ("/faq", "/online") -- the sitemap's
// list, the footer's, `buildPageMetadata`'s `path` -- and these add the current
// locale's prefix at render time. That is the whole reason to use them rather
// than `next/link`: a hard-coded `/faq` inside a Spanish page is a link out of
// the locale, and it fails silently because the page it lands on is a real page.
//
// `Link` here is the one imported by components. `redirect` is the one used by
// `/daily`'s 308. `usePathname` returns the pathname WITHOUT the locale prefix,
// which is what makes `ModeTabs`' active-tab test keep working unchanged.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
