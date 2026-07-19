"use client";

import { useActiveMatch } from "@/components/duel/ActiveMatchContext";
import { MarketingSections } from "@/components/marketing/MarketingSections";

import { Footer } from "./Footer";
import { ModeTabs } from "./ModeTabs";

// Hidden entirely during an active duel/knockout match -- CLAUDE.md already
// hides the ad slot for the same reason (AdSlotGate); a live race is the
// wrong moment for mode tabs or marketing content competing for attention
// too, so this collapses the shell down to just the top bar (rendered by
// the parent layout, outside this component) and the match itself.
export function GameChrome({ children }: { children: React.ReactNode }) {
  const { active } = useActiveMatch();

  if (active) return <>{children}</>;

  return (
    <>
      <ModeTabs />
      {children}

      <div className="mx-auto w-full max-w-240 px-4">
        <hr className="border-border" />
      </div>

      <MarketingSections />
      <Footer />
    </>
  );
}
