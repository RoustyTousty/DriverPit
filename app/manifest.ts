import type { MetadataRoute } from "next";

import { PALETTE } from "@/lib/game/palette";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/site";

// Served at /manifest.webmanifest and linked automatically by Next.
//
// Makes the game installable, which is a retention feature first (a daily game
// on a home screen is a daily game that gets opened) and a quality signal
// second. It costs one small JSON file and no runtime code.
//
// A TypeScript route rather than a static public/manifest.json so the name,
// description and colours come from the same constants the pages and the OG
// card read. A manifest whose theme colour has drifted from globals.css is
// invisible until someone installs the app and gets a differently-coloured
// title bar, which is exactly the class of thing nobody checks.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — Daily F1 Driver Guessing Game`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    // The game, not the marketing. An installed app should open where you play,
    // and since Pass 5 that is the root -- pointing it at /daily would make
    // every cold launch of the installed app pay a redirect.
    start_url: "/",
    // Scoped to the whole site so following a link to /archive or /faq from
    // inside the installed app stays in it rather than kicking out to a browser
    // tab; anything else (an outbound link) still leaves, which is correct.
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // From lib/game/palette.ts, the literal-hex copy of the design tokens that
    // app/globals.css owns -- the same file the OG card and the share image
    // read, so there is one place to change a colour and three renderers that
    // follow. `background_color` is the splash screen (the page background),
    // `theme_color` the OS chrome.
    background_color: PALETTE.bg,
    theme_color: PALETTE.bg,
    categories: ["games", "sports", "entertainment"],
    icons: [
      // TWO files, not one declared twice, and the split is the point (2026-08-15).
      //
      // `any` is the icon as drawn, and it is TRANSPARENT: the same file backs
      // <link rel="icon">, so an opaque tile here renders as a black box in a
      // light browser tab strip next to everyone else's transparent marks.
      //
      // `maskable` must be the opposite -- opaque and full-bleed -- because
      // Android crops it to the launcher's shape and puts a transparent
      // maskable icon on a white circle. One file cannot satisfy both, which is
      // why the previous version of this list had to pick one and got the tab
      // wrong. Both come out of `npm run icons:generate`.
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
