import { useTranslations } from "next-intl";

import { MoreLink } from "./MoreLink";

// The home page's shorter FAQ. Deliberately NOT a subset of lib/marketing/
// faqContent.ts: these answers are rewritten short rather than truncated, so
// they are different content and get their own keys. The structured data belongs
// on the full page regardless.
const QA_KEYS = [
  "dailyReset",
  "unknownDriver",
  "teamMeaning",
  "shading",
  "pool",
  "multiplayer",
] as const;

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

export function FaqTeaser() {
  const t = useTranslations("marketing.faqTeaser");

  return (
    <section id="faq" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">{t("heading")}</h2>
      <div className="flex flex-col gap-2">
        {QA_KEYS.map((key) => (
          <details key={key} className="group rounded-lg border border-border bg-surface-2 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
              {t(`items.${key}.q`)}
              <ChevronIcon />
            </summary>
            <p className="mt-2 text-sm text-text-muted">{t(`items.${key}.a`)}</p>
          </details>
        ))}
      </div>
      <MoreLink href="/faq">{t("more")}</MoreLink>
    </section>
  );
}
