import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SIGN_IN_PATH } from "@/lib/auth/routes";

import { ProfileSection } from "./ProfileSection";

// Settings -> Profile after the auth form moved out to /auth/sign-in
// (components/auth/AuthPanel, and AuthPanel.test.tsx pins the form itself).
//
// Two things are worth pinning here, and both are about the move rather than
// about the section's internals:
//
//   1. A guest is given the way to an account, and the form is GONE rather than
//      duplicated. Two live copies of an auth form is the failure mode this
//      extraction exists to prevent -- one of them would quietly stop being the
//      one that gets fixed.
//   2. Sign-out still confirms before it abandons a live match. That prompt is
//      the only thing standing between the cog and a forfeited rated duel, and
//      it stayed behind when the sign-IN half of it left with the form.

const useAuthMock = vi.hoisted(() => vi.fn());
const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
const commitmentsMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => supabaseMock }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toastMock }));
vi.mock("@/lib/duel/duelCommitments", () => ({ getDuelCommitments: commitmentsMock }));
// Unrelated to what's under test, and it pulls in DiceBear. Its own behaviour
// belongs to its own tests.
vi.mock("./AvatarPicker", () => ({ AvatarPicker: () => null }));

const signOutAndReset = vi.fn();

function renderSection({ isGuest }: { isGuest: boolean }) {
  useAuthMock.mockReturnValue({
    user: { id: "u-1", email: isGuest ? null : "player@example.com", is_anonymous: isGuest },
    profile: { id: "u-1", username: "user482913", displayName: null, avatarUrl: "seed", isGuest },
    loading: false,
    refresh: vi.fn(),
    ensureIdentity: vi.fn().mockResolvedValue("user-1"),
    signOutAndReset,
  });
  return render(<ProfileSection />);
}

beforeEach(() => {
  vi.clearAllMocks();
  commitmentsMock.mockReturnValue({ matchLive: false, queued: false, hostingLobby: false });
  signOutAndReset.mockResolvedValue(undefined);
});

describe("ProfileSection", () => {
  it("sends a guest to the sign-in page instead of holding a second copy of the form", () => {
    renderSection({ isGuest: true });

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", SIGN_IN_PATH);
    // The form lives in exactly one place now.
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Create account" })).not.toBeInTheDocument();
  });

  it("asks before signing out would forfeit a live match", async () => {
    commitmentsMock.mockReturnValue({ matchLive: true, queued: false, hostingLobby: false });
    const user = userEvent.setup();
    renderSection({ isGuest: false });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("Forfeit your match?")).toBeInTheDocument();
    expect(signOutAndReset).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Forfeit and sign out" }));
    expect(signOutAndReset).toHaveBeenCalledTimes(1);
  });

  it("signs out straight away when nothing is in flight", async () => {
    // A needless "are you sure?" on the common path just trains people to
    // dismiss the one that matters.
    const user = userEvent.setup();
    renderSection({ isGuest: false });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOutAndReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Forfeit your match?")).not.toBeInTheDocument();
  });
});
