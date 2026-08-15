import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { PALETTE } from "../lib/game/palette";

// Generates every app icon from one source: public/driverpit-banner.png.
//
// WHY THESE ARE GENERATED AND NOT DRAWN. The three files this writes were, until
// 2026-08-13, a single byte-identical PNG copied to three names, and each copy
// was wrong for the slot it sat in:
//
//   - `icon.png` was 49% TRANSPARENT and clipped to the edge of the canvas
//     (content bbox 0,39 -> 511,472 in a 512x512 image). Google Search renders a
//     favicon on a WHITE results page, so the light-grey half of the mark
//     vanished into the background and the orange half floated on its own --
//     which is the "washed out" look, and it is not fixable by choosing a
//     different orange. The clipping is the second half: Google's mobile results
//     put the favicon in a CIRCLE, so an edge-to-edge mark loses its corners.
//   - `apple-icon.png` carried the same alpha channel. iOS composites a touch
//     icon onto BLACK and applies its own rounded-rectangle mask, and Apple's
//     guidance is explicit that the image must be opaque -- transparency there
//     produces a smear, not a transparent icon.
//   - `favicon.ico` was a PNG with an `.ico` extension. Its first four bytes
//     were `89 50 4E 47`; a real ICO begins `00 00 01 00`. Browsers sniff and
//     cope, but it was never the multi-resolution container the name promises.
//
// The rule this file encoded until 2026-08-15 was "EVERY ICON IS OPAQUE". That
// was too broad, and it cost the browser tab: an opaque tile renders as a BLACK
// BOX in a light tab strip, next to everyone else's transparent marks. Opacity
// is still right for three of the four outputs, but not for the favicon:
//
//   An opaque tile is not the only way to keep a light-grey mark visible on a
//   white page, and it is the way that breaks the tab. Padding does it too: the
//   lockup sits at MARK_SCALE inside the canvas, so the frame is a bounded shape
//   on the page's own background rather than a mark bleeding into it. The orange
//   letters carry the contrast at every size; the grey frame is the part that
//   goes quiet on white, and it is the frame, not the icon, that is optional.
//
// So the rule now: EVERY ICON KEEPS ITS CONTENT INSIDE A CENTRED CIRCLE OF 80%
// DIAMETER -- the maskable safe zone Android crops to, and near enough what
// Google's circular mobile treatment leaves -- and each output is opaque only
// where its consumer demands it:
//
//   favicon.ico        TRANSPARENT -- browser tabs, and Google's results row
//   icon.png           TRANSPARENT -- manifest `purpose: any`, <link rel=icon>
//   icon-maskable.png  OPAQUE      -- manifest `purpose: maskable`; Android
//                                     crops it to a shape, and a transparent
//                                     maskable icon gets a white circle behind
//                                     it, which is the bug this file began with
//   apple-icon.png     OPAQUE      -- Apple's guidance is explicit; iOS
//                                     composites onto black and transparency
//                                     there produces a smear
//
// There is deliberately NO CI test diffing the output, unlike the flag subset.
// sharp's resampling is not byte-stable across libvips versions, so such a test
// would fail on a runner upgrade rather than on a real change -- and unlike the
// flag list, nothing routinely triggers a regeneration. Run it when the brand
// artwork changes: `npm run icons:generate`.

const REPO = join(__dirname, "..");
const BANNER = join(REPO, "public/driverpit-banner.png");

/**
 * The bracketed "PIT" lockup inside the banner -- the grey frame AND the orange
 * letters -- measured rather than guessed (`sharp().raw()` over the alpha).
 *
 * CHOSEN BY THE OWNER, 2026-08-15, over the letters-only crop this used before
 * (`{ left: 494, top: 59, width: 193, height: 124 }`). The argument for dropping
 * the frame stands and is worth keeping written down: it is a ~4%-of-height
 * hairline, so below about 48px it stops reading as a frame and becomes a grey
 * haze around the letters -- at 16px, the size a desktop results row actually
 * uses, the bracketed mark reads as a grey box with an orange smudge in it,
 * while the letters alone still read as "PIT".
 *
 * That is a legibility trade, not a correctness one, and the brand is the
 * owner's call. To revert, restore the crop above and set MARK_SCALE back
 * to 0.66.
 */
