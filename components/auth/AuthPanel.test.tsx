import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RESET_PASSWORD_PATH } from "@/lib/auth/routes";

import { AuthPanel } from "./AuthPanel";

// The app's whole email/password + Google auth UI, as rendered DOM. What is
// pinned here is the shape of the promise it makes -- that a player can pick
// their own password, and can come back to the account later with it -- because
// every part of that is a fact about what is on screen and what the click
// sends, which `tsc` cannot see.
//
// These tests came from ProfileSection.test.tsx and moved with the form when it
// left the Settings modal for /auth/sign-in. They were written against a version
// that had one email field and one "Continue" button (magic link only, no
// password, so an account was only reachable from the device that made it), and
// each still fails against it.

const useAuthMock = vi.hoisted(() => vi.fn());
const supabaseMock = vi.hoisted(() => ({
  auth: {
    updateUser: vi.fn(),
    linkIdentity: vi.fn(),
    resetPasswordForEmail: vi.fn(),
  },
}));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
const commitmentsMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: useAuthMock }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => supabaseMock }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toastMock }));
vi.mock("@/lib/duel/duelCommitments", () => ({ getDuelCommitments: commitmentsMock }));

const signInWithPassword = vi.fn();
// Every path in this panel now mints the guest it is about to upgrade before
// calling GoTrue -- see AuthPanel.handleCreateAccount.
const ensureIdentity = vi.fn();

function renderPanel(next = "/") {
  useAuthMock.mockReturnValue({ refresh: vi.fn(), signInWithPassword, ensureIdentity });
  return render(<AuthPanel next={next} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  commitmentsMock.mockReturnValue({ matchLive: false, queued: false, hostingLobby: false });
  // The shape GoTrue actually returns with "Confirm email" ON: the address is
  // pending, so the row is still anonymous until the link is opened.
  supabaseMock.auth.updateUser.mockResolvedValue({ data: { user: { is_anonymous: true } }, error: null });
  supabaseMock.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  supabaseMock.auth.linkIdentity.mockResolvedValue({ error: null });
  signInWithPassword.mockResolvedValue(undefined);
  ensureIdentity.mockResolvedValue("guest-1");
});

describe("AuthPanel", () => {
  it("offers both a password to choose and a way back into an existing account", async () => {
    renderPanel();

    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Sign in" })).toBeInTheDocument();
  });

  it("sends the email and the password in ONE updateUser call", async () => {
    // Load-bearing, not stylistic: GoTrue refuses to set a password on an
    // anonymous user unless the same request also carries the address it will
    // belong to ("Updating password of an anonymous user without an email or
    // phone is not allowed"). Split into two calls, the password half fails and
    // the account is created without one -- which is exactly the state this
    // feature exists to get out of.
    const user = userEvent.setup();
    renderPanel("/online");

    await user.type(screen.getByLabelText("Email"), "  Player@Example.COM  ");
    await user.type(screen.getByLabelText("Password"), "brundle-1994");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(supabaseMock.auth.updateUser).toHaveBeenCalledTimes(1);
    const [attributes, options] = supabaseMock.auth.updateUser.mock.calls[0];
    // Folded, so signing in later with the lowercase form is the same account.
    expect(attributes).toEqual({ email: "player@example.com", password: "brundle-1994" });
    // Named so the arrival toast doesn't claim they signed in with Google.
    expect(options.emailRedirectTo).toContain("flow=email");
    // And back to where the player came FROM, not to the page holding this form.
    // The panel used to build this from window.location.pathname, which was
    // Settings' own route; on a dedicated sign-in page that would land a player
    // who just confirmed their address straight back on the sign-in page.
    expect(new URL(options.emailRedirectTo).searchParams.get("next")).toBe("/online");
  });

  it("sends Google back to where the player came from too", async () => {
    const user = userEvent.setup();
    renderPanel("/online");

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    // linkIdentity, never signInWithOAuth: linking preserves the guest's
    // identity (and so their stats and rating), and the already-claimed case
    // comes back as identity_already_exists for OAuthErrorHandler to recover.
    expect(supabaseMock.auth.linkIdentity).toHaveBeenCalledTimes(1);
    const [{ options }] = supabaseMock.auth.linkIdentity.mock.calls[0];
    expect(new URL(options.redirectTo).searchParams.get("next")).toBe("/online");
  });

  it("only promises an email when one is actually going to arrive", async () => {
    // Whether a confirmation is sent is the Supabase project's "Confirm email"
    // setting, not ours. With it off the address is applied on the spot, and
    // telling the player to check an inbox for a link that will never come is
    // indistinguishable from the feature being broken.
    supabaseMock.auth.updateUser.mockResolvedValue({ data: { user: { is_anonymous: false } }, error: null });
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.type(screen.getByLabelText("Password"), "brundle-1994");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(toastMock.success).toHaveBeenCalledWith(expect.stringMatching(/account created/i));
    expect(screen.queryByText(/open the link to finish/i)).not.toBeInTheDocument();
  });

  it("refuses a too-short password before spending a request on it", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 8 characters/i);
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it("routes a sign-in through AuthProvider rather than straight at supabase", async () => {
    // AuthProvider.signInWithPassword is where the outgoing guest's live match,
    // queue row and open lobby get released before the identity is abandoned.
    // Calling supabase.auth.signInWithPassword here instead would strand all
    // three -- a stale queue row is the rating-farming vector drizzle/0032
    // exists to close.
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("tab", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Email"), "Player@Example.com");
    await user.type(screen.getByLabelText("Password"), "brundle-1994");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signInWithPassword).toHaveBeenCalledWith("player@example.com", "brundle-1994");
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it("asks before signing in would forfeit a live match", async () => {
    // Signing IN as someone else abandons the current identity exactly as
    // signing out does. Nothing may leave until the player has said so.
    commitmentsMock.mockReturnValue({ matchLive: true, queued: false, hostingLobby: false });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("tab", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.type(screen.getByLabelText("Password"), "brundle-1994");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Forfeit your match?")).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Forfeit and sign in" }));
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("does not carry an error across the tabs, where it would mean the opposite", async () => {
    // "That email already has an account" is a failure on Create account and
    // the whole premise of Sign in.
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Sign in" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends a reset link to the address in the field", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("tab", { name: "Sign in" }));
    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(supabaseMock.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    const [address, options] = supabaseMock.auth.resetPasswordForEmail.mock.calls[0];
    expect(address).toBe("player@example.com");
    // Through /auth/callback (which does the code exchange) and on to the page
    // that actually takes the new password, with the flow named so the arrival
    // toast stays quiet there. NOT the panel's `next`: a recovery link has one
    // destination and it isn't wherever the player happened to be.
    const redirect = new URL(options.redirectTo);
    expect(redirect.pathname).toBe("/auth/callback");
    expect(redirect.searchParams.get("flow")).toBe("recovery");
    expect(redirect.searchParams.get("next")).toBe(RESET_PASSWORD_PATH);
  });
});
