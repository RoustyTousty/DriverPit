import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COUNTRY_CODES } from "@/lib/game/flags";

import { Flag } from "./Flag";

// Audit 2026-07-30 §1.4 residual. The flag stylesheet is now a generated
// 40-country subset (app/flag-icons.subset.css) rather than the whole package,
// which puts a new seam in the app: the class `Flag` builds has to be a class
// the subset defines. Nothing type-checks that -- `fi-${code}` is a template
// string -- and the failure is silent, an empty span where a flag should be.
//
// jsdom applies no stylesheet, so this reads the generated CSS directly and
// asserts the join. Written to fail first, confirmed by deleting `.fi-gb` from
// the subset (the coverage test below fails, naming United Kingdom) and by
// changing `Flag` to emit `fis` (the same test fails for all 40).

// Off `cwd` (vitest's, i.e. the repo root) rather than `import.meta.url`: in the
// jsdom project that is an http: URL, and `fileURLToPath` rejects it.
const subsetCss = readFileSync(path.resolve("app/flag-icons.subset.css"), "utf8");

/** The classes the subset can actually back. */
const defined = new Set([
  ...[...subsetCss.matchAll(/^\.(fi[a-z0-9-]*)\s*[{:]/gm)].map((m) => m[1]),
]);

function classesOf(element: Element): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}

describe("Flag", () => {
  it("renders a labelled icon for a mapped nationality", () => {
    render(<Flag nationality="United Kingdom" />);

    const flag = screen.getByRole("img", { name: "United Kingdom flag" });
    // The name, not the code: "gb" is meaningless read aloud, and the tile's
    // meaning has to exist in text rather than only in the background image.
    expect(classesOf(flag)).toEqual(expect.arrayContaining(["fi", "fi-gb"]));
  });

  it("keeps the caller's className alongside its own", () => {
    render(<Flag nationality="Italy" className="text-2xl" />);

    expect(classesOf(screen.getByRole("img", { name: "Italy flag" }))).toEqual(
      expect.arrayContaining(["fi", "fi-it", "text-2xl"]),
    );
  });

  it("renders nothing at all for an unmapped nationality", () => {
    // Not an empty `fi` span: that is a sized, empty box where the roster holds
    // an F1DB slug or a country the map has not caught up with.
    const { container } = render(<Flag nationality="united-states-of-america" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("only ever emits classes the generated subset defines", () => {
    for (const nationality of Object.keys(COUNTRY_CODES)) {
      const { container, unmount } = render(<Flag nationality={nationality} />);
      const flag = container.firstElementChild;
      expect(flag, `${nationality} rendered no flag`).not.toBeNull();

      for (const className of classesOf(flag!)) {
        expect(
          defined.has(className),
          `${nationality} renders .${className}, which app/flag-icons.subset.css does not define ` +
            "-- run `npm run flags:subset`",
        ).toBe(true);
      }
      unmount();
    }
  });
});
