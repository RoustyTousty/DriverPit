import { describe, expect, it } from "vitest";

import { CURATED_AVATAR_SEEDS, randomAvatarSeed, renderAvatarSvg } from "./avatars";

// Two properties of the avatar renderer, both of which are promises to the
// player rather than facts about the code.

describe("renderAvatarSvg", () => {
  it("renders a static SVG for every curated seed", () => {
    // The `clay` style SHIPS an animation component: an `animation-none` variant
    // and a `fastest` one that injects a <style> block with @keyframes. `fastest`
    // carries `weight: 0`, so DiceBear never selects it -- which is the only
    // reason these avatars are still, and is exactly the kind of thing a
    // @dicebear/styles bump can flip without a word in a changelog.
    //
    // It matters twice over: the site's design rules allow no ambient loops
    // (CLAUDE.md, "Surface, spacing, motion"), and avatars appear in a
    // leaderboard list a dozen at a time -- so a weight change would put a
    // dozen looping animations on screen at once.
    const seeds = [...CURATED_AVATAR_SEEDS, ...Array.from({ length: 60 }, () => randomAvatarSeed())];

    for (const seed of seeds) {
      const svg = renderAvatarSvg(seed);
      expect(svg).toContain("<svg");
      expect(svg).not.toContain("<style");
      expect(svg).not.toContain("keyframes");
      expect(svg).not.toContain("<animate");
    }
  });

  it("renders any string, so a seed chosen under an older style still works", () => {
    // profiles.avatar_url stores the SEED, never the picture, which is what
    // makes a style swap a one-line change with no backfill. These two values
    // predate the current style; both must still render.
    for (const legacy of ["preset-3", "Apex"]) {
      expect(renderAvatarSvg(legacy)).toContain("<svg");
    }
  });
});
