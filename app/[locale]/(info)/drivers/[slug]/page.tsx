import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { DriverAppearances } from "@/components/drivers/DriverAppearances";
import { DriverCareer } from "@/components/drivers/DriverCareer";
import { JsonLd } from "@/components/seo/JsonLd";
import { getDriverPage, listDriverArchiveEvidence } from "@/lib/db/dailyRecap";
import { isDriverPageEligible, playedAppearances } from "@/lib/drivers/pageEligibility";
import { writeDriverSummary } from "@/lib/drivers/summary";
import { formatUtcDate } from "@/lib/i18n/dates";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { Link } from "@/lib/i18n/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { breadcrumbJsonLd, driverPersonJsonLd } from "@/lib/seo/structuredData";

// One page per driver this site has something of its own to say about.
//
// THE GATE IS lib/drivers/pageEligibility.ts AND IT IS NOT OPTIONAL. Read that
// file before widening anything here: several hundred pages of F1DB career data
// on a domain with no authority is doorway content, and it drags down the
// archive pages that are actually earning. Measured on 2026-08-08, the rule
// admits 5 of the ranked pool's 103, and that is the intended outcome -- the set
// grows on its own as finished days accumulate.
//
// IN `(info)`, NOT AT `app/drivers/`. docs/seo-roadmap.md sketches the latter,
// but Pass 3 put the archive in this group and these are the same kind of thing:
// a standalone document with InfoTopBar and the footer. A third kind of chrome
// is what CLAUDE.md's "Site architecture" refuses. The route group's parens are
// stripped, so the URL is still /drivers/<slug>.
//
// NOT PREGENERATED EXHAUSTIVELY, and `dynamicParams` is left at its default:
// generateStaticParams below covers who is eligible at build time, and a driver
// who becomes eligible tomorrow -- by being the answer on a day somebody plays
// -- is rendered on demand at the next request. The 404 for everyone else is
// cached for the same hour, so a newly eligible driver appears within one
// revalidate window rather than at the next deploy.

export const revalidate = 3600;

type Props = { params: Promise<{ locale: Locale; slug: string }> };

// The eligible set CROSSED WITH THE LOCALES. `generateStaticParams` in a nested
// dynamic segment must supply every dynamic param above it as well -- returning
// only `{ slug }` here would leave `locale` unfilled and none of these pages
// would be pregenerated at all, silently, with the route still working on
// demand. Five drivers times six locales is 30 pages, which is a rounding error
// against the archive this cross-product would be unaffordable for (hence that
// route having no generateStaticParams at all).
export async function generateStaticParams(): Promise<{ locale: Locale; slug: string }[]> {
  const evidence = await listDriverArchiveEvidence();
  const slugs = evidence
    .filter((driver) => isDriverPageEligible(driver.appearances))
    .map((driver) => driver.slug);

  return LOCALES.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const driver = await getDriverPage(slug);
  const t = await getTranslations({ locale, namespace: "driverPage" });
  // The page itself calls notFound(); this only avoids inheriting the root title
  // on the 404 that is about to render.
  if (!driver || !isDriverPageEligible(driver.appearances)) return { title: t("notFound") };

  const played = playedAppearances(driver.appearances);
  // The description leads with the site-unique fact rather than the career one,
  // because the career one is what every other result for this name already
  // says. "Been the answer N times" is the reason to click this one.
  const appearances =
    played.length === 1
      ? t("meta.appearedOnce", { date: formatUtcDate(played[0].date, locale) })
      : t("meta.appearedMany", { count: played.length });

  return buildPageMetadata({
    title: t("meta.title", { driver: driver.fullName }),
    description: t("meta.description", {
      appearances,
      driver: driver.fullName,
      wins: driver.careerWins,
      podiums: driver.podiums,
      titles: driver.championshipWins,
      // A string, not a number: a `{debut, number}` placeholder is grouped by
      // the locale, and "2007" becomes "2.007" in five of the six.
      debut: String(driver.debutYear),
    }),
    path: `/drivers/${driver.slug}`,
    locale,
  });
}

export default async function DriverPageRoute({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const driver = await getDriverPage(slug);
  // One 404 for both "no such driver" and "nothing to say about them", at one
  // call site. They are the same answer to a visitor and the same answer to a
  // crawler, and splitting them would put the threshold in two places.
  if (!driver || !isDriverPageEligible(driver.appearances)) notFound();

  const t = await getTranslations({ locale, namespace: "driverPage" });
  const summaryT = await getTranslations({ locale, namespace: "driverSummary" });

  const summary = writeDriverSummary(driver, {
    currentYear: new Date().getUTCFullYear(),
    locale,
    formatDate: (date) => formatUtcDate(date, locale),
    t: summaryT,
  });

  return (
    <article className="flex flex-col gap-10">
      <JsonLd
        data={breadcrumbJsonLd(locale, [
          { name: t("breadcrumbHome"), path: "/" },
          { name: driver.fullName, path: `/drivers/${driver.slug}` },
        ])}
      />
      <JsonLd
        data={driverPersonJsonLd({
          fullName: driver.fullName,
          nationality: driver.nationality,
          locale,
          path: `/drivers/${driver.slug}`,
          jobTitle: t("jobTitle"),
          // The page renders an age, not a birth date -- the board compares on
          // age -- but the markup wants the date, which is the value that does
          // not go stale.
          birthDate: driver.dateOfBirth,
          deathDate: driver.dateOfDeath,
        })}
      />

      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-wide text-text-muted uppercase">
          {driver.nationality} · {driver.debutYear}
          {driver.debutYear !== driver.lastActiveYear && `–${driver.lastActiveYear}`}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-text">{driver.fullName}</h1>
      </header>

      {/* The auto-written paragraph. Composed from this driver's own numbers by
          lib/drivers/summary.ts -- see that file for why it picks sentence
          shapes rather than filling one template, and for the two facts it
          refuses to state together. */}
      <p className="text-lg leading-relaxed text-text">{summary.join(" ")}</p>

      <DriverCareer driver={driver} />

      <DriverAppearances driver={driver} />

      <nav className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Link
          href="/archive"
          className="rounded-lg border border-border px-3 py-2 text-sm text-text transition hover:border-accent/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ← {t("backToArchive")}
        </Link>
        <Link
          href="/"
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {t("playToday")}
        </Link>
      </nav>
    </article>
  );
}
