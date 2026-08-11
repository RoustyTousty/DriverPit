import type { DriverPage } from "../db/dailyRecap";
import { intlLocale, type Locale } from "../i18n/locales";

import { playedAppearances } from "./pageEligibility";

// The auto-written paragraph on a driver page, built on the three rules
// lib/recap/summary.ts learned the hard way against real data. They apply here
// unchanged, and the third one bites harder: a driver page has ONE subject, so
// every sentence is about the same person and the temptation to say the same
// fact twice in different words is constant.
//
// 1. EVERY SENTENCE IS ENTAILED BY THE NUMBERS. Nothing below asserts anything
//    that is not a restatement of a field on DriverPage. In particular nothing
//    characterises a career as good, unlucky, underrated or wasted -- those are
//    the sentences that would sound best and be unsupported.
//
// 2. A FACT THE SAMPLE CANNOT SUPPORT IS NOT SAID. The archive sentence is the
//    one exposed to this: with two finished boards, "62% of players solved it"
//    is a number with no meaning. Below MIN_RATE_SAMPLE the counts are stated
//    and the percentage is not.
//
// 3. NO FACT IS NAMED TWICE. Wins are mentioned by exactly one sentence, and
//    the podium count only appears where it is not already implied.
//
// ONE MORE, SPECIFIC TO THIS DATA. `careerWins` is computed by the seed from
// race results; `podiums`, `polePositions` and `championshipWins` come straight
// from F1DB's own totals. CLAUDE.md records that the two methodologies are
// deliberately not cross-checked -- so nothing here may phrase one as containing
// the other ("32 wins among 106 podiums") unless the numbers in hand actually
// permit it. A generated sentence that becomes false after a roster refresh is
// the worst thing on this page.
//
// PASS 7. Same split as lib/recap/summary.ts: the branching is arithmetic and
// stays here, the words move to messages/*.json. Three things this file does
// that a naive translation would get wrong:
//
//   - COUNTS ARE PLURALISED BY ICU INSIDE THE SENTENCE, not by a `plural()`
//     helper feeding a slot. English needs "grand prix"/"grands prix", German
//     needs a different noun form again, and only the message can know. Nesting
//     the plural in the sentence also lets a translator move the count to
//     wherever their language puts it.
//   - TENSE IS A KEY, NOT A VERB SLOT. "has won" vs "won" was injected as a
//     word; in languages where the auxiliary and the participle straddle the
//     object (German "hat … gewonnen") that is unbuildable. Each tense is its
//     own whole sentence.
//   - THE TEAM LIST IS `Intl.ListFormat`, not ", " with " and " on the end.
//     Spanish switches "y" to "e" before an i- sound and German uses no serial
//     comma; the platform knows all of it.

// Below this many finished boards a solve rate is not a rate. Deliberately the
// same shape of guard as summary.ts's MIN_COMPARABLE_DAYS, and deliberately
// lower than components/recap/RecapCard's MIN_RECAP_SAMPLE of 25: that one gates
// a CHART travelling as an image with no context, this one gates a sentence
// sitting next to the raw counts.
const MIN_RATE_SAMPLE = 10;

export type SummaryTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * "in 2014" / "between 2001 and 2026" / "since 2001" — the span every career
 * sentence hangs off.
 *
 * A driver whose last start is the current season is described with "since",
 * because "between 2001 and 2026" reads as a career that ended and Alonso's has
 * not. Both are entailed: `lastActiveYear` is the most recent season they
 * started a race in, so "has raced since 2001" claims nothing about the future.
 * `currentYear` is a parameter rather than a `new Date()` so this stays pure and
 * so the tests do not go stale on 1 January.
 *
 * The years are interpolated as STRINGS. A number placeholder would be
 * formatted by the locale's own rules, and `2001` grouped as `2.001` is how a
 * German page ends up claiming a driver debuted in the year two thousand and
 * one point nought nought one.
 */
function span(driver: DriverPage, currentYear: number, t: SummaryTranslator): string {
  if (driver.debutYear === driver.lastActiveYear) return t("span.single", { year: String(driver.debutYear) });
  if (isActive(driver, currentYear)) return t("span.since", { from: String(driver.debutYear) });
  return t("span.between", { from: String(driver.debutYear), to: String(driver.lastActiveYear) });
}

