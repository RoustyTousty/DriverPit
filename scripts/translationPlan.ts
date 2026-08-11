import { createHash } from "node:crypto";

import { LOCALES, type Locale } from "../lib/i18n/locales";

// The pure half of `npm run i18n:translate` -- change detection and the ICU
// validator. It lives apart from the runner for the reason `rosterPlan.ts` does:
// everything decision-shaped is testable without an API key, a network, or a
// bill, and the runner is left holding only I/O.
//
// THE SOURCE OF TRUTH IS `messages/en.json`. Every other catalogue is generated
// from it. That is what makes the translations maintainable rather than five
// files somebody has to remember to hand-edit -- which is exactly how they came
// to be byte-identical copies of English in the first place.

/** A catalogue flattened to dotted keys, which is the shape everything here works in. */
export type FlatCatalogue = Record<string, string>;

/** Arbitrarily nested JSON message catalogue, as it exists on disk. */
export type NestedCatalogue = { [key: string]: string | NestedCatalogue };

export function flatten(catalogue: NestedCatalogue, prefix = ""): FlatCatalogue {
  const out: FlatCatalogue = {};
  for (const [key, value] of Object.entries(catalogue)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

/**
 * The inverse, and it preserves ENGLISH'S KEY ORDER rather than the order the
 * translations happen to arrive in. A generated file that reshuffles itself on
 * every run produces a diff nobody can read, which is how a real change hides.
 */
export function unflatten(flat: FlatCatalogue, order: readonly string[]): NestedCatalogue {
  const out: NestedCatalogue = {};
  for (const path of order) {
    const value = flat[path];
    if (value === undefined) continue;
    const parts = path.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (typeof next === "string" || next === undefined) node[part] = {};
      node = node[part] as NestedCatalogue;
    }
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

/**
 * Fingerprint of the ENGLISH text a translation was made from.
 *
 * Keyed on the source rather than on the translation, because the question the
 * manifest answers is "is this translation still current?" -- and the only thing
 * that can make it stale is the English changing.
 */
export function sourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/** locale -> key -> hash of the English source it was translated from. */
export type Manifest = Partial<Record<Locale, Record<string, string>>>;

export type TranslateMode = "stale" | "all";

export interface LocalePlan {
  locale: Locale;
  /** Keys to send to the translator. */
  translate: string[];
  /** Keys present in the locale but no longer in English -- deleted, not kept. */
  remove: string[];
  /** Keys already current. Reported so a no-op run says so out loud. */
  current: number;
}

/**
 * What each locale needs.
 *
 * A key is translated when it is missing, when the English it was made from has
 * changed, or when the caller asked for everything. That last mode is the one
 * that regenerates a hand-written catalogue wholesale.
 *
 * `remove` is deliberately separate from `translate`: deleting a key costs
 * nothing and must happen even on a run where nothing is translated, or a
 * renamed key leaves its old translation behind forever and the catalogues drift
 * out of parity with English -- the exact failure the parity check catches late.
 */
export function planTranslation(
  english: FlatCatalogue,
  existing: Partial<Record<Locale, FlatCatalogue>>,
  manifest: Manifest,
  mode: TranslateMode,
): LocalePlan[] {
  const englishKeys = Object.keys(english);

  return LOCALES.filter((locale) => locale !== "en").map((locale) => {
    const have = existing[locale] ?? {};
    const seen = manifest[locale] ?? {};

    const translate = englishKeys.filter((key) => {
      if (mode === "all") return true;
      if (have[key] === undefined) return true;
      return seen[key] !== sourceHash(english[key]);
    });

    return {
      locale,
      translate,
      remove: Object.keys(have).filter((key) => english[key] === undefined),
      current: englishKeys.length - translate.length,
    };
  });
}

// --- ICU validation -------------------------------------------------------
//
// The half that makes machine translation safe to ship. A translator that
// helpfully renders `{driver}` as `{conductor}`, or translates the `one`/`other`
// plural keywords, produces a string that either throws at render time or
// silently prints a placeholder name at the reader. Neither is acceptable in a
// generated file nobody reads before it ships, so every returned string is
// re-parsed and compared against its English source.

/** Minimal shape of the parser's AST -- typed here so `any` never enters. */
interface IcuNode {
  type: number;
  value?: string;
  options?: Record<string, { value: IcuNode[] }>;
  children?: IcuNode[];
}

type IcuParse = (message: string) => IcuNode[];

/**
 * Every argument name the message references, at any depth.
 *
 * The NAMES are what must match, not the structure: a translator is allowed to
 * reorder clauses, drop a plural category English needed, or add one English
 * did not (Polish needs `few`; Spanish does not need English's split). What it
 * is never allowed to do is invent, drop or rename a placeholder, because that
 * is the interface the calling code passes values through.
 */
export function placeholderNames(nodes: IcuNode[]): Set<string> {
  const names = new Set<string>();
  const walk = (list: IcuNode[]) => {
    for (const node of list) {
      // type 0 is literal text and carries a `value` that is not an argument
      // name -- the guard is what keeps prose out of the placeholder set.
      if (node.type !== 0 && typeof node.value === "string") names.add(node.value);
      if (node.children) walk(node.children);
      if (node.options) for (const option of Object.values(node.options)) walk(option.value);
    }
  };
  walk(nodes);
  return names;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Is `translated` a safe replacement for `english`?
 *
 * Rejects on unparseable ICU and on any placeholder difference. A rejected
 * string is never written: the runner keeps whatever was there before and
 * reports the key, so a bad translation degrades to a stale one rather than to a
 * crash on someone's archive page.
 */
export function validateTranslation(
  parse: IcuParse,
  english: string,
  translated: string,
): ValidationResult {
  if (translated.trim() === "") return { ok: false, reason: "empty" };

  let englishNodes: IcuNode[];
  let translatedNodes: IcuNode[];
  try {
    englishNodes = parse(english);
  } catch (error) {
    // The English itself is broken -- worth failing loudly rather than blaming
    // the translation for it.
    return { ok: false, reason: `source is not valid ICU: ${describe(error)}` };
  }
  try {
    translatedNodes = parse(translated);
  } catch (error) {
    return { ok: false, reason: `not valid ICU: ${describe(error)}` };
  }

  const want = placeholderNames(englishNodes);
  const got = placeholderNames(translatedNodes);

  const missing = [...want].filter((name) => !got.has(name));
  const extra = [...got].filter((name) => !want.has(name));
  if (missing.length > 0 || extra.length > 0) {
    const parts = [
      missing.length > 0 ? `dropped {${missing.join("}, {")}}` : "",
      extra.length > 0 ? `invented {${extra.join("}, {")}}` : "",
    ].filter(Boolean);
    return { ok: false, reason: `placeholder mismatch: ${parts.join("; ")}` };
  }

  return { ok: true };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Split a key list into batches.
 *
 * Batched rather than one request per key because the per-request overhead
 * dominates at ~200 short strings, and rather than one request for everything
 * because a single malformed reply would then cost the whole run. The batch is
 * also the unit of retry.
 */
export function batchKeys(keys: readonly string[], size: number): string[][] {
  if (size < 1) throw new Error("batch size must be at least 1");
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += size) batches.push(keys.slice(i, i + size));
  return batches;
}
