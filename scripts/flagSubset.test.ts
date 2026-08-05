import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { COUNTRY_CODES } from "../lib/game/flags";
import {
  assertFlagAssetsExist,
  assetUrl,
  buildFlagSubsetCss,
  extractBaseRules,
  readFlagIconsVersion,
  readUpstreamCss,
  subsetCodes,
  SUBSET_CSS_PATH,
} from "./flagSubset";

// Audit 2026-07-30 §1.4 residual. `app/flag-icons.subset.css` is generated, and
// a generated file that nobody regenerates is worse than no generator at all --
// the failure mode is a nationality whose flag silently does not render, which
// is exactly what the "Show flags" setting exists to produce.
//
// So the checked-in file is diffed against a fresh build on every static run.
// That covers both drift directions in one assertion: a nationality added to
// COUNTRY_CODES, and a bumped `flag-icons` whose base rules or url layout moved.
//
// Written to fail first, confirmed by deleting the `.fi-gb` rule from the
// checked-in file (both the regeneration diff and the coverage test below fail)
// and by adding a fake nationality to COUNTRY_CODES (same two).

const subsetCss = readFileSync(SUBSET_CSS_PATH, "utf8");

// `core.autocrlf=true` is set on the machine this was written on, so the working
// copy can hold CRLF where the repo holds LF. What is pinned is the CSS, not
// which bytes the checkout wrote for a newline.
const normalize = (css: string) => css.replace(/\r\n/g, "\n");

/** Every `.fi-<code>` the stylesheet defines a background for. */
function definedCodes(css: string): string[] {
  return [...css.matchAll(/^\.fi-([a-z0-9-]+)\s*\{/gm)].map((m) => m[1]).sort();
}

describe("app/flag-icons.subset.css", () => {
  it("is what the generator produces right now", () => {
    const regenerated = buildFlagSubsetCss(readUpstreamCss(), readFlagIconsVersion());
    expect(
      normalize(subsetCss),
      "app/flag-icons.subset.css is stale -- run `npm run flags:subset`",
    ).toBe(normalize(regenerated));
  });

  it("defines a rule for every code COUNTRY_CODES maps, and for no others", () => {
    // The point of the whole change: 40 countries, not flag-icons' ~250 x 2.
    expect(definedCodes(subsetCss)).toEqual(subsetCodes());
  });

  it("points every rule at an SVG that exists on disk", () => {
    const urls = [...subsetCss.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls).toHaveLength(subsetCodes().length);

    const cssDir = path.dirname(SUBSET_CSS_PATH);
    const missing = urls.filter((url) => !existsSync(path.resolve(cssDir, url)));
    expect(missing, "url() with no file behind it -- the flag would render as nothing").toEqual([]);
  });

  it("styles the bare `fi` class every rendered flag carries", () => {
    // Without it the span has no width, no background sizing and no `content`,
    // so a correct `.fi-gb` still renders nothing.
    expect(subsetCss).toMatch(/^\.fi\s*\{/m);
    expect(subsetCss).toMatch(/^\.fi:before\s*\{/m);
  });

  it("ships no `fis` or `fib` selector, since it ships no rule to back one", () => {
    // Only the 4x3 rules are emitted. Keeping upstream's `.fi.fis { width: 1em }`
    // would leave a square variant that renders a letterboxed 4x3 flag.
    expect(subsetCss).not.toMatch(/\.fis\b/);
    expect(subsetCss).not.toMatch(/\.fib\b/);
  });
});

describe("buildFlagSubsetCss", () => {
  const upstream = readUpstreamCss();
  const version = readFlagIconsVersion();

  it("fails loudly when upstream stops shipping a mapped country", () => {
    // The dangerous upgrade: the package still installs, the stylesheet still
    // parses, and one nationality quietly loses its flag. Guessing past it is
    // the same mistake as `?? id` in the seed's reference-table joins.
    const withoutBritain = upstream.replace(
      /\.fi-gb \{\s*background-image: url\(\.\.\/flags\/4x3\/gb\.svg\);\s*\}/,
      "",
    );
    expect(withoutBritain).not.toBe(upstream);
    expect(() => buildFlagSubsetCss(withoutBritain, version)).toThrow(/fi-gb/);
  });

  it("fails loudly when the stylesheet has no country rules at all", () => {
    expect(() => buildFlagSubsetCss(".fi { display: inline-block; }", version)).toThrow(/format has changed/);
  });

  it("records the installed flag-icons version, so a bump has to be looked at", () => {
    expect(buildFlagSubsetCss(upstream, "9.9.9")).toContain("flag-icons@9.9.9");
  });
});

describe("extractBaseRules", () => {
  it("keeps upstream's rules verbatim, minus the variant selectors", () => {
    const base = extractBaseRules(
      [
        ".fib, .fi {\n  background-size: contain;\n}\n",
        "\n.fi {\n  display: inline-block;\n}\n",
        ".fi.fis {\n  width: 1em;\n}\n",
        "\n.fi-ad {\n  background-image: url(../flags/4x3/ad.svg);\n}\n",
      ].join(""),
    );

    expect(base).toBe(
      ".fi {\n  background-size: contain;\n}\n\n.fi {\n  display: inline-block;\n}",
    );
  });

  it("refuses a base block that no longer styles a bare `.fi`", () => {
    expect(() => extractBaseRules(".fis {\n  width: 1em;\n}\n.fi-ad {\n  background-image: url(x);\n}")).toThrow(
      /bare `\.fi`/,
    );
  });
});

describe("subsetCodes", () => {
  it("covers every nationality COUNTRY_CODES maps", () => {
    const codes = subsetCodes();
    for (const [nationality, code] of Object.entries(COUNTRY_CODES)) {
      expect(codes, `no rule would be emitted for ${nationality}`).toContain(code);
    }
  });

  it("names an asset path relative to the stylesheet, not to the repo root", () => {
    // A root-relative or bare-specifier url() would resolve differently (or not
    // at all) once the bundler inlines this file into globals.css.
    expect(assetUrl("gb")).toBe("../node_modules/flag-icons/flags/4x3/gb.svg");
  });

  it("has every asset on disk", () => {
    expect(() => assertFlagAssetsExist(subsetCodes())).not.toThrow();
    expect(() => assertFlagAssetsExist(["zz"])).toThrow(/zz/);
  });
});