const LOCKUP_MARK = { left: 493, top: 24, width: 227, height: 192 };

/**
 * Mark width as a fraction of the canvas. THERE ARE TWO, and which one an
 * output gets depends on one question: does its consumer crop to a circle?
 *
 * `SAFE_SCALE` (0.58) is bounded by the 80% safe circle that Android's maskable
 * crop and Google's MOBILE results leave. This lockup is 227x192 (aspect 1.18),
 * so at 512px and 0.58 it renders 297x251, whose half-diagonal is 194px against
 * the circle's 205px radius. Measured at the alternatives: 0.60 gives 201px
 * (fits, 4px of margin) and 0.66 gives 221px -- CLIPPED. The frame is squarer
 * than the bare letters were, so it eats more of the corner budget, which is why
 * the letters-only crop's old 0.66 could not simply be carried over to it.
 *
 * `TAB_SCALE` (0.80) is for the sizes a BROWSER TAB actually renders, where
 * there is no circular crop and 0.58 is simply wasted padding -- the mark reads
 * as too small beside every other favicon in the strip. 0.80 is chosen to put
 * the ORANGE LETTERS back at the size they were before the frame was added:
 * they occupy 193/227 of the lockup's width, so 0.80 x 193/227 = 0.68 of the
 * canvas, against the 0.66 the letters-only crop gave. Same visual weight,
 * frame included.
 */
const SAFE_SCALE = 0.58;
const TAB_SCALE = 0.8;

const BG = PALETTE.bg;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

interface TileOptions {
  /** Fill the square with BG. False leaves it transparent — see the header. */
  opaque?: boolean;
  /** Mark width as a fraction of the canvas. See SAFE_SCALE / TAB_SCALE. */
  scale?: number;
  /**
   * Whether the file keeps an alpha channel. Only meaningful when `opaque`,
   * since a transparent tile obviously needs one, and BOTH answers are
   * load-bearing somewhere:
   *
   *   - The PNGs embedded in the `.ico` MUST keep it. Next builds that file
   *     through Turbopack, whose ICO decoder is Rust's `image` crate, and that
   *     decoder rejects a non-RGBA embedded PNG outright -- "Format error
   *     decoding Ico: The PNG is not in RGBA format!", which fails the whole
   *     page, not just the icon. (Measured: stripping the channel 500s every
   *     route in dev.)
   *   - `apple-icon.png` should drop it. Apple's touch-icon guidance is that
   *     the image carries no transparency, and iOS composites onto black.
   */
  keepAlphaChannel?: boolean;
}

