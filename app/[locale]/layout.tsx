import type { Metadata } from "next";
import { GeistSans as geistSans } from "geist/font/sans";
import { GeistMono as geistMono } from "geist/font/mono";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdScripts } from "@/components/ads/AdScripts";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { OAuthErrorHandler } from "@/components/auth/OAuthErrorHandler";
import { ActiveMatchProvider } from "@/components/duel/ActiveMatchContext";
import { JsonLd } from "@/components/seo/JsonLd";
import { ToastProvider } from "@/components/ui/Toast";
import { LOCALES, type Locale, OG_LOCALES } from "@/lib/i18n/locales";
import { routing } from "@/lib/i18n/routing";
import { COLORBLIND_BOOTSTRAP_SCRIPT } from "@/lib/settings/store";
import { localeOgImage } from "@/lib/seo/metadata";
import { SITE_NAME, SITE_URL, siteVerification } from "@/lib/seo/site";
import { websiteJsonLd } from "@/lib/seo/structuredData";

import "../globals.css";

// THE root layout. It sits under `[locale]` rather than at `app/` because
// `<html lang>` is a per-locale value and there is exactly one place that
// attribute is written -- a wrong `lang` is what makes a screen reader read
// Spanish with English phonemes, and it is also a ranking signal.
//
// The three route files that stayed at `app/` (sitemap, robots, manifest,
// opengraph-image) and the two route handlers (`/api/recap/...`,
// `/auth/callback`) render no HTML, so they need no layout above them.

// Renders all six locales at build time instead of on first request. Without
// this every locale is dynamic, which loses the ISR that the daily page and the
// archive depend on.
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "site" });

  // Search Console / Bing Webmaster ownership tokens, when they are configured.
  // Set here rather than per page because verification is a property of the
  // SITE, and the services look for the tag on whichever URL they were pointed
  // at -- which for a domain property is `/`, and for a hand-typed one could be
  // any page. A layout-level tag is on all of them. See lib/seo/site.ts for why
  // this is env-driven and why an empty value must emit nothing.
  const verification = siteVerification();

  return {
    metadataBase: new URL(SITE_URL),
    ...(verification ? { verification } : {}),
    title: {
      default: t("title"),
      // Child pages set a bare title and the site name is appended once, here.
      template: `%s – ${SITE_NAME}`,
    },
    description: t("description"),
    applicationName: SITE_NAME,
    // NO site-wide `alternates.canonical`. It was here when `/` was a 308 with
    // no page of its own; `/` is the daily game now (Pass 5) and sets its own
    // through buildPageMetadata, like every other indexable page. A layout-level
    // canonical is INHERITED, and the only pages that would inherit it are the
    // two `/auth/*` ones -- each then declaring itself a duplicate of the home
    // page while also carrying noindex, which is a contradictory pair.
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OG_LOCALES[locale],
      title: t("title"),
      description: t("description"),
      url: SITE_URL,
      images: [localeOgImage(locale)],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: [localeOgImage(locale).url],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        // The defaults are conservative and there is nothing here worth
        // withholding from a result.
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": -1,
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  // A dynamic segment matches anything, so `/xx/faq` arrives here with an
  // unknown locale. 404 is the honest answer -- rendering the default locale's
  // content at `/xx/faq` would mint an unlimited supply of duplicate URLs.
  if (!hasLocale(routing.locales, locale)) notFound();

  // Opts this subtree back into static rendering. Without it, reading the
  // locale from the request marks every page below as dynamic and the daily
  // page's `revalidate = 60` stops meaning anything.
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "site" });

  return (
    // suppressHydrationWarning: the script below writes data-colorblind onto
    // <html> before React hydrates, which React would otherwise report as an
    // extra attribute from the server.
    <html lang={locale as Locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}
      >
        {/* First thing in the document and deliberately render-blocking: it
            must set the colorblind attribute before anything paints, or the
            tiles flash the default green. next/script can't do this -- even
            beforeInteractive loads after the shell -- so it's a raw inline
            <script>, the same technique as theme-flash prevention. */}
        <script dangerouslySetInnerHTML={{ __html: COLORBLIND_BOOTSTRAP_SCRIPT }} />
        {/* Site-level identity. The game itself is described on `/` rather than
            here -- this layout wraps every route, and repeating the VideoGame
            entity on nine of them describes nine games. */}
        <JsonLd data={websiteJsonLd(locale, t("description"))} />
        <AdScripts />
        {/* Messages are handed to the client tree here, once. Every client
            component below reads them through `useTranslations` rather than
            receiving translated strings as props, so a string used in two
            places cannot end up translated in one of them. */}
        <NextIntlClientProvider>
          <ToastProvider>
            <OAuthErrorHandler />
            <AuthProvider>
              <ActiveMatchProvider>{children}</ActiveMatchProvider>
            </AuthProvider>
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
