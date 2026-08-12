import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AboutSection } from "./AboutSection";
import { ContactSection } from "./ContactSection";
import { HowToPlay } from "./HowToPlay";
import { StrategyGuide } from "./StrategyGuide";

// A MISSING MESSAGE KEY IS INVISIBLE TO EVERY OTHER CHECK IN THIS REPO, and
// these four components are where that matters most.
//
// `tsc` cannot see it: `t("definitionsHeading")` is a string argument, so a
// typo, a key that was never added to the catalogue, or a section renamed in
// TypeScript but not in JSON all type-check cleanly. `npm run lint` cannot see
// it either. And next-intl does not throw on one -- it logs and renders the
// FULL KEY PATH in place of the sentence, so the page still returns 200 with
// "marketing.strategy.sections.opening.p3" sitting in the middle of a
// paragraph. Nobody reads their own marketing pages often enough to catch that.
//
// The risk is concentrated here because these pages are mostly prose: the
// strategy guide alone reads ~40 keys, and the /contact and /strategy routes
// plus the two expanded sections were all added in one pass (2026-08-12) to
// answer an AdSense "low value content" rejection. A page that ships a raw key
// path is worse for that purpose than the thin page it replaced.
//
// So this asserts the property rather than the strings: every key these
// components ask for resolves. It is deliberately not a copy test -- the words
// are meant to be edited freely, and a test that pins sentences would be
// deleted the first time somebody improved one.

const KEY_PATH_SHAPE = /\b(marketing|meta|nav)\.[a-zA-Z]+\.[a-zA-Z.]+/;

let errors: unknown[][];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything the component actually rendered, as one string. */
function renderedText(container: HTMLElement): string {
  return container.textContent ?? "";
}

describe.each([
  ["StrategyGuide", () => <StrategyGuide />],
  ["ContactSection", () => <ContactSection />],
  ["HowToPlay", () => <HowToPlay />],
  ["AboutSection", () => <AboutSection />],
])("%s", (_name, renderComponent) => {
  it("resolves every message key it asks for", () => {
    const { container } = render(renderComponent());
    const text = renderedText(container);

    // The rendered-output half. next-intl's default fallback is the full dotted
    // key, so a leaked one is visible in the DOM as literal text.
    const leaked = text.match(KEY_PATH_SHAPE);
    expect(leaked?.[0] ?? null).toBeNull();

    // The console half, which catches a key that resolved to an empty string —
    // invisible in the DOM but still a missing message.
    const missing = errors.filter((args) =>
      args.some((arg) => String(arg).includes("MISSING_MESSAGE")),
    );
    expect(missing).toEqual([]);
  });

  it("renders real prose rather than an empty shell", () => {
    // The control case, and it is not optional: without it, "no key path
    // leaked" passes perfectly for a component that rendered nothing at all,
    // which is exactly what an early return or a bad conditional would produce.
    const { container } = render(renderComponent());

    expect(renderedText(container).length).toBeGreaterThan(400);
  });
});

describe("ContactSection", () => {
  it("shows the contact address as a working mailto", () => {
    // The one string here worth pinning literally. This page exists so a reader
    // — and an AdSense reviewer — can reach the owner, and a contact page whose
    // address is missing or unlinked has failed at the only job it has.
    const { container } = render(<ContactSection />);

    const mailto = container.querySelector('a[href^="mailto:"]');
    expect(mailto).not.toBeNull();
    expect(mailto?.getAttribute("href")).toContain("driverpit.inc@gmail.com");
    expect(mailto?.textContent).toBe("driverpit.inc@gmail.com");
  });

  it("links only to profiles that exist", () => {
    // The footer's four `href="#"` social icons were part of what AdSense
    // flagged as misleading navigation. This page lists the same profiles, so
    // it gets the same guard: no placeholder hrefs, ever.
    const { container } = render(<ContactSection />);

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("#");
    expect(hrefs.every((href) => href && href.trim() !== "")).toBe(true);
  });
});
