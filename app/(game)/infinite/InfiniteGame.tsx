"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { GuessGrid, type Guess } from "@/components/game/GuessGrid";
import { PoolSelect, type PoolSelectOption } from "@/components/game/PoolSelect";
import { useToast } from "@/components/ui/Toast";
import type { DriverSummary, DriverWithActivity } from "@/lib/db/queries";
import { MAX_GUESSES } from "@/lib/game/constants";
import { startInfiniteRound, submitGuess } from "@/lib/game/infiniteGuessRpc";
import { consumeInfiniteRoundPrefetch } from "@/lib/game/infiniteRoundPrefetch";
import { POOL_WINDOWS, poolCutoffYear, type PoolWindow } from "@/lib/game/poolWindow";
import { readPoolWindowPreference, writePoolWindowPreference } from "@/lib/settings/poolWindow";
import { useSettings } from "@/lib/settings/useSettings";

type RoundStatus = "loading" | "playing" | "won" | "lost";

// The only parts of a fresh round that are genuinely unknown while loading
// are the controls that need a real round to act on -- the guess input, the
// pool switcher, and "New driver" all either can't do anything useful yet or
// would just re-trigger the same in-flight load. Everything else about "0
// guesses made" (the column labels, the correct number of empty dashed
// rows, "N guesses left") is already fully known the instant a round
// starts, so the real GuessGrid and guesses-left text are rendered as-is
// below rather than faked -- a skeleton should stand in for what's actually
// unknown, not reproduce content that's already certain. Each ghost below
// matches its real control's own sizing (same padding/border classes, an
// invisible same-size label driving the height/width) so there's zero
// layout shift when it's swapped in.
function DriverInputGhost() {
  return (
    <div
      role="status"
      aria-label="Loading a driver"
      className="w-full animate-pulse rounded-lg border border-border bg-surface-2 px-4 py-3 motion-reduce:animate-none"
    >
      <span className="invisible text-base">Guess a driver…</span>
    </div>
  );
}

function PoolSelectGhost() {
  return (
    <div
      role="status"
      aria-label="Loading driver pool options"
      className="w-full animate-pulse rounded-lg border border-border bg-surface-2 px-4 py-3 motion-reduce:animate-none"
    >
      <span className="invisible text-base">Regular</span>
    </div>
  );
}

function NewDriverButtonGhost() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="shrink-0 animate-pulse rounded-lg border border-border bg-surface-2 px-3 py-2 motion-reduce:animate-none"
    >
      <span className="invisible text-sm font-semibold">New driver</span>
    </div>
  );
}

export function InfiniteGame({ allDrivers }: { allDrivers: DriverWithActivity[] }) {
  const { showFlags } = useSettings();
  const toast = useToast();
  const [status, setStatus] = useState<RoundStatus>("loading");
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [target, setTarget] = useState<DriverSummary | null>(null);
  const [isPending, startTransition] = useTransition();
  // Guards beginRound itself against re-entrancy -- belt-and-suspenders
  // alongside the disabled-button check below, since that check only takes
  // effect once React actually commits the re-render, leaving a brief real
  // window (independent of isPending's own timing) where a fast second
  // click could otherwise slip through and fire a second, wasted
  // startInfiniteRound call racing the first.
  const startingRef = useRef(false);
  // Lazy initializer: reads localStorage on the client only, defaults to
  // the same window as Daily on the server / first paint.
  const [poolWindow, setPoolWindow] = useState<PoolWindow>(() => readPoolWindowPreference());

  const poolDrivers = useMemo<DriverOption[]>(() => {
    const cutoff = poolCutoffYear(poolWindow, new Date().getUTCFullYear());
    const inPool = cutoff === null ? allDrivers : allDrivers.filter((d) => d.lastActiveYear >= cutoff);
    return inPool.map((d) => ({ id: d.id, fullName: d.fullName, nationality: d.nationality }));
  }, [allDrivers, poolWindow]);

  const poolOptions = useMemo<PoolSelectOption[]>(() => {
    const referenceYear = new Date().getUTCFullYear();
    return POOL_WINDOWS.map((window) => {
      const cutoff = poolCutoffYear(window.value, referenceYear);
      const count = cutoff === null ? allDrivers.length : allDrivers.filter((d) => d.lastActiveYear >= cutoff).length;
      return { value: window.value, tier: window.tier, label: window.label, count };
    });
  }, [allDrivers]);

  // `existing` lets the initial mount reuse a round already kicked off by
  // hovering/focusing the Infinite tab (see infiniteRoundPrefetch.ts)
  // instead of paying for a second, redundant server round trip.
  function beginRound(window: PoolWindow, existing?: Promise<void>) {
    if (startingRef.current) return;
    startingRef.current = true;
    setStatus("loading");
    setGuesses([]);
    setTarget(null);
    startTransition(async () => {
      try {
        await (existing ?? startInfiniteRound(window));
        setStatus("playing");
      } finally {
        startingRef.current = false;
      }
    });
  }

  // Mount only — switching the pool via the selector below starts its own
  // fresh round explicitly, so this shouldn't re-fire when poolWindow changes.
  useEffect(() => {
    beginRound(poolWindow, consumeInfiniteRoundPrefetch(poolWindow) ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePoolChange(next: PoolWindow) {
    setPoolWindow(next);
    writePoolWindowPreference(next);
    beginRound(next);
  }

  function handleSelect(driver: DriverOption) {
    startTransition(async () => {
      const response = await submitGuess(driver.id);
      if (!response.ok) {
        toast.error(response.error);
        return;
      }

      setGuesses((prev) => [
        ...prev,
        { guessedDriver: response.guessedDriver, result: response.result },
      ]);

      if (response.status === "won" || response.status === "lost") {
        setStatus(response.status);
        if (response.target) setTarget(response.target);
      }
    });
  }

  const isRoundOver = status === "won" || status === "lost";
  const guessesLeft = MAX_GUESSES - guesses.length;

  return (
    <div className="mx-auto flex w-full flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
          <p className="text-sm text-text-muted">Infinite mode</p>
        </div>
        {status === "loading" ? (
          <NewDriverButtonGhost />
        ) : (
          <button
            onClick={() => beginRound(poolWindow)}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            New driver
          </button>
        )}
      </header>

      {status === "loading" ? (
        <PoolSelectGhost />
      ) : (
        <PoolSelect value={poolWindow} options={poolOptions} onChange={(next) => handlePoolChange(next)} />
      )}

      {status === "loading" ? (
        <DriverInputGhost />
      ) : (
        <DriverAutocomplete
          drivers={poolDrivers}
          onSelect={handleSelect}
          disabled={isPending || isRoundOver}
        />
      )}

      {!isRoundOver && (
        <p className="text-center text-sm text-text-muted">
          {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left
        </p>
      )}

      <GuessGrid guesses={guesses} maxGuesses={MAX_GUESSES} showFlags={showFlags} />

      {status === "won" && target && (
        <div className="rounded-lg border border-border bg-surface-2 p-4 text-center">
          <p className="font-semibold text-accent">🏆 You got it — {target.fullName}!</p>
        </div>
      )}

      {status === "lost" && target && (
        <div className="rounded-lg border border-border bg-surface-2 p-4 text-center">
          <p className="font-semibold text-text">Out of guesses. It was {target.fullName}.</p>
        </div>
      )}
    </div>
  );
}
