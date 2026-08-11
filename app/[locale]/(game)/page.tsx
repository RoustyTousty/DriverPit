import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { JsonLd } from "@/components/seo/JsonLd";
import { getLatestArchiveDate } from "@/lib/db/dailyRecap";
import { listPoolDriverOptions } from "@/lib/db/queries";
import { getDailyPuzzleNumber } from "@/lib/game/dailySelection";
import type { Locale } from "@/lib/i18n/locales";
import { DAILY_POOL_WINDOW } from "@/lib/game/poolWindow";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { videoGameJsonLd } from "@/lib/seo/structuredData";

import { DailyGame } from "./DailyGame";

type Props = { params: Promise<{ locale: Locale }> };

// The daily game, served at `/` (roadmap Pass 5). It used to live at `/daily`
// with the root 308ing to it, which spent a redirect on the most-linked URL the
// site has -- the bare domain is what people paste, and it was not a page.
// `/daily` is now the redirect, in the other direction, for inbound links only.
//
// Its files sit directly in app/(game)/ for the same reason: this route IS the
// group's root, so `loading.tsx` here is the daily skeleton. That is safe next
// to /infinite and /online because each has a loading.tsx of its own, and React
// shows the NEAREST boundary -- this one can only appear for `/`.

// Dynamic rather than a static export, so the title and description carry the
// puzzle number and today's date. That is a real freshness signal on the one
// page whose content genuinely changes every day, and it costs nothing: the
// number is a pure function of the date (lib/game/dailySelection.ts) with no
// query behind it, and this recomputes on the same 60s ISR cycle as the page.
//
// Nothing here can leak the answer -- the puzzle NUMBER says which day it is,
// not who the driver is, which is exactly the split dailySelection.ts exists to
// preserve.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.daily" });
  // The date in the description is the one visible per-locale value on this
  // page's metadata, so it is formatted by the locale's own rules rather than
  // hard-coded en-GB -- "8 August 2026" is not how a German or Brazilian reader
  // writes that date, and a search snippet is exactly where that shows.
  const format = await getFormatter({ locale });

  const todayUtc = new Date().toISOString().slice(0, 10);
  const puzzleNumber = getDailyPuzzleNumber(todayUtc);
  const readableDate = format.dateTime(new Date(`${todayUtc}T00:00:00.000Z`), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return buildPageMetadata({
    title: t("title", { number: puzzleNumber }),
    description: t("description", { number: puzzleNumber, date: readableDate }),
    path: "/",
    locale,
  });
}

// Same data for every visitor at a given moment (never per-user), so this
// doesn't need force-dynamic -- that disabled caching *and* Link
// prefetching entirely, forcing a full DB round trip on every single mode
// switch. ISR instead: cached for a minute, which is an imperceptible
// staleness window for a puzzle that only changes once a day.
export const revalidate = 60;

export default async function DailyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "site" });
  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10);

  // In parallel: the board's own data cannot wait on a link, and the archive
  // read is a single indexed max() against daily_targets.
  const [eligibleDrivers, latestArchiveDate] = await Promise.all([
    listPoolDriverOptions(DAILY_POOL_WINDOW, now.getUTCFullYear()),
    getLatestArchiveDate(),
  ]);
  const puzzleNumber = getDailyPuzzleNumber(todayUtc);

  return (
    <>
      {/* The game entity, declared once for the whole site and here rather than
          in the layout -- this is the site's front door and the page that
          should rank for the game's own name. */}
      <JsonLd data={videoGameJsonLd(locale, t("description"))} />
      <DailyGame
        eligibleDrivers={eligibleDrivers}
        puzzleNumber={puzzleNumber}
        hasPuzzleToday={eligibleDrivers.length > 0}
        latestArchiveDate={latestArchiveDate}
      />
    </>
  );
}
