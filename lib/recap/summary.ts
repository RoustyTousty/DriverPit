import type { DailyRecap } from "../db/dailyRecap";

// The auto-written paragraph on every archive page, and the thing that decides
// whether those pages are content or filler.
//
// THREE RULES, in order of how much damage breaking them does.
//
// 1. EVERY SENTENCE MUST BE ENTAILED BY THE NUMBERS. It is very easy to write
//    generated prose that sounds insightful and claims something the data does
//    not support ("most guesses overshot the wins column"), and a page that
//    does that is worse than a bare table: it is wrong, at scale, in a
//    confident voice. Nothing below asserts anything that is not a restatement
//    of a value in DailyRecap.
//
// 2. A FACT THE SAMPLE CANNOT SUPPORT IS NOT SAID AT ALL. This is the rule the
//    first draft broke, and it was obvious the moment it ran against real days:
//    with one player it produced "More players tried Alexander Albon than tried
//    Brendon Hartley" off a 1-1 tie broken by driver id, and called one
//    person's first guess "the most popular opening guess". Every
//    population-level sentence now carries a minimum, and a one-player day gets
//    one sentence about that one board instead of three about a crowd that does
//    not exist.
//
// 3. NO FACT AND NO DRIVER IS NAMED TWICE. The first draft also produced "Most
//    boards opened with Alexander Albon, and the wrong name that came up most
//    often was Alexander Albon" — two clauses, one event. Sentences are now
//    selected against what has already been said.
//
// Underneath all three: one template with the numbers swapped is a page that
// reads identically 365 times, which is the thin content this pass exists to
// avoid. So the paragraph is assembled from sentence SHAPES chosen by the data,
// and the shapes differ in what they lead with — the driver, the count, a
// clause — not only in their adjectives.
//
// PASS 7: THE SHAPES ARE CHOSEN HERE; THE WORDS LIVE IN messages/*.json.
// The selection logic above is arithmetic over a recap and is identical in
// every language, so it stays in TypeScript and is translated nowhere. What
// each branch returns is now a message KEY plus its values. Two consequences
// worth stating, because both are ways to break this quietly:
//
//   - A branch must never build a sentence by concatenating translated
//     fragments. Word order differs per language, and a clause glued on with
//     ", and" in English lands in the wrong half of a German sentence. The one
//     place two clauses combine (`approachSentence`) has a dedicated `both` key
//     per locale rather than a join.
//   - Ordinals and small number words are message keys, not a table here.
//     "the second guess" agrees with gender in Spanish, Italian and Portuguese,
//     so the *sentence* carries the ordinal rather than a shared noun phrase.
//
// Pure and unit-tested (summary.test.ts) so the shapes can be read and
// regression-checked without a database or a browser.

export interface RecapSummaryContext {
  /** Mean per-day solve rate across the other finished days; see ArchiveDayContext. */
  averageSolveRate: number | null;
  comparableDays: number;
}

/**
 * The subset of next-intl's translator this module needs. Structural rather
 * than next-intl's own generic so the file stays pure and testable with a plain
 * function standing in for the catalogue.
 */
export type SummaryTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

// Below this many other days, "the archive average" is noise, and quoting it
// would be the generator's one unsupported claim.
const MIN_COMPARABLE_DAYS = 5;
// How far from that average a day has to sit before it is worth a sentence.
// Under this it is not a story, it is rounding.
const NOTABLE_GAP = 0.1;
const WIDE_GAP = 0.2;
// "The most popular opening guess" needs a population to be popular within.
// Under four boards a plurality is one or two people, and saying otherwise is
// rule 2.
const MIN_BOARDS_FOR_PLURALITY = 4;
// A wrong name has to have come up at least twice to have "come up often".
const MIN_WRONG_ANSWER_COUNT = 2;

/**
 * "first" … "sixth", from the catalogue. Falls back to the digit for anything
 * past six, which the six-guess cap makes unreachable but which keeps this
 * total rather than returning `undefined` into a sentence.
 */
function ordinal(t: SummaryTranslator, n: number): string {
  return n >= 1 && n <= 6 ? t(`ordinal.${n}`) : String(n);
}

/** "one" … "six". Same contract as `ordinal`. */
function numberWord(t: SummaryTranslator, n: number): string {
  return n >= 0 && n <= 6 ? t(`number.${n}`) : String(n);
}

/**
 * The same word, for the START of a sentence.
 *
 * A SEPARATE key set rather than an uppercase-the-first-letter step here, which
 * is the note on `firstGuess.many` made concrete: sentence-initial casing is a
 * property of the sentence, and the two are only interchangeable in languages
 * that write their number words the same way in both positions. German does not
 * ("drei" mid-sentence, "Drei" leading), and a locale that wanted a digit here
 * could simply say so.
 */
