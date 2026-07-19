"use client";

import { createContext, useContext, useState } from "react";

interface ActiveMatchContextValue {
  active: boolean;
  setActive: (active: boolean) => void;
}

const ActiveMatchContext = createContext<ActiveMatchContextValue | null>(null);

// Lets DuelMatch (deep under /duel) tell the root layout's ad slot (a
// sibling, not an ancestor/descendant of it) to hide itself for the
// duration of a live match -- see CLAUDE.md: "Hide the ad slot during an
// active duel/knockout match."
export function ActiveMatchProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  return <ActiveMatchContext.Provider value={{ active, setActive }}>{children}</ActiveMatchContext.Provider>;
}

export function useActiveMatch(): ActiveMatchContextValue {
  const ctx = useContext(ActiveMatchContext);
  if (!ctx) throw new Error("useActiveMatch must be used within an ActiveMatchProvider");
  return ctx;
}
