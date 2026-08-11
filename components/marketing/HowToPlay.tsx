import { useTranslations } from "next-intl";

import { Tile } from "@/components/game/GuessGrid";

// Structure (order, tile colours, sample values) stays in TypeScript; the prose
// lives in messages/*.json. Same split as lib/marketing/faqContent.ts, for the
// same reason: a visual decision is not a translatable string, and a reworded
// sentence must not be able to reorder the legend.
const STEP_KEYS = ["type", "read", "narrow", "solve"] as const;
const TIP_KEYS = ["broad", "historical", "brightest", "pace"] as const;
const COLUMN_RULE_KEYS = ["nationality", "team", "age", "debut", "wins"] as const;

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
        <h2 className="text-2xl font-bold text-text">{t("heading")}</h2>
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
    </section>
  );
}
