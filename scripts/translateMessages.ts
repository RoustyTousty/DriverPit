import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { LOCALES, LOCALE_NAMES, type Locale } from "../lib/i18n/locales";
import {
  batchKeys,
  flatten,
  planTranslation,
  sourceHash,
  unflatten,
  validateTranslation,
  type FlatCatalogue,
  type Manifest,
  type NestedCatalogue,
  type TranslateMode,
} from "./translationPlan";

// Regenerates messages/{es,pt,it,nl,de}.json from messages/en.json.
//
// WHY THIS EXISTS: the five non-English catalogues were hand-written once and
// had already drifted into byte-identical copies of English before anyone
// noticed -- six URLs of the same page under a full hreflang set, which is worse
// for search than not translating at all. A generated catalogue cannot drift:
// English is the only file a human edits, and every run reconciles the rest.
//
// TWO THINGS MAKE MACHINE TRANSLATION SAFE TO SHIP HERE, and neither is the
// model choice:
//
//  1. EVERY RETURNED STRING IS RE-PARSED as ICU and compared to its English
//     source (translationPlan.ts). A translation that mangles `{driver}` or
//     translates a plural keyword is rejected and the previous text is kept, so
//     the failure mode is a stale string rather than a crash on a live page.
//  2. IT IS INCREMENTAL. A manifest records the English each translation was
//     made from, so a run after a one-word edit re-translates one key. Cost
//     tracks edits, not catalogue size.
//
// Google's spam guidance singles out machine-translated text published WITHOUT
// human review. This script is the drafting step, not the publishing decision --
// the generated diff is meant to be read before it is committed, which is also
// why the output is deterministically ordered.

const MESSAGES_DIR = join(process.cwd(), "messages");
const MANIFEST_PATH = join(MESSAGES_DIR, ".translations.json");
const SOURCE_LOCALE = "en";

// Model and batching. `claude-opus-5` because the job is instruction-following
// under a hard structural constraint (preserve ICU exactly, keep proper nouns,
// avoid gendered agreement) rather than bulk throughput -- the constraint is the
// whole reason this is an LLM call and not a translation API, which cannot be
// told any of it.
const MODEL = "claude-opus-5";
const BATCH_SIZE = 25;
const MAX_TOKENS = 16000;

/** Locale-specific notes for things a general instruction gets wrong here. */
const LOCALE_NOTES: Partial<Record<Locale, string>> = {
  pt: "Use Brazilian Portuguese — it is the overwhelming majority of Portuguese speakers, and the catalogue serves every Portuguese market.",
  de: "Use the informal 'du' — the site addresses players directly.",
  nl: "Use the informal 'je' — the site addresses players directly.",
};

/**
 * The rules the translator must not break, cached across every batch.
 *
 * Each line is here because breaking it produces a specific defect that has
 * either already happened in this repo or would be invisible until a player
 * reported it.
 */
function systemPrompt(): string {
  return [
    "You translate UI strings for DriverPit, a daily Formula 1 driver guessing game.",
    "You return translations only. You never explain, apologise, or add commentary.",
    "",
    "RULES, in order of how much damage breaking them does:",
    "",
    "1. ICU MESSAGE SYNTAX IS PRESERVED EXACTLY. Placeholders like {driver}, {count}",
    "   or {date} are code: never translate, rename, reorder the spelling of, or",
    "   remove one. Plural blocks keep their exact structure and English keywords —",
    "   `{wins, plural, one {...} other {...}}` stays `plural`, `one`, `other`. The `#`",
    "   symbol inside a plural block is the number and stays as `#`. You may add a",
    "   plural category the target language needs, and drop one it does not.",
    "",
    "2. PROPER NOUNS ARE NEVER TRANSLATED: 'DriverPit', driver names, team and",
    "   constructor names (Ferrari, Red Bull, McLaren), 'Formula 1', 'F1', 'Grand Prix'",
    "   where it names the event. 'Lewis Hamilton' is what a Spanish speaker searches.",
    "",
    "3. NO GENDERED AGREEMENT FOR DRIVERS. The roster includes female drivers, so a",
    "   masculine past participle or pronoun is wrong, not merely unidiomatic. Prefer",
    "   a construction that avoids the choice — reword rather than pick a gender.",
    "",
    "4. MATCH THE REGISTER: plain, concise, direct. This is game UI, not marketing.",
    "   Keep roughly the length of the English — these strings sit in fixed layouts.",
    "",
    "5. Preserve leading and trailing whitespace exactly. Some strings are sentence",
    "   fragments joined to others, and a lost leading space runs two words together.",
    "",
    "If a string is a brand name or an untranslatable token, return it unchanged.",
  ].join("\n");
}

interface TranslationItem {
  key: string;
  english: string;
  /** Sibling English keys are not sent; the key path is the context that matters. */
}

/** Structured output: the model must return one entry per requested key. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          text: { type: "string" },
        },
        required: ["key", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
} as const;

function readCatalogue(locale: string): NestedCatalogue | null {
  const path = join(MESSAGES_DIR, `${locale}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as NestedCatalogue;
}

function readManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) return {};
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

/**
 * Ask the model for one batch.
 *
 * Structured outputs rather than "reply with JSON": the schema is enforced by
 * the API, so a malformed reply is impossible and there is no brittle parser
 * here to drift. The system prompt is cached — it is identical for every batch
 * of every locale, and re-billing it per batch is the one obvious waste.
 */
