import { useTranslations } from "next-intl";

import { Tile } from "@/components/game/GuessGrid";

import { MoreLink } from "./MoreLink";

// Its own short labels, not the full page's: this is a four-tile summary and
// the wording is written tighter for it. Shares the `marketing.howToPlay`
// namespace so both live beside each other in the catalogue.
const LEGEND: {
  key: "exact" | "historical" | "miss" | "close";
  feedback: "exact" | "historical" | "miss" | "lower";
  value: string;
  closeness?: number;
}[] = [
  { key: "exact", feedback: "exact", value: "Ferrari" },
  { key: "historical", feedback: "historical", value: "McLaren" },
  { key: "miss", feedback: "miss", value: "Italy" },
  { key: "close", feedback: "lower", value: "2007", closeness: 0.85 },
];

export function HowToPlayTeaser() {
  const t = useTranslations("marketing.howToPlay");

  return (
    <section id="how-to-play" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">{t("heading")}</h2>

      <p className="text-sm text-text-muted">{t("teaserIntro")}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LEGEND.map((item) => (
          <div key={item.key} className="flex flex-col gap-1.5">
            <Tile feedback={item.feedback} closeness={item.closeness}>
              {item.value}
            </Tile>
            <p className="text-xs text-text-muted">{t(`teaserLegend.${item.key}`)}</p>
          </div>
        ))}
      </div>

      <MoreLink href="/how-to-play">{t("teaserMore")}</MoreLink>
    </section>
  );
}
