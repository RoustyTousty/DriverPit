import { describe, expect, it } from "vitest";

import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { FAQ_KEYS, faqEntries } from "@/lib/marketing/faqContent";

import en from "../../messages/en.json";
import { SITE_URL } from "./site";
import {
  breadcrumbJsonLd,
  driverPersonJsonLd,
  faqPageJsonLd,
  videoGameJsonLd,
  websiteJsonLd,
} from "./structuredData";

// The catalogues are imported rather than stubbed so the FAQ assertions run over
// the prose that actually ships. A stubbed translator would pass just as happily
// against a catalogue missing every answer, which is the failure this file is
// best placed to catch.
const CATALOGUES: Record<Locale, { faq: Record<string, unknown> }> = {
  en,
  es: await import("../../messages/es.json").then((m) => m.default),
  pt: await import("../../messages/pt.json").then((m) => m.default),
  it: await import("../../messages/it.json").then((m) => m.default),
  nl: await import("../../messages/nl.json").then((m) => m.default),
  de: await import("../../messages/de.json").then((m) => m.default),
};

/** A translator over one locale's `faq` namespace, dotted-key like next-intl's. */
function faqTranslator(locale: Locale) {
  return (key: string): string => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        CATALOGUES[locale].faq,
      );
    if (typeof value !== "string") throw new Error(`missing faq.${key} in ${locale}`);
    return value;
  };
}

const ENTRIES = faqEntries(faqTranslator("en"));

const TRAIL = [
  { name: "Home", path: "/" },
  { name: "Archive", path: "/archive" },
  { name: "31 July 2026", path: "/archive/2026-07-31" },
];

const DRIVER = {
  fullName: "Lewis Hamilton",
  nationality: "United Kingdom",
  locale: "en" as Locale,
  path: "/drivers/lewis-hamilton",
  jobTitle: "Formula One driver",
  birthDate: "1985-01-07",
  deathDate: null,
};

const DESCRIPTION = "Guess the Formula 1 driver.";

/** Every block, built for one locale — the argument list is the thing that drifts. */
function allBlocks(locale: Locale) {
  return [
    websiteJsonLd(locale, DESCRIPTION),
    videoGameJsonLd(locale, DESCRIPTION),
    faqPageJsonLd(faqEntries(faqTranslator(locale))),
    breadcrumbJsonLd(locale, TRAIL),
    driverPersonJsonLd({ ...DRIVER, locale }),
  ];
}

// Structured data fails silently by design: a malformed block is ignored by the
// consumer and nothing on the page changes, so the only way to know it broke is
// to check it. These assert the contract each block has to satisfy to be read at
// all, not its prose.
describe("structured data", () => {
  it("gives every block a context and a type", () => {
    for (const block of allBlocks("en")) {
      expect(block["@context"]).toBe("https://schema.org");
      expect(typeof block["@type"]).toBe("string");
    }
  });

  it("serializes to valid JSON", () => {
    // The blocks are emitted with JSON.stringify into a script body; an
    // undefined or circular value would produce something a parser rejects and
    // the whole block would be dropped without a word.
    for (const block of allBlocks("en")) {
      expect(() => JSON.parse(JSON.stringify(block))).not.toThrow();
    }
  });

  it("declares the game as free and multiplayer", () => {
    // The two claims that make this site distinguishable from the other F1
    // guessing games in a search result, so they are the two worth pinning.
    const game = videoGameJsonLd("en", DESCRIPTION);
    expect(game.playMode).toEqual(["SinglePlayer", "MultiPlayer"]);
    expect(game.offers).toMatchObject({ price: "0" });
  });

  it("never claims a rating", () => {
    // Fabricated review markup is a manual-action offence, and this is the
    // property somebody would reach for to get stars in a result. There are no
    // ratings to report; if that ever changes they must come from real ones.
    //
    // The driver block is the one where this stops being only a policy
    // question: it describes a real, named, mostly-living person, so a
    // fabricated score on it would be a claim about someone who never asked to
    // be scored.
    for (const block of [videoGameJsonLd("en", DESCRIPTION), driverPersonJsonLd(DRIVER)]) {
      expect(block).not.toHaveProperty("aggregateRating");
      expect(block).not.toHaveProperty("review");
    }
  });

  it("describes a driver as a Person with a Country nationality", () => {
    // `nationality` expects a Country entity; a bare string there is dropped
    // rather than reported, which is the silent-failure shape this whole suite
    // exists for.
    const person = driverPersonJsonLd(DRIVER);
    expect(person["@type"]).toBe("Person");
    expect(person.nationality).toEqual({ "@type": "Country", name: "United Kingdom" });
    expect(person.url).toBe(`${SITE_URL}/drivers/lewis-hamilton`);
  });

  it("omits deathDate for a living driver rather than emitting null", () => {
    // A null property is not "unknown" in JSON-LD -- a consumer reading one may
    // discard the property or the block. Absent is the correct way to say it.
    expect(driverPersonJsonLd(DRIVER)).not.toHaveProperty("deathDate");
    expect(driverPersonJsonLd({ ...DRIVER, deathDate: "1994-05-01" })).toHaveProperty(
      "deathDate",
      "1994-05-01",
    );
  });

  it("carries every visible FAQ entry, question and answer", () => {
    // Google requires the markup to match the visible content. Both sides read
    // the same keys through the same translator, so this checks the mapping
    // rather than the wording -- a dropped field or a renamed key is what would
    // actually go wrong.
    const faq = faqPageJsonLd(ENTRIES);
    const entities = faq.mainEntity;
    expect(Array.isArray(entities)).toBe(true);
    expect(entities).toHaveLength(ENTRIES.length);
    expect(entities).toMatchObject(
      ENTRIES.map((entry) => ({
        "@type": "Question",
        name: entry.q,
        acceptedAnswer: { "@type": "Answer", text: entry.a },
      })),
    );
  });

  it("numbers the breadcrumb from 1 with no gaps, and uses absolute URLs", () => {
    // Both are silently ignored rather than reported when wrong: a trail
    // starting at 0, or one whose `item` is site-relative, simply does not
    // render in a result and nothing says so.
    const crumbs = breadcrumbJsonLd("en", TRAIL).itemListElement;
    expect(Array.isArray(crumbs)).toBe(true);
    expect(crumbs).toMatchObject(
      TRAIL.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
      })),
    );
    for (const crumb of crumbs as { item: string }[]) {
      expect(crumb.item.startsWith(`${SITE_URL}/`) || crumb.item === SITE_URL).toBe(true);
    }
  });

  it("has no empty question or answer, in any locale", () => {
    for (const locale of LOCALES) {
      for (const entry of faqEntries(faqTranslator(locale))) {
        expect(entry.q.trim(), locale).not.toBe("");
        expect(entry.a.trim(), locale).not.toBe("");
      }
    }
  });
});

