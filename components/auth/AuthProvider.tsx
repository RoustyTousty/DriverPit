"use client";

import { isAuthRetryableFetchError, type Session, type User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { pushLocalDailyToServer } from "@/lib/game/legacyDailyMigration";
import { migrateLocalStats } from "@/lib/stats/actions";
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
  currentStreak: number;
  maxStreak: number;
  guessDistribution: number[];
  lastResult: { won: boolean; guessCount: number } | null;
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
    currentStreak: row.current_streak,
    maxStreak: row.max_streak,
    guessDistribution: row.guess_distribution,
    lastResult: row.last_result,
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
  // `loading` until the *current* identity's profile/stats are resolved --
  // true again during an identity swap (sign-in/out), which is the signal a
  // per-user view uses to show its gate instead of the previous identity's
  // data. `loading` is kept as an alias of `status === "loading"` for existing
  // consumers.
  status: AuthStatus;
  loading: boolean;
  // Re-fetches profile/stats for the current user — call after an action
  // that's expected to have changed them (e.g. the signup trigger firing,
  // an upgrade completing).
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
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

  const loadProfileAndStats = useCallback(
    async (userId: string) => {
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
        await loadProfileAndStats(currentSession.user.id);
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
          if (data.user) await loadProfileAndStats(data.user.id);
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
        void loadProfileAndStats(newUser.id);
      } else {
        currentIdRef.current = null;
        setProfile(null);
        setStats(null);
        setResolvedId(null);
        // Only re-establish a guest identity on an explicit runtime sign-out.
        // This listener also fires once on subscribe with whatever the session
        // was at that moment (event "INITIAL_SESSION") -- on a first visit
        // that's null too, same as what init() above is concurrently
        // resolving. Reacting to that here as well used to race init()'s own
        // signInAnonymously() call, firing two concurrent anonymous sign-ins
        // for one visit. The app is never identity-less, so a real sign-out is
        // an identity *swap*: signInAnonymously() immediately, and `status`
        // stays "loading" (user is null) so no board shows in the gap.
        if (event === "SIGNED_OUT") {
          void withRetry(() => supabase.auth.signInAnonymously()).then(({ error }) => {
            if (error) console.error("Anonymous re-sign-in after sign-out failed", error);
          });
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
  // "loading" during the first resolve, and again whenever the live identity
  // has outrun its loaded profile/stats (a swap in progress, or the null gap
  // between sign-out and the fresh guest).
  const status: AuthStatus =
    initialLoading || !user || user.id !== resolvedId ? "loading" : "ready";
  const loading = status === "loading";

  // On sign-in (identity resolved -- guests included, since they have server
  // daily_progress too), carry any pre-existing local daily board onto the
  // account. Once per identity per session; a transient failure clears the
  // guard so a later attempt this session can retry. Server precedence + the
  // legacy-key clear inside pushLocalDailyToServer make repeats safe.
  const dailyPushedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "ready" || !userId) return;
    if (dailyPushedForRef.current === userId) return;
    dailyPushedForRef.current = userId;
    void pushLocalDailyToServer().catch((err) => {
      console.error("Local daily migration failed", err);
      if (dailyPushedForRef.current === userId) dailyPushedForRef.current = null;
    });
  }, [status, userId]);

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

    // Also carry the pre-server daily board over on upgrade, next to the stats
    // fold-in. Idempotent and independent of local stats -- normally a no-op
    // here because the sign-in effect above already handled it under the same
    // (unchanged-on-upgrade) userId, but it also serves as a retry if that
    // attempt failed.
    void pushLocalDailyToServer().catch((err) => console.error("Local daily migration failed", err));

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

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ user, session, profile, stats, userId, isGuest, status, loading, refresh, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
