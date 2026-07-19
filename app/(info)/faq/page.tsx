import type { Metadata } from "next";

import { Faq } from "@/components/marketing/Faq";

export const metadata: Metadata = {
  title: "FAQ – DriverPit",
  description: "Answers to common questions about how DriverPit's guessing, pools, and modes work.",
};

export default function FaqPage() {
  return <Faq />;
}
