import { useTranslations } from "next-intl";

import { Tile } from "@/components/game/GuessGrid";
import { Link } from "@/lib/i18n/navigation";

// Structure (order, tile colours, sample values) stays in TypeScript; the prose
// lives in messages/*.json. Same split as lib/marketing/faqContent.ts, for the
// same reason: a visual decision is not a translatable string, and a reworded
// sentence must not be able to reorder the legend.
const STEP_KEYS = ["type", "read", "narrow", "solve"] as const;
const TIP_KEYS = ["broad", "historical", "brightest", "pace"] as const;
const COLUMN_RULE_KEYS = ["nationality", "team", "age", "debut", "wins"] as const;

// Two sections added 2026-08-12. The page was ~285 words, which is thin for the
// one page that is meant to be the site's authoritative answer to "how does this
// game work" -- and thin pages were the substance of the AdSense "low value
// content" rejection.
//
// Neither is padding, and that distinction is the whole point of adding them:
// DEFINITIONS answers the questions the tile legend does NOT ("age" is the
// driver's age now, not at their debut; a driver with no current team can never
// match on team), which is where almost every avoidable near-miss comes from.
// MISTAKES names the four habits that cost guesses. Both are specific to this
// game and could not be written about any other one, which is the test a page
// like this has to pass.
const DEFINITION_KEYS = ["age", "team", "wins", "debut", "pool"] as const;
const MISTAKE_KEYS = ["confirming", "extremes", "noTeam", "brightness"] as const;

// Sample VALUES are deliberately not translated. Team names are proper nouns,
// and a nationality on a real board is the English string out of `drivers`, so a
// translated example would show something the game never actually shows.
const LEGEND: {
  key: "exact" | "historical" | "miss" | "wide" | "close";
  feedback: "exact" | "historical" | "miss" | "higher" | "lower";
  value: string;
  closeness?: number;
}[] = [
  { key: "exact", feedback: "exact", value: "Ferrari" },
  { key: "historical", feedback: "historical", value: "McLaren" },
  { key: "miss", feedback: "miss", value: "Italy" },
  { key: "wide", feedback: "higher", value: "39", closeness: 0.15 },
  { key: "close", feedback: "lower", value: "2007", closeness: 0.85 },
];

const EXAMPLE_COLUMNS: {
  key: "nationality" | "team" | "age" | "debut" | "wins";
  feedback: "miss" | "historical" | "higher" | "lower";
  closeness?: number;
  value: string | number;
}[] = [
  { key: "nationality", feedback: "miss", value: "German" },
  { key: "team", feedback: "historical", value: "Aston Martin" },
  { key: "age", feedback: "higher", closeness: 0.2, value: 39 },
  { key: "debut", feedback: "lower", closeness: 0.75, value: 2007 },
  { key: "wins", feedback: "lower", closeness: 0.3, value: 53 },
];

export function HowToPlay() {
  const t = useTranslations("marketing.howToPlay");
  // The example's headers are the BOARD's column labels, read from the shared
  // `game.columns` namespace so the worked example cannot drift from the board
  // it exists to explain.
  const columns = useTranslations("game.columns");

  return (
    <section id="how-to-play" className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-text">{t("heading")}</h1>
        <p className="text-sm text-text-muted">{t("intro")}</p>
      </div>

      <ol className="flex flex-col gap-3">
        {STEP_KEYS.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-weak text-xs font-bold text-accent">
              {index + 1}
            </span>
            <p className="text-sm text-text-muted">
              <span className="font-semibold text-text">{t(`steps.${step}.title`)}.</span>{" "}
              {t(`steps.${step}.body`)}
            </p>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">{t("legendHeading")}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LEGEND.map((item) => (
            <div key={item.key} className="flex flex-col gap-1.5">
              <Tile feedback={item.feedback} closeness={item.closeness}>
                {item.value}
              </Tile>
              <p className="text-xs text-text-muted">{t(`legend.${item.key}`)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">{t("columnsHeading")}</p>
        <dl className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-2 p-4 sm:grid-cols-2">
          {COLUMN_RULE_KEYS.map((column) => (
            <div key={column}>
              <dt className="text-sm font-semibold text-text">{t(`columnRules.${column}.label`)}</dt>
              <dd className="text-sm text-text-muted">{t(`columnRules.${column}.rule`)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-text">{t("exampleHeading")}</p>
        <p className="text-xs text-text-muted">{t("exampleLead")}</p>
        <div className="flex flex-col gap-1">
          <div className="flex gap-1.5 px-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
            {EXAMPLE_COLUMNS.map((column) => (
              <div key={column.key} className="flex-1 text-center">
                {columns(column.key)}
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            {EXAMPLE_COLUMNS.map((column) => (
              <Tile key={column.key} feedback={column.feedback} closeness={column.closeness}>
                {column.value}
              </Tile>
            ))}
          </div>
        </div>
        <p className="text-xs text-text-muted">{t("exampleExplanation")}</p>
      </div>

      {/* Placed after the worked example and before the tips, which is where a
          reader who has just seen a real board starts asking "but what does
          Age actually mean?". A <dl> rather than a bullet list: these are
          term/definition pairs and the markup should say so. */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">{t("definitionsHeading")}</p>
        <p className="text-xs text-text-muted">{t("definitionsIntro")}</p>
        <dl className="flex flex-col gap-3">
          {DEFINITION_KEYS.map((definition) => (
            <div key={definition} className="rounded-lg border border-border bg-surface-2 p-4">
              <dt className="text-sm font-semibold text-text">
                {t(`definitions.${definition}.label`)}
              </dt>
              <dd className="mt-1 text-sm text-text-muted">{t(`definitions.${definition}.body`)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">{t("tipsHeading")}</p>
        <ul className="flex flex-col gap-1.5">
          {TIP_KEYS.map((tip) => (
            <li key={tip} className="flex gap-2 text-sm text-text-muted">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
              {t(`tips.${tip}`)}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-text">{t("mistakesHeading")}</p>
        <ul className="flex flex-col gap-1.5">
          {MISTAKE_KEYS.map((mistake) => (
            <li key={mistake} className="flex gap-2 text-sm text-text-muted">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
              {t(`mistakes.${mistake}`)}
            </li>
          ))}
        </ul>
      </div>

      {/* The outbound half of the how-to-play <-> strategy pair. This page is
          the rules; the guide is what to do with them, and neither should try
          to be the other. One sentence, one link, inside the translated string
          so word order can move around it. */}
      <p className="text-sm text-text-muted">
        {t.rich("strategyLink", {
          strategy: (chunks) => (
            <Link
              href="/strategy"
              className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </section>
  );
}
