import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Fonts for anything rendered with `next/og` (Satori). Shared rather than
// inlined in the one caller because the daily-recap cards will want exactly
// these three, and three copies of a font-loading path is three chances for one
// of them to point at a file that is no longer traced into the bundle.
//
// WHY THE FILES ARE COMMITTED under `app/fonts/` instead of read out of
// `node_modules/geist`: Satori needs raw font bytes, and Next's file tracing
// follows static imports, not a `readFile` of a path it cannot evaluate. A path
// into `node_modules` therefore works locally and 404s on Vercel, where the
// function bundle contains only what was traced. `next.config.ts` names these
// three files in `outputFileTracingIncludes` for the same reason -- keep the two
// in step if a weight is added here.
//
// TTF, not the WOFF2 the browser gets from `geist/font`: Satori reads ttf/otf
// and (unreliably) woff, never woff2.

const FONT_DIR = join(process.cwd(), "app", "fonts");

export interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

/**
 * Geist Sans at two weights plus Geist Mono bold — the same pairing the site
 * uses (display/UI in sans, data and tiles in mono, per CLAUDE.md's typography
 * rules), so a social card looks like a screenshot of the game rather than like
 * a template someone filled in.
 */
export async function loadOgFonts(): Promise<OgFont[]> {
  const [sansRegular, sansBold, monoBold] = await Promise.all([
    readFile(join(FONT_DIR, "Geist-Regular.ttf")),
    readFile(join(FONT_DIR, "Geist-Bold.ttf")),
    readFile(join(FONT_DIR, "GeistMono-Bold.ttf")),
  ]);

  return [
    { name: "Geist", data: sansRegular, weight: 400, style: "normal" },
    { name: "Geist", data: sansBold, weight: 700, style: "normal" },
    { name: "Geist Mono", data: monoBold, weight: 700, style: "normal" },
  ];
}
