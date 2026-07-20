"use client";

import { useActiveMatch } from "@/components/duel/ActiveMatchContext";

import { ModeTabs } from "./ModeTabs";

// Hidden entirely during an active duel/knockout match -- CLAUDE.md already
// hides the ad slot for the same reason (AdSlotGate); a live race is the
// wrong moment for mode tabs or marketing content competing for attention
// too, so this collapses the shell down to just the top bar (rendered by
// the parent layout, outside this component) and the match itself.
//
// `marketing`/`footer` come in as already-rendered elements from the
// Server Component layout rather than being imported here -- a "use
// client" module can't import a Server Component directly (MarketingSections
// has an async Server Component, NewsSection's NewsBody, deep inside it;
// importing it from a client file forces the whole subtree into the client
// bundle, which async Server Components can't run in). Passing it down as a
// prop is the supported composition pattern.
export function GameChrome({
  children,
  marketing,
  footer,
}: {
  children: React.ReactNode;
  marketing: React.ReactNode;
  footer: React.ReactNode;
}) {
  const { active } = useActiveMatch();

  if (active) return <>{children}</>;

  return (
    <>
      <ModeTabs />
      {children}

      <div className="mx-auto w-full max-w-240 px-4">
        <hr className="border-border" />
      </div>

      {marketing}
      {footer}
    </>
  );
}