async function translateBatch(
  client: Anthropic,
  locale: Locale,
  items: TranslationItem[],
): Promise<Map<string, string>> {
  const note = LOCALE_NOTES[locale];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA }, effort: "medium" },
    messages: [
      {
        role: "user",
        content: [
          `Translate these DriverPit UI strings into ${LOCALE_NAMES[locale]} (${locale}).`,
          note ? `${note}` : "",
          "",
          "Return one entry per key, with the key unchanged.",
          "",
          JSON.stringify({ strings: items.map((i) => ({ key: i.key, text: i.english })) }, null, 1),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const parsed = extractJson(response);
  const out = new Map<string, string>();
  for (const entry of parsed.translations) out.set(entry.key, entry.text);
  return out;
}

interface TranslationsPayload {
  translations: { key: string; text: string }[];
}

function extractJson(response: Anthropic.Message): TranslationsPayload {
  // `stop_reason` is checked before the content is read: a refusal returns a
  // 200 with empty content, and indexing into it would throw a TypeError that
  // says nothing about what happened.
  if (response.stop_reason === "refusal") {
    throw new Error("the model declined this batch (stop_reason: refusal)");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(`batch truncated at max_tokens — lower BATCH_SIZE (currently ${BATCH_SIZE})`);
  }
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no text block in response");
  return JSON.parse(block.text) as TranslationsPayload;
}

async function main() {
  // Mode comes from the environment and the flag lives inside the package.json
  // script, never forwarded by the caller: PowerShell drops a bare `--`, so a
  // script whose safe behaviour depends on a forwarded flag silently does the
  // dangerous thing. Same shape, same reason, as `db:seed`.
  const commit = process.argv.includes("--commit");
  const mode: TranslateMode = process.env.I18N_RETRANSLATE === "all" ? "all" : "stale";

  console.log(`Mode: ${commit ? "REAL WRITE" : "DRY RUN (plan only, no API calls)"}`);
  console.log(`Scope: ${mode === "all" ? "every key (I18N_RETRANSLATE=all)" : "new and changed keys"}\n`);

  const source = readCatalogue(SOURCE_LOCALE);
  if (!source) throw new Error(`missing messages/${SOURCE_LOCALE}.json`);
  const english = flatten(source);
  const englishKeys = Object.keys(english);

  const existing: Partial<Record<Locale, FlatCatalogue>> = {};
  const manifest = readManifest();
  const plans = planTranslation(
    english,
    Object.fromEntries(
      // Derived, never a second copy of the list: locales.ts is the only
      // place that knows which locales exist, and a hardcoded list here
      // would silently skip any locale added after this line was written.
      LOCALES.filter((locale) => locale !== SOURCE_LOCALE).map((locale) => {
        const catalogue = readCatalogue(locale);
        const flat = catalogue ? flatten(catalogue) : {};
        existing[locale] = flat;
        return [locale, flat];
      }),
    ),
    manifest,
    mode,
  );

  const totalWork = plans.reduce((n, p) => n + p.translate.length, 0);
  for (const plan of plans) {
    const bits = [`${plan.translate.length} to translate`, `${plan.current} current`];
    if (plan.remove.length > 0) bits.push(`${plan.remove.length} to remove`);
    console.log(`  ${plan.locale.padEnd(6)} ${bits.join(", ")}`);
  }
  console.log(`\n${englishKeys.length} keys in English; ${totalWork} translations needed.`);

  if (!commit) {
    console.log("\nDry run — nothing written and no API calls made.");
    console.log("Run `npm run i18n:translate:commit` to translate and write.");
    return;
  }

  if (totalWork === 0 && plans.every((p) => p.remove.length === 0)) {
    console.log("\nEverything is already up to date.");
    return;
  }

  // Fails closed, and says which variable. A translation run that silently did
  // nothing would look exactly like one that had nothing to do.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — refusing to run.\n" +
        "  Add it to .env (it is gitignored) or export it for this shell.",
    );
  }

  const { parse } = await import("@formatjs/icu-messageformat-parser");
  const client = new Anthropic();
  let rejected = 0;

  for (const plan of plans) {
    const flat = { ...(existing[plan.locale] ?? {}) };
    for (const key of plan.remove) delete flat[key];

    const localeManifest = { ...(manifest[plan.locale] ?? {}) };
    for (const key of plan.remove) delete localeManifest[key];

    if (plan.translate.length > 0) {
      const batches = batchKeys(plan.translate, BATCH_SIZE);
      for (const [index, batch] of batches.entries()) {
        process.stdout.write(
          `\r  ${plan.locale.padEnd(6)} batch ${index + 1}/${batches.length}…   `,
        );
        const items = batch.map((key) => ({ key, english: english[key] }));
        const result = await translateBatch(client, plan.locale, items);

        for (const key of batch) {
          const text = result.get(key);
          if (text === undefined) {
            console.warn(`\n    ! ${key}: no translation returned — keeping previous`);
            rejected++;
            continue;
          }
          const check = validateTranslation(parse, english[key], text);
          if (!check.ok) {
            // Kept, not written. A stale string is a far smaller problem than
            // one that throws when a page renders it.
            console.warn(`\n    ! ${key}: ${check.reason} — keeping previous`);
            rejected++;
            continue;
          }
          flat[key] = text;
          localeManifest[key] = sourceHash(english[key]);
        }
      }
      process.stdout.write("\r");
    }

    // Written in ENGLISH'S key order so the diff is readable and stable.
    writeFileSync(
      join(MESSAGES_DIR, `${plan.locale}.json`),
      `${JSON.stringify(unflatten(flat, englishKeys), null, 2)}\n`,
      "utf8",
    );
    manifest[plan.locale] = localeManifest;
    console.log(`  ${plan.locale.padEnd(6)} written (${Object.keys(flat).length} keys)`);
  }

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`\nDone.${rejected > 0 ? ` ${rejected} string(s) rejected and left unchanged.` : ""}`);
  console.log("Read the diff before committing — these are machine translations.");
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