function numberWordCapitalised(t: SummaryTranslator, n: number): string {
  return n >= 0 && n <= 6 ? t(`numberCap.${n}`) : String(n);
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** The most-guessed driver who was not the answer, if they were guessed enough to count. */
function topWrongAnswer(recap: DailyRecap) {
  const wrong = recap.topGuesses.find((guess) => guess.driverId !== recap.target.id);
  return wrong && wrong.count >= MIN_WRONG_ANSWER_COUNT ? wrong : null;
}

/** Distribution buckets that anyone landed in, as 1-based guess counts. */
function usedBuckets(recap: DailyRecap): number[] {
  return recap.distribution.flatMap((count, index) => (count > 0 ? [index + 1] : []));
}

/** 1-based guess count of the fullest bucket, or null if nobody solved it. */
function modalGuessCount(recap: DailyRecap): number | null {
  let best = 0;
  let bestIndex = -1;
  recap.distribution.forEach((count, index) => {
    if (count > best) {
      best = count;
      bestIndex = index;
    }
  });
  return bestIndex >= 0 ? bestIndex + 1 : null;
}

// --- Sentence 1: what happened. Always present. --------------------------

function openingSentence(recap: DailyRecap, t: SummaryTranslator): string {
  const { target, puzzleNumber, players, completed, solved, solveRate } = recap;
  const name = target.fullName;
  const base = { number: puzzleNumber, driver: name };

  if (players === 0) return t("opening.nobody", base);
  if (completed === 0) {
    return players === 1
      ? t("opening.noneFinishedOne", base)
      : t("opening.noneFinished", { ...base, players });
  }

  // A single finished board is not a field, a majority or a percentage — it is
  // one person's game, so it gets told as one, guess count included. That
  // replaces the three redundant sentences the first draft produced here.
  if (completed === 1) {
    const only = usedBuckets(recap)[0];
    if (solved === 1) {
      return only === 1
        ? t("opening.soloFirstGuess", base)
        : t("opening.soloNthGuess", { ...base, ordinal: ordinal(t, only) });
    }
    return t("opening.soloFailed", base);
  }

  // The two ends of the range read badly as fractions ("2 of 2", "0 of 5") and
  // are the most common outcomes on a quiet day, so neither quotes one.
  if (solved === completed) {
    return completed === 2
      ? t("opening.bothSolved", base)
      : t("opening.allSolved", { ...base, completed });
  }
  if (solved === 0) return t("opening.noneSolved", { ...base, completed });

  // Number words at small counts: "1 of the 2 finished boards" is how a
  // spreadsheet talks, and at these sizes the digits buy nothing.
  const fraction =
    completed <= 3
      ? t("fraction.words", {
          solved: numberWord(t, solved),
          completed: numberWord(t, completed),
        })
      : t("fraction.digits", { solved, completed });

  const band =
    solveRate >= 0.8
      ? "veryEasy"
      : solveRate >= 0.6
        ? "easy"
        : solveRate >= 0.4
          ? "even"
          : solveRate >= 0.2
            ? "hard"
            : "veryHard";
  return t(`opening.${band}`, { driver: name, fraction });
}

// --- Sentence 2: the most notable thing about how it was solved. ----------
//
// Candidates in descending order of how much they tell you; the first that
// applies wins. That ranking is what makes two days with the same solve rate
// read differently: one mentions its distance from the archive average, the
// next its first-guess solve, the next only where its winning boards landed.

function difficultySentence(
  recap: DailyRecap,
  context: RecapSummaryContext,
  t: SummaryTranslator,
): string | null {
  const { averageSolveRate, comparableDays } = context;
  if (recap.completed === 0) return null;
  if (averageSolveRate === null || comparableDays < MIN_COMPARABLE_DAYS) return null;

  const gap = recap.solveRate - averageSolveRate;
  if (Math.abs(gap) < NOTABLE_GAP) return null;

  const average = percent(averageSolveRate);
  if (gap <= -WIDE_GAP) return t("difficulty.muchHarder", { average });
  if (gap >= WIDE_GAP) return t("difficulty.muchEasier", { average });
  return gap < 0 ? t("difficulty.slightlyHarder", { average }) : t("difficulty.slightlyEasier", { average });
}

function firstGuessSentence(recap: DailyRecap, t: SummaryTranslator): string | null {
  const firstTry = recap.distribution[0] ?? 0;
  if (firstTry <= 0) return null;
  if (firstTry === 1) return t("firstGuess.one");
  // The count is spelled as a word at small values: a sentence that opens "3
  // boards got there" reads as a spreadsheet cell, not as a sentence. The
  // CAPITALISATION is left to the catalogue rather than done here -- German
  // capitalises nouns mid-sentence and Spanish does not capitalise the number
  // word at all, so an uppercase-the-first-letter step in TypeScript would be
  // wrong in two directions at once.
  return t("firstGuess.many", { count: numberWordCapitalised(t, firstTry), raw: firstTry });
}

/**
 * More people guessed someone else than guessed the answer — genuinely
 * interesting, and the first draft's worst offender.
 *
 * It needs a real margin over the answer's own count, not a tie broken by
 * driver id. If the answer is not in the top five at all, the margin is
 * certain, which is why the fallback is `true` rather than a guess.
 */
function upsetSentence(recap: DailyRecap, t: SummaryTranslator): string | null {
  const leader = recap.topGuesses[0];
  if (!leader || leader.driverId === recap.target.id) return null;
  if (recap.players < MIN_BOARDS_FOR_PLURALITY) return null;

  const answerEntry = recap.topGuesses.find((guess) => guess.driverId === recap.target.id);
  if (answerEntry && leader.count <= answerEntry.count) return null;

  return t("upset", { leader: leader.fullName, driver: recap.target.fullName });
}

function distributionSentence(recap: DailyRecap, t: SummaryTranslator): string | null {
  const buckets = usedBuckets(recap);
  if (buckets.length === 0) return null;

  // Every winner took the same number of guesses. Common at small n, and
  // "averaged 2.0 guesses" is a silly way to say it.
  if (buckets.length === 1) {
    const only = buckets[0];
    if (only === 1) return null; // firstGuessSentence says this better.
    const guesses = numberWord(t, only);
    if (recap.solved === 1) return t("distribution.uniformOne", { guesses });
    return recap.solved === 2
      ? t("distribution.uniformTwo", { guesses })
      : t("distribution.uniformAll", { guesses });
  }

  const modal = modalGuessCount(recap);
  if (modal === null) return null;
  if (recap.averageGuesses !== null) {
    return t("distribution.averageAndMode", {
      average: recap.averageGuesses.toFixed(1),
      ordinal: ordinal(t, modal),
    });
  }
  return t("distribution.mode", { ordinal: ordinal(t, modal) });
}

// --- Sentence 3: how people went about it. -------------------------------

/**
 * The opening guess and the most popular wrong answer, minus anything already
 * said. `mentioned` carries the driver names earlier sentences used, because
 * the same driver named in two consecutive sentences is what made the first
 * draft read like a machine.
 */
function approachSentence(
  recap: DailyRecap,
  mentioned: Set<string>,
  t: SummaryTranslator,
): string | null {
  const opener = recap.commonOpener;
  const wrong = topWrongAnswer(recap);

  // A day whose most popular FIRST guess was the answer is a real oddity, and
  // the one thing here worth a sentence of its own. Phrased without repeating
  // the driver's name, which sentence 1 has already used — naming them twice in
  // three sentences is what makes generated prose sound generated.
  if (opener && opener.fullName === recap.target.fullName && recap.players >= MIN_BOARDS_FOR_PLURALITY) {
    return t("approach.openerWasAnswer", { count: opener.count });
  }

  // The opener clause is picked as a KEY here and rendered as a whole sentence
  // below, never assembled. See the module note: a clause that reads correctly
  // when glued to ", and …" in English does not survive the join in German.
  let openerKey: string | null = null;
  const openerValues: Record<string, string | number> = {};
  if (opener && !mentioned.has(opener.fullName) && opener.fullName !== recap.target.fullName) {
    openerValues.opener = opener.fullName;
    if (recap.players >= 2 && opener.count === recap.players) {
      // Unanimity is worth saying at any size, because it is not a plurality.
      if (recap.players === 2) {
        openerKey = "bothOpened";
      } else {
        openerKey = "allOpened";
        openerValues.players = recap.players;
      }
    } else if (recap.players >= MIN_BOARDS_FOR_PLURALITY) {
      openerKey = opener.count / recap.players >= 0.5 ? "mostOpened" : "popularOpener";
    }
  }

  // When the opening guess and the most popular wrong answer are the same
  // driver they are also the same event, so it gets said once.
  const wrongName =
    wrong && wrong.fullName !== opener?.fullName && !mentioned.has(wrong.fullName) ? wrong.fullName : null;

  if (openerKey && wrongName) {
    return t(`approach.${openerKey}WithWrong`, { ...openerValues, wrong: wrongName });
  }
  if (openerKey) return t(`approach.${openerKey}`, openerValues);
  if (wrongName) return t("approach.wrongOnly", { wrong: wrongName });
  return null;
}

/**
 * One to three sentences describing a finished day, as an array so the caller
 * can join them into a paragraph and the tests can read them one at a time.
 *
 * A quiet day gets one sentence. That is deliberate: padding it out is how a
 * page with nothing to report starts sounding like a page with something to
 * report, and there is no version of that which is not a lie.
 */
export function writeRecapSummary(
  recap: DailyRecap,
  context: RecapSummaryContext,
  t: SummaryTranslator,
): string[] {
  const sentences = [openingSentence(recap, t)];
  const mentioned = new Set<string>([recap.target.fullName]);

  // A single board's whole story is already in the opening sentence.
  if (recap.completed > 1 || recap.players > 1) {
    const middle =
      difficultySentence(recap, context, t) ??
      firstGuessSentence(recap, t) ??
      upsetSentence(recap, t) ??
      distributionSentence(recap, t);
    if (middle) {
      sentences.push(middle);
      const leader = recap.topGuesses[0];
      if (leader && middle.includes(leader.fullName)) mentioned.add(leader.fullName);
    }
  }

  if (recap.players >= 2) {
    const approach = approachSentence(recap, mentioned, t);
    if (approach) sentences.push(approach);
  }

  return sentences;
}
