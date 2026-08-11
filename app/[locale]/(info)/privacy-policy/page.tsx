import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PrivacyPolicy } from "@/components/marketing/PrivacyPolicy";
import type { Locale } from "@/lib/i18n/locales";
import { buildPageMetadata } from "@/lib/seo/metadata";

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.privacy" });

  return buildPageMetadata({
    title: t("title"),
    description: t("description"),
    path: "/privacy-policy",
    locale,
  });
}

export default async function PrivacyPolicyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <PrivacyPolicy />;
}
