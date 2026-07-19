import type { Metadata } from "next";

import { GameModes } from "@/components/marketing/GameModes";

export const metadata: Metadata = {
  title: "Game modes – DriverPit",
  description: "What Daily, Infinite, and Duel each play like, and what Knockout will bring.",
};

export default function GameModesPage() {
  return <GameModes />;
}
