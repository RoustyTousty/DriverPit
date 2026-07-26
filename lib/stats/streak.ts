// Daily-streak rules. Pure and unit-tested (./streak.test.ts) -- the SQL side
// of the same rules lives in the `leaderboard` view (drizzle/0037), and the two
// must agree.
//
// A streak counts CONSECUTIVE UTC days with a daily win. Two separate questions
// fall out of that, and getting only the first one right was the original bug:
//
//   1. On write: does today's win extend the stored streak, or start a new one?
//      Before this, a win always did `streak + 1` regardless of gap, so skipping
//      a week and then winning read as an 8-day streak.
//   2. On read: is the stored streak still alive AT ALL? A streak also breaks by
//      simply not playing, and nothing writes user_stats on a day you skip -- so
//      the stored number stays frozen at its last value forever unless every
//      reader re-evaluates it against today. Without this half, "never play
//      again" was the safest way to keep a streak.

const MS_PER_DAY = 86_400_000;

// The UTC calendar day as a "YYYY-MM-DD" string -- the form daily_results.date
// and user_stats.last_daily_date come back as, so comparisons stay string-free.
export function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseUtcDateMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

// Whole UTC days from `from` to `to`. Negative if `from` is in the future.
function daysBetween(from: string, to: string): number {
  return Math.round((parseUtcDateMs(to) - parseUtcDateMs(from)) / MS_PER_DAY);
}

// The streak value to store for a result recorded on `date`.
//
// `lastDailyDate` is the day of the previously recorded result (null if there
// isn't one). Null is treated as "no evidence of a streak" and restarts at 1
// rather than continuing: after the drizzle/0037 backfill the only rows with a
// null anchor and a non-zero streak are legacy localStorage merges
// (migrateLocalStats), whose streaks carry no dates at all and so can never be
// verified or decayed. Continuing one would recreate exactly the immortal
// streak this module exists to kill.
export function nextCurrentStreak(params: {
  previousStreak: number;
  lastDailyDate: string | null;
  date: string;
  won: boolean;
}): number {
  const { previousStreak, lastDailyDate, date, won } = params;
  if (!won) return 0;
  if (lastDailyDate === null) return 1;
  return daysBetween(lastDailyDate, date) === 1 ? previousStreak + 1 : 1;
}

// The streak to SHOW (and rank by) today, given what's stored.
//
// Alive means the last recorded result was today or yesterday: today's puzzle
// isn't missed until the UTC day is over, so a win yesterday still counts at
// 03:00 today and breaks only once today ends unplayed. `<= 1` rather than
// `=== 0 || === 1` so a clock running behind the database (which resolves every
// stored date) reads as alive instead of zeroing a real streak.
export function currentStreakAsOf(
  storedStreak: number,
  lastDailyDate: string | null,
  today: string,
): number {
  if (lastDailyDate === null) return 0;
  return daysBetween(lastDailyDate, today) <= 1 ? storedStreak : 0;
}
