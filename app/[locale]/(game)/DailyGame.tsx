"use client";

import { useTranslations } from "next-intl";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuthIdentity } from "@/components/auth/AuthProvider";
import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { GuessGrid, type Guess } from "@/components/game/GuessGrid";
import { LoadingOverlay } from "@/components/game/LoadingOverlay";
import { ResultCard } from "@/components/game/ResultCard";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { MAX_GUESSES } from "@/lib/game/constants";
import type { DailyBoardGuess, DailyBoardState } from "@/lib/game/dailyBoard";
import { fetchDailyState } from "@/lib/game/dailyStateRpc";
import { submitDailyGuessRpc } from "@/lib/game/submitDailyGuessRpc";
import { buildShareText } from "@/lib/game/emojiGrid";
import { renderResultImage } from "@/lib/game/shareImage";
import { recordDailyResult } from "@/lib/stats/actions";
import { useSettings } from "@/lib/settings/useSettings";

import { NextPuzzleCountdown } from "./NextPuzzleCountdown";
import { Link } from "@/lib/i18n/navigation";

// Server-authoritative daily board: state comes from the daily_state() /
// daily_submit_guess() Postgres RPCs, called straight from the browser
// (lib/game/dailyStateRpc.ts, lib/game/submitDailyGuessRpc.ts) -- one warm hop,
// no Server Action in the path. They follow the account across devices.
// localStorage is demoted to a write-through cache
// (below) -- it survives a failed/offline hydration but never decides whether
// a board is playable; only the server concludes "you've already played
// today."
const STORAGE_PREFIX = "f1dw:daily:";

// What a day looks like before anyone has touched it. Used only on the
// deferred-identity path (roadmap Pass 4a), where the server has provably
// nothing stored for this visitor and the first guess appends to this rather
// than to a hydrated board.
const EMPTY_BOARD: DailyBoardState = {
  guesses: [],
  completed: false,
  won: false,
  guessesRemaining: MAX_GUESSES,
  target: null,
};

type Phase = "loading" | "error" | "ready";

function todayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Cache key is per-account AND per-day so one identity never reads another's
// board (and yesterday's is dropped, see cleanupStaleCache). The server date
// is authoritative for what actually renders; this client date only buckets
// the fallback cache.
function cacheKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}:${todayUtcKey()}`;
}

function readCache(userId: string): DailyBoardState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    return raw ? (JSON.parse(raw) as DailyBoardState) : null;
  } catch {
    return null;
  }
}

function cleanupStaleCache(keep: string) {
  if (typeof window === "undefined") return;
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // Sweeps every other f1dw:daily:* entry -- other identities', other days',
    // and any leftover pre-accounts `f1dw:daily:<date>` blob. Those used to be
    // exempted so the local->server migration could consume them first; that
    // migration is gone (the server is the only record of a day now), so
    // they're dead bytes in the player's storage and get cleared on next write.
    if (key && key.startsWith(STORAGE_PREFIX) && key !== keep) {
      stale.push(key);
    }
  }
  for (const key of stale) localStorage.removeItem(key);
}

function writeCache(userId: string, state: DailyBoardState) {
  if (typeof window === "undefined") return;
  try {
    const key = cacheKey(userId);
    cleanupStaleCache(key);
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Quota/disabled storage: the cache is best-effort resilience, never
    // required for correctness, so a failure here is fine to swallow.
  }
}

// Adapt a server board guess to the shared GuessRow's shape -- identical row,
// tiles, and initials as live play and the duel board (CLAUDE.md "Duel visual
// consistency").
function toGuess(g: DailyBoardGuess): Guess {
  return {
    guessedDriver: {
      id: g.driverId,
      fullName: g.name,
      driverCode: g.code,
      nationality: g.nationality,
      team: g.team,
      age: g.age,
      debutYear: g.debutYear,
      careerWins: g.careerWins,
    },
    result: g.tiles,
  };
}

interface DailyGameProps {
  eligibleDrivers: DriverOption[];
  puzzleNumber: number;
  hasPuzzleToday: boolean;
  /**
   * The newest day with an archive page, resolved SERVER-side by the daily page.
   *
   * Not "yesterday" computed here: the archive only has a page for a day a
   * puzzle was actually pinned for, so deriving the date on the client would
   * link to a 404 on any gap in the record — and would do it from the visitor's
   * own clock, which is never the clock that decides which day it is. Optional
   * so the link is simply absent when there is no archive yet.
   */
  latestArchiveDate?: string | null;
}

// Keyed wrapper: an identity change swaps the `key`, remounting DailyBoard so
// NO state from the previous identity can survive -- stale guesses, a stale
// "already played"/completed banner, the countdown all reset (React guarantees
// fresh state on a new key), per CLAUDE.md "Auth state is reactive,
// everywhere".
//
// Still needed even though sign-out now hard-reloads: signing IN can also land
// on a different user id -- OAuthErrorHandler's identity_already_exists path
// signs you into your other account rather than linking -- and that case is
// handled in place, with no reload.
export function DailyGame(props: DailyGameProps) {
  const { userId } = useAuthIdentity();
  return <DailyBoard key={userId ?? "pending"} {...props} />;
}

function DailyBoard({ eligibleDrivers, puzzleNumber, hasPuzzleToday, latestArchiveDate }: DailyGameProps) {
  const modes = useTranslations("nav.modes");
  const router = useRouter();
  // identityStatus, NOT status: the board needs to know *which account* it is
  // fetching for and nothing else. Gating on `status` (which additionally waits
  // for profiles + user_stats) put two PostgREST round trips in front of
  // daily_state() and is what made the board take seconds -- CLAUDE.md: "board
  // readiness gates only on identity + daily_state()".
  //
  // useAuthIdentity(), NOT useAuth(), for the render-time half of the same
  // rule: the completing guess below calls refresh() to pull the new user_stats
  // into Settings, and on the single context that re-rendered this whole board
  // -- the one that had just finished -- for data it doesn't display (audit
  // 2026-07-30 §1.1).
  const { userId, identityStatus, isGuest, refresh, ensureIdentity } = useAuthIdentity();
  const identityLoading = identityStatus === "loading";
  // Proven to have no session, and no identity acquired yet (roadmap Pass 4a).
  // There is nothing on the server to hydrate, so the empty board below is the
  // TRUE state of this visitor's day rather than a placeholder for one -- which
  // is the only condition under which CLAUDE.md's no-replay-flash gate may be
  // skipped. `identityStatus === "loading"` still holds the skeleton.
  const noIdentityYet = identityStatus === "anonymous";
  const { showFlags } = useSettings();
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>("loading");
  const [board, setBoard] = useState<DailyBoardState | null>(null);
  const [pending, setPending] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "sharing" | "shared" | "copied">("idle");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [lastShareFormat, setLastShareFormat] = useState<"image" | "text" | null>(null);

  // Each hydrate bumps this; a slow response from a previous identity (or a
  // pre-rollover day) is discarded when a newer hydrate has superseded it, so
  // switching accounts can't leave a stale board on screen.
  const hydrateSeq = useRef(0);

  // Fetches the authoritative board. Callable at any time (the effect below
  // drives the initial load; Retry and the midnight rollover re-call it) -- it
  // does NOT decide *whether* a hydrate is due, only how to do one.
  const hydrate = useCallback(async () => {
    if (!hasPuzzleToday || !userId) return;
    const seq = ++hydrateSeq.current;
    setPhase("loading");
    try {
      // Straight to the one warm RPC -- nothing is awaited in front of it, so
      // the board's only blocking call is this hop.
      const next = await fetchDailyState();
      if (seq !== hydrateSeq.current) return;
      setBoard(next);
      setPhase("ready");
      writeCache(userId, next);
    } catch {
      if (seq !== hydrateSeq.current) return;
      // Server unreachable: fall back to the last cached server snapshot for
      // resilience. With no cache we show an error/retry -- NOT an empty
      // playable board, so localStorage is never the reason a board is
      // playable on a fresh device.
      const cached = readCache(userId);
      if (cached) {
        setBoard(cached);
        setPhase("ready");
      } else {
        setPhase("error");
      }
    }
  }, [userId, hasPuzzleToday]);

  // Exactly ONE daily_state() per identity resolution. `isGuest` can no longer
  // be a plain hydrate dependency: now that the board no longer waits on
  // profile/stats, it resolves BEFORE the profile lands, so isGuest can settle
  // from the auth user's `is_anonymous` onto `profiles.is_guest` shortly after
  // the fetch already started -- as a dep that would fire a second, redundant
  // fetch. Only a genuine in-place upgrade (guest -> full account, true->false,
  // same userId) re-hydrates; that path can't remount, since the keyed wrapper
  // only remounts on a userId change.
  const hydratedForRef = useRef<string | null>(null);
  const wasGuestRef = useRef<boolean | null>(null);
  useEffect(() => {
    // A visitor with no session has nothing stored for today, so the empty
    // board is already correct and there is nothing to fetch. Deliberately
    // "ready", not "loading": holding the overlay here would leave every
    // first-time visitor -- and every crawler -- staring at a permanent
    // skeleton, which is what makes this branch necessary rather than optional.
    if (noIdentityYet) {
      setBoard(null);
      setPhase("ready");
      return;
    }
    // The gate: hold the skeleton until we know whose board to fetch. Never an
    // empty *playable* board -- that flash reads as "you can play again".
    if (identityLoading || !userId) {
      setPhase("loading");
      return;
    }
    const upgraded = wasGuestRef.current === true && !isGuest;
    wasGuestRef.current = isGuest;
    if (hydratedForRef.current === userId && !upgraded) return;
    hydratedForRef.current = userId;
    void hydrate();
  }, [identityLoading, noIdentityYet, userId, isGuest, hydrate]);

  const isRoundOver = board?.completed ?? false;

  // The UTC day turned over under a finished board: pull fresh server data
  // (a new puzzle number and pool) and re-hydrate onto the new day. Called by
  // NextPuzzleCountdown, which owns the 1 Hz tick itself so it doesn't
  // re-render this whole board every second -- audit 2026-07-29 §1.2.
  const handleRollover = useCallback(() => {
    router.refresh();
    void hydrate();
  }, [router, hydrate]);

  // Latched, so returning focus to the input after every guess doesn't re-ask.
  const warmedRef = useRef(false);
  const warmIdentity = useCallback(() => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    void ensureIdentity();
  }, [ensureIdentity]);

  function handleSelect(driver: DriverOption) {
    if (board?.completed || pending) return;

    // NO "return if there is no board yet". A null board reaches this line in
    // exactly two ways, and dropping the guess is wrong in both: the
    // deferred-identity case, where the empty board on screen is the whole
    // truth, and the instant between the identity landing and the hydrate
    // effect firing, where `noIdentityYet` has already gone false but no board
    // has arrived. Every other route to a null board leaves the input disabled
    // (phase "loading") or replaces it outright (phase "error"), so it cannot
    // get here. A silently discarded guess is the worst outcome available.
    const current = board ?? EMPTY_BOARD;
    setPending(true);
    void (async () => {
      try {
        // The identity is normally already in hand -- warmIdentity() below
        // fires the moment the input takes focus, which is always before a
        // driver can be picked from it. This await is the race guard for
        // someone who types and selects faster than a sign-in round trip, and
        // on the ordinary path it resolves off a local getSession with no
        // network hop, so a guess is still one warm call.
        const identity = userId ?? (await ensureIdentity());
        if (!identity) {
          toast.error("Couldn't start your board. Check your connection and try again.");
          setPending(false);
          return;
        }
        // Claim the hydrate this identity would otherwise trigger: this guess
        // IS the first read of a board that was provably empty, and letting the
        // effect fire daily_state() alongside it would race two writers of
        // `board` against each other.
        hydratedForRef.current = identity;
        // Optimistic: the pending shimmer row shows immediately (via GuessGrid
        // below); the server response is what actually wins. The RPC returns the
        // single evaluated guess row (duel-shaped); we append it to the board we
        // hydrated from daily_state, exactly as the duel board appends its rows.
        const result = await submitDailyGuessRpc(driver.id);

        const next: DailyBoardState = {
          guesses: [...current.guesses, result.guess],
          completed: result.completed,
          won: result.won,
          guessesRemaining: result.guessesRemaining,
          target: result.target,
        };
        setBoard(next);
        writeCache(identity, next);
        // Cleared HERE, batched with the row that replaces it, and not left to
        // the `finally` below. The shimmer's whole job ends the moment the
        // authoritative row is on the board -- but on the *completing* guess the
        // finally is two awaits away (recordDailyResult + refresh, both real
        // round trips), so the shimmer went on rendering for seconds BELOW the
        // finished row instead of in place of it. On the 6th guess there's no
        // empty slot left for it to consume either, so the grid grew a seventh
        // row and shoved the result card and share button down until the stats
        // write landed. Infinite never showed this only because nothing sits
        // between its append and its clear.
        setPending(false);

        // On the completing guess, flow the result through the existing
        // recordDailyResult path (its daily_results idempotency guard is
        // unchanged), then refresh the auth context so Statistics reflects it.
        // Latency here is irrelevant -- the day is already over.
        //
        // It takes no arguments: the outcome and the day are read back from the
        // daily_progress row daily_submit_guess just wrote, not asserted from
        // here (audit 2026-07-27 §3.2). `result` above is still what the board
        // renders -- it's just no longer what the stats believe.
        if (result.completed) {
          await recordDailyResult();
          await refresh();
        }
      } catch {
        // A failed write must be surfaced, never silently accepted locally --
        // a local-only guess is exactly how two devices diverge again.
        toast.error("Couldn't submit your guess — it didn't count. Check your connection and try again.");
      } finally {
        // The failure path's clear (the guess threw before the line above ran,
        // so no row landed and the shimmer must not be left behind). A no-op on
        // the success path, where it's already false.
        setPending(false);
      }
    })();
  }

  // "Share result" opens a popup asking image vs. emoji text (same Modal
  // primitive as Settings/Leaderboard/the duel forfeit confirm) rather than a
  // persisted setting -- the choice is per-share, not a standing preference.
  async function handleShare(format: "image" | "text") {
    if (!board) return;
    setShareModalOpen(false);
    setLastShareFormat(format);
    const results = board.guesses.map((g) => g.tiles);
    const text = buildShareText({
      puzzleNumber,
      results,
      won: board.won,
      maxGuesses: MAX_GUESSES,
    });

    setShareState("sharing");

    // Copy only -- deliberately NOT navigator.share. This option is labelled
    // "Copy text" and its whole promise is "it's on your clipboard now"; routing
    // it through the OS share sheet made that a lie on mobile (a sheet opens,
    // you pick a target, nothing is copied) and gave the same button two
    // different outcomes depending on the device. The share sheet is what the
    // Image option is for.
    if (format === "text") {
      try {
        await navigator.clipboard.writeText(text);
        setShareState("copied");
        // The button label also flips to "Copied", but the modal has just
        // closed over it -- a toast is the feedback that's actually visible at
        // the moment the copy happens.
        toast.success("Copied to clipboard");
        setTimeout(() => setShareState("idle"), 2000);
      } catch (err) {
        console.error("Copy failed", err);
        toast.error("Couldn't copy to your clipboard. Try again.");
        setShareState("idle");
      }
      return;
    }

    // Prefer the native share sheet with an actual result-card image attached
    // (real social targets) -- clipboard-only text is the fallback.
    try {
      const blob = await renderResultImage({ puzzleNumber, results, won: board.won, maxGuesses: MAX_GUESSES });
      const file = new File([blob], "driverpit-result.png", { type: "image/png" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ text, files: [file] });
        setShareState("shared");
        setTimeout(() => setShareState("idle"), 2000);
        return;
      }

      // No file-share support (most desktop browsers): copy the text and hand
      // over a downloadable image so there's still something to post.
      await navigator.clipboard.writeText(text);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "driverpit-result.png";
      link.click();
      URL.revokeObjectURL(link.href);
      setShareState("copied");
      // Two silent side effects at once (a download and a clipboard write), so
      // this branch says what happened -- same reason the copy option toasts.
      // The navigator.share branch above doesn't: the OS sheet IS the feedback.
      toast.success("Image saved and text copied to clipboard");
      setTimeout(() => setShareState("idle"), 2000);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setShareState("idle");
        return;
      }
      console.error("Share failed", err);
      toast.error("Couldn't share right now. Try again.");
      setShareState("idle");
    }
  }

  // Memoized on `board` rather than rebuilt per render so the rows keep one
  // identity across the renders the board state doesn't change on (opening the
  // share modal, the share button's own idle/sharing/copied cycle, an auth
  // context refresh). That is what lets memo(GuessGrid) actually skip, and it
  // stops GuessAnnouncer's effect re-running against an identical list.
  const guesses = useMemo(() => (board ? board.guesses.map(toGuess) : []), [board]);
  const guessesLeft = board?.guessesRemaining ?? MAX_GUESSES;
  const isLoading = phase === "loading";

  // Withheld from the suggestions, so a duplicate can't burn one of six turns
  // for a row already on the board (audit 2026-07-29 §4.7). Recomputed when the
  // board changes -- a guess or a hydrate -- and never on an unrelated render,
  // so the set keeps one identity across those.
  const guessedDriverIds = useMemo(
    () => new Set(board?.guesses.map((g) => g.driverId) ?? []),
    [board],
  );

  return (
    // `relative` anchors the hydration overlay over the ENTIRE game window --
    // header included -- so loading is one state covering one card, not a
    // sharp title above a blurred board. inset-0 lands exactly on the card's
    // edges: this div is the `{children}` of the rounded-lg surface card in
    // app/(game)/layout.tsx.
    <div className="relative mx-auto flex w-full flex-col gap-4 px-4 py-6" aria-busy={isLoading}>
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">
          {modes("daily")} #{puzzleNumber}
        </p>
      </header>

      {!hasPuzzleToday ? (
        <div className="py-12 text-center text-text-muted">
          No puzzle is scheduled for today. Check back soon.
        </div>
      ) : phase === "error" ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-text-muted">Couldn&apos;t load today&apos;s puzzle.</p>
          <button
            onClick={() => void hydrate()}
            className="rounded-lg border border-accent-weak bg-accent-weak/40 px-4 py-2 text-sm font-semibold text-accent transition hover:border-accent/50 hover:bg-accent-weak/60 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Retry
          </button>
        </div>
      ) : (
        // THE gate against a replay flash: until daily_state() lands we don't
        // know how much of today is already played, so the board rendered here
        // is empty -- the overlay's blur is what stops that reading as "you can
        // play again", where a merely-disabled empty board wouldn't.
        <div className="flex flex-col gap-4">
          {/* Focus is the earliest honest signal that a person is about to
              play, and it is always reached before a driver can be picked --
              by pointer, by touch and by Tab alike. Acquiring the identity
              here rather than in handleSelect keeps the sign-in off the guess
              path, so the first guess is still one warm hop. A crawler renders
              this and never focuses it, which is the entire saving. */}
          <div onFocusCapture={warmIdentity}>
            <DriverAutocomplete
              drivers={eligibleDrivers}
              onSelect={handleSelect}
              disabled={isLoading || pending || isRoundOver}
              guessedDriverIds={guessedDriverIds}
            />
          </div>

          {!isRoundOver && (
            // Held but blanked while loading: the count is genuinely unknown
            // until the server answers (this is a resumable board, not a fresh
            // one), and rendering the MAX_GUESSES fallback would be a claim
            // about today. `invisible` keeps its height so the grid doesn't
            // jump when the real number arrives.
            <p className={`text-center text-sm text-text-muted ${isLoading ? "invisible" : ""}`}>
              {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left
            </p>
          )}

          <GuessGrid guesses={guesses} maxGuesses={MAX_GUESSES} showFlags={showFlags} pending={pending} />

          {isRoundOver && (
            <ResultCard
              won={board?.won ?? false}
              driverName={board?.target?.name ?? null}
              driverCode={board?.target?.code ?? null}
              guessesUsed={guesses.length}
              maxGuesses={MAX_GUESSES}
            />
          )}

          {isRoundOver && (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShareModalOpen(true)}
                disabled={shareState === "sharing"}
                // Solid accent, same as every other primary action on the site
                // (duel Forfeit/Rematch, the guest Sign up prompt): sharing is
                // THE thing to do on a finished board, so it gets the full
                // accent rather than the accent-weak tint, which the site uses
                // for secondary/recovery actions like Retry above.
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="M8.6 10.5 15.4 6.5M8.6 13.5l6.8 4" />
                </svg>
                {shareState === "shared"
                  ? "Shared!"
                  : shareState === "copied"
                    ? lastShareFormat === "image"
                      ? "Copied + image saved"
                      : "Copied"
                    : "Share result"}
              </button>
              <NextPuzzleCountdown onRollover={handleRollover} />
              {/* The archive, offered at the one moment a player has nothing
                  left to do here and the next puzzle is hours away. A quiet
                  text link rather than a second button: sharing is still THE
                  action on a finished board, and two accented controls would
                  make neither of them the primary one. */}
              {latestArchiveDate && (
                <Link
                  href={`/archive/${latestArchiveDate}`}
                  className="rounded text-center text-sm text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  See how everyone did on the last puzzle →
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {isLoading && <LoadingOverlay label="Loading today's board" />}

      <Modal open={shareModalOpen} onClose={() => setShareModalOpen(false)} title="Share result">
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void handleShare("image")}
            className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface-2 p-4 text-left transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="text-base font-bold text-text">Image</span>
            <span className="text-sm text-text-muted">
              A picture of your grid — post it or save it to your device.
            </span>
          </button>
          <button
            type="button"
            onClick={() => void handleShare("text")}
            className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface-2 p-4 text-left transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="text-base font-bold text-text">Copy text</span>
            <span className="text-sm text-text-muted">
              The emoji grid on your clipboard, ready to paste anywhere.
            </span>
          </button>
        </div>
      </Modal>
    </div>
  );
}
