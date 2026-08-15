import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";

import { LegalTranslationNotice } from "./LegalTranslationNotice";

// Section ORDER and shape here; prose in messages/*.json under `legal.terms`.
// See the note in PrivacyPolicy.tsx for why the split is stricter on these two
// pages than on the rest of the marketing copy.
const SECTIONS = [
  { key: "agreement", paragraphs: 1 },
  { key: "service", paragraphs: 1 },
  { key: "accounts", paragraphs: 2 },
  { key: "acceptableUse", paragraphs: 0 },
  { key: "usernames", paragraphs: 1 },
  { key: "advertising", paragraphs: 1 },
  { key: "noWarranty", paragraphs: 1 },
  { key: "liability", paragraphs: 1 },
  { key: "termination", paragraphs: 1 },
  { key: "changes", paragraphs: 1 },
] as const;

const LINK_CLASS =
  "font-medium text-text underline decoration-border underline-offset-2 hover:text-accent";

export function TermsOfService() {
  const t = useTranslations("legal");
  const s = useTranslations("legal.terms.sections");

  return (
    <section id="terms-of-service" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-text">{t("terms.heading")}</h1>
        <p className="text-xs text-text-muted">{t("lastUpdated", { date: t("date") })}</p>
      </div>

      <LegalTranslationNotice />

      {SECTIONS.map((section) => (
        <div key={section.key} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-text">{s(`${section.key}.title`)}</h3>

          {section.key === "acceptableUse" ? (
            <ul className="flex flex-col gap-1.5 text-sm text-text-muted">
              {[1, 2, 3, 4].map((item) => (
                <li key={item} className="flex gap-2">
                  <span
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted"
                    aria-hidden="true"
                  />
                  {s(`acceptableUse.items.${item}`)}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-2 text-sm text-text-muted">
              {Array.from({ length: section.paragraphs }, (_, i) => i + 1).map((n) => (
                <p key={n}>
                  {s.rich(`${section.key}.p${n}`, {
                    f1db: (chunks) => (
                      <a href="https://github.com/f1db/f1db" className={LINK_CLASS}>
                        {chunks}
                      </a>
                    ),
                    // Locale-aware: a Spanish terms page must link to the
                    // Spanish privacy policy, not walk the reader out of the
                    // locale on a legal cross-reference.
                    privacy: (chunks) => (
                      <Link href="/privacy-policy" className={LINK_CLASS}>
                        {chunks}
                      </Link>
                    ),
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
