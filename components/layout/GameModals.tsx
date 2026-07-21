"use client";

import { useMemo, useState } from "react";

import { LeaderboardModal } from "@/components/leaderboard/LeaderboardModal";
import { SettingsModal, type SettingsSection } from "@/components/settings/SettingsModal";

import { SettingsModalProvider } from "./SettingsModalContext";

type OpenModal = "settings" | "leaderboard" | null;

// Owns the game shell's two global modals (Settings, Leaderboard) and
// exposes openers via SettingsModalContext. This state used to live inside
// TopBar itself, which worked while the top bar's own buttons were the only
// way in -- but the duel results panel (deep under the game window, a
// sibling subtree) needs to open Settings -> Profile for its guest upgrade
// prompt, so the state moved up here where both TopBar and the game window
// are descendants. Still exactly one instance of each modal.
export function GameModals({ children }: { children: React.ReactNode }) {
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");

  const value = useMemo(
    () => ({
      openSettings: (section: SettingsSection) => {
        setSettingsSection(section);
        setOpenModal("settings");
      },
      openLeaderboard: () => setOpenModal("leaderboard"),
    }),
    [],
  );

  return (
    <SettingsModalProvider value={value}>
      {children}
      <SettingsModal
        open={openModal === "settings"}
        onClose={() => setOpenModal(null)}
        initialSection={settingsSection}
      />
      <LeaderboardModal
        open={openModal === "leaderboard"}
        onClose={() => setOpenModal(null)}
        onUpgrade={() => value.openSettings("profile")}
      />
    </SettingsModalProvider>
  );
}