/**
 * Did they start a race this season?
 *
 * It decides the TENSE of the whole paragraph, which is why it is worth a named
 * function: "Felipe Massa has won 11 grands prix between 2002 and 2017" is
 * wrong in a way that reads as machine-written, and it was the last thing
 * visible when this generator was run against the real roster. Present perfect
 * for a career still going, simple past for one that has finished.
 */
function isActive(driver: DriverPage, currentYear: number): boolean {
  return driver.lastActiveYear >= currentYear;
}

/** `active` / `past`, used as the last segment of a message key. */
function tense(driver: DriverPage, currentYear: number): "active" | "past" {
  return isActive(driver, currentYear) ? "active" : "past";
}

// --- Sentence 1: the career, led by whatever the record actually is. -------
//
// Five shapes, picked by the data rather than one template with numbers
// substituted, so a champion's page and a one-season page do not read as the
// same document. Each leads with a different thing: the title, the win count,
// the absence of a win, the pole, the span.

// Small counts are spelled as words: "four different constructors", not "4".
// The words live in the catalogue (`number.N`) rather than in a table here, for
// the reason lib/recap/summary.ts gives -- they are language, not arithmetic.
// Past this many, digits read better in every locale we ship.
const NUMBER_WORD_MAX = 12;

function numberWord(t: SummaryTranslator, n: number): string {
  return n >= 0 && n <= NUMBER_WORD_MAX ? t(`number.${n}`) : String(n);
}

/**
 * "once" / "twice" / "five times" / "41 times".
 *
 * A frequency, not a count, and English needs three shapes for it -- which is
 * exactly why it is a message rather than a `${n} times` template. "finished on
 * the podium 1 time" came out of the first real run against the roster and is
 * one of the four defects summary.test.ts exists to have caught.
 */
function times(t: SummaryTranslator, n: number): string {
  if (n === 1) return t("times.once");
  if (n === 2) return t("times.twice");
  return t("times.many", { count: numberWord(t, n) });
}

function careerSentence(driver: DriverPage, currentYear: number, t: SummaryTranslator): string {
  const { fullName, championshipWins, careerWins, podiums, polePositions } = driver;
  const when = span(driver, currentYear, t);
  const at = tense(driver, currentYear);
  const base = { driver: fullName, when };

  // Both the word and the raw number go to the catalogue: the word is what the
  // sentence reads, the raw number is what its ICU plural selects on. Deriving
  // one from the other in here would put "championship"/"championships" in
  // TypeScript, where no locale's rules can reach it.
  if (championshipWins >= 1) {
    const titles = { titles: numberWord(t, championshipWins), titlesRaw: championshipWins };
    return careerWins >= 1
      ? t(`career.titlesAndWins.${at}`, { ...base, ...titles, wins: careerWins })
      : t(`career.titles.${at}`, { ...base, ...titles });
  }

  if (careerWins >= 1) {
    // The podium clause is a SEPARATE MESSAGE rather than an appended one, and
    // guarded rather than assumed: the two counts come from different sources
    // (see the header), and "5 wins and 3 podium finishes" would be a sentence
    // this page had no business printing.
    return podiums > careerWins
      ? t(`career.winsAndPodiums.${at}`, { ...base, wins: careerWins, podiums: times(t, podiums) })
      : t(`career.wins.${at}`, { ...base, wins: careerWins });
  }

  if (podiums >= 1) return t(`career.podiumsNoWin.${at}`, { ...base, podiums: times(t, podiums) });
  if (polePositions >= 1) {
    return t(`career.polesOnly.${at}`, {
      ...base,
      poles: numberWord(t, polePositions),
      polesRaw: polePositions,
    });
  }
  return t(`career.none.${at}`, base);
}

// --- Sentence 2: who they drove for. ---------------------------------------

