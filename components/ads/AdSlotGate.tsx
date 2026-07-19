"use client";

import { useActiveMatch } from "@/components/duel/ActiveMatchContext";

import { AdSlot } from "./AdSlot";

export function AdSlotGate() {
  const { active } = useActiveMatch();
  if (active) return null;
  return <AdSlot />;
}
