// Combining marks left behind by an NFD decomposition ("é" -> "e" + U+0301).
// Deliberately the explicit range rather than `\p{Diacritic}`: a Unicode
// property escape is ES2018, and this repo targets ES2017, so TS rejects it.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

// Latin letters that are their own codepoint rather than a base + a mark, so
// NFD leaves them untouched. Small on purpose -- only what this roster
// actually contains (Tom Belsø) plus the near neighbours, since every entry
// here is a claim about how someone would type a name.
const NON_DECOMPOSING: Record<string, string> = {
  ø: "o",
  æ: "ae",
  œ: "oe",
  đ: "d",
  ð: "d",
  ł: "l",
  ß: "ss",
  þ: "th",
};
const NON_DECOMPOSING_PATTERN = new RegExp(`[${Object.keys(NON_DECOMPOSING).join("")}]`, "g");

// Folds a string to the form both sides of a match are compared in: lowercase
// and accent-free. "Sergio Pérez" -> "sergio perez", so typing the unaccented
// spelling finds the driver -- which it did not before, because the substring
// test failed on `é != e` and the subsequence fallback then ran out of plain
// `e`/`r` characters and returned null. Nobody types "Hülkenberg" with the
// umlaut on a phone (audit 2026-07-27 §4.2).
//
// Applied to the *query* as well, so the accented spelling still works too --
// folding is only a search convenience, never a restriction on what can be
// typed.
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(NON_DECOMPOSING_PATTERN, (char) => NON_DECOMPOSING[char]);
}

export interface SearchEntry<T> {
  readonly item: T;
  readonly key: string;
}

// Normalize once per pool, not once per driver per keystroke. The old filter
// called `.toLowerCase()` inside the scan, allocating a string for every
// driver on every keypress -- ~800 of them on Infinite's legacy pool, on a
// phone. Callers build this when the pool changes and hold it (audit §1.3);
// normalization is strictly more expensive than lowercasing, so doing it in
// the hot loop instead would have made the accent fix a slowdown.
export function buildSearchIndex<T>(
  items: readonly T[],
  getText: (item: T) => string,
): SearchEntry<T>[] {
  return items.map((item) => ({ item, key: normalizeSearchText(getText(item)) }));
}

// Contiguous substring matches score highest (weighted toward matches near
// the start of the string). Falls back to an in-order subsequence match so
// typos and skipped letters ("vrstpn" -> "Verstappen") still hit, rewarding
// consecutive character runs over scattered ones. Returns null on no match.
// Both arguments must already be normalized.
function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0;

  const substringIndex = target.indexOf(query);
  if (substringIndex !== -1) {
    return 1000 - substringIndex;
  }

  let queryIndex = 0;
  let score = 0;
  let lastMatchIndex = -1;
  for (
    let targetIndex = 0;
    targetIndex < target.length && queryIndex < query.length;
    targetIndex++
  ) {
    if (target[targetIndex] === query[queryIndex]) {
      score += lastMatchIndex === targetIndex - 1 ? 5 : 1;
      lastMatchIndex = targetIndex;
      queryIndex++;
    }
  }

  return queryIndex === query.length ? score : null;
}

export function fuzzyFilter<T>(
  query: string,
  index: readonly SearchEntry<T>[],
  limit = 8,
): T[] {
  if (limit <= 0) return [];
  const trimmed = normalizeSearchText(query.trim());
  if (trimmed === "") return index.slice(0, limit).map((entry) => entry.item);

  // Bounded top-`limit` insertion rather than scoring everything into an array
  // and sorting it: the old version built ~800 objects and ran a full
  // O(n log n) sort per keystroke to then discard all but 8. Insertion is
  // stable in the same way `Array.sort` is -- an entry only moves ahead of
  // ones scoring *strictly* lower -- so equal scores keep pool order
  // (alphabetical), exactly as before.
  const top: { item: T; score: number }[] = [];
  for (const entry of index) {
    const score = fuzzyScore(trimmed, entry.key);
    if (score === null) continue;
    if (top.length === limit && score <= top[limit - 1].score) continue;

    let insertAt = top.length;
    while (insertAt > 0 && top[insertAt - 1].score < score) insertAt--;
    top.splice(insertAt, 0, { item: entry.item, score });
    if (top.length > limit) top.pop();
  }

  return top.map((match) => match.item);
}
