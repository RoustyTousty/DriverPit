import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AdScripts } from "@/components/ads/AdScripts";
import { AdSlot } from "@/components/ads/AdSlot";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { Footer } from "@/components/layout/Footer";
import { ModeTabs } from "@/components/layout/ModeTabs";
import { TopBar } from "@/components/layout/TopBar";
import { MarketingSections } from "@/components/marketing/MarketingSections";
import { MotionSync } from "@/components/settings/MotionSync";

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
  description: "Guess the Formula 1 driver in 5 tries.",
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
        <MotionSync />
        <AuthProvider>
          <TopBar />
          <ModeTabs />

          <main className="flex flex-1 flex-col items-center gap-6 px-4 py-6">
            <div className="w-full max-w-[520px] rounded-lg border border-border bg-surface">
              {children}
            </div>
            <AdSlot />
          </main>

          <div className="mx-auto w-full max-w-[960px] px-4">
            <hr className="border-border" />
          </div>

          <MarketingSections />
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
