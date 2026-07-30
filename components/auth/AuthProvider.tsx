"use client";

import { isAuthRetryableFetchError, type Session, type User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { forfeitMatch } from "@/lib/duel/actions";
import { getLiveMatchId, isQueued } from "@/lib/duel/duelCommitments";
import { leaveQueue } from "@/lib/duel/matchmaking";
import { awaitInFlightGuess } from "@/lib/game/inFlightGuess";
import { migrateLocalStats } from "@/lib/stats/actions";
import { normalizeDistribution } from "@/lib/stats/guessDistribution";
import { currentStreakAsOf, todayUtcDateString } from "@/lib/stats/streak";
import { readStats, resetStats } from "@/lib/stats/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries only transient network/fetch failures (isAuthRetryableFetchError)
// -- a genuinely invalid or revoked refresh token comes back as a different
// error and should fail fast, not spin here. Exists because mobile devices
// commonly hit exactly this on app resume: the network is still
// reassociating (wifi/cellular handoff, DNS cold) for the first request or
// two, which used to be indistinguishable from "no session" below and would
// silently replace a perfectly recoverable real session with a brand new
// anonymous one.
async function withRetry<R extends { error: unknown }>(fn: () => Promise<R>, attempts = 5): Promise<R> {
  let result = await fn();
  for (let attempt = 1; attempt < attempts && result.error && isAuthRetryableFetchError(result.error); attempt++) {
    await sleep(Math.min(500 * 2 ** attempt, 8000));
    result = await fn();
  }
  return result;
}

// Row shapes as returned by PostgREST (exact column names, snake_case) —
// mapped below to camelCase app-facing types. Not generated from a
// Database type yet (no `supabase gen types` wiring in this repo); once
// the accounts schema stabilizes it's worth generating proper types
// instead of these hand-written row interfaces.
interface ProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string;
  is_guest: boolean;
  created_at: string;
}

interface UserStatsRow {
  user_id: string;
  games_played: number;
  wins: number;
  current_streak: number;
  max_streak: number;
  guess_distribution: number[];
  last_result: { won: boolean; guessCount: number } | null;
  last_daily_date: string | null;
  duel_rating: number;
  duel_wins: number;
  duel_losses: number;
}

export interface Profile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string;
  isGuest: boolean;
  createdAt: string;
}

export interface UserStats {
  userId: string;
  gamesPlayed: number;
  wins: number;
  // Already decayed to 0 if the streak is dead -- see toUserStats. Consumers
  // render this directly and must NOT re-derive it from lastDailyDate.
  currentStreak: number;
  maxStreak: number;
  // Always MAX_GUESSES buckets -- see toUserStats. Consumers render this
  // directly and must NOT re-pad it or invent a fallback length.
  guessDistribution: number[];
  lastResult: { won: boolean; guessCount: number } | null;
  // The UTC day of the last recorded daily result, null if there is none.
  lastDailyDate: string | null;
  duelRating: number;
  duelWins: number;
  duelLosses: number;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    isGuest: row.is_guest,
    createdAt: row.created_at,
  };
}

function toUserStats(row: UserStatsRow): UserStats {
  return {
    userId: row.user_id,
    gamesPlayed: row.games_played,
    wins: row.wins,
    // Decayed HERE, not in the view that renders it, so no consumer can forget:
    // a streak breaks by not playing, and nothing writes user_stats on a day
    // you skip -- the stored number just stays frozen at its last value. It's
    // only real if the last recorded result was today or yesterday
    // (lib/stats/streak.ts). The leaderboard gets the same treatment in SQL
    // (drizzle/0037), where it also has to drive ORDER BY.
    //
    // This uses the device clock, unlike every write (which resolves its date
    // in the database). A skewed clock can therefore only mis-display the
    // viewer's own streak for a few hours around UTC midnight; nothing
    // authoritative -- what's stored, what's ranked -- moves with it.
    currentStreak: currentStreakAsOf(row.current_streak, row.last_daily_date, todayUtcDateString()),
    maxStreak: row.max_streak,
    // Normalised HERE for the same reason the streak is decayed here: so no
    // consumer can forget. drizzle/0016 moved guess_distribution's default from
    // five buckets to six and backfilled nothing, so a row created before it is
    // still five long and would render five bars.
    guessDistribution: normalizeDistribution(row.guess_distribution),
    lastResult: row.last_result,
    lastDailyDate: row.last_daily_date,
    duelRating: row.duel_rating,
    duelWins: row.duel_wins,
    duelLosses: row.duel_losses,
  };
}