/** One square: the mark centred on either the dark tile or nothing. */
async function tile(
  size: number,
  { opaque = true, keepAlphaChannel = true, scale = SAFE_SCALE }: TileOptions = {},
): Promise<Buffer> {
  const target = Math.round(size * scale);
  const mark = await sharp(BANNER)
    .extract(LOCKUP_MARK)
    .resize({ width: target, fit: "inside" })
    .toBuffer();
  const { width = target, height = target } = await sharp(mark).metadata();

  let composed = sharp({
    create: { width: size, height: size, channels: 4, background: opaque ? BG : TRANSPARENT },
  }).composite([
    { input: mark, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) },
  ]);

  // `flatten` is what makes the image opaque -- it composites the transparent
  // pixels onto the background. Skipped entirely for a transparent tile, where
  // it would undo the whole point.
  if (opaque) composed = composed.flatten({ background: BG });

  return (opaque && !keepAlphaChannel ? composed.removeAlpha() : composed)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * A real multi-resolution `.ico`, assembled by hand because sharp cannot write
 * one.
 *
 * The entries carry PNG payloads, which every browser released this decade
 * reads and which keeps the file a fraction of the size of the equivalent BMPs.
 * 48px is in here because Google Search asks for a favicon that is a multiple of
 * 48 -- `icon.png` is 512 for the manifest's sake, so this is where that
 * guidance is actually satisfied.
 */
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, png }, index) => {
    const at = index * 16;
    // 0 means 256 in an ICO directory; nothing here is that big, but the
    // encoding is the reason the field is a single byte.
    directory[at] = size >= 256 ? 0 : size;
    directory[at + 1] = size >= 256 ? 0 : size;
    directory[at + 2] = 0; // palette colours
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

async function main() {
  // 512 for `icon.png`: it is what the manifest declares for `purpose: any`,
  // and what a <link rel="icon"> points at. TRANSPARENT, so it sits on the
  // browser's own surface rather than punching a dark hole in it.
  writeFileSync(join(REPO, "app/icon.png"), await tile(512, { opaque: false }));

  // The maskable twin, and the one file that must stay opaque and full-bleed:
  // Android crops it to the launcher's shape, and a transparent maskable icon
  // is placed on a white circle. In `public/` rather than `app/` deliberately --
  // Next's file convention claims `app/icon*.png` and would publish this as a
  // second <link rel="icon">, which is exactly the black box being removed.
  writeFileSync(join(REPO, "public/icon-maskable.png"), await tile(512));

  // 180 is the size iOS asks for and the one it uses without resampling. Opaque
  // and alpha-free, per Apple's guidance -- see `tile`.
  //
  // TAB_SCALE, not SAFE_SCALE: iOS masks a touch icon to a ROUNDED RECTANGLE,
  // not a circle, and that clips far less of the corners -- so the circle budget
  // does not apply and 0.58 would just be a small mark adrift on a dark tile.
  writeFileSync(
    join(REPO, "app/apple-icon.png"),
    await tile(180, { keepAlphaChannel: false, scale: TAB_SCALE }),
  );

  // THE ICO IS WHERE "a different icon for the tab than for Google" ACTUALLY
  // HAPPENS, and it is done by SIZE rather than by file, because there is no way
  // to address the two consumers separately -- both read the same
  // <link rel="icon"> set, so a second file would just be a second candidate
  // either of them might pick.
  //
  // What can be relied on is which SIZE each one reaches for:
  //
  //   16 and 32  a browser tab, at 1x and 2x. No circular crop, so these get
  //              TAB_SCALE and fill the square.
  //   48         what Google asks for ("a multiple of 48px square"). Google's
  //              mobile results crop to a circle, so this one keeps SAFE_SCALE.
  //
  // The hedge is deliberate: if Google reaches for the 48 entry it gets the
  // circle-safe mark, and if a high-DPI tab reaches for it instead the only cost
  // is one slightly smaller icon -- never a clipped one. Both failure modes are
  // survivable, which is the most that can be promised here.
  const ico = buildIco(
    await Promise.all([
      ...[16, 32].map(async (size) => ({
        size,
        png: await tile(size, { opaque: false, scale: TAB_SCALE }),
      })),
      { size: 48, png: await tile(48, { opaque: false }) },
    ]),
  );
  writeFileSync(join(REPO, "app/favicon.ico"), ico);

  for (const file of [
    "app/icon.png",
    "public/icon-maskable.png",
    "app/apple-icon.png",
    "app/favicon.ico",
  ]) {
    const bytes = readFileSync(join(REPO, file));
    console.log(`${file.padEnd(26)} ${String(bytes.length).padStart(7)} bytes`);
  }
  console.log(
    `\nmark ${LOCKUP_MARK.width}x${LOCKUP_MARK.height} (bracket + PIT) from the banner` +
      `\n  transparent  favicon.ico, icon.png` +
      `\n  opaque ${BG}  icon-maskable.png, apple-icon.png` +
      `\n  ${TAB_SCALE * 100}% (no circular crop)  ico 16/32, apple-icon` +
      `\n  ${SAFE_SCALE * 100}% (circle-safe)      ico 48, icon.png, icon-maskable.png`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
