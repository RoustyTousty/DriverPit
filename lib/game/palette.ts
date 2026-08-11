// The design tokens as literal hex, for the renderers that cannot read CSS.
//
// `app/globals.css` is the authority for anything the browser paints, via the
// `--surface` / `--accent` / … custom properties and Tailwind's `@theme`. Two
// renderers here are outside that: the share-image canvas
// (`lib/game/shareImage.ts`, which draws into a bitmap) and Satori
// (`app/opengraph-image.tsx` and anything else built with `next/og`, which takes
// a CSS subset with no variable resolution). Both need the same colours as
// numbers.
//
// This file exists so there are TWO copies of the palette in the repo -- this
// one and globals.css -- rather than one per renderer, which is what was
// starting to happen. Change a token in globals.css, change it here.
export const PALETTE = {
  bg: "#0b0d10",
  surface: "#14181d",
  surface2: "#1c222a",
  border: "#262c35",
  text: "#e7eaee",
  textMuted: "#8a929e",
  accent: "#ff6a00",
  accentWeak: "#3a2418",
  correct: "#2e7d46",
  miss: "#2a2f37",
} as const;
