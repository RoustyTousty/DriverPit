import { useTranslations } from "next-intl";

import { Tile } from "@/components/game/GuessGrid";
import { Link } from "@/lib/i18n/navigation";

const LINK_CLASS =
  "font-medium text-text underline decoration-border underline-offset-2 hover:text-accent";

// STRUCTURE IN TYPESCRIPT, PROSE IN messages/*.json -- the same split HowToPlay
// and GameModes make, and the reason is the same: the number of paragraphs a
// section runs to is a layout decision, and a translator rewording a sentence
// must not be able to add or drop one.
//
// The section ORDER is the argument this page makes, in order: pick a first
// guess, read what comes back, understand which columns are worth the most, then
// spend the remaining guesses well. Duel and Infinite come last because they are
// variations on a skill you need first.
const SECTIONS = [
  { key: "opening", paragraphs: 3 },
  { key: "numbers", paragraphs: 2 },
  { key: "team", paragraphs: 3 },
  { key: "nationality", paragraphs: 2 },
  { key: "sequencing", paragraphs: 3 },
  { key: "duel", paragraphs: 3 },
  { key: "infinite", paragraphs: 2 },
] as const;

// The five columns ranked by how much they narrow the field, which is the one
// claim on this page a reader could not work out for themselves in six guesses.
// Ranked order is the content, so it lives here rather than in the catalogue.
const COLUMN_VALUE = ["team", "debut", "wins", "age", "nationality"] as const;

// A closeness ladder for the same tile, which is the fastest way to explain a
// squared falloff without arithmetic: the reader sees that "warm" already means
// close and that only the last year or two is properly bright. Real values from
// a real column -- a debut year against a target of 2007.
const CLOSENESS_LADDER: { value: string; closeness: number; key: "far" | "nearby" | "adjacent" }[] =
  [
    { value: "1991", closeness: 0.2, key: "far" },
    { value: "2001", closeness: 0.6, key: "nearby" },
    { value: "2006", closeness: 0.92, key: "adjacent" },
  ];

export function StrategyGuide() {
  const t = useTranslations("marketing.strategy");

  return (
    <section id="strategy" className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-text">{t("heading")}</h1>
        <p className="text-sm text-text-muted">{t("intro")}</p>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.key} className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-text">{t(`sections.${section.key}.heading`)}</h2>
          {Array.from({ length: section.paragraphs }, (_, index) => index + 1).map((paragraph) => (
            <p key={paragraph} className="text-sm leading-relaxed text-text-muted">
              {t(`sections.${section.key}.p${paragraph}`)}
            </p>
          ))}

          {/* Two sections carry a visual, placed inside them rather than
              collected at the bottom of the page: each one is the thing its
              paragraphs just described, and a legend a screen away from its
              explanation gets read as decoration. */}
          {section.key === "numbers" && (
            <div className="mt-1 flex flex-col gap-2">
              <div className="flex gap-1.5">
                {CLOSENESS_LADDER.map((step) => (
                  <div key={step.key} className="flex flex-1 flex-col gap-1.5">
                    <Tile feedback="higher" closeness={step.closeness}>
                      {step.value}
                    </Tile>
                    <p className="text-xs text-text-muted">{t(`ladder.${step.key}`)}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-text-muted">{t("ladderCaption")}</p>
            </div>
          )}

          {section.key === "team" && (
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              <div className="flex flex-col gap-1.5">
                <Tile feedback="exact">Ferrari</Tile>
                <p className="text-xs text-text-muted">{t("teamTiles.exact")}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Tile feedback="historical">McLaren</Tile>
                <p className="text-xs text-text-muted">{t("teamTiles.historical")}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Tile feedback="miss">Williams</Tile>
                <p className="text-xs text-text-muted">{t("teamTiles.miss")}</p>
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-text">{t("columnValueHeading")}</h2>
        <p className="text-sm leading-relaxed text-text-muted">{t("columnValueIntro")}</p>
        <ol className="flex flex-col gap-2">
          {COLUMN_VALUE.map((column, index) => (
            <li
              key={column}
              className="flex gap-3 rounded-lg border border-border bg-surface-2 p-3 text-sm"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-weak font-mono text-xs font-bold text-accent">
                {index + 1}
              </span>
              <p className="text-text-muted">
                <span className="font-semibold text-text">
                  {t(`columnValue.${column}.label`)}.
                </span>{" "}
                {t(`columnValue.${column}.body`)}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-sm leading-relaxed text-text-muted">
        {t.rich("outro", {
          howToPlay: (chunks) => (
            <Link href="/how-to-play" className={LINK_CLASS}>
              {chunks}
            </Link>
          ),
          archive: (chunks) => (
            <Link href="/archive" className={LINK_CLASS}>
              {chunks}
            </Link>
          ),
          play: (chunks) => (
            <Link href="/" className={LINK_CLASS}>
              {chunks}
            </Link>
          ),
        })}
      </p>
    </section>
  );
}
