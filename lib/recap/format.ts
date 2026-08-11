// Pure presentation rules for the daily recap, kept out of the card itself so
// they are testable in the `node` tier -- the card is rendered by Satori, which
// no test in this repo can execute, so anything with a rule in it belongs here
// rather than inline in the JSX.
//
// Everything here is deliberately locale-independent. The recap card is
// generated on a server whose ICU data and TZ are not ours to assume, and the
// same finished day must produce the same bytes on every request; a
// `toLocaleDateString()` or a `%` formatted through `Intl` is a value that can
// change under the image without anything in this repo changing.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Is this exactly a `YYYY-MM-DD` UTC calendar day?
 *
 * The round trip through `Date.UTC` is the load-bearing half: the regex alone
 * accepts `2026-02-31` and `2026-13-01`, which Postgres would reject with an
 * error rather than an empty result — so a malformed path parameter would come
 * back as a 500 instead of the 404 the archive route owes it.
 */
export function isUtcDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/** `2026-07-31` → `31 July 2026`. Assumes a validated date string. */
export function formatRecapDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** A 0–1 ratio as a whole percentage, e.g. `0.666…` → `67%`. */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "0%";
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

/**
 * The average guess count to one decimal, or an em dash when nobody solved the
 * day. Not "0.0", which would read as a real average of zero guesses.
 */
export function formatAverageGuesses(average: number | null): string {
  if (average === null || !Number.isFinite(average)) return "—";
  return average.toFixed(1);
}

/** Thousands separators without `Intl` — see the module note on determinism. */
export function formatCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// A nonzero bar that rounds to a sliver is worse than no bar: it reads as a
// rendering fault rather than as a small number. Anything above zero gets at
// least this much width, and zero gets none at all.
const MIN_VISIBLE_BAR_PERCENT = 3;

/** Width of one bar as a CSS percentage of the largest bar in its group. */
export function barWidthPercent(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "0%";
  const raw = (value / max) * 100;
  return `${Math.max(MIN_VISIBLE_BAR_PERCENT, Math.min(100, raw))}%`;
}

// Advance width as a fraction of the font size. Geist Mono has exactly one, so
// MONO is a measurement rather than an estimate (0.6, plus headroom); SANS is a
// deliberate over-estimate of Geist Sans' average, since guessing high shrinks
// text that would have fitted and guessing low clips text that does not.
export const MONO_ADVANCE = 0.62;
export const SANS_ADVANCE = 0.58;

// Used for the FIT only; the card renders at 1.15. The difference is the safety
// margin — text that computes to exactly the box height would otherwise clip on
// the last line's descenders.
const FIT_LINE_HEIGHT = 1.2;
const MIN_FIT_SIZE = 10;

/** Lines a greedy word wrap needs at a given characters-per-line budget. */
function wrappedLines(words: string[], charsPerLine: number): number {
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (used === 0) {
      used = word.length;
    } else if (used + 1 + word.length <= charsPerLine) {
      used += 1 + word.length;
    } else {
      lines += 1;
      used = word.length;
    }
  }
  return lines;
}

/**
 * The largest font size at which `text` still fits inside a `box`.
 *
 * Satori wraps text but never shrinks it, and every box on this card is a fixed
 * size, so a value that does not fit is not a squeezed value — it is a clipped
 * or overlapping one, with no symptom other than a wrong-looking PNG. Two real
 * cases drove this: "Ferrari" at 36px in a 134px tile lost its last letter off
 * the right edge, and "United States of America" wrapped to four lines that
 * overprinted the tile's own NATION label.
 *
 * The search is a downward scan rather than a formula because the previous
 * closed form — estimating line count from total character area — is wrong in
 * the direction that hurts: word wrapping wastes the tail of every line, so it
 * under-counts lines for exactly the multi-word values that overflow. For a
 * monospace face the wrap is *exactly* computable, so it is computed. Ten to
 * forty iterations of integer arithmetic, once per tile.
 *
 * A word is never allowed to be broken. That is the constraint that catches
 * "Ferrari": there is room for two lines, so a line-count test alone accepts a
 * size that renders it as "Ferrar" / "i".
 */
export function fitTextSize(
  text: string,
  base: number,
  box: { width: number; height: number },
  advance: number = MONO_ADVANCE,
): number {
  if (box.width <= 0 || box.height <= 0) return base;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return base;
  const longestWord = Math.max(...words.map((word) => word.length));

  for (let size = Math.floor(base); size > MIN_FIT_SIZE; size -= 1) {
    const charsPerLine = Math.floor(box.width / (size * advance));
    if (charsPerLine < longestWord) continue;
    if (wrappedLines(words, charsPerLine) * size * FIT_LINE_HEIGHT <= box.height) return size;
  }
  return MIN_FIT_SIZE;
}

export type RecapImageFormat = "portrait" | "wide";

/**
 * `?format=` for the recap image route. Unknown and absent both fall back to
 * portrait rather than erroring: the parameter selects a rendering, and a
 * social scraper that appends something we do not recognise should still get a
 * card.
 */
export function parseRecapFormat(raw: string | null | undefined): RecapImageFormat {
  return raw === "wide" ? "wide" : "portrait";
}
