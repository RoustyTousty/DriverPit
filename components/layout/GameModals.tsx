"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { useAuthIdentity } from "@/components/auth/AuthProvider";
import type { SettingsSection } from "@/components/settings/SettingsModal";

import { SettingsModalProvider } from "./SettingsModalContext";

// Audit 2026-07-29 §1.4. Both modals used to be static imports, and this
// component sits in the (game) layout -- so the daily board and /infinite paid for the
// whole Settings tree and, through LeaderboardModal -> AvatarGlyph, DiceBear
// (~67 KB) on first load, to render nothing at all until a top-bar button is
// pressed and for an avatar that is never visible on either route.
//
// `ssr: false` because there is nothing to server-render: both start closed,
// and Modal portals into document.body anyway. `loading: () => null` for the
// same reason -- a fallback would be inline markup where a dialog isn't.
//
// Type-only import of SettingsSection above, so naming the section a caller
// wants doesn't drag the module back onto the critical path (types erase;
// SettingsModalContext imports it the same way).
const SettingsModal = dynamic(
  () => import("@/components/settings/SettingsModal").then((m) => m.SettingsModal),
  { ssr: false, loading: () => null },
);
const LeaderboardModal = dynamic(
  () => import("@/components/leaderboard/LeaderboardModal").then((m) => m.LeaderboardModal),
  { ssr: false, loading: () => null },
);

type OpenModal = "settings" | "leaderboard" | null;

// Owns the game shell's two global modals (Settings, Leaderboard) and
// exposes openers via SettingsModalContext. This state used to live inside
// TopBar itself, which worked while the top bar's own buttons were the only
// way in; it moved up here so a component deep under the game window (a
// sibling subtree) could open one too, without mounting a second copy. Still
// exactly one instance of each modal.
//
// The original such caller -- the duel results panel's guest prompt, which
// opened Settings -> Profile -- no longer needs it: the auth UI is a page now
// (/auth/sign-in) and every guest prompt on the site is a plain link to it.
// That is what removed LeaderboardModal's `onUpgrade` prop.
export function GameModals({ children }: { children: React.ReactNode }) {
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  // One-way latches: a lazy component's chunk is fetched when it first
  // *renders*, so leaving `<SettingsModal open={false} />` mounted from the
  // start would pull both chunks on every game route and buy nothing.
  //
  // One-way rather than `openModal === "settings" && ...` because Modal plays a
  // 200ms exit transition before it unmounts itself; dropping the wrapper the
  // instant openModal clears would cut that off. Once a modal has been opened,
  // its chunk is already loaded, so staying mounted costs one null render --
  // exactly what it cost before this change.
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [leaderboardMounted, setLeaderboardMounted] = useState(false);

  // Both modals render this visitor's own profile and stats, so opening either
  // is one of the moments an identity is genuinely needed (roadmap Pass 4a).
  // Fired here rather than inside the modals because this is the click: the
  // sign-in overlaps the chunk render and the profile fetch instead of
  // following them, and there is one place to look rather than two.
  const { ensureIdentity } = useAuthIdentity();
  const value = useMemo(
    () => ({
      openSettings: (section: SettingsSection) => {
        void ensureIdentity();
        setSettingsSection(section);
        setSettingsMounted(true);
        setOpenModal("settings");
      },
      openLeaderboard: () => {
        void ensureIdentity();
        setLeaderboardMounted(true);
        setOpenModal("leaderboard");
      },
    }),
    [ensureIdentity],
  );

  // Warm both chunks once the page has gone idle. The split above is about
  // keeping them off the *critical* path, not about never fetching them:
  // without this, the first press of the cup or the cog waits on a network
  // round trip that used to be paid during the initial load, which would trade
  // one regression for another. Idle time is free; a click is not.
  //
  // Same specifiers as the dynamic() factories above, so this populates the
  // very chunk they resolve -- by the time either renders, its promise is
  // already settled.
  useEffect(() => {
    const warm = () => {
      void import("@/components/settings/SettingsModal");
      void import("@/components/leaderboard/LeaderboardModal");
    };
    // requestIdleCallback is unavailable on Safari before 16.4; the timeout
    // fallback is the same intent, just without the scheduler's help.
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timeout = setTimeout(warm, 2000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <SettingsModalProvider value={value}>
      {children}
      {settingsMounted && (
        <SettingsModal
          open={openModal === "settings"}
          onClose={() => setOpenModal(null)}
          initialSection={settingsSection}
        />
      )}
      {leaderboardMounted && (
        <LeaderboardModal open={openModal === "leaderboard"} onClose={() => setOpenModal(null)} />
      )}
    </SettingsModalProvider>
  );
}
