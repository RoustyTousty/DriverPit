// Avatar rendering -- profiles.avatar_url holds a DiceBear seed string, not
// a real asset path (no upload/Storage path exists). Rendered via the "clay"
// style (dicebear.com/styles/clay) -- soft 3D-ish character heads, with no
// baked-in background, so they sit inside our own surface tile (see
// AvatarGlyph). Any string is a valid seed (DiceBear hashes it), so seeds
// chosen under the previous style -- and old "preset-N" values from before this
// avatar system -- still render fine with no backfill needed. That is the whole
// reason a style swap is a one-line change: the column stores the seed, never
// the picture.
//
// `clay` needs @dicebear/core >= 10.4: its animation component uses a style
// schema 10.3 rejects outright (StyleValidationError at construction, which is
// module scope here -- so it would take the whole page down, not just the
// avatar). If core is ever pinned back, the style has to go back with it.
import { Avatar, Style } from "@dicebear/core";
import clay from "@dicebear/styles/clay.json" with { type: "json" };

// One Style instance shared across every render (e.g. a full leaderboard
// list) instead of re-parsing the style definition per avatar.
const style = new Style(clay);

export function renderAvatarSvg(seed: string): string {
  return new Avatar(style, { seed }).toString();
}

// Curated seeds shown by default in the avatar picker grid -- racing/energy
// themed so the picker reads as intentional rather than a bag of random
// hashes. DiceBear's seed space is effectively unlimited; the picker's
// "Shuffle" control generates fresh random seeds beyond this list.
export const CURATED_AVATAR_SEEDS: string[] = [
  "Apex", "Blaze", "Comet", "Delta", "Ember", "Flux", "Grid", "Havoc",
  "Ignite", "Jetstream", "Kilo", "Lumen", "Mach", "Nova", "Orbit", "Pace",
  "Quantum", "Rally", "Surge", "Torque",
];

export function randomAvatarSeed(): string {
  return crypto.randomUUID().slice(0, 8);
}
