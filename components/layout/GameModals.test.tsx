import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GameModals } from "./GameModals";
import { useSettingsModal } from "./SettingsModalContext";

// Audit 2026-07-29 §1.4. The `next/dynamic` split closed with "not verified in
// a browser" (§2.6), and what went unverified is not the import -- the module
// graph was A/B'd against a dev server -- but the two things the resolution
// calls load-bearing around it:
//
//   1. Neither modal RENDERS before it is opened. A lazy component's chunk is
//      fetched when it first renders, so an always-mounted `open={false}` would
//      pull both chunks on every game route and buy nothing.
//   2. Once opened, the wrapper STAYS mounted. Modal plays a 200ms exit
//      transition before unmounting itself, so `openModal === "settings" && ...`
//      would cut that off.
//
// Both survive a `tsc` clean and both are the sort of thing a later
// "simplification" removes on sight. The real modals are stubbed: what is
// asserted is GameModals' own mounting rule, not the dialogs' contents.

vi.mock("@/components/settings/SettingsModal", () => ({
  SettingsModal: ({ open, initialSection }: { open: boolean; initialSection: string }) => (
    <div data-testid="settings-modal" data-open={String(open)} data-section={initialSection} />
  ),
}));

vi.mock("@/components/leaderboard/LeaderboardModal", () => ({
  LeaderboardModal: ({ open }: { open: boolean }) => (
    <div data-testid="leaderboard-modal" data-open={String(open)} />
  ),
}));

function Openers() {
  const { openSettings, openLeaderboard } = useSettingsModal();
  return (
    <>
      <button onClick={() => openSettings("profile")}>open settings</button>
      <button onClick={openLeaderboard}>open leaderboard</button>
    </>
  );
}

function setup() {
  render(
    <GameModals>
      <Openers />
    </GameModals>,
  );
  return userEvent.setup();
}

describe("GameModals", () => {
  it("renders neither modal until one is opened", () => {
    setup();

    expect(screen.queryByTestId("settings-modal")).toBeNull();
    expect(screen.queryByTestId("leaderboard-modal")).toBeNull();
  });

  it("mounts only the modal that was asked for", async () => {
    const user = setup();

    await user.click(screen.getByRole("button", { name: "open settings" }));

    expect(await screen.findByTestId("settings-modal")).toHaveAttribute("data-open", "true");
    expect(screen.queryByTestId("leaderboard-modal")).toBeNull();
  });

  // The one-way latch. Unmounting here would cut off Modal's exit transition,
  // and the chunk is already loaded by now, so staying mounted costs one null
  // render -- exactly what it cost before the split.
  it("keeps the modal mounted after it closes, so its exit can play", async () => {
    const user = setup();

    await user.click(screen.getByRole("button", { name: "open leaderboard" }));
    const modal = await screen.findByTestId("leaderboard-modal");
    expect(modal).toHaveAttribute("data-open", "true");

    // Closing goes through the modal's own onClose; drive it the way the app
    // does, by opening the other one.
    await user.click(screen.getByRole("button", { name: "open settings" }));

    expect(screen.getByTestId("leaderboard-modal")).toHaveAttribute("data-open", "false");
  });

  // The duel results panel's guest prompt opens Settings straight to Profile,
  // which is the whole reason this state sits up here rather than in TopBar.
  it("passes the requested section through to Settings", async () => {
    const user = setup();

    await user.click(screen.getByRole("button", { name: "open settings" }));

    expect(await screen.findByTestId("settings-modal")).toHaveAttribute(
      "data-section",
      "profile",
    );
  });
});