function teamsSentence(
  driver: DriverPage,
  currentYear: number,
  locale: Locale,
  t: SummaryTranslator,
): string | null {
  // NOT translated: a constructor name is a proper noun. "Scuderia Ferrari" is
  // Scuderia Ferrari in every locale, and the roadmap names this rule outright.
  const teams = driver.teams.filter((team) => team.trim() !== "");
  if (teams.length === 0) return null;
  const at = tense(driver, currentYear);

  // "Their whole career" is entailed: previous_teams is every distinct
  // constructor they ever started a race for, not a recent subset. "So far" is
  // the honest qualifier while that career is still running.
  if (teams.length === 1) return t(`teams.single.${at}`, { team: teams[0] });

  const list = new Intl.ListFormat(intlLocale(locale), {
    style: "long",
    type: "conjunction",
  }).format(teams);
  const seasons = driver.lastActiveYear - driver.debutYear + 1;
  // Two shapes, and which one applies is itself a fact about the career: more
  // teams than seasons is a different story from a long stint across a few.
  if (teams.length >= 4 && teams.length >= seasons / 2) {
    return t(`teams.many.${at}`, { count: numberWord(t, teams.length), list });
  }
  return t(`teams.few.${at}`, { list });
}

// --- Sentence 3: the part no other site has. -------------------------------
//
// This is the sentence the page exists for, so it is the one with the strictest
// honesty rules. Pole positions above are F1DB's; this is ours.

/**
 * How the one day went.
 *
 * The ends of the range are the common outcomes at these sample sizes and both
 * read badly as fractions ("2 of 2", "0 of 1"), which is the same reason
 * lib/recap/summary.ts's opening sentence special-cases them.
 */
function singleDayKey(solved: number, completed: number): string {
  if (completed === 1) return solved === 1 ? "soloSolved" : "soloFailed";
  if (solved === completed) return completed === 2 ? "bothSolved" : "allSolved";
  if (solved === 0) return "noneSolved";
  return "someSolved";
}

function archiveSentence(
  driver: DriverPage,
  formatDate: (date: string) => string,
  t: SummaryTranslator,
): string | null {
  const played = playedAppearances(driver.appearances);
  if (played.length === 0) return null;

  const completed = played.reduce((total, day) => total + day.completed, 0);
  const solved = played.reduce((total, day) => total + day.solved, 0);

  // The date, not the puzzle number: this sentence is prose, and "on 31 July
  // 2026" is what a reader can place. The puzzle number is on the appearance
  // list below it, where it is a label rather than a claim.
  if (played.length === 1) {
    const [day] = played;
    return t(`archive.single.${singleDayKey(day.solved, day.completed)}`, {
      date: formatDate(day.date),
      solved: numberWord(t, day.solved),
      completed: numberWord(t, day.completed),
    });
  }

  // With several appearances a rate is worth quoting -- but only once there are
  // enough finished boards behind it for the number to mean anything. Under that
  // the counts are stated instead, which is the same fact without the false
  // precision.
  return completed >= MIN_RATE_SAMPLE
    ? t("archive.multiRate", {
        appearances: times(t, played.length),
        percent: Math.round((solved / completed) * 100),
        completed,
      })
    : t("archive.multiCounts", {
        appearances: times(t, played.length),
        solved: numberWord(t, solved),
        completed: numberWord(t, completed),
      });
}

export interface DriverSummaryContext {
  /** Current UTC year, for "since 2001" vs "between 2001 and 2024". */
  currentYear: number;
  /** Drives `Intl.ListFormat` for the team list, and nothing else. */
  locale: Locale;
  /** `2026-07-31` → `31 July 2026`. Injected so this module stays free of formatting. */
  formatDate: (date: string) => string;
  t: SummaryTranslator;
}

/**
 * Two or three sentences describing a driver, as an array so the caller joins
 * them into a paragraph and the tests can read them one at a time.
 *
 * There is no padding branch. A driver with one team and one appearance gets two
 * sentences, and that is the correct length for what is known about them —
 * stretching it is how a page with little to report starts sounding like a page
 * with a lot to report.
 */
export function writeDriverSummary(driver: DriverPage, context: DriverSummaryContext): string[] {
  const { currentYear, locale, formatDate, t } = context;
  const sentences = [careerSentence(driver, currentYear, t)];

  const teams = teamsSentence(driver, currentYear, locale, t);
  if (teams) sentences.push(teams);

  const archive = archiveSentence(driver, formatDate, t);
  if (archive) sentences.push(archive);

  return sentences;
}
