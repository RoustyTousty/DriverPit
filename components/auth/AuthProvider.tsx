"use client";

import { isAuthRetryableFetchError, type Session, type User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

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

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  stats: UserStats | null;
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
  const [loading, setLoading] = useState(true);

  const loadProfileAndStats = useCallback(
    async (userId: string) => {
      const [{ data: profileRow, error: profileError }, { data: statsRow, error: statsError }] =
        await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          supabase.from("user_stats").select("*").eq("user_id", userId).maybeSingle(),
        ]);

      if (profileError) console.error("Failed to load profile", profileError);
      if (statsError) console.error("Failed to load user_stats", statsError);

      setProfile(profileRow ? toProfile(profileRow as ProfileRow) : null);
      setStats(statsRow ? toUserStats(statsRow as UserStatsRow) : null);
    },
    [supabase],
  );

  const refresh = useCallback(async () => {
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();
    setSession(currentSession);
    setUser(currentSession?.user ?? null);
    if (currentSession?.user) {
      await loadProfileAndStats(currentSession.user.id);
    } else {
      setProfile(null);
      setStats(null);
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
          if (data.user) await loadProfileAndStats(data.user.id);
        }
      }

      if (!cancelled) setLoading(false);
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        void loadProfileAndStats(newSession.user.id);
      } else {
        setProfile(null);
        setStats(null);
        // Only re-establish a guest identity on an explicit runtime
        // sign-out. This listener also fires once on subscribe with
        // whatever the session was at that moment (event
        // "INITIAL_SESSION") -- on a first visit that's null too, same as
        // what init() above is concurrently resolving. Reacting to that
        // here as well used to race init()'s own signInAnonymously() call,
        // firing two concurrent anonymous sign-ins for one visit.
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
    if (!profile || profile.isGuest || migratingRef.current) return;

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
    <AuthContext.Provider value={{ user, session, profile, stats, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
