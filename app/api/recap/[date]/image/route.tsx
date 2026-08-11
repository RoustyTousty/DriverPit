import { ImageResponse } from "next/og";

import { RecapCard } from "@/components/recap/RecapCard";
import { getDailyRecap } from "@/lib/db/dailyRecap";
import { parseRecapFormat } from "@/lib/recap/format";
import { loadOgFonts } from "@/lib/seo/ogFonts";

// The daily recap as a PNG: `/api/recap/2026-07-31/image?format=portrait|wide`.
//
// Portrait (1080x1350) is the default and the poster -- the best Instagram
// size, and fine on Reddit and Bluesky. Wide (1200x630) is the link-preview
// card Pass 3's archive page will point its og:image at.
//
// A route handler rather than a page-level `opengraph-image.tsx` because the
// portrait poster has no page of its own to hang off: it is an asset a human
// downloads and posts. Pass 3 adds the archive route's own opengraph-image,
// which renders the SAME component at `wide` rather than reimplementing it.

// next/og needs the Node runtime here twice over: Satori reads the fonts off
// disk, and getDailyRecap goes through the Drizzle postgres connection. Neither
// works on edge. (Node is already the default for route handlers -- this is a
// note against someone "optimising" it later, not a change.)
export const runtime = "nodejs";

const DIMENSIONS = {
  portrait: { width: 1080, height: 1350 },
  wide: { width: 1200, height: 630 },
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const recap = await getDailyRecap(date);

  // getDailyRecap returns null for a malformed date, an unknown one, and one
  // that is not over yet -- the three cases are deliberately indistinguishable
  // from out here. In particular this route can never be asked about today:
  // that check lives in SQL against the database clock, not here.
  if (!recap) {
    return new Response("Not found", { status: 404 });
  }

  const format = parseRecapFormat(new URL(request.url).searchParams.get("format"));

  return new ImageResponse(<RecapCard recap={recap} format={format} />, {
    ...DIMENSIONS[format],
    fonts: await loadOgFonts(),
    headers: {
      // A finished day is frozen: daily_submit_guess only ever writes today's
      // row, so nothing behind this image can change again. Cache it like the
      // static asset it effectively is.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
