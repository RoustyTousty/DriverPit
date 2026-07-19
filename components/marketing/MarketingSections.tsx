import { AboutSection } from "@/components/marketing/AboutSection";
import { Faq } from "@/components/marketing/Faq";
import { HowToPlay } from "@/components/marketing/HowToPlay";
import { NewsSection } from "@/components/marketing/NewsSection";

export function MarketingSections() {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-16 px-4 py-16">
      <HowToPlay />
      <Faq />
      <AboutSection />
      <NewsSection />
    </div>
  );
}
