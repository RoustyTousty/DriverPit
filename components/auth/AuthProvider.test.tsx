import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth, useAuthIdentity } from "./AuthProvider";

// Audit 2026-07-30 §1.1, as a fact about renders rather than about a value.
// AuthProvider wraps the whole app, so a single context value made `userId` and
// `stats` one subscription: refresh() after a completed daily -- whose entire
// job is to pull new user_stats into Settings -- re-rendered the board that had
// just finished, for data it does not display. Nothing about that is visible in
// the types, in tsc, or in any pure test; it is only observable by counting
// renders of a real consumer under a real provider, which is what this does
// (§2.6's rule for what earns a place in the dom tier).
//
// The check that matters is the pair: identity must NOT re-render on a stats
// change, and must re-render on an identity change. Only the first would also
// pass against a context that never updates at all.

interface FakeProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string;
  is_guest: boolean;
  created_at: string;
}

interface FakeStatsRow {
  user_id: string;
  games_played: number;
  wins: number;
  current_streak: number;
  max_streak: number;
  guess_distribution: number[];
  last_result: null;
  last_daily_date: string | null;
  duel_rating: number;
  duel_wins: number;
  duel_losses: number;
}

type AuthListener = (event: string, session: unknown) => void;

const fake = vi.hoisted(() => {
  const state = {
    userId: "user-1",
    isAnonymous: false,
    profile: null as FakeProfileRow | null,
    stats: null as FakeStatsRow | null,
    listener: null as AuthListener | null,
  };

  // A FRESH object every call, deliberately: supabase-js re-reads the persisted
  // session and JSON.parses it, so `user` and `session` come back with new
  // identities after every getSession() even when the account has not changed.
  // That is precisely why they live on the account side of the split -- putting
  // them beside `userId` would make the identity context churn on every
  // refresh() and quietly undo the whole thing. A fake that returned one frozen
  // object would let that regression pass.
  const session = () => ({
    access_token: "token",
    user: { id: state.userId, is_anonymous: state.isAnonymous },
  });

  const client = {
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      signInAnonymously: async () => ({
        data: { session: session(), user: session().user },
        error: null,
      }),
      onAuthStateChange: (cb: AuthListener) => {
        state.listener = cb;
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                state.listener = null;
              },
            },
          },
        };
      },
      signOut: async () => ({ error: null }),
    },
    // Only ever reached as .from(table).select("*").eq(col, val).maybeSingle().
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "profiles" ? state.profile : state.stats,
            error: null,
          }),
        }),
      }),
    }),
  };

  return { state, client, session };
});

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => fake.client,
}));
// Server Actions: importing them for real pulls in lib/db (postgres client) and
// next/headers, neither of which exists in jsdom. None is called by these tests.
vi.mock("@/lib/duel/actions", () => ({ forfeitMatch: vi.fn() }));
vi.mock("@/lib/duel/matchmaking", () => ({ leaveQueue: vi.fn() }));
vi.mock("@/lib/stats/actions", () => ({ migrateLocalStats: vi.fn() }));

function profileRow(id: string): FakeProfileRow {
  return {
    id,
    username: `user${id}`,
    display_name: null,
    avatar_url: "seed",
    is_guest: false,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function statsRow(id: string, gamesPlayed: number): FakeStatsRow {
  return {
    user_id: id,
    games_played: gamesPlayed,
    wins: 5,
    current_streak: 0,
    max_streak: 3,
    guess_distribution: [0, 0, 0, 0, 0, 0],
    last_result: null,
    last_daily_date: null,
    duel_rating: 1000,
    duel_wins: 0,
    duel_losses: 0,
  };
}

let identityRenders = 0;
let accountRenders = 0;

// Stands in for DailyBoard: reads identity, and calls refresh() without
// rendering anything it loads -- the exact shape the finding is about.
function IdentityConsumer() {
  identityRenders++;
  const { userId, refresh } = useAuthIdentity();
  return (
    <button type="button" data-testid="refresh" onClick={() => void refresh()}>
      {userId ?? "none"}
    </button>
  );
}

// Stands in for StatisticsSection: renders stats, so it SHOULD re-render.
function AccountConsumer() {
  accountRenders++;
  const { stats } = useAuth();
  return <span data-testid="games">{stats?.gamesPlayed ?? -1}</span>;
}

function renderProvider() {
  return render(
    <AuthProvider>
      <IdentityConsumer />
      <AccountConsumer />
    </AuthProvider>,
  );
}

// Boot is several renders (session resolve, INITIAL_SESSION, profile+stats
// landing) and none of them is what's under test. Wait for the account data to
// be on screen, then zero the counters.
async function bootAndResetCounters() {
  renderProvider();
  await waitFor(() => expect(screen.getByTestId("games")).toHaveTextContent("10"));
  await waitFor(() => expect(screen.getByTestId("refresh")).toHaveTextContent("user-1"));
  identityRenders = 0;
  accountRenders = 0;
}

beforeEach(() => {
  fake.state.userId = "user-1";
  fake.state.isAnonymous = false;
  fake.state.profile = profileRow("user-1");
  fake.state.stats = statsRow("user-1", 10);
  fake.state.listener = null;
  identityRenders = 0;
  accountRenders = 0;
  localStorage.clear();
});

describe("AuthProvider identity/account context split", () => {
  it("does not re-render a userId consumer when stats change", async () => {
    await bootAndResetCounters();

    fake.state.stats = statsRow("user-1", 11);

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh"));
    });
    await waitFor(() => expect(screen.getByTestId("games")).toHaveTextContent("11"));

    // Pre-split this was 1+: `stats` and `userId` were the same context value,
    // and refresh() also replaces `user`/`session` with fresh objects.
    expect(identityRenders).toBe(0);
    expect(accountRenders).toBeGreaterThan(0);
  });

  it("still re-renders a userId consumer when the identity changes", async () => {
    await bootAndResetCounters();

    fake.state.userId = "user-2";
    fake.state.profile = profileRow("user-2");
    fake.state.stats = statsRow("user-2", 10);

    await act(async () => {
      fake.state.listener?.("SIGNED_IN", fake.session());
    });
    await waitFor(() => expect(screen.getByTestId("refresh")).toHaveTextContent("user-2"));

    expect(identityRenders).toBeGreaterThan(0);
  });

  it("exposes both halves through useAuth, so its consumers see one object", async () => {
    function BothConsumer() {
      const { userId, stats, identityStatus, status } = useAuth();
      return (
        <span data-testid="both">{`${userId}/${stats?.gamesPlayed}/${identityStatus}/${status}`}</span>
      );
    }

    render(
      <AuthProvider>
        <BothConsumer />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("both")).toHaveTextContent("user-1/10/ready/ready"),
    );
  });
});
