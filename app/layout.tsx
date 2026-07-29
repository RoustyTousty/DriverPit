import type { Metadata } from "next";
import { GeistSans as geistSans } from "geist/font/sans";
import { GeistMono as geistMono } from "geist/font/mono";

import { AdScripts } from "@/components/ads/AdScripts";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { OAuthErrorHandler } from "@/components/auth/OAuthErrorHandler";
import { ActiveMatchProvider } from "@/components/duel/ActiveMatchContext";
import { ToastProvider } from "@/components/ui/Toast";
import { COLORBLIND_BOOTSTRAP_SCRIPT } from "@/lib/settings/store";

import "./globals.css";

export const metadata: Metadata = {
  title: "DriverPit",
  description: "Guess the Formula 1 driver in 6 tries.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the script below writes data-colorblind onto
    // <html> before React hydrates, which React would otherwise report as an
    // extra attribute from the server.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}
      >
        {/* First thing in the document and deliberately render-blocking: it
            must set the colorblind attribute before anything paints, or the
            tiles flash the default green. next/script can't do this -- even
            beforeInteractive loads after the shell -- so it's a raw inline
            <script>, the same technique as theme-flash prevention. */}
        <script dangerouslySetInnerHTML={{ __html: COLORBLIND_BOOTSTRAP_SCRIPT }} />
        <AdScripts />
        <ToastProvider>
          <OAuthErrorHandler />
          <AuthProvider>
            <ActiveMatchProvider>{children}</ActiveMatchProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
