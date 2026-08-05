"use client";

import { createContext, useContext } from "react";

import type { SettingsSection } from "@/components/settings/SettingsModal";

interface SettingsModalContextValue {
  // Opens the game shell's Settings modal straight to a given section, from
  // anywhere under the (game) layout rather than only from the top bar's cog.
  //
  // The original reason for the section argument is gone: the duel results
  // panel and the leaderboard used it to reach the auth UI at
  // openSettings("profile"), and that UI is now a page of its own
  // (/auth/sign-in), which they link to instead. Kept because Settings has
  // three sections and deep-linking one is a two-line generality -- but the
  // state still lives up in GameModals rather than in TopBar, which is what
  // lets any descendant open a dialog there is exactly one instance of.
  openSettings: (section: SettingsSection) => void;
  openLeaderboard: () => void;
}

const SettingsModalContext = createContext<SettingsModalContextValue | null>(null);

export const SettingsModalProvider = SettingsModalContext.Provider;

export function useSettingsModal(): SettingsModalContextValue {
  const ctx = useContext(SettingsModalContext);
  if (!ctx) throw new Error("useSettingsModal must be used within GameModals");
  return ctx;
}
