import type { Metadata } from "next";

import { HowToPlay } from "@/components/marketing/HowToPlay";

export const metadata: Metadata = {
  title: "How to play – DriverPit",
  description: "The full rules: tile colors, closeness shading, and a worked example guess.",
};

export default function HowToPlayPage() {
  return <HowToPlay />;
}
