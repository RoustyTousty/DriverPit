import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { GameModes } from "@/components/marketing/GameModes";
import type { Locale } from "@/lib/i18n/locales";
import { buildPageMetadata } from "@/lib/seo/metadata";

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.gameModes" });

  return buildPageMetadata({
    title: t("title"),
    description: t("description"),
    path: "/game-modes",
    locale,
  });
}

export default async function GameModesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <GameModes />;
}
