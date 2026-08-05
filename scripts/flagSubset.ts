// Audit 2026-07-30 §1.4 residual -- `flag-icons` on every route.
//
// `app/globals.css` used to `@import "flag-icons/css/flag-icons.min.css"`: the
// whole ~250-country stylesheet, in two aspect ratios, on every route including
// /about and the legal pages -- for a setting that is off by default
// (lib/settings/store.ts, `showFlags: false`). Measured against the last build
// output in `.next/`: 542 country rules, 36,486 of the built globals chunk's
// 91,717 bytes (15,247 -> 8,397 gzipped without them), and 514 SVGs / 5.1 MB
// emitted into `.next/static/media`.
//
// `lib/game/flags.ts` maps 40 nationalities, and `countryCode` returns null for
// everything else, so `components/ui/Flag.tsx` can only ever render 40 of those
// classes. This cuts the stylesheet to exactly those.
//
// Pure + fs helpers, no side effects at import, so `scripts/flagSubset.test.ts`
// can regenerate and diff the checked-in file in the static CI tier. That diff
// is the whole drift story: a nationality added to COUNTRY_CODES or a bumped
// `flag-icons` fails the suite until `npm run flags:subset` is re-run. A
// keep-in-sync comment would not have been enough -- the failure mode is a flag
// that silently does not render, which is what the setting exists to produce.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COUNTRY_CODES } from "../lib/game/flags";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export const UPSTREAM_CSS_PATH = path.join(
  repoRoot,
  "node_modules",
  "flag-icons",
  "css",
  "flag-icons.css",
);
export const UPSTREAM_PACKAGE_JSON_PATH = path.join(
  repoRoot,
  "node_modules",
  "flag-icons",
  "package.json",
);
export const FLAGS_4X3_DIR = path.join(repoRoot, "node_modules", "flag-icons", "flags", "4x3");
export const SUBSET_CSS_PATH = path.join(repoRoot, "app", "flag-icons.subset.css");

// url()s resolve relative to the stylesheet that contains them, so this is
// derived from where the generated file actually lands rather than typed out --
// move the file and the urls follow. posix separators: this string goes into
// CSS, not into a filesystem call.
const ASSET_PREFIX = path
  .relative(path.dirname(SUBSET_CSS_PATH), FLAGS_4X3_DIR)
  .split(path.sep)
  .join("/");

/**
 * The ISO codes the subset must cover: every distinct value in COUNTRY_CODES.
 *
 * Deduped defensively even though `flags.test.ts` pins that no two nationalities
 * share a code -- a duplicate here would emit the same rule twice rather than
 * fail, and that is the kind of thing a generator should not be able to do.
 */
export function subsetCodes(): string[] {
  return [...new Set(Object.values(COUNTRY_CODES))].sort();
}

export function readUpstreamCss(): string {
  return readFileSync(UPSTREAM_CSS_PATH, "utf8");
}

export function readFlagIconsVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(UPSTREAM_PACKAGE_JSON_PATH, "utf8"));
  const version =
    typeof pkg === "object" && pkg !== null && "version" in pkg ? (pkg as { version: unknown }).version : undefined;
  if (typeof version !== "string") {
    throw new Error(`No version in ${UPSTREAM_PACKAGE_JSON_PATH} -- is flag-icons installed?`);
  }
  return version;
}

/** The `url()` this file emits for one country, relative to the stylesheet. */
export function assetUrl(code: string): string {
  return `${ASSET_PREFIX}/${code}.svg`;
}

/**
 * A rule the sheet cannot back is worse than a class that does not exist, so the
 * asset behind every emitted rule is checked to be on disk before anything is
 * written. Same reason `assertColumns` lives inside `readCsv` in the seed: the
 * check that can be forgotten is the check that gets forgotten.
 */
export function assertFlagAssetsExist(codes: readonly string[]): void {
  const missing = codes.filter((code) => !existsSync(path.join(FLAGS_4X3_DIR, `${code}.svg`)));
  if (missing.length > 0) {
    throw new Error(
      `flag-icons ships no 4x3 SVG for: ${missing.join(", ")}. ` +
        `COUNTRY_CODES maps a nationality onto ${missing.length === 1 ? "it" : "them"}, so the flag would not render.`,
    );
  }
}

// Everything before the first country rule. `.fi-xx` (upstream's unknown-flag
// placeholder) is the first one, and it sorts before every real code.
const FIRST_COUNTRY_RULE = /^\.fi-[a-z]/m;

