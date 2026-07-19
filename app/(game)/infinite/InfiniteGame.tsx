"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { GuessGrid, type Guess } from "@/components/game/GuessGrid";
import { PoolSelect, type PoolSelectOption } from "@/components/game/PoolSelect";
import { useToast } from "@/components/ui/Toast";
import type { DriverSummary, DriverWithActivity } from "@/lib/db/queries";
import { MAX_GUESSES } from "@/lib/game/constants";
import { POOL_WINDOWS, poolCutoffYear, type PoolWindow } from "@/lib/game/poolWindow";
import { readPoolWindowPreference, writePoolWindowPreference } from "@/lib/settings/poolWindow";
import { useSettings } from "@/lib/settings/useSettings";

import { startInfiniteRound, submitGuess } from "./actions";

type RoundStatus = "loading" | "playing" | "won" | "lost";

export function InfiniteGame({ allDrivers }: { allDrivers: DriverWithActivity[] }) {
  const { showFlags } = useSettings();
  const toast = useToast();
  const [status, setStatus] = useState<RoundStatus>("loading");
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [target, setTarget] = useState<DriverSummary | null>(null);
  const [isPending, startTransition] = useTransition();
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

  function beginRound(window: PoolWindow) {
    setStatus("loading");
    setGuesses([]);
    setTarget(null);
    startTransition(async () => {
      await startInfiniteRound(window);
      setStatus("playing");
    });
  }

  // Mount only — switching the pool via the selector below starts its own
  // fresh round explicitly, so this shouldn't re-fire when poolWindow changes.
  useEffect(() => {
    beginRound(poolWindow);
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
        <button
          onClick={() => beginRound(poolWindow)}
          disabled={isPending && status === "loading"}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text disabled:opacity-50 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          New driver
        </button>
      </header>

      <PoolSelect
        value={poolWindow}
        options={poolOptions}
        onChange={(next) => handlePoolChange(next)}
        disabled={isPending}
      />

      {status === "loading" ? (
        <div className="py-12 text-center text-text-muted">Loading a driver…</div>
      ) : (
        <>
          <DriverAutocomplete
            drivers={poolDrivers}
            onSelect={handleSelect}
            disabled={isPending || isRoundOver}
          />

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
        </>
      )}
    </div>
  );
}
