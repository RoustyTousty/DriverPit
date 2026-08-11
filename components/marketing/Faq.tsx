import { useTranslations } from "next-intl";

import { FAQ_KEYS } from "@/lib/marketing/faqContent";

// The question ORDER and KEYS live in lib/marketing/faqContent.ts and the prose
// lives in messages/*.json, because app/[locale]/(info)/faq/page.tsx renders the
// same content as FAQPage structured data and the two must not be able to
// disagree -- in any locale. FaqTeaser keeps its own shorter list; see the note
// there.
//
// A Server Component calling `useTranslations`: that is supported and is the
// point of next-intl's server integration. It stays a Server Component because
// nothing here is interactive -- `<details>` does the disclosure natively.

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function Faq() {
  const t = useTranslations("faq");

  return (
    <section id="faq" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">{t("heading")}</h2>
      <div className="flex flex-col gap-2">
        {FAQ_KEYS.map((key) => (
          <details key={key} className="group rounded-lg border border-border bg-surface-2 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
              {t(`items.${key}.q`)}
              <ChevronIcon />
            </summary>
            <p className="mt-2 text-sm text-text-muted">{t(`items.${key}.a`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
