import { AboutTeaser } from "@/components/marketing/AboutTeaser";
import { FaqTeaser } from "@/components/marketing/FaqTeaser";
import { GameModesTeaser } from "@/components/marketing/GameModesTeaser";
import { HowToPlayTeaser } from "@/components/marketing/HowToPlayTeaser";
import { NewsSection } from "@/components/marketing/NewsSection";
import { SupportCallout } from "@/components/marketing/SupportCallout";

// Compact teasers only -- each links out to its full-detail page under
// app/(info)/ (see MoreLink) rather than dumping the whole explanation here.
// SupportCallout is the one exception and has no page behind it; see its own
// comment.
//
// The support ask sits directly after About on purpose: About is where the
// reader learns this is one person's side project, and that is the sentence the
// ask only makes sense after. Before it, "buy me a coffee" is addressed to
// nobody in particular.
export function MarketingSections() {
  return (
    <div className="mx-auto flex w-full max-w-180 flex-col gap-16 px-4 py-16">
      <HowToPlayTeaser />
      <GameModesTeaser />
      <FaqTeaser />
      <AboutTeaser />
      <SupportCallout />
      <NewsSection />
    </div>
  );
}
