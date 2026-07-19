// Contiguous substring matches score highest (weighted toward matches near
// the start of the string). Falls back to an in-order subsequence match so
// typos and skipped letters ("vrstpn" -> "Verstappen") still hit, rewarding
// consecutive character runs over scattered ones. Returns null on no match.
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
  items: readonly T[],
  getText: (item: T) => string,
  limit = 8,
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return items.slice(0, limit);

  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(trimmed, getText(item).toLowerCase());
    if (score !== null) scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((match) => match.item);
}
