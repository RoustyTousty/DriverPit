"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { GuessGrid, type Guess } from "@/components/game/GuessGrid";
import { LoadingOverlay } from "@/components/game/LoadingOverlay";
import { PoolSelect, type PoolSelectOption } from "@/components/game/PoolSelect";
import { ResultCard } from "@/components/game/ResultCard";
import { useToast } from "@/components/ui/Toast";
import type { DriverSummary, DriverWithActivity } from "@/lib/db/queries";
import { MAX_GUESSES } from "@/lib/game/constants";
import { startInfiniteRound, submitGuess } from "@/lib/game/infiniteGuessRpc";
import { consumeInfiniteRoundPrefetch } from "@/lib/game/infiniteRoundPrefetch";
import { POOL_WINDOWS, poolCutoffYear, type PoolWindow } from "@/lib/game/poolWindow";
import { readPoolWindowPreference, writePoolWindowPreference } from "@/lib/settings/poolWindow";
import { useSettings } from "@/lib/settings/useSettings";

type RoundStatus = "loading" | "playing" | "won" | "lost" | "error";

export function InfiniteGame({ allDrivers }: { allDrivers: DriverWithActivity[] }) {
  const { showFlags } = useSettings();
  const toast = useToast();
  const [status, setStatus] = useState<RoundStatus>("loading");
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [target, setTarget] = useState<DriverSummary | null>(null);
  const [isPending, startTransition] = useTransition();
  // Deliberately NOT reused from `isPending`: that transition also covers
  // beginRound ("New driver" / switching pool), and the grid stays mounted
  // through a round start -- so keying the shimmer off isPending would show a
  // phantom pending row when no guess is in flight at all. This tracks only an
  // in-flight guess.
  const [guessPending, setGuessPending] = useState(false);
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
      } catch {
        // startInfiniteRound throws on RPC failure (offline, a Supabase
        // error), and so does a rejected prefetch handed in as `existing`.
        // Without this the status stays "loading" forever and the overlay
        // becomes a permanent dead end with no error and no way out --
        // there's no partial state to fall back to the way daily has its
        // cached board, because an infinite round only exists once the
        // server has picked its driver. Same shape as daily's hydrate:
        // surface it and offer a retry.
        setStatus("error");
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
    if (guessPending) return;
    // Optimistic: the shimmer row appears on this line, before the RPC is even
    // sent, and is replaced by the authoritative row when it resolves -- which
    // is what makes the remaining ~150ms read as zero (CLAUDE.md "Instant
    // guesses").
    setGuessPending(true);
    startTransition(async () => {
      try {
        const response = await submitGuess(driver.id);
        if (!response.ok) {
          // The guess did NOT count, so no row is appended and the shimmer is
          // cleared below -- never leave a placeholder implying it landed. The
          // RPC's rejections are already written as player-facing copy ("Your
          // round expired. Start a new driver to keep playing."), so they're
          // surfaced as-is rather than flattened to a generic message.
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
      } catch {
        // submitGuess maps Supabase errors into { ok: false }, so reaching here
        // means something unexpected (offline, a thrown network error). Same
        // rule as daily: a failed guess is surfaced, never silently swallowed.
        toast.error("Couldn't submit your guess — it didn't count. Check your connection and try again.");
      } finally {
        setGuessPending(false);
      }
    });
  }

  const isLoading = status === "loading";
  const isRoundOver = status === "won" || status === "lost";
  const guessesLeft = MAX_GUESSES - guesses.length;

  return (
    // `relative` anchors the loading overlay over the ENTIRE game window --
    // header and "New driver" included -- so a starting round is one state
    // covering one card. inset-0 lands exactly on the card's edges: this div is
    // the `{children}` of the rounded-lg surface card in app/(game)/layout.tsx.
    // Everything underneath renders for real rather than as a skeleton: nothing
    // about a fresh round's layout is unknown ("N guesses left" and the empty
    // dashed rows are certain the moment it starts), so there's nothing to fake
    // and nothing shifts when the round lands.
    <div className="relative mx-auto flex w-full flex-col gap-4 px-4 py-6" aria-busy={isLoading}>
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
          <p className="text-sm text-text-muted">Infinite</p>
        </div>
        {/* The overlay covers this, but covering isn't disabling: an overlay
            stops pointers, not keyboard focus. Still `disabled` so it can't be
            tabbed to and fired while a round is loading. Same for the two
            controls below. */}
        <button
          onClick={() => beginRound(poolWindow)}
          disabled={isLoading}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted"
        >
          New driver
        </button>
      </header>

      {status === "error" ? (
        // Replaces the whole play area rather than sitting above a dead board:
        // there is no round, so a pool selector, an input and six empty rows
        // would all be controls that can't do anything. The header's "New
        // driver" button is live again here and does the same thing as Retry --
        // that's fine, but it isn't discoverable as error recovery on its own,
        // which is what this says.
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-text-muted">
            Couldn&apos;t start a round. Check your connection and try again.
          </p>
          <button
            onClick={() => beginRound(poolWindow)}
            className="rounded-lg border border-accent-weak bg-accent-weak/40 px-4 py-2 text-sm font-semibold text-accent transition hover:border-accent/50 hover:bg-accent-weak/60 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <PoolSelect
            value={poolWindow}
            options={poolOptions}
            onChange={(next) => handlePoolChange(next)}
            disabled={isLoading}
          />

          <DriverAutocomplete
            drivers={poolDrivers}
            onSelect={handleSelect}
            disabled={isLoading || isPending || isRoundOver}
          />

          {!isRoundOver && (
            <p className="text-center text-sm text-text-muted">
              {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left
            </p>
          )}

          <GuessGrid guesses={guesses} maxGuesses={MAX_GUESSES} showFlags={showFlags} pending={guessPending} />

          {isRoundOver && target && (
            <ResultCard
              won={status === "won"}
              driverName={target.fullName}
              driverCode={target.driverCode}
              guessesUsed={guesses.length}
              maxGuesses={MAX_GUESSES}
            />
          )}
        </>
      )}

      {isLoading && <LoadingOverlay label="Loading a driver" />}
    </div>
  );
}
