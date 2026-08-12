import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ArchiveIndex } from "@/components/archive/ArchiveIndex";
import { JsonLd } from "@/components/seo/JsonLd";
import type { Locale } from "@/lib/i18n/locales";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { breadcrumbJsonLd } from "@/lib/seo/structuredData";

// In the (info) route group, so it gets the same chrome the other standalone
// content pages get -- InfoTopBar and the footer, no mode tabs, no ad slot.
// An archive page is not a game window, and building it a third kind of shell
// would be a third place to change when the site's header does.

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "archive.meta" });

  return buildPageMetadata({
    title: t("indexTitle"),
    description: t("indexDescription"),
    path: "/archive",
    locale,
  });
}

// A finished day never changes, but this list gains a row every midnight UTC.
// An hour is well inside that and keeps the index off the database on the
// crawl traffic these pages exist to attract.
export const revalidate = 3600;

export default async function ArchivePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "archive" });

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd(locale, [
          { name: t("breadcrumb.home"), path: "/" },
          { name: t("breadcrumb.archive"), path: "/archive" },
        ])}
      />
      <ArchiveIndex page={1} locale={locale} />
    </>
  );
}
