import { ImageResponse } from "next/og";

import { PALETTE } from "@/lib/game/palette";
import { loadOgFonts } from "@/lib/seo/ogFonts";
import { OG_IMAGE, SITE_NAME } from "@/lib/seo/site";

// The site-wide social card, inherited by every page that does not set its own.
//
// Before this, the site had no OG image at all -- every link shared to Discord,
// X, WhatsApp or Slack rendered as a bare blue line of text. The obvious
// stopgap, pointing at `public/driverpit-banner.png`, would have been wrong:
// that is the 720x240 wordmark the top bar draws, and a card slot is roughly
// 1.91:1, so it would arrive letterboxed in grey bars. Generating the card
// instead means the size is right by construction and it can show the game
// rather than the logo.
//
// Satori, not a browser: flexbox only (no grid, no floats), every element with
// more than one child needs an explicit `display: flex`, and there are no CSS
// variables -- hence PALETTE. Keep the markup boring; a layout that renders in
// Chrome is not evidence it renders here.

// Derived from OG_IMAGE rather than typed out again: `buildPageMetadata` emits
// og:image:width/height from those numbers, and a card that renders at one size
// while the tags declare another is a crop or a letterbox on every share.
export const alt = OG_IMAGE.alt;
export const size = { width: OG_IMAGE.width, height: OG_IMAGE.height };
export const contentType = "image/png";

// The five columns of the real board, in order, with a plausible spread of
// verdicts -- one exact, one historical, two ordered near-misses, one miss. A
// reader who has never seen the game learns the whole mechanic from this row,
// which is the only job the card has that copy cannot do.
const TILES: { label: string; value: string; fill: string; glyph?: string }[] = [
  { label: "NATIONALITY", value: "NED", fill: PALETTE.correct },
  { label: "TEAM", value: "RED BULL", fill: PALETTE.miss },
  { label: "AGE", value: "28", fill: PALETTE.miss, glyph: "▲" },
  { label: "DEBUT", value: "2015", fill: PALETTE.miss, glyph: "▼" },
  { label: "WINS", value: "63", fill: PALETTE.correct },
];

// The orange overlay a near-miss carries on the real board. Drawn as a second
// absolutely-positioned layer rather than as a blended colour so the tile shades
// exactly the way GuessGrid's does.
const CLOSENESS: Record<string, number> = { AGE: 0.55, DEBUT: 0.3 };

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: PALETTE.bg,
          padding: "64px 72px",
          fontFamily: "Geist",
        }}
      >
        {/* Wordmark. The square orange mark is the logo's one use of accent, and
            keeping it here is most of what makes a shared link recognisable at
            thumbnail size. */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: PALETTE.accent,
              marginRight: 18,
            }}
          />
          <div style={{ fontSize: 40, fontWeight: 700, color: PALETTE.text, letterSpacing: -0.5 }}>
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 68,
              fontWeight: 700,
              color: PALETTE.text,
              lineHeight: 1.1,
              letterSpacing: -2,
              maxWidth: 900,
            }}
          >
            Guess the mystery F1 driver in six tries
          </div>

          <div style={{ display: "flex", marginTop: 40 }}>
            {TILES.map((tile) => {
              const closeness = CLOSENESS[tile.label] ?? 0;
              return (
                <div
                  key={tile.label}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    width: 196,
                    height: 96,
                    marginRight: 16,
                    borderRadius: 10,
                    backgroundColor: tile.fill,
                  }}
                >
                  {closeness > 0 ? (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        borderRadius: 10,
                        backgroundColor: PALETTE.accent,
                        opacity: 0.12 + closeness * 0.56,
                      }}
                    />
                  ) : null}
                  <div
                    style={{
                      fontFamily: "Geist Mono",
                      fontSize: 15,
                      fontWeight: 700,
                      color: PALETTE.text,
                      opacity: 0.65,
                      letterSpacing: 1.2,
                    }}
                  >
                    {tile.label}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      fontFamily: "Geist Mono",
                      fontSize: 28,
                      fontWeight: 700,
                      color: PALETTE.text,
                      marginTop: 4,
                    }}
                  >
                    {tile.glyph ? <span style={{ marginRight: 8 }}>{tile.glyph}</span> : null}
                    {tile.value}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 28, color: PALETTE.textMuted }}>
            Daily puzzle · Unlimited practice · Real-time 1v1 duels
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: PALETTE.accent }}>Free to play</div>
        </div>
      </div>
    ),
    { ...size, fonts: await loadOgFonts() },
  );
}
