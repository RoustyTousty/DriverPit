import { useTranslations } from "next-intl";

import { LegalTranslationNotice } from "./LegalTranslationNotice";

// Section ORDER and the shape of each section live here; the prose lives in
// messages/*.json under `legal.privacy`. Same split as every other marketing
// component, but it matters more on this page: a reordered or dropped section is
// a disclosure that stopped being made, and a translator must not be able to
// cause one by rewording a paragraph.
const SECTIONS = [
  { key: "overview", paragraphs: 1 },
  { key: "accounts", paragraphs: 3 },
  { key: "cookies", paragraphs: 3 },
  { key: "advertising", paragraphs: 2 },
  { key: "sharing", paragraphs: 0 },
  { key: "retention", paragraphs: 1 },
  { key: "choices", paragraphs: 0 },
  { key: "children", paragraphs: 1 },
  { key: "changes", paragraphs: 1 },
] as const;

const BULLET = (
  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
);

const LINK_CLASS =
  "font-medium text-text underline decoration-border underline-offset-2 hover:text-accent";

export function PrivacyPolicy() {
  const t = useTranslations("legal");
  const p = useTranslations("legal.privacy.sections");

  return (
    <section id="privacy-policy" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-text">{t("privacy.heading")}</h2>
        <p className="text-xs text-text-muted">{t("lastUpdated", { date: t("date") })}</p>
      </div>

      {/* Renders on every locale but English — see the component. */}
      <LegalTranslationNotice />

      {SECTIONS.map((section) => (
        <div key={section.key} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-text">{p(`${section.key}.title`)}</h3>

          {section.key === "sharing" ? (
            <div className="flex flex-col gap-2 text-sm text-text-muted">
              <p>{p("sharing.p1")}</p>
              <ul className="flex flex-col gap-1.5">
                {[1, 2, 3].map((item) => (
                  <li key={item} className="flex gap-2">
                    {BULLET}
                    {p(`sharing.items.${item}`)}
                  </li>
                ))}
              </ul>
              <p>
                {p.rich("sharing.p2", {
                  f1db: (chunks) => (
                    <a href="https://github.com/f1db/f1db" className={LINK_CLASS}>
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>
          ) : section.key === "choices" ? (
            <ul className="flex flex-col gap-1.5 text-sm text-text-muted">
              {[1, 2, 3].map((item) => (
                <li key={item} className="flex gap-2">
                  {BULLET}
                  {p(`choices.items.${item}`)}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-2 text-sm text-text-muted">
              {Array.from({ length: section.paragraphs }, (_, i) => i + 1).map((n) => (
                <p key={n}>
                  {p.rich(`${section.key}.p${n}`, {
                    b: (chunks) => <span className="font-medium text-text">{chunks}</span>,
                    code: (chunks) => <code className="text-xs">{chunks}</code>,
                  })}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
