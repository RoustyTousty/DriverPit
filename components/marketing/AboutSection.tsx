import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";

const LINK_CLASS =
  "font-medium text-text underline decoration-border underline-offset-2 hover:text-accent";

// The full About page. It is about the PROJECT: what it is, what you can play,
// who makes it and how it stays free. Where the driver rows come from is an
// implementation detail, and an About section is not where anyone goes looking
// for it -- that disclosure lives in the terms and the privacy policy, which is
// also where it does real work.
//
// The prose lives in messages/*.json and is rendered with `t.rich`, so the
// emphasis and the two internal links stay INSIDE the translated sentence.
// Splitting a sentence into fragments around them would be the concatenation
// mistake lib/recap/summary.ts documents: word order differs per language, and
// a clause that reads correctly either side of a link in English lands in the
// wrong half of a German one.
export function AboutSection() {
  const t = useTranslations("marketing.about");

  return (
    <section id="about" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">{t("heading")}</h2>

      <p className="text-sm text-text-muted">{t("whatItIs")}</p>

      <p className="text-sm text-text-muted">
        {t.rich("modes", {
          b: (chunks) => <span className="font-semibold text-text">{chunks}</span>,
          howToPlay: (chunks) => (
            <Link href="/how-to-play" className={LINK_CLASS}>
              {chunks}
            </Link>
          ),
          gameModes: (chunks) => (
            <Link href="/game-modes" className={LINK_CLASS}>
              {chunks}
            </Link>
          ),
        })}
      </p>

      {/* Two paragraphs added 2026-08-12. Both are about the PROJECT rather than
          the dataset, which is the line this section has always held -- where
          the driver rows come from belongs in the terms and the privacy policy.
          `fairness` answers the question every daily game gets asked and this
          one has an unusually good answer to (the target is random and pinned,
          not derived from the date, so there is no formula to run); and
          `accessibility` states what is actually built, which is the sort of
          thing a reader has no other way to discover before playing. */}
      <p className="text-sm text-text-muted">{t("fairness")}</p>

      <p className="text-sm text-text-muted">{t("whoBuildsIt")}</p>

      <p className="text-sm text-text-muted">{t("accessibility")}</p>

      <p className="text-sm text-text-muted">
        {t.rich("support", {
          // The one external link in this section, and it stays a plain <a>:
          // it leaves the site, so it is not a locale-aware route.
          coffee: (chunks) => (
            <a
              href="https://buymeacoffee.com/ecozo"
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_CLASS}
            >
              {chunks}
            </a>
          ),
        })}
      </p>

      <p className="text-xs text-text-muted">{t("disclaimer")}</p>
    </section>
  );
}
