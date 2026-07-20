// Avatar rendering -- profiles.avatar_url holds a DiceBear seed string, not
// a real asset path (no upload/Storage path exists). Rendered via the
// "bottts-neutral" style (dicebear.com/styles/bottts-neutral, MIT-licensed
// remix of Pablo Stanley's Bottts) -- robot characters with no baked-in
// background, meant to sit inside our own colored circle (see
// AvatarGlyph). Any string is a valid seed (DiceBear hashes it), so old
// "preset-N" values from before this avatar system still render fine with
// no backfill needed.
import { Avatar, Style } from "@dicebear/core";
import botttsNeutral from "@dicebear/styles/bottts-neutral.json" with { type: "json" };

// One Style instance shared across every render (e.g. a full leaderboard
// list) instead of re-parsing the style definition per avatar.
const style = new Style(botttsNeutral);

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
