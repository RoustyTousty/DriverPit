import type { FaqEntry } from "@/lib/seo/structuredData";

// The full FAQ, as data rather than as JSX inside the component that renders it.
//
// It moved out of components/marketing/Faq.tsx so /faq can emit FAQPage
// structured data built from the SAME source it renders visibly. Google's
// structured-data guidelines require the markup to match the visible content,
// and the only honest way to guarantee that is one source rather than two to
// remember. Pass 7 made that constraint sharper rather than looser: with six
// locales, "the visible content" is now a different string per locale and the
// markup has to follow it, so both sides take the same translator.
//
// What lives here is the ORDER and the KEYS; the prose lives in
// messages/*.json under `faq.items`. A key is a stable slug and never the
// question text -- a reworded question must not orphan five translations.
//
// FaqTeaser deliberately keeps its own shorter list and is NOT folded in here.
// Its answers are rewritten short for the home page rather than truncated (see
// CLAUDE.md, "Site architecture"), so it is different content and not a subset
// -- and the structured data belongs on the full page regardless.
// "knockout" was here and was dropped on 2026-08-12, with the mode's entries on
// the home teaser, /game-modes and the /online landing. A question answering
// "What is Knockout mode?" is the strongest form of the thing AdSense rejected
// the site for -- it is a whole FAQ entry, emitted as FAQPage structured data,
// about a mode that does not exist and cannot be reached from anywhere. Its
// copy is still in the catalogues under `faq.items.knockout`, so restoring it is
// putting the key back in this list.
export const FAQ_KEYS = [
  // First because it is the question someone arrives with, and deliberately
  // phrased as the comparison people actually search for.
  //
  // "Wordle" is a New York Times trademark and appears NOWHERE else in this
  // app's copy -- CLAUDE.md's SEO section records that removal (2026-08-06) and
  // the reason for it. This one entry is a considered exception, reinstated
  // 2026-08-15 with the risk accepted explicitly, and the FORM is what makes it
  // defensible rather than a reversal of that decision: it is nominative use --
  // naming another product to describe how this one compares -- inside an answer
  // that states the differences and disclaims affiliation outright. That is a
  // materially different act from putting "F1 Wordle" in a <title>, which uses
  // the mark as a source identifier for our own product and is the form the
  // takedowns cited in CLAUDE.md were aimed at.
  //
  // So the rule going forward is about SHAPE, not count: the word may appear
  // where this site is being compared to Wordle and says it is not Wordle. It
  // must not appear in a title, an og:title, a heading, or anywhere it reads as
  // branding. If this ever needs a second placement, the home page's FaqTeaser
  // (its own keys, components/marketing/FaqTeaser.tsx) is the next one to use,
  // in the same comparative form.
  "wordleLike",
  "dailyReset",
  "unknownDriver",
  "teamMeaning",
  "shading",
  "ageBasis",
  "driverCode",
  "pool",
  "multiplayer",
  "personalData",
  "accountNeeded",
  "duelRating",
  "duelSpam",
  "ads",
  "profile",
] as const;

export type FaqKey = (typeof FAQ_KEYS)[number];

/**
 * Minimal shape of a next-intl translator scoped to the `faq` namespace. Typed
 * structurally rather than as next-intl's own generic so this module stays
 * importable from both the server and client trees without pulling a runtime in.
 */
type FaqTranslator = (key: string) => string;

export function faqEntries(t: FaqTranslator): FaqEntry[] {
  return FAQ_KEYS.map((key) => ({
    q: t(`items.${key}.q`),
    a: t(`items.${key}.a`),
  }));
}
