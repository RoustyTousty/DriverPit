import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NEXT } from "@/lib/auth/oauthCallback";

import SignInPage from "./page";

// The page's own job, which is not the form's (AuthPanel.test.tsx covers that):
// decide which of three things a visitor is looking at, and pass the return
// destination through.
//
// The fork is the part worth pinning. EVERY visitor to this site has a session,
// because AuthProvider signs first-time visitors in anonymously -- so "is there
// a session" is always yes and would show a signed-in visitor the guest form and
// a guest the signed-in card. The test is `isGuest`. The reset-password page
// carries the same trap and the same comment.

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: useAuthMock }));
// Stubbed so what is asserted is the page's choice and the prop it passes, not
// the form's contents -- and so this test doesn't drag in supabase.
vi.mock("@/components/auth/AuthPanel", () => ({
  AuthPanel: ({ next }: { next: string }) => <div data-testid="auth-panel" data-next={next} />,
}));
// The real one needs a StaticImageData object; vite hands the .png import back
// as a bare URL string, which next/image rejects for missing width/height.
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

function mockAuth({ isGuest, resolved = true }: { isGuest: boolean; resolved?: boolean }) {
  useAuthMock.mockReturnValue({
    user: { id: "u-1", email: isGuest ? null : "player@example.com", is_anonymous: isGuest },
    profile: { id: "u-1", username: "user482913", displayName: null, avatarUrl: "seed", isGuest },
    isGuest,
    identityStatus: resolved ? "ready" : "loading",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/auth/sign-in");
});

describe("SignInPage", () => {
  it("shows the form to a guest — who already has a session, and is the whole audience", () => {
    mockAuth({ isGuest: true });
    render(<SignInPage />);

    expect(screen.getByTestId("auth-panel")).toBeInTheDocument();
  });

  it("shows a full account the way out instead of a form it doesn't need", () => {
    // Where a confirmed email address lands. Offering the sign-up form again
    // here reads as the confirmation not having worked.
    mockAuth({ isGuest: false });
    render(<SignInPage />);

    expect(screen.queryByTestId("auth-panel")).not.toBeInTheDocument();
    expect(screen.getByText(/player@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to DriverPit" })).toHaveAttribute("href", "/");
  });

  it("shows neither while the identity is still resolving", () => {
    // A guest form flashing in front of someone who turns out to be signed in is
    // the same class of mistake as the daily board's replay flash.
    mockAuth({ isGuest: false, resolved: false });
    render(<SignInPage />);

    expect(screen.queryByTestId("auth-panel")).not.toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("carries ?next= through to the form and to every way out", () => {
    window.history.replaceState(null, "", "/auth/sign-in?next=%2Fonline");
    mockAuth({ isGuest: true });
    render(<SignInPage />);

    expect(screen.getByTestId("auth-panel")).toHaveAttribute("data-next", "/online");
    expect(screen.getByRole("link", { name: "Keep playing as a guest" })).toHaveAttribute("href", "/online");
  });

  it("falls back to the default destination rather than following a crafted next", () => {
    // sanitizeNextPath's job, checked here because this value ends up inside the
    // `redirectTo` handed to Supabase.
    window.history.replaceState(null, "", "/auth/sign-in?next=%2F%2Fevil.example.com");
    mockAuth({ isGuest: true });
    render(<SignInPage />);

    expect(screen.getByTestId("auth-panel")).toHaveAttribute("data-next", DEFAULT_NEXT);
  });
});
