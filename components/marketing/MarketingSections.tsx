import { AboutTeaser } from "@/components/marketing/AboutTeaser";
import { FaqTeaser } from "@/components/marketing/FaqTeaser";
import { GameModesTeaser } from "@/components/marketing/GameModesTeaser";
import { HowToPlayTeaser } from "@/components/marketing/HowToPlayTeaser";
import { NewsSection } from "@/components/marketing/NewsSection";

// Compact teasers only -- each links out to its full-detail page under
// app/(info)/ (see MoreLink) rather than dumping the whole explanation here.
export function MarketingSections() {
  return (
    <div className="mx-auto flex w-full max-w-180 flex-col gap-16 px-4 py-16">
      <HowToPlayTeaser />
      <GameModesTeaser />
      <FaqTeaser />
      <AboutTeaser />
      <NewsSection />
    </div>
  );
}
