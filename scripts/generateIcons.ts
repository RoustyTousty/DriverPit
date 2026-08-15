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
// So the rule this file encodes: EVERY ICON IS OPAQUE, and every icon keeps its
// content inside a centred circle of 80% diameter -- the maskable safe zone
// Android crops to, and near enough what Google's circular treatment leaves.
//
// There is deliberately NO CI test diffing the output, unlike the flag subset.
// sharp's resampling is not byte-stable across libvips versions, so such a test
// would fail on a runner upgrade rather than on a real change -- and unlike the
// flag list, nothing routinely triggers a regeneration. Run it when the brand
// artwork changes: `npm run icons:generate`.

const REPO = join(__dirname, "..");
const BANNER = join(REPO, "public/driverpit-banner.png");

/**
 * The orange "PIT" inside the banner, measured rather than guessed
 * (`sharp().raw()` over the alpha and the accent hue).
 *
 * The grey bracket that frames it in the full lockup is deliberately LEFT OUT.
 * It is a ~4%-of-height hairline, so below about 48px it stops being a frame and
 * becomes a grey haze around the letters -- rendered at 16px, the size a desktop
 * results row actually uses, the bracketed version reads as a grey box with an
 * orange smudge in it while the letters alone still read as "PIT". The icon's
 * job at that size is to be a distinct, high-contrast signature, and the frame
 * works against it.
 */
const PIT_MARK = { left: 494, top: 59, width: 193, height: 124 };

/**
 * Mark width as a fraction of the canvas.
 *
 * 0.66 is not a taste call, it is the largest value that fits this mark's
 * aspect ratio inside the 80% safe circle: at 512px the mark is 338x217, whose
 * half-diagonal is 201px against the circle's 205px radius. Push it to 0.74 and
 * the outer stems of the P and the T sit outside the circle and get shaved off
 * on Android and in mobile search results.
 */
const MARK_SCALE = 0.66;

const BG = PALETTE.bg;

/**
 * One opaque square: the dark tile with the mark centred on it.
 *
 * `keepAlphaChannel` decides whether the file keeps a (fully opaque) alpha
 * channel or drops it, and BOTH answers are load-bearing somewhere:
 *
 *   - The PNGs embedded in the `.ico` MUST keep it. Next builds that file
 *     through Turbopack, whose ICO decoder is Rust's `image` crate, and that
 *     decoder rejects a non-RGBA embedded PNG outright -- "Format error decoding
 *     Ico: The PNG is not in RGBA format!", which fails the whole page, not just
 *     the icon. (Measured: stripping the channel 500s every route in dev.)
 *   - `apple-icon.png` should drop it. Apple's touch-icon guidance is that the
 *     image carries no transparency, and iOS composites onto black.
 *
 * `flatten` is what makes the image opaque either way -- it composites the
 * transparent pixels onto the background. `removeAlpha` only decides whether the
 * now-redundant channel is still written.
 */
async function tile(size: number, keepAlphaChannel = true): Promise<Buffer> {
  const target = Math.round(size * MARK_SCALE);
  const mark = await sharp(BANNER)
    .extract(PIT_MARK)
    .resize({ width: target, fit: "inside" })
    .toBuffer();
  const { width = target, height = target } = await sharp(mark).metadata();

  const composed = sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: mark, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }])
    .flatten({ background: BG });

  return (keepAlphaChannel ? composed : composed.removeAlpha())
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
  // 512 for `icon.png`: it is what the manifest declares, and Android wants a
  // 512 source for the install splash.
  const icon = await tile(512);
  writeFileSync(join(REPO, "app/icon.png"), icon);

  // 180 is the size iOS asks for and the one it uses without resampling. The
  // one file that drops its alpha channel -- see `tile`.
  writeFileSync(join(REPO, "app/apple-icon.png"), await tile(180, false));

  const ico = buildIco(
    await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await tile(size) }))),
  );
  writeFileSync(join(REPO, "app/favicon.ico"), ico);

  for (const file of ["app/icon.png", "app/apple-icon.png", "app/favicon.ico"]) {
    const bytes = readFileSync(join(REPO, file));
    console.log(`${file.padEnd(22)} ${String(bytes.length).padStart(7)} bytes`);
  }
  console.log(`\nmark ${PIT_MARK.width}x${PIT_MARK.height} from the banner, at ${MARK_SCALE * 100}% of each canvas, on ${BG}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
