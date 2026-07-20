import { AdSlotGate } from "@/components/ads/AdSlotGate";
import { Footer } from "@/components/layout/Footer";
import { GameChrome } from "@/components/layout/GameChrome";
import { TopBar } from "@/components/layout/TopBar";
import { MarketingSections } from "@/components/marketing/MarketingSections";

// The main game shell (daily/infinite/duel + marketing) -- kept as its own
// route group layout, distinct from app/(info)/layout.tsx's InfoTopBar, so
// the two site sections can have different chrome under one root layout.
// GameChrome (client, reads ActiveMatchContext) hides everything but the
// top bar and the game window itself during a live duel match. Marketing
// and Footer are rendered here (Server Components) and passed down as
// elements, not imported inside GameChrome -- see the comment there.
export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopBar />
      <GameChrome marketing={<MarketingSections />} footer={<Footer />}>
        <main className="flex flex-1 flex-col items-center gap-6 px-4 pt-2 pb-6">
          <div className="w-full max-w-160 rounded-lg border border-border bg-surface">{children}</div>
          <AdSlotGate />
        </main>
      </GameChrome>
    </>
  );
}
