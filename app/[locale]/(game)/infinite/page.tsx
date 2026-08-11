import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { listAllDriverOptionsWithActivity } from "@/lib/db/queries";
import type { Locale } from "@/lib/i18n/locales";
import { buildPageMetadata } from "@/lib/seo/metadata";

import { InfiniteGame } from "./InfiniteGame";

type Props = { params: Promise<{ locale: Locale }> };

// Written for the unlimited-practice searches. Every competing F1 guessing game
// is one puzzle a day; unlimited rounds over a pool the player composes is a
// thing only this site does, so this page has a real shot at its own terms
// rather than competing for the head term on brand strength it does not have
// yet. The description names the four filters because those ARE the long tail --
// someone searching "f1 quiz ferrari drivers" is describing this feature without
// knowing its name.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.infinite" });

  return buildPageMetadata({
    title: t("title"),
    description: t("description"),
    path: "/infinite",
    locale,
  });
}

// The roster itself isn't per-user or per-request -- only the weekly
// Jolpica cron changes it (see CLAUDE.md) -- and per-request round state
// lives in server actions / a session cookie, not this page's data. An
// hour of ISR staleness here is unnoticeable and turns every mode switch
// back into a cache hit instead of a fresh ~800-row query.
export const revalidate = 3600;

export default async function InfinitePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const allDrivers = await listAllDriverOptionsWithActivity();

  return <InfiniteGame allDrivers={allDrivers} />;
}
