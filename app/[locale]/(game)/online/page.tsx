import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { DuelRoot } from "@/components/duel/DuelRoot";
import { listAllDriverOptionsWithActivity } from "@/lib/db/queries";
import type { Locale } from "@/lib/i18n/locales";
import { DAILY_POOL_WINDOW, poolCutoffYear } from "@/lib/game/poolWindow";
import { buildPageMetadata } from "@/lib/seo/metadata";

type Props = { params: Promise<{ locale: Locale }> };

// The Online tab's landing (mode select -> lobby -> live match -> results):
// Duel, Custom, and Knockout still to come (see CLAUDE.md). Not per-user, so
// ISR rather than force-dynamic -- see app/infinite/page.tsx for why.
//
// Fetches the FULL roster, the same query /infinite already serves under the
// same 1-hour ISR, rather than listPoolDriverOptions(DAILY_POOL_WINDOW). A
// custom lobby's filter panel needs every driver to compute its cascading
// counts, and a custom match's autocomplete needs THAT match's filtered set
// rather than the 20-year pool. Costs roughly 250 rows -> 800 on a cached
// route.
//
// Both lists are then derived client-side from pure predicates already in the
// repo (poolCutoffYear here, matchesDriverFilter in the lobby), so there is one
// source and no "which list am I on" bug.
export const revalidate = 3600;

// The strongest page on the site from a search point of view, and the one that
// had no metadata at all. "f1 multiplayer guessing game", "f1 game with
// friends", "play f1 quiz against someone" -- every one of those has demand and
// no good answer, because every competing F1 guessing game is single-player.
// Both halves are named deliberately: matchmaking against a stranger and a
// private code you send a friend are different searches with different intent.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.online" });

  return buildPageMetadata({
    title: t("title"),
    description: t("description"),
    path: "/online",
    locale,
  });
}

export default async function OnlinePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const referenceYear = new Date().getUTCFullYear();
  const allDrivers = await listAllDriverOptionsWithActivity();

  // A ranked duel still plays out of DAILY_POOL_WINDOW, so its autocomplete
  // gets exactly the list it always did -- narrowed from the full roster here
  // instead of by a second query.
  const cutoff = poolCutoffYear(DAILY_POOL_WINDOW, referenceYear);
  const eligibleDrivers = allDrivers
    .filter((driver) => cutoff === null || driver.lastActiveYear >= cutoff)
    .map((driver) => ({
      id: driver.id,
      fullName: driver.fullName,
      nationality: driver.nationality,
    }));

  return (
    <DuelRoot eligibleDrivers={eligibleDrivers} allDrivers={allDrivers} referenceYear={referenceYear} />
  );
}
