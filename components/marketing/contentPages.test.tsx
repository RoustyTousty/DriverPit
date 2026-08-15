import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AboutSection } from "./AboutSection";
import { ContactSection } from "./ContactSection";
import { Faq } from "./Faq";
import { GameModes } from "./GameModes";
import { HowToPlay } from "./HowToPlay";
import { PrivacyPolicy } from "./PrivacyPolicy";
import { StrategyGuide } from "./StrategyGuide";
import { TermsOfService } from "./TermsOfService";

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
  // Added 2026-08-15. The FAQ was the gap in this list and the most expensive
  // one to have: its prose is not written inline but looked up from FAQ_KEYS
  // (lib/marketing/faqContent.ts), so a key added to that array with no matching
  // message renders the dotted path as the QUESTION -- and the same array feeds
  // the page's FAQPage JSON-LD, so the broken string is also published as
  // structured data. Two of the five below already cover components whose keys
  // are inline; this one covers the only list where the keys and the prose live
  // in different files and can drift apart.
  ["Faq", () => <Faq />],
  // The remaining three full-page components, added with the h1 assertion
  // below. Each is rendered by exactly one route and by nothing else, so the
  // heading it emits IS that page's heading.
  ["GameModes", () => <GameModes />],
  ["PrivacyPolicy", () => <PrivacyPolicy />],
  ["TermsOfService", () => <TermsOfService />],
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

  it("contributes exactly one h1, and it is not empty", () => {
    // Bing's SEO report, 2026-08-15: /faq, /about, /how-to-play, /game-modes
    // and both legal pages shipped with NO h1 at all -- their top heading was
    // an h2, so every one of these documents began at level 2 with nothing
    // above it. /strategy and /contact were correct, which is what made it
    // invisible: the two components written most recently used h1 and the
    // older six did not, so no single file looked wrong.
    //
    // Nothing else in this repo can see it. `tsc` does not type heading levels,
    // lint has no rule for it, and the page renders identically either way --
    // the h2 and h1 here carry the same className precisely so the fix changed
    // no pixels. It is only observable in the delivered markup and to a screen
    // reader's heading navigation.
    const { container } = render(renderComponent());
    const h1s = container.querySelectorAll("h1");

    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
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
