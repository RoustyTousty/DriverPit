import { useLocale, useTranslations } from "next-intl";

import { DEFAULT_LOCALE } from "@/lib/i18n/locales";

// Shown above the privacy policy and the terms on every locale EXCEPT English.
//
// This is the roadmap's one hard rule about the legal pages: they may be
// translated, but a translation must say it is one. The English text is the
// operative version, and a reader in another language has to be told that
// before they rely on a sentence about data retention or liability — not after.
//
// Rendered on the page rather than buried in a footnote, and above the content
// rather than below it, because a disclosure nobody reaches is not a disclosure.
// English gets nothing at all: there is no original to point at.
export function LegalTranslationNotice() {
  const locale = useLocale();
  const t = useTranslations("legal");

  if (locale === DEFAULT_LOCALE) return null;

  return (
    <p
      // `note`, not `alert`: it is standing context for the page, not something
      // that just happened, and an alert would interrupt a screen reader every
      // time the page loads.
      role="note"
      className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-text-muted"
    >
      {t("translationNotice")}
    </p>
  );
}