export type AuthStatus = "loading" | "ready";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  stats: UserStats | null;
  // Convenience projections of `user`/`profile` that every game window keys
  // off, per CLAUDE.md "Auth state is reactive, everywhere".
  userId: string | null;
  isGuest: boolean;
  // TWO separate readiness signals -- keeping them apart is what stops a game
  // board from waiting on data it doesn't render (CLAUDE.md: "The board's first
  // paint never waits on profile/stats").
  //
  // `identityStatus` is "ready" the moment `userId` is known and stable, with
  // NO regard for profile/stats. It's the signal a game window gates on: the
  // only thing /daily needs before firing daily_state() is which account it's
  // fetching for. Chaining the board behind `status` below is what turned the
  // board load into seconds.
  identityStatus: AuthStatus;
  // `loading` until the *current* identity's profile/stats are resolved --
  // true again when signing in resolves to a DIFFERENT user id (not the common
  // guest upgrade, which links in place and keeps the id, but the
  // identity_already_exists path in OAuthErrorHandler, which signs you into
  // your other account). That's the signal a per-user view uses to show its
  // gate instead of the previous identity's data. Sign-out no longer produces
  // this state at all -- it reloads the page (signOutAndReset). This is the
  // signal for views that actually render profile/stats (Settings, Statistics,
  // Leaderboard) -- NOT for boards. `loading` is kept as an alias of
  // `status === "loading"` for existing consumers.
  status: AuthStatus;
  loading: boolean;
  // Re-fetches profile/stats for the current user — call after an action
  // that's expected to have changed them (e.g. the signup trigger firing,
  // an upgrade completing).
  refresh: () => Promise<void>;
  // The ONLY sign-out entry point -- no component may call
  // supabase.auth.signOut() directly. Releases server-side commitments, signs
  // out, then hard-reloads to "/". Throws WITHOUT signing out if the cleanup
  // fails, so callers must surface the error rather than assume it succeeded.
  // Resolves only in that failure case; on success the page is navigating away.
  signOutAndReset: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  // The initial session resolve (first paint). `status` (derived below) also
  // reports "loading" during later identity swaps, but this flag is only about
  // that very first resolution.
  const [initialLoading, setInitialLoading] = useState(true);
  // The id whose profile/stats are the ones currently in state. Drives the
  // reactive `status`: while it lags the live `user.id` (an identity just
  // changed), the current identity isn't resolved yet -> "loading".
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  // Mirrors the live user id synchronously so an in-flight profile/stats load
  // can tell it's been superseded by a newer identity and bail, instead of
  // writing the previous identity's rows over the current one's.
  const currentIdRef = useRef<string | null>(null);
  // The id a profile/stats load has already been STARTED for. init() and the
  // onAuthStateChange subscription both observe the very same initial session
  // (the listener fires once on subscribe with event "INITIAL_SESSION"), so
  // without this the first page load fired two identical profiles+user_stats
  // fetches -- four redundant PostgREST calls per visit. refresh() deliberately
  // ignores this guard: it's an explicit "re-read now" after a known change.
  const profileLoadStartedForRef = useRef<string | null>(null);

  const loadProfileAndStats = useCallback(
    async (userId: string) => {
      profileLoadStartedForRef.current = userId;
      const [{ data: profileRow, error: profileError }, { data: statsRow, error: statsError }] =
        await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          supabase.from("user_stats").select("*").eq("user_id", userId).maybeSingle(),
        ]);

      if (profileError) console.error("Failed to load profile", profileError);
      if (statsError) console.error("Failed to load user_stats", statsError);

      // A newer identity superseded this load mid-flight -- discard it so we
      // never render one identity's data under another.
      if (currentIdRef.current !== userId) return;

      setProfile(profileRow ? toProfile(profileRow as ProfileRow) : null);
      setStats(statsRow ? toUserStats(statsRow as UserStatsRow) : null);
      setResolvedId(userId);
    },
    [supabase],
  );

  const refresh = useCallback(async () => {
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();
    const nextUser = currentSession?.user ?? null;
    setSession(currentSession);
    setUser(nextUser);
    currentIdRef.current = nextUser?.id ?? null;
    if (nextUser) {
      await loadProfileAndStats(nextUser.id);
    } else {
      setProfile(null);
      setStats(null);
      setResolvedId(null);
    }
  }, [supabase, loadProfileAndStats]);

  // Mount only: resolve (or create) the initial session, then hand off to
  // onAuthStateChange for everything that happens after — sign-out,
  // upgrade completing, token refresh.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { data: { session: currentSession }, error: sessionError } = await withRetry(() =>
        supabase.auth.getSession(),
      );

      if (currentSession) {
        if (cancelled) return;
        setSession(currentSession);
        setUser(currentSession.user);
        currentIdRef.current = currentSession.user.id;
        // NOT awaited: profile/stats feed Settings/Statistics/Leaderboard, and
        // nothing that blocks a game board. Awaiting it here is what put two
        // PostgREST round trips in front of every board's first fetch --
        // identity is resolved the moment the session is, so let the board go
        // now and let this land in parallel.
        void loadProfileAndStats(currentSession.user.id);
      } else if (sessionError && isAuthRetryableFetchError(sessionError)) {
        // Couldn't reach Supabase after retrying -- this is very likely a
        // real, recoverable session that the network just couldn't refresh
        // right now (the exact case on mobile app-resume, before the
        // network has reassociated). Do NOT fall through to
        // signInAnonymously(): that would create and persist a brand new
        // guest session, overwriting the real one's refresh token in
        // storage with no way back. Leave signed out for this load; the
        // next reload (or a future refresh attempt once the network is
        // back) will pick the real session back up.
        console.error("Could not restore session after retries", sessionError);
      } else {
        // Genuinely no session (not a fetch error, an actual empty
        // result): first visit, or a session that's truly gone. Sign in
        // anonymously so every visitor has a real identity (and a
        // trigger-seeded profile/stats row) from the start. Retried the
        // same way -- a first-time visitor on a flaky mobile connection
        // deserves the same resilience as a returning one.
        const { data, error } = await withRetry(() => supabase.auth.signInAnonymously());
        if (error) {
          console.error("Anonymous sign-in failed", error);
        } else if (!cancelled) {
          setSession(data.session);
          setUser(data.user);
          currentIdRef.current = data.user?.id ?? null;
          // Same as above -- identity is what the board waits on, not this.
          if (data.user) void loadProfileAndStats(data.user.id);
        }
      }

      if (!cancelled) setInitialLoading(false);
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      const newUser = newSession?.user ?? null;
      setSession(newSession);
      setUser(newUser);

      if (newUser) {
        // A genuinely different identity (sign-in as another account, or the
        // fresh guest after a sign-out) -- not a same-id token refresh. Drop
        // the previous identity's profile/stats *now* so nothing renders stale
        // while the new ones load; `status` reports "loading" until they do.
        const identityChanged = newUser.id !== currentIdRef.current;
        currentIdRef.current = newUser.id;
        if (identityChanged) {
          setProfile(null);
          setStats(null);
          setResolvedId(null);
        }
        // Skip when a load for this exact id is already in flight or done --
        // otherwise the "INITIAL_SESSION" event this listener receives on
        // subscribe duplicates init()'s load on every single page visit. A real
        // identity change always passes (different id), and refresh() bypasses
        // this path entirely.
        if (profileLoadStartedForRef.current !== newUser.id) {
          void loadProfileAndStats(newUser.id);
        }
      } else {
        currentIdRef.current = null;
        profileLoadStartedForRef.current = null;
        setProfile(null);
        setStats(null);
        setResolvedId(null);
        // NO in-place signInAnonymously() here. Sign-out is a full application
        // reset (see signOutAndReset below): the fresh page load bootstraps a
        // new anonymous identity through init()'s ordinary first-visit path, so
        // doing it here as well would just be a second, redundant sign-in.
        //
        // Reload on SIGNED_OUT rather than sitting identity-less. Our own
        // sign-out navigates to "/" a moment later anyway (same destination, so
        // a duplicate is harmless); this also covers a sign-out we did NOT
        // initiate -- another tab, or a session revoked server-side -- which
        // would otherwise leave this tab with `user` null and every board stuck
        // behind its loading gate forever.
        //
        // Deliberately NOT fired for "INITIAL_SESSION", which this listener
        // also receives on subscribe with a null session on a first visit --
        // reloading there would be an infinite refresh loop on the very first
        // page view, and init() is already resolving that case concurrently.
        if (event === "SIGNED_OUT") {
          window.location.assign("/");
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const userId = user?.id ?? null;
  // profiles.is_guest is the canonical flag (flips on upgrade); fall back to
  // the auth user's anonymity while the profile row is still loading.
  const isGuest = profile?.isGuest ?? user?.is_anonymous ?? true;
  // Identity only: "ready" as soon as the session resolve has finished and
  // there IS a user, regardless of whether profile/stats have landed.
  // `initialLoading` now means exactly "the initial session resolve is still
  // running" -- it no longer waits on loadProfileAndStats (see init()). There
  // is no sign-out gap to cover any more: sign-out reloads the page, and the
  // fresh load resolves an anonymous identity through init()'s normal path.
  const identityStatus: AuthStatus = initialLoading || !user ? "loading" : "ready";
  // Identity AND its profile/stats. Strictly stronger than identityStatus:
  // additionally "loading" whenever the live identity has outrun its loaded
  // profile/stats (a swap in progress, or a first load still fetching them).
  const status: AuthStatus =
    initialLoading || !user || user.id !== resolvedId ? "loading" : "ready";
  const loading = status === "loading";

  // Folds pre-existing localStorage stats into the account exactly once,
  // the moment a guest becomes a full account (profile.isGuest flips via
  // the handle_user_updated DB trigger, picked up here on the next
  // profile fetch). Only ever fires for local data that predates this
  // whole accounts feature -- new play always writes straight to
  // user_stats now, never localStorage. The "once" guard is really
  // readStats() finding nothing left: migrateLocalStats clears local
  // storage on success, so a re-run of this effect (e.g. profile
  // refetching for an unrelated reason) finds gamesPlayed === 0 and no-ops.
  const migratingRef = useRef(false);
  useEffect(() => {
    if (!profile || profile.isGuest) return;
    // NOTE: the daily board needs no equivalent fold-in. Upgrading links the
    // anonymous identity in place, so userId is unchanged and the account's
    // daily_progress row simply carries over.
    if (migratingRef.current) return;
    const local = readStats();
    if (local.gamesPlayed <= 0) return;

    migratingRef.current = true;
    void (async () => {
      const result = await migrateLocalStats(local);
      if (result.ok) {
        resetStats();
        await refresh();
      } else {
        migratingRef.current = false;
      }
    })();
  }, [profile, refresh]);

  // Sign-out is a FULL APPLICATION RESET, not an in-place identity swap: it
  // ends by hard-navigating to "/" so the next identity boots from a genuinely
  // clean page. That discards, in one move, every category of stale-identity
  // bug we would otherwise have to defend against feature by feature -- user
  // ids captured in closures, live Realtime subscriptions, in-flight requests,
  // module-level caches. Sign-out is rare and user-initiated, so the reload
  // costs nothing perceptible.
  //
  // Deliberately asymmetric: SIGN-IN still re-resolves in place (see the
  // reactive `status`/`identityStatus` machinery above). Guest -> full account
  // is a *link* that preserves userId, so reloading there would interrupt an
  // in-progress daily for no reason.
  //
  // The ordering below is the whole point and must not be rearranged:
  //   1. Release every server-side commitment WHILE STILL AUTHENTICATED. After
  //      step 2 this identity can no longer authenticate anything, so a match
  //      left running or a queue row left behind becomes unreachable garbage --
  //      and a stale queue row is the rating-farming vector drizzle/0032 exists
  //      to close.
  //   2. Sign out.
  //   3. Hard navigation -- window.location.assign, NOT a Next.js router push,
  //      which would preserve exactly the in-memory state we are discarding.
  //
  // FAILS CLOSED: if step 1 can't complete (offline, request error) this throws
  // and does NOT sign out or reload. Reloading anyway would strand a live match
  // or a matchable queue row while destroying the only client that still had
  // the session needed to clean it up.
  //
  // useCallback, not a plain function declaration: this goes into the context
  // value, so an unstable identity would make that value new on every render no
  // matter how the value itself is memoized -- and would churn the deps of any
  // consumer that captures it (ProfileSection's sign-out handler).
  const signOutAndReset = useCallback(async () => {
    // 1a. Forfeit a live match so the opponent gets an immediate clean win
    //     rather than waiting out DISCONNECT_GRACE_MS.
    const liveMatchId = getLiveMatchId();
    if (liveMatchId !== null) {
      const result = await forfeitMatch(liveMatchId);
      if (!result.ok) throw new Error(result.error);
    }

    // 1b. Drop the queue row. Only when we actually hold one: it's idempotent
    //     server-side, but calling it unconditionally would let a network blip
    //     block a sign-out that had nothing at stake.
    if (isQueued()) {
      await leaveQueue();
    }

    // 1c. Let an in-flight guess land. daily_submit_guess APPENDS server-side,
    //     so abandoning one mid-write leaves the client's last rendered board
    //     disagreeing with what was actually stored. Never rejects -- a guess
    //     that failed is the board's problem to surface, not a reason someone
    //     can't sign out.
    await awaitInFlightGuess();

    // 2.
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    // 3.
    window.location.assign("/");
  }, [supabase]);

  // Memoized because AuthProvider wraps the ENTIRE app: a fresh object literal
  // here re-renders every useAuth() consumer on every provider render, whether
  // or not anything they read actually changed. `refresh` and `signOutAndReset`
  // are both useCallback for the same reason -- one unstable function is enough
  // to defeat the memo.
  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      stats,
      userId,
      isGuest,
      identityStatus,
      status,
      loading,
      refresh,
      signOutAndReset,
    }),
    [
      user,
      session,
      profile,
      stats,
      userId,
      isGuest,
      identityStatus,
      status,
      loading,
      refresh,
      signOutAndReset,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
