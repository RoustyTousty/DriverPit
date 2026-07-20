import type { Metadata } from "next";

import { PrivacyPolicy } from "@/components/marketing/PrivacyPolicy";

export const metadata: Metadata = {
  title: "Privacy policy – DriverPit",
  description: "What data DriverPit collects, why, and what choices you have about it.",
};

export default function PrivacyPolicyPage() {
  return <PrivacyPolicy />;
}
