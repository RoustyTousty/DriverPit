import type { Metadata } from "next";
import { GeistSans as geistSans } from "geist/font/sans";
import { GeistMono as geistMono } from "geist/font/mono";

import { AdScripts } from "@/components/ads/AdScripts";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { OAuthErrorHandler } from "@/components/auth/OAuthErrorHandler";
import { ActiveMatchProvider } from "@/components/duel/ActiveMatchContext";
import { SettingsSync } from "@/components/settings/SettingsSync";
import { ToastProvider } from "@/components/ui/Toast";

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
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}
      >
        <AdScripts />
        <SettingsSync />
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
