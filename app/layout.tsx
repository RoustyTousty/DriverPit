import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AdScripts } from "@/components/ads/AdScripts";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { OAuthErrorHandler } from "@/components/auth/OAuthErrorHandler";
import { ActiveMatchProvider } from "@/components/duel/ActiveMatchContext";
import { SettingsSync } from "@/components/settings/SettingsSync";
import { ToastProvider } from "@/components/ui/Toast";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
