"use client";

import { createContext, useContext } from "react";

import type { SettingsSection } from "@/components/settings/SettingsModal";

interface SettingsModalContextValue {
  // Opens the game shell's Settings modal straight to a given section --
  // lets a component far from the top bar (e.g. the duel results panel's
  // guest upgrade prompt) trigger the same sign-in/upgrade UI the
  // leaderboard's "Sign up" nudge uses, without mounting a second modal.
  // Note: CLAUDE.md describes this flow as reusing a standalone
  // "AccountModal" component, but that was never built as its own piece --
  // the settings restructure landed first and absorbed its job into
  // SettingsModal's Profile section, which is what this opens.
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
