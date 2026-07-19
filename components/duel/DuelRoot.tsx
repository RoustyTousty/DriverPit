"use client";

import { useState } from "react";

import type { DriverOption } from "@/components/game/DriverAutocomplete";

import { DuelLanding } from "./DuelLanding";
import { MatchmakingLobby } from "./MatchmakingLobby";

export function DuelRoot({ eligibleDrivers }: { eligibleDrivers: DriverOption[] }) {
  const [inQueue, setInQueue] = useState(false);

  if (inQueue) {
    return <MatchmakingLobby eligibleDrivers={eligibleDrivers} onCancel={() => setInQueue(false)} />;
  }

  return <DuelLanding onSelectDuel={() => setInQueue(true)} />;
}
