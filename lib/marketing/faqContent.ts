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
export const FAQ_KEYS = [
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
  "knockout",
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
