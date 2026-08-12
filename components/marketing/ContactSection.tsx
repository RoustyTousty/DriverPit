import { useTranslations } from "next-intl";

import { CONTACT_EMAIL, SOCIAL_PROFILES, contactMailto } from "@/lib/marketing/contact";
import { Link } from "@/lib/i18n/navigation";

const LINK_CLASS =
  "font-medium text-text underline decoration-border underline-offset-2 hover:text-accent";

// STRUCTURE HERE, PROSE IN messages/*.json -- the same split every other
// marketing component makes. The four reasons someone writes in are a list whose
// ORDER is an editorial decision (a bug report is the most likely and the most
// useful, a data request is the one with a legal obligation behind it), so a
// translator rewording a line must not be able to reorder or drop one.
//
// Each reason carries its own mailto subject, and that is the one thing on this
// page doing real work rather than being polite: an inbox that receives four
// kinds of mail all titled nothing is an inbox that answers none of them. The
// subject line is English in every locale on purpose -- it is a filing label for
// the person reading, not copy for the person writing.
const REASONS = [
  { key: "bug", subject: "DriverPit — bug report" },
  { key: "data", subject: "DriverPit — data request" },
  { key: "driverData", subject: "DriverPit — driver data correction" },
  { key: "other", subject: "DriverPit — hello" },
] as const;

export function ContactSection() {
  const t = useTranslations("marketing.contact");

  return (
    <section id="contact" className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-text">{t("heading")}</h1>
        <p className="text-sm text-text-muted">{t("intro")}</p>
      </div>

      {/* The address, once, as the page's primary action. Big enough to read
          off a screen and copy by hand, and a real mailto so it is one tap on a
          phone. Not obfuscated against scrapers: an address a reviewer cannot
          see is an address that fails the check this page exists to pass, and
          every obfuscation trick that defeats a scraper also defeats a
          screen reader or a browser with JS disabled. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-4">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">
          {t("emailLabel")}
        </p>
        <a
          href={contactMailto()}
          className="font-mono text-base break-all text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {CONTACT_EMAIL}
        </a>
        <p className="text-xs text-text-muted">{t("responseTime")}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text">{t("reasonsHeading")}</h2>
        <dl className="flex flex-col gap-3">
          {REASONS.map((reason) => (
            <div key={reason.key} className="rounded-lg border border-border bg-surface-2 p-4">
              <dt className="text-sm font-semibold text-text">
                <a
                  href={contactMailto(reason.subject)}
                  className="hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {t(`reasons.${reason.key}.title`)}
                </a>
              </dt>
              <dd className="mt-1 text-sm text-text-muted">{t(`reasons.${reason.key}.body`)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text">{t("socialHeading")}</h2>
        <p className="text-sm text-text-muted">{t("socialBody")}</p>
        <ul className="flex flex-wrap gap-2">
          {SOCIAL_PROFILES.map((profile) => (
            <li key={profile.label}>
              {/* Plain <a>, not the locale-aware Link: these leave the site, so
                  there is no prefix to add. */}
              <a
                href={profile.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm transition hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="font-semibold text-text">{profile.label}</span>
                <span className="font-mono text-xs text-text-muted">{profile.handle}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-text-muted">
        {t.rich("beforeWriting", {
          faq: (chunks) => (
            <Link href="/faq" className={LINK_CLASS}>
              {chunks}
            </Link>
          ),
          howToPlay: (chunks) => (
            <Link href="/how-to-play" className={LINK_CLASS}>
              {chunks}
            </Link>
          ),
        })}
      </p>

      <p className="text-xs text-text-muted">{t("disclaimer")}</p>
    </section>
  );
}
