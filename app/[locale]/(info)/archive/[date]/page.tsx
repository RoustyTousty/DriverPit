import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AnswerBoardRow } from "@/components/archive/AnswerBoardRow";
import { RecapStats } from "@/components/archive/RecapStats";
import { JsonLd } from "@/components/seo/JsonLd";
import { getArchiveDayContext, getDailyRecap } from "@/lib/db/dailyRecap";
import { isDriverPageEligible } from "@/lib/drivers/pageEligibility";
import { Link } from "@/lib/i18n/navigation";
import { formatUtcDate } from "@/lib/i18n/dates";
import type { Locale } from "@/lib/i18n/locales";
import { isArchiveDayIndexable } from "@/lib/recap/dayEligibility";
import { formatPercent } from "@/lib/recap/format";
import { writeRecapSummary } from "@/lib/recap/summary";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { breadcrumbJsonLd } from "@/lib/seo/structuredData";

// One indexable page per finished day. The content engine: everything else in
// docs/seo-roadmap.md is a fixed amount of work, and this is the only asset
// that compounds.
//
// NOT generateStaticParams over the archive. Two years in that would be 730
// pages rendered on every build for a set that grows by one a day and is almost
// never revisited -- and with six locales it would be 4,380. ISR on demand
// instead: the first request for a given day in a given locale renders it,
// everything after is cached.
//
// 404 IS THE DEFAULT, and the check is not in this file. `getDailyRecap`
// returns null for a malformed date, an unknown one, and one that is not over
// yet, comparing against the DATABASE clock; the route cannot become a way to
// ask about today, whatever it is handed.

export const revalidate = 3600;

type Props = { params: Promise<{ locale: Locale; date: string }> };

// The wide recap card from Pass 2, rather than an `opengraph-image.tsx` of this
// segment's own. Next's file convention attaches such a card by merging it into
// the segment's resolved metadata -- and `buildPageMetadata` sets `openGraph`,
// which REPLACES that resolved value outright (the defect `npm run seo:audit`
// found on 2026-08-07). So the URL has to be named explicitly either way, and
// naming the route that already exists beats a second Satori route with a
// second outputFileTracingIncludes entry rendering identical bytes.
//
// `locale` is a query parameter rather than a path segment because the route
// lives outside `[locale]` -- it is an API route, not a page, and moving it
// under the locale segment would put a rewrite in front of an endpoint social
// scrapers fetch directly.
function recapImage(date: string, locale: Locale, alt: string) {
  return {
    url: `/api/recap/${date}/image?format=wide&locale=${locale}`,
    width: 1200,
    height: 630,
    alt,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, date } = await params;
  const recap = await getDailyRecap(date);
  const t = await getTranslations({ locale, namespace: "archive" });
  // The page itself calls notFound(); this just avoids inheriting the root
  // title on the 404 that is about to render.
  if (!recap) return { title: t("meta.notFound") };

  const readableDate = formatUtcDate(date, locale);
  // The answer IS the description, deliberately. These pages exist to be the
  // authoritative result for "DriverPit answer 31 July" and hiding the driver
  // behind a click would lose that query to anyone who does not. The day is
  // over; there is nothing left to spoil.
  const outcome =
    recap.completed > 0 ? t("meta.dayOutcome", { percent: formatPercent(recap.solveRate) }) : "";

  return buildPageMetadata({
    title: t("meta.dayTitle", { number: recap.puzzleNumber, date: readableDate }),
    description: t("meta.dayDescription", {
      date: readableDate,
      number: recap.puzzleNumber,
      driver: recap.target.fullName,
      outcome,
    }),
    path: `/archive/${date}`,
    locale,
    image: recapImage(date, locale, t("meta.cardAlt", { date: readableDate })),
    // A day nobody played has nothing of its own to say: the answer plus five
    // career facts F1DB states better. It still renders, still sits in the
    // index and still carries prev/next -- it is simply not offered to the
    // crawler. `isArchiveDayIndexable` is the SAME predicate app/sitemap.ts
    // filters on, so the two cannot disagree about which URLs are advertised.
    // See lib/recap/dayEligibility.ts for the measurement behind the rule.
    noIndex: !isArchiveDayIndexable(recap),
  });
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border px-3 py-2 text-sm text-text transition hover:border-accent/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </Link>
  );
}

export default async function ArchiveDayPage({ params }: Props) {
  const { locale, date } = await params;
  setRequestLocale(locale);

  const [recap, context] = await Promise.all([getDailyRecap(date), getArchiveDayContext(date)]);
  if (!recap || !context) notFound();

  const t = await getTranslations({ locale, namespace: "archive" });
  const summaryT = await getTranslations({ locale, namespace: "recapSummary" });

  const readableDate = formatUtcDate(date, locale);
  const summary = writeRecapSummary(recap, context, summaryT);

  // Does the answer have a page of their own to link to?
  //
  // Asked by running the SAME predicate the driver route 404s on, over this one
  // day as its evidence. That is exact rather than approximate: if this day
  // alone satisfies the rule then the page exists, whatever else the driver has
  // done, so the link can never land on a 404 — and if the rule is ever changed,
  // this moves with it instead of going stale. See lib/drivers/pageEligibility.
  const driverHref =
    recap.target.slug &&
    isDriverPageEligible([
      { date, puzzleNumber: recap.puzzleNumber, players: recap.players, completed: recap.completed, solved: recap.solved },
    ])
      ? `/drivers/${recap.target.slug}`
      : null;

  return (
    <article className="flex flex-col gap-10">
      <JsonLd
        data={breadcrumbJsonLd(locale, [
          { name: t("breadcrumb.home"), path: "/" },
          { name: t("breadcrumb.archive"), path: "/archive" },
          { name: readableDate, path: `/archive/${date}` },
        ])}
      />

      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-wide text-text-muted uppercase">
          <Link href="/archive" className="hover:text-text">
            {t("breadcrumb.archive")}
          </Link>{" "}
          · {t("puzzleNumber", { number: recap.puzzleNumber })}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-text">
          {t("dayHeading", { date: readableDate, driver: recap.target.fullName })}
        </h1>
      </header>

      <section className="flex flex-col gap-4">
        <AnswerBoardRow target={recap.target} />
        {/* Under the board row rather than wrapping the H1: the heading is this
            page's own title and a link inside it would compete with the answer
            it states. This is the outbound half of the archive<->driver
            cross-link, and the only path a crawler has into a driver page. */}
        {driverHref && (
          <p className="text-sm">
            <Link href={driverHref} className="text-accent hover:underline">
              {t("driverLink", { driver: recap.target.fullName })}
            </Link>
          </p>
        )}
      </section>

      {/* The auto-written paragraph. Composed from the day's own numbers by
          lib/recap/summary.ts -- see that file for why it picks sentence shapes
          rather than filling one template, and why a quiet day gets one
          sentence instead of three padded ones. */}
      <p className="text-lg leading-relaxed text-text">{summary.join(" ")}</p>

      <RecapStats recap={recap} />

      <nav className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        {context.previousDate && (
          <NavLink href={`/archive/${context.previousDate}`}>
            ← {formatUtcDate(context.previousDate, locale)}
          </NavLink>
        )}
        {context.nextDate && (
          <NavLink href={`/archive/${context.nextDate}`}>
            {formatUtcDate(context.nextDate, locale)} →
          </NavLink>
        )}
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