// Pass 7. Every one of these is a way for a localised page to keep claiming to
// be the English one -- which is worse than not translating it, because it tells
// a crawler six URLs are the same page.
describe("structured data is locale-aware", () => {
  it("declares the rendering locale as inLanguage", () => {
    for (const locale of LOCALES) {
      expect(websiteJsonLd(locale, DESCRIPTION).inLanguage, locale).toBe(locale);
      expect(videoGameJsonLd(locale, DESCRIPTION).inLanguage, locale).toBe(locale);
    }
  });

  it("points every URL at the locale's own prefix", () => {
    // `pt-BR` is the one that matters: it is advertised as `pt-BR` and served at
    // `/pt`, and its OG locale is still `pt_BR`, so neither is a mechanical
    // transformation of the other.
    expect(websiteJsonLd("es", DESCRIPTION).url).toBe(`${SITE_URL}/es`);
    expect(videoGameJsonLd("pt", DESCRIPTION).url).toBe(`${SITE_URL}/pt`);
    expect(driverPersonJsonLd({ ...DRIVER, locale: "de" }).url).toBe(
      `${SITE_URL}/de/drivers/lewis-hamilton`,
    );
  });

  it("keeps the default locale unprefixed, so Pass 5's URLs are unchanged", () => {
    expect(websiteJsonLd("en", DESCRIPTION).url).toBe(SITE_URL);
    expect(videoGameJsonLd("en", DESCRIPTION).url).toBe(SITE_URL);
  });

  it("keeps a localised breadcrumb inside its own locale", () => {
    // The breadcrumb is the one block whose items are navigational, so an
    // English trail on a Spanish page walks the reader out of the locale.
    const crumbs = breadcrumbJsonLd("it", TRAIL).itemListElement as { item: string }[];
    for (const crumb of crumbs) {
      expect(crumb.item.startsWith(`${SITE_URL}/it`)).toBe(true);
    }
  });

  it("never translates a driver's name", () => {
    // Proper nouns, in every locale -- "Lewis Hamilton" is what a Spanish
    // speaker searches. Same rule as the `drivers` table itself.
    for (const locale of LOCALES) {
      expect(driverPersonJsonLd({ ...DRIVER, locale }).name, locale).toBe("Lewis Hamilton");
    }
  });

  it("translates the FAQ prose it marks up", () => {
    // The markup must match the VISIBLE content, so a Spanish page emitting the
    // English answers is a guideline violation rather than a cosmetic gap. The
    // assertion is that the strings differ from English, not what they say.
    const english = faqEntries(faqTranslator("en"));
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const translated = faqEntries(faqTranslator(locale));
      expect(translated, locale).toHaveLength(FAQ_KEYS.length);
      expect(translated.some((entry, i) => entry.a !== english[i].a), locale).toBe(true);
    }
  });
});
