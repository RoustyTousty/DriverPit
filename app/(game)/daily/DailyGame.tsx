"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthProvider";
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

// Server-authoritative daily board: state comes from the daily_state() /
// daily_submit_guess() Postgres RPCs, called straight from the browser
// (lib/game/dailyStateRpc.ts, lib/game/submitDailyGuessRpc.ts) -- one warm hop,
// no Server Action in the path. They follow the account across devices.
// localStorage is demoted to a write-through cache
// (below) -- it survives a failed/offline hydration but never decides whether
// a board is playable; only the server concludes "you've already played
// today."
const STORAGE_PREFIX = "f1dw:daily:";

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

function msUntilNextUtcMidnight(): number {
  const now = new Date();
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return nextMidnight - now.getTime();
}

function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

interface DailyGameProps {
  eligibleDrivers: DriverOption[];
  puzzleNumber: number;
  hasPuzzleToday: boolean;
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
  const { userId } = useAuth();
  return <DailyBoard key={userId ?? "pending"} {...props} />;
}

function DailyBoard({ eligibleDrivers, puzzleNumber, hasPuzzleToday }: DailyGameProps) {
  const router = useRouter();
  // identityStatus, NOT status: the board needs to know *which account* it is
  // fetching for and nothing else. Gating on `status` (which additionally waits
  // for profiles + user_stats) put two PostgREST round trips in front of
  // daily_state() and is what made the board take seconds -- CLAUDE.md: "board
  // readiness gates only on identity + daily_state()".
  const { userId, identityStatus, isGuest, refresh } = useAuth();
  const identityLoading = identityStatus === "loading";
  const { showFlags } = useSettings();
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>("loading");
  const [board, setBoard] = useState<DailyBoardState | null>(null);
  const [pending, setPending] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "sharing" | "shared" | "copied">("idle");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [lastShareFormat, setLastShareFormat] = useState<"image" | "text" | null>(null);
  const [countdown, setCountdown] = useState("");

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
  }, [identityLoading, userId, isGuest, hydrate]);

  const isRoundOver = board?.completed ?? false;

  // Ticks only once the round is over; when it hits zero the UTC day has rolled
  // over, so pull fresh server data and re-hydrate for the new day.
  useEffect(() => {
    if (!isRoundOver) return;
    function tick() {
      const msLeft = msUntilNextUtcMidnight();
      setCountdown(formatCountdown(msLeft));
      if (msLeft <= 0) {
        router.refresh();
        void hydrate();
      }
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isRoundOver, router, hydrate]);

  function handleSelect(driver: DriverOption) {
    if (!board || board.completed || pending || !userId) return;

    const current = board;
    setPending(true);
    void (async () => {
      try {
        // Optimistic: the pending shimmer row shows immediately (via GuessGrid
        // below); the server response is what actually wins. The RPC returns the
        // single evaluated guess row (duel-shaped); we append it to the board we
        // hydrated from daily_state, exactly as the duel board appends its rows.
        const result = await submitDailyGuessRpc(driver.id);
        if (!userId) return;

        const next: DailyBoardState = {
          guesses: [...current.guesses, result.guess],
          completed: result.completed,
          won: result.won,
          guessesRemaining: result.guessesRemaining,
          target: result.target,
        };
        setBoard(next);
        writeCache(userId, next);

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

  const guesses = board ? board.guesses.map(toGuess) : [];
  const guessesLeft = board?.guessesRemaining ?? MAX_GUESSES;
  const isLoading = phase === "loading";

  return (
    // `relative` anchors the hydration overlay over the ENTIRE game window --
    // header included -- so loading is one state covering one card, not a
    // sharp title above a blurred board. inset-0 lands exactly on the card's
    // edges: this div is the `{children}` of the rounded-lg surface card in
    // app/(game)/layout.tsx.
    <div className="relative mx-auto flex w-full flex-col gap-4 px-4 py-6" aria-busy={isLoading}>
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">Daily #{puzzleNumber}</p>
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
          <DriverAutocomplete
            drivers={eligibleDrivers}
            onSelect={handleSelect}
            disabled={isLoading || pending || isRoundOver}
          />

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
              <p className="text-center text-sm text-text-muted">Next driver in {countdown}</p>
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
