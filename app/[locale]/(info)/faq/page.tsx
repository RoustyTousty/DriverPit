import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Faq } from "@/components/marketing/Faq";
import { JsonLd } from "@/components/seo/JsonLd";
import type { Locale } from "@/lib/i18n/locales";
import { faqEntries } from "@/lib/marketing/faqContent";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { faqPageJsonLd } from "@/lib/seo/structuredData";

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.faq" });

  return buildPageMetadata({
    title: t("title"),
    description: t("description"),
    path: "/faq",
    locale,
  });
}

export default async function FaqPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "faq" });

  return (
    <>
      {/* Built from the same entries the page renders visibly, which is what
          keeps the markup and the content identical -- a requirement of Google's
          structured-data guidelines, not a nicety. That now has to hold in six
          languages, which is why both sides read the SAME translator rather than
          the JSON-LD keeping an English copy: a Spanish page carrying English
          FAQPage markup is a mismatch Google treats as spam. */}
      <JsonLd data={faqPageJsonLd(faqEntries(t))} />
      <Faq />
    </>
  );
}