// One CSS rule: leading whitespace, a selector list, a body. Sufficient because
// flag-icons' output is flat -- no @media, no nesting, no braces in any value.
const RULE = /(\s*)([^{}]+?)\s*\{([^{}]*)\}/g;

/**
 * The base rules, taken from upstream verbatim except that selectors naming the
 * square (`fis`) or box (`fib`) variants are dropped.
 *
 * `Flag` renders `fi fi-<code>` and nothing in the repo uses either variant, so
 * their country rules are not emitted -- which would leave `.fi.fis { width: 1em }`
 * promising a square flag that renders as a letterboxed 4x3 one. Dropping the
 * selector is mechanical rather than a hand-edit of vendor CSS, so an upstream
 * restructure still shows up as a diff instead of being quietly preserved.
 */
export function extractBaseRules(upstreamCss: string): string {
  const firstCountry = upstreamCss.search(FIRST_COUNTRY_RULE);
  if (firstCountry < 0) {
    throw new Error("No `.fi-<code>` rule in the flag-icons stylesheet -- its format has changed.");
  }

  const parts: string[] = [];
  let sawBareFi = false;
  for (const [, lead, selectors, body] of upstreamCss.slice(0, firstCountry).matchAll(RULE)) {
    const kept = selectors
      .split(",")
      .map((selector) => selector.trim())
      .filter((selector) => !selector.includes(".fis") && !selector.includes(".fib"));
    if (kept.length === 0) continue;
    if (kept.includes(".fi")) sawBareFi = true;
    parts.push(`${lead}${kept.join(", ")} {${body}}`);
  }

  // Every rendered flag carries the bare `fi` class, so a base block that no
  // longer styles it means upstream moved the layout somewhere this extraction
  // cannot see -- and the flags would come out as zero-width spans.
  if (!sawBareFi) {
    throw new Error("The flag-icons base rules no longer style a bare `.fi` -- its format has changed.");
  }

  return parts.join("").trim();
}

/** Asserts upstream still ships the 4x3 rule for `code`, in the shape we re-emit. */
function assertUpstreamHasFlag(upstreamCss: string, code: string): void {
  const rule = new RegExp(
    String.raw`\.fi-${code}\s*\{\s*background-image:\s*url\(\.\./flags/4x3/${code}\.svg\)\s*;?\s*\}`,
  );
  if (!rule.test(upstreamCss)) {
    throw new Error(
      `flag-icons has no \`.fi-${code}\` 4x3 rule in the expected shape. ` +
        `COUNTRY_CODES maps a nationality onto "${code}", so that flag would silently not render.`,
    );
  }
}

function header(version: string, codeCount: number): string {
  return `/*
 * GENERATED -- do not edit by hand. Run \`npm run flags:subset\`.
 *
 * A country subset of flag-icons@${version}, cut to the ${codeCount} ISO codes that
 * COUNTRY_CODES (lib/game/flags.ts) maps -- the only ones components/ui/Flag.tsx
 * can ever render, since countryCode() returns null for everything else.
 *
 * The full stylesheet was imported on every route, including /about and the
 * legal pages, for a setting that is off by default: 542 country rules,
 * 36,486 of the built globals chunk's 91,717 bytes, and 514 SVGs / 5.1 MB
 * emitted into the build. (audit 2026-07-30 §1.4 residual)
 *
 * 4x3 only. \`Flag\` renders \`fi fi-<code>\`; nothing here uses flag-icons'
 * square (\`fis\`) or box (\`fib\`) variants, so those selectors are dropped from
 * the base rules too rather than left promising a rule that is not emitted.
 *
 * Base rules are upstream's, extracted verbatim; country rules are re-emitted
 * with url()s rewritten relative to this file. scripts/flagSubset.test.ts
 * regenerates and diffs, so this cannot drift from COUNTRY_CODES or from an
 * upgraded flag-icons without failing the static tier.
 */`;
}

export function buildFlagSubsetCss(upstreamCss: string, version: string): string {
  const codes = subsetCodes();
  const base = extractBaseRules(upstreamCss);

  const rules = codes.map((code) => {
    assertUpstreamHasFlag(upstreamCss, code);
    return `.fi-${code} {\n  background-image: url("${assetUrl(code)}");\n}`;
  });

  return `${header(version, codes.length)}\n\n${base}\n\n${rules.join("\n\n")}\n`;
}
