import {
  clampDriverFilter,
  defaultDriverFilter,
  parseDriverFilter,
  type DriverFilter,
} from "@/lib/game/driverFilter";

// A remembered driver filter, per place one is composed.
//
// TWO SCOPES, TWO KEYS, DELIBERATELY. Infinite's filter is a practice
// preference ("I'm drilling 90s drivers"); a custom lobby's is the shape of a
// game you are about to host for someone else. Sharing one key would mean
// narrowing Infinite to Ferrari silently re-pooling the next game you invite a
// friend to, which nobody asked for and nobody would connect to what they did.
// Same storage behaviour, separate values.
//
// The infinite key replaced a single `f1dw:infinite:poolWindow` string -- a NEW
// key rather than a reused one, so a browser holding the old preference reads as
// "no stored filter" and gets the default rather than something half-parsed. The
// old key is swept on the next write.
export type DriverFilterScope = "infinite" | "custom";

const STORAGE_KEYS: Record<DriverFilterScope, string> = {
  infinite: "f1dw:infinite:driverFilter",
  custom: "f1dw:custom:driverFilter",
};

const LEGACY_POOL_WINDOW_KEY = "f1dw:infinite:poolWindow";

/**
 * The stored filter for this scope, or the default. Every path returns
 * something usable: storage can be disabled, hold a value from an older shape,
 * or hold something a player edited by hand, and none of those is a reason for
 * the mode not to start -- parseDriverFilter validates and clamps, and null
 * means "use the default", never "throw".
 *
 * Note it also re-clamps against `referenceYear` on every read, so a filter
 * stored last year ("2005-2025", when 2025 was the ceiling) stays inside the
 * seasons that exist rather than becoming a span the year slider cannot show.
 */
export function readDriverFilterPreference(
  scope: DriverFilterScope,
  referenceYear: number,
): DriverFilter {
  if (typeof window === "undefined") return defaultDriverFilter(referenceYear);
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[scope]);
    if (!raw) return defaultDriverFilter(referenceYear);
    return parseDriverFilter(JSON.parse(raw), referenceYear) ?? defaultDriverFilter(referenceYear);
  } catch {
    // Malformed JSON, or storage blocked entirely.
    return defaultDriverFilter(referenceYear);
  }
}

export function writeDriverFilterPreference(
  scope: DriverFilterScope,
  filter: DriverFilter,
  referenceYear: number,
) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEYS[scope],
      JSON.stringify(clampDriverFilter(filter, referenceYear)),
    );
    if (scope === "infinite") localStorage.removeItem(LEGACY_POOL_WINDOW_KEY);
  } catch {
    // Quota or disabled storage: the preference is a convenience, and losing it
    // costs one re-pick. Never a reason to fail a round start.
  }
}
