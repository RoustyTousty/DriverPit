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

  // `children` (the actual game window -- DuelRoot's whole match/queue
  // state tree, among others) must stay at the same position in this
  // fragment's children across the active/inactive branches. Without
  // this, toggling `active` (DuelMatch calls setActive(true) the instant
  // a round starts) shifts children's index in React's eyes -- from 1
  // (after ModeTabs) to 0 -- which reads as a type mismatch at that slot
  // and makes React tear down and remount the whole subtree from scratch,
  // resetting DuelRoot's inQueue state back to the landing screen the
  // moment a match actually starts. Conditionally rendering *around*
  // children instead of conditionally returning different trees keeps its
  // slot stable no matter what active is.
  return (
    <>
      {!active && <ModeTabs />}
      {children}
      {!active && (
        <>
          <div className="mx-auto w-full max-w-240 px-4">
            <hr className="border-border" />
          </div>

          {marketing}
          {footer}
        </>
      )}
    </>
  );
}
