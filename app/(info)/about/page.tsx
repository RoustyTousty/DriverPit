import type { Metadata } from "next";

import { AboutSection } from "@/components/marketing/AboutSection";

export const metadata: Metadata = {
  title: "About – DriverPit",
  description:
    "What DriverPit is, the four ways to play it, and who builds it — a free, independent Formula 1 guessing game.",
};

export default function AboutPage() {
  return <AboutSection />;
}
