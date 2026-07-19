import type { Metadata } from "next";

import { AboutSection } from "@/components/marketing/AboutSection";

export const metadata: Metadata = {
  title: "About – DriverPit",
  description: "Where DriverPit's driver data comes from and how the driver pools and comparisons work.",
};

export default function AboutPage() {
  return <AboutSection />;
}
