"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthProvider";
import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { GuessGrid, type Guess } from "@/components/game/GuessGrid";
import type { DriverSummary } from "@/lib/db/queries";
import { buildShareText } from "@/lib/game/emojiGrid";
import { recordDailyResult } from "@/lib/stats/actions";

import { revealDailyTarget, submitDailyGuess } from "./actions";

const MAX_GUESSES = 5;
const STORAGE_PREFIX = "f1dw:daily:";

type RoundStatus = "loading" | "playing" | "won" | "lost";

interface PersistedState {
  guesses: Guess[];
  status: Exclude<RoundStatus, "loading">;
  target?: DriverSummary;
}

function todayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readPersisted(key: string): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function writePersisted(key: string, state: PersistedState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state));
}

function cleanupStaleKeys(todayKey: string) {
  if (typeof window === "undefined") return;
  const staleKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      key.startsWith(STORAGE_PREFIX) &&
      key !== STORAGE_PREFIX + todayKey
    ) {
      staleKeys.push(key);
    }
  }
  for (const key of staleKeys) localStorage.removeItem(key);
}

function msUntilNextUtcMidnight(): number {
  const now = new Date();
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return nextMidnight - now.getTime();
}

function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
    2,
    "0",
  );
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function DailyGame({
  eligibleDrivers,
  puzzleNumber,
  hasPuzzleToday,
}: {
  eligibleDrivers: DriverOption[];
  puzzleNumber: number;
  hasPuzzleToday: boolean;
}) {
  const router = useRouter();
  const { refresh } = useAuth();
  const todayKeyRef = useRef(todayUtcKey());

  const [status, setStatus] = useState<RoundStatus>("loading");
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [target, setTarget] = useState<DriverSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [countdown, setCountdown] = useState("");

  const loadState = useCallback(() => {
    const key = todayUtcKey();
    todayKeyRef.current = key;
    cleanupStaleKeys(key);
    const persisted = readPersisted(key);
    if (persisted) {
      setGuesses(persisted.guesses);
      setStatus(persisted.status);
      setTarget(persisted.target ?? null);
    } else {
      setGuesses([]);
      setStatus("playing");
      setTarget(null);
    }
    setError(null);
    setCopied(false);
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const isRoundOver = status === "won" || status === "lost";

  // Ticks only once the round is over; when it hits zero the UTC day has
  // rolled over, so pull fresh server data and reload local state for it.
  useEffect(() => {
    if (!isRoundOver) return;
    function tick() {
      const msLeft = msUntilNextUtcMidnight();
      setCountdown(formatCountdown(msLeft));
      if (msLeft <= 0) {
        router.refresh();
        loadState();
      }
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isRoundOver, router, loadState]);

  function handleSelect(driver: DriverOption) {
    setError(null);
    startTransition(async () => {
      const response = await submitDailyGuess(driver.id);
      if (!response.ok) {
        setError(response.error);
        return;
      }

      const newGuesses: Guess[] = [
        ...guesses,
        { guessedDriver: response.guessedDriver, result: response.result },
      ];
      setGuesses(newGuesses);

      if (response.won) {
        setStatus("won");
        setTarget(response.guessedDriver);
        await recordDailyResult(true, newGuesses.length);
        await refresh();
        writePersisted(todayKeyRef.current, {
          guesses: newGuesses,
          status: "won",
          target: response.guessedDriver,
        });
        return;
      }

      if (newGuesses.length >= MAX_GUESSES) {
        const reveal = await revealDailyTarget();
        const revealedTarget = reveal.ok ? reveal.target : undefined;
        setStatus("lost");
        setTarget(revealedTarget ?? null);
        if (!reveal.ok) setError(reveal.error);
        await recordDailyResult(false, newGuesses.length);
        await refresh();
        writePersisted(todayKeyRef.current, {
          guesses: newGuesses,
          status: "lost",
          target: revealedTarget,
        });
        return;
      }

      writePersisted(todayKeyRef.current, {
        guesses: newGuesses,
        status: "playing",
      });
    });
  }

  async function handleShare() {
    const text = buildShareText({
      puzzleNumber,
      results: guesses.map((g) => g.result),
      won: status === "won",
      maxGuesses: MAX_GUESSES,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy to clipboard.");
    }
  }

  const guessesLeft = MAX_GUESSES - guesses.length;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">Daily #{puzzleNumber}</p>
      </header>

      {!hasPuzzleToday ? (
        <div className="py-12 text-center text-text-muted">
          No puzzle is scheduled for today. Check back soon.
        </div>
      ) : status === "loading" ? (
        <div className="py-12 text-center text-text-muted">Loading today&apos;s puzzle…</div>
      ) : (
        <>
          <DriverAutocomplete
            drivers={eligibleDrivers}
            onSelect={handleSelect}
            disabled={isPending || isRoundOver}
          />

          {!isRoundOver && (
            <p className="text-center text-sm text-text-muted">
              {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left
            </p>
          )}

          {error && (
            <p role="alert" className="text-center text-sm text-red-400">
              {error}
            </p>
          )}

          <GuessGrid guesses={guesses} maxGuesses={MAX_GUESSES} />

          {status === "won" && target && (
            <div className="rounded-lg border border-border bg-surface-2 p-4 text-center">
              <p className="font-semibold text-accent">🏆 You got it — {target.fullName}!</p>
            </div>
          )}

          {status === "lost" && (
            <div className="rounded-lg border border-border bg-surface-2 p-4 text-center">
              <p className="font-semibold text-text">
                {target
                  ? `Out of guesses. It was ${target.fullName}.`
                  : "Out of guesses."}
              </p>
            </div>
          )}

          {isRoundOver && (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleShare}
                className="w-full rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {copied ? "Copied!" : "Share result"}
              </button>
              <p className="text-center text-sm text-text-muted">Next driver in {countdown}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
