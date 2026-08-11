import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo/site";

// There was no robots.txt at all, which is not the same as an empty one: with no
// file, crawlers guess at what to fetch and there is nowhere to advertise the
// sitemap. Next generates this at /robots.txt from the export below.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Only `/api/*`: endpoints, not pages, and nothing links to them.
        //
        // `/auth/*` is deliberately NOT here even though none of it should be
        // indexed. Those pages carry `noindex` from app/auth/layout.tsx instead,
        // and the two mechanisms do not stack -- a crawler forbidden from
        // fetching a page can never read the noindex on it, while the URL can
        // still be indexed contentless from its inbound links. /auth/sign-in has
        // six of those. Allow the crawl, refuse the index.
        disallow: ["/api/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
