"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthProvider";
import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { GuessGrid, type Guess } from "@/components/game/GuessGrid";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { dailyState, dailySubmitGuess } from "@/lib/db/dailyProgressActions";
import { MAX_GUESSES } from "@/lib/game/constants";
import type { DailyBoardGuess, DailyBoardState } from "@/lib/game/dailyBoard";
import { isLegacyDailyKey } from "@/lib/game/legacyDaily";
import { pushLocalDailyToServer } from "@/lib/game/legacyDailyMigration";
import { buildShareText } from "@/lib/game/emojiGrid";
import { renderResultImage } from "@/lib/game/shareImage";
import { useSettings } from "@/lib/settings/useSettings";

// Server-authoritative daily board: state comes from daily_state() /
// daily_submit_guess() (lib/db/dailyProgressActions.ts), which follow the
// account across devices. localStorage is demoted to a write-through cache
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
    // Sweep other identities'/days' cache entries, but LEAVE legacy pre-server
    // keys (f1dw:daily:<date>) alone -- the auth-time migration
    // (lib/game/legacyDaily.ts + migrateLocalDaily) owns their lifecycle and
    // deleting one here before it's read would silently drop the player's
    // pre-existing progress.
    if (key && key.startsWith(STORAGE_PREFIX) && key !== keep && !isLegacyDailyKey(key)) {
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
// everywhere". The board's own hydration gate covers the brief null gap during
// a sign-out -> fresh-guest swap (userId is momentarily null).
export function DailyGame(props: DailyGameProps) {
  const { userId } = useAuth();
  return <DailyBoard key={userId ?? "pending"} {...props} />;
}

function DailyBoard({ eligibleDrivers, puzzleNumber, hasPuzzleToday }: DailyGameProps) {
  const router = useRouter();
  const { userId, status, isGuest, refresh } = useAuth();
  const authLoading = status === "loading";
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

  // The hydration gate. While auth is still resolving (status "loading") or the
  // fetch is in flight, phase stays "loading" and the UI shows a disabled
  // skeleton -- it must NEVER render an empty, playable board that later fills
  // in, since that flash reads as "you can play again" and invites a duplicate
  // attempt. Identity *swaps* remount this whole board (the keyed wrapper), so
  // within a mount userId is fixed; this also re-runs when a guest *upgrades*
  // in place (same userId, isGuest flips) so the board re-hydrates after
  // sign-in, per the prompt.
  const hydrate = useCallback(async () => {
    if (!hasPuzzleToday) return;
    const seq = ++hydrateSeq.current;
    if (authLoading || !userId) {
      setPhase("loading");
      return;
    }
    setPhase("loading");
    try {
      // Carry any pre-existing local daily board onto the account BEFORE
      // fetching, so the board we render reflects it (no empty-then-fills-in
      // flash). Best-effort: a migration failure must not block hydration --
      // the legacy key is retained for a later retry. Idempotent and races
      // harmlessly with AuthProvider's own sign-in migration.
      try {
        await pushLocalDailyToServer();
      } catch {
        // swallow -- still hydrate from whatever the server has
      }
      if (seq !== hydrateSeq.current) return;

      const next = await dailyState();
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
    // isGuest is a dependency so an in-place upgrade re-hydrates; within a mount
    // userId never changes (a swap remounts via the keyed wrapper).
  }, [authLoading, userId, isGuest, hasPuzzleToday]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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

    const wasCompleted = board.completed;
    setPending(true);
    void (async () => {
      try {
        // Optimistic: the pending shimmer row shows immediately (via GuessGrid
        // below); the server response is what actually wins.
        const next = await dailySubmitGuess(driver.id);
        if (!userId) return;
        setBoard(next);
        writeCache(userId, next);
        // The server records the result on the completing guess; refresh the
        // auth context so Statistics reflects it.
        if (!wasCompleted && next.completed) await refresh();
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

    if (format === "text") {
      try {
        if (navigator.share) {
          await navigator.share({ text });
          setShareState("shared");
        } else {
          await navigator.clipboard.writeText(text);
          setShareState("copied");
        }
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

  return (
    <div className="mx-auto flex w-full flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">Daily #{puzzleNumber}</p>
      </header>

      {!hasPuzzleToday ? (
        <div className="py-12 text-center text-text-muted">
          No puzzle is scheduled for today. Check back soon.
        </div>
      ) : phase === "loading" ? (
        // Skeleton board with the input disabled -- the hydration gate. Same
        // layout as the ready state so nothing shifts when it resolves.
        <div className="flex flex-col gap-4" aria-busy="true">
          <DriverAutocomplete drivers={eligibleDrivers} onSelect={() => {}} disabled />
          <p className="text-center text-sm text-text-muted">Loading today&apos;s board…</p>
          <div className="animate-pulse motion-reduce:animate-none">
            <GuessGrid guesses={[]} maxGuesses={MAX_GUESSES} showFlags={showFlags} />
          </div>
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
        <>
          <DriverAutocomplete
            drivers={eligibleDrivers}
            onSelect={handleSelect}
            disabled={pending || isRoundOver}
          />

          {!isRoundOver && (
            <p className="text-center text-sm text-text-muted">
              {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left
            </p>
          )}

          <GuessGrid guesses={guesses} maxGuesses={MAX_GUESSES} showFlags={showFlags} pending={pending} />

          {isRoundOver && board?.won && (
            <div className="rounded-lg border border-border bg-surface-2 p-4 text-center">
              <p className="font-semibold text-accent">🏆 You got it — {board.target?.name}!</p>
            </div>
          )}

          {isRoundOver && !board?.won && (
            <div className="rounded-lg border border-border bg-surface-2 p-4 text-center">
              <p className="font-semibold text-text">
                {board?.target ? `Out of guesses. It was ${board.target.name}.` : "Out of guesses."}
              </p>
            </div>
          )}

          {isRoundOver && (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShareModalOpen(true)}
                disabled={shareState === "sharing"}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent-weak bg-accent-weak/40 px-4 py-3 text-base font-semibold text-accent transition hover:border-accent/50 hover:bg-accent-weak/60 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
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
        </>
      )}

      <Modal open={shareModalOpen} onClose={() => setShareModalOpen(false)} title="Share result">
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void handleShare("image")}
            className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface-2 p-4 text-left transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="text-base font-bold text-text">Image</span>
            <span className="text-sm text-text-muted">
              A result-card image of your board, ready to post or save.
            </span>
          </button>
          <button
            type="button"
            onClick={() => void handleShare("text")}
            className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface-2 p-4 text-left transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="text-base font-bold text-text">Emoji text</span>
            <span className="text-sm text-text-muted">Just the emoji grid — paste it anywhere.</span>
          </button>
        </div>
      </Modal>
    </div>
  );
}
