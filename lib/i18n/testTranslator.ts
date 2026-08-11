import { createTranslator } from "next-intl";

import en from "../../messages/en.json";
import type { Locale } from "./locales";

// A real ICU translator over the real catalogue, for the two pure summary
// generators' unit tests.
//
// It exists rather than a stub returning its own key because of what those
// suites assert: they read the finished PROSE and check that no driver is named
// twice, that a claim matches its sample, and that "1 time" is not printed for a
// single podium. A stub would satisfy every one of those against a catalogue
// with broken plurals or a missing key, which is the opposite of the point --
// the generators pick sentence shapes, and the shapes are only half the sentence
// now that the words live in messages/*.json.
//
// `createTranslator` is next-intl's own renderer, so plural categories, number
// formatting and escaping behave exactly as they do in a request. Anything this
// resolves, the running app resolves.

/** Locale catalogues, loaded lazily so a test only pays for what it asks for. */
const CATALOGUES: Partial<Record<Locale, Record<string, unknown>>> = { en };

/**
 * A `SummaryTranslator` for one namespace — structurally what both generators
 * take, without either of them importing next-intl.
 *
 * Deliberately NOT typed against next-intl's message generic: these keys are
 * assembled at runtime (`career.titles.${tense}`), so a compile-time key union
 * would reject the very call shape under test. A missing key still fails loudly
 * at runtime, which is where the suites read the output anyway.
 */
export function summaryTranslator(
  namespace: string,
  locale: Locale = "en",
  messages: Record<string, unknown> = CATALOGUES[locale] ?? en,
): (key: string, values?: Record<string, string | number>) => string {
  const translate = createTranslator({
    locale,
    messages: messages as Parameters<typeof createTranslator>[0]["messages"],
    namespace,
  });

  return (key, values) =>
    (translate as unknown as (k: string, v?: Record<string, string | number>) => string)(
      key,
      values,
    );
}
