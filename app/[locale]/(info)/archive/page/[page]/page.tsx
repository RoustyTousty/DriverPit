import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ArchiveIndex } from "@/components/archive/ArchiveIndex";
import { JsonLd } from "@/components/seo/JsonLd";
import type { Locale } from "@/lib/i18n/locales";
import { archivePagePath, parseArchivePage } from "@/lib/recap/archivePaging";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { breadcrumbJsonLd } from "@/lib/seo/structuredData";

// Pages 2+ of the archive index. Page 1 is /archive, and `parseArchivePage`
// rejects "1" here so there is exactly one URL per page of rows -- two URLs
// serving the same list is the duplicate-content own-goal a canonical tag is
// there to prevent, and the cheapest fix is to not mint the second URL.
//
// The literal `page` segment sits beside the dynamic `[date]` one. Next
// resolves static segments first, so /archive/page/2 lands here and
// /archive/2026-07-31 lands on the day page; /archive/page on its own has no
// page.tsx and 404s, which is the right answer for a URL nothing links to.

export const revalidate = 3600;

type Props = { params: Promise<{ locale: Locale; page: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, page: raw } = await params;
  const page = parseArchivePage(raw);
  const t = await getTranslations({ locale, namespace: "archive.meta" });
  if (page === null) return { title: t("notFound") };

  return buildPageMetadata({
    // The page number is in the title because these pages are near-identical
    // otherwise, and "no two pages share a title" is one of the things
    // `npm run seo:audit` checks.
    title: t("pageTitle", { page }),
    description: t("pageDescription", { page }),
    path: archivePagePath(page),
    locale,
  });
}

export default async function ArchiveIndexPage({ params }: Props) {
  const { locale, page: raw } = await params;
  setRequestLocale(locale);

  const page = parseArchivePage(raw);
  if (page === null) notFound();

  const t = await getTranslations({ locale, namespace: "archive" });

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd(locale, [
          { name: t("breadcrumb.home"), path: "/" },
          { name: t("breadcrumb.archive"), path: "/archive" },
          { name: t("breadcrumb.page", { page }), path: archivePagePath(page) },
        ])}
      />
      <ArchiveIndex page={page} locale={locale} />
    </>
  );
}
