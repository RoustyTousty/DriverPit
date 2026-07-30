// Relative, not "@/..." -- vitest resolves no path alias for the node project,
// and this module is unit-tested. Same convention as ./streak.ts.
import { MAX_GUESSES } from "../game/constants";

// A guess distribution is MAX_GUESSES buckets, where index i holds the number
// of wins solved in i + 1 guesses. That length is the entire content of this
// module, and it is a rule the codebase has broken from three directions --
// which is why the rule now lives in one place instead of being re-spelled at
// each call site.
//
// The reason any of this is hard: `user_stats.guess_distribution` has been six
// buckets since drizzle/0016, but drizzle/0007 defaulted it to FIVE and 0016
// moved only the DEFAULT -- it backfilled no rows. Any row created between
// those two migrations is still five long today, so every reader and every
// writer has to cope with one arriving.
//
//   * MERGING (audit 2026-07-29 §0.4). migrateLocalStats did
//     `current.guessDistribution.map((count, i) => count + local[i])`, and
//     `.map` preserves the RECEIVER's length. Against a five-bucket server row
//     a legacy player's 6-guess wins were dropped on the floor and the row
//     stayed five buckets forever. Building the result from MAX_GUESSES rather
//     than from either input is the fix, and it normalises the length in the
//     same expression.
//   * READING (§0.6). StatisticsSection fell back to a hardcoded `[0,0,0,0,0]`,
//     so a viewer whose stats hadn't loaded saw five bars and then six.
//   * WRITING. recordDailyResult spread the stored array, so a five-bucket row
//     stayed five unless the player happened to win in exactly six guesses
//     (the one index whose write extends the array). Normalising on write is
//     what makes the 0007-0016 rows self-heal on their next result of any kind
//     -- a backfill migration would do the same thing once, but this cannot
//     miss a row and needs no database access.
//
// Pure and unit-tested (./guessDistribution.test.ts).

export function emptyDistribution(): number[] {
  return Array<number>(MAX_GUESSES).fill(0);
}

// Reads a stored distribution as exactly MAX_GUESSES buckets: short rows are
// padded with zeros, long ones truncated.
export function normalizeDistribution(stored: unknown): number[] {
  return Array.from({ length: MAX_GUESSES }, (_, index) => bucket(stored, index));
}

// Index-wise sum, MAX_GUESSES long regardless of what either side's length is.
export function mergeDistributions(a: unknown, b: unknown): number[] {
  return Array.from({ length: MAX_GUESSES }, (_, index) => bucket(a, index) + bucket(b, index));
}

// Total by construction, and `unknown` rather than `number[]` on purpose: the
// column is jsonb, so "this is an array of numbers" describes what we write,
// not what is necessarily there. drizzle/0005 defaulted it to `'{}'` -- an
// OBJECT, which drizzle/0008 had to go back and tidy up -- and a `.map` over
// that throws inside whatever is rendering it. An unreadable bucket reads as 0.
function bucket(source: unknown, index: number): number {
  if (!Array.isArray(source)) return 0;
  const value: unknown = source[index];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}
