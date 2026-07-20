import type { Metadata } from "next";

import { TermsOfService } from "@/components/marketing/TermsOfService";

export const metadata: Metadata = {
  title: "Terms of service – DriverPit",
  description: "The terms that apply to playing DriverPit and creating an account.",
};

export default function TermsOfServicePage() {
  return <TermsOfService />;
}
