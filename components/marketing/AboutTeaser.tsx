import { useTranslations } from "next-intl";

import { MoreLink } from "./MoreLink";

// About the PROJECT, not about the dataset behind it. The provenance of the
// driver rows is an implementation detail nobody arrives at a game's About
// section to read -- it belongs in the terms, where it is a real disclosure,
// and it stays there.
//
// Shares the `marketing.about` namespace with AboutSection but keeps its own
// `teaser` key: the home page copy is written short rather than truncated, so
// the two are different content and must stay separately translatable.
export function AboutTeaser() {
  const t = useTranslations("marketing.about");

  return (
    <section id="about" className="flex flex-col gap-3">
      <h2 className="text-2xl font-bold text-text">{t("heading")}</h2>
      <p className="text-sm text-text-muted">{t("teaser")}</p>
      <MoreLink href="/about">{t("teaserMore")}</MoreLink>
    </section>
  );
}
