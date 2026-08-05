"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { DriverFilterButton } from "@/components/game/DriverFilterButton";
import { DriverFilterModal } from "@/components/game/DriverFilterModal";
import { DriverFilterSummary } from "@/components/game/DriverFilterSummary";
import { GuessGrid, type Guess } from "@/components/game/GuessGrid";
import { LoadingOverlay } from "@/components/game/LoadingOverlay";
import { ResultCard } from "@/components/game/ResultCard";
import { useToast } from "@/components/ui/Toast";
import type { DriverSummary, DriverWithActivity } from "@/lib/db/queries";
import { MAX_GUESSES } from "@/lib/game/constants";
import { matchesDriverFilter, type DriverFilter } from "@/lib/game/driverFilter";
import { startInfiniteRound, submitGuess } from "@/lib/game/infiniteGuessRpc";
import { consumeInfiniteRoundPrefetch } from "@/lib/game/infiniteRoundPrefetch";
import { readDriverFilterPreference, writeDriverFilterPreference } from "@/lib/settings/driverFilter";
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
  const [filterOpen, setFilterOpen] = useState(false);
  // The current UTC year, pinned for this mount. It bounds the year slider and
  // clamps the filter, and re-reading it per render would make every memo below
  // depend on the wall clock for no benefit -- a session that spans New Year's
  // Eve gets the new bound on its next load.
  const referenceYear = useMemo(() => new Date().getUTCFullYear(), []);
  // Lazy initializer: reads localStorage on the client only, and returns the
  // default (the same 20-season span daily uses) on the server / first paint.
  const [filter, setFilter] = useState<DriverFilter>(() =>
    readDriverFilterPreference("infinite", referenceYear),
  );

  // The drivers this filter admits -- the autocomplete's pool AND the set the
  // server draws the target from, via the same predicate mirrored in
  // infinite_start_round. One pass, memoized on the filter, so it is not redone
  // per keystroke.
  const matchingDrivers = useMemo(
    () => allDrivers.filter((d) => matchesDriverFilter(d, filter)),
    [allDrivers, filter],
  );

  const poolDrivers = useMemo<DriverOption[]>(
    () =>
      matchingDrivers.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        nationality: d.nationality,
      })),
    [matchingDrivers],
  );

  // `existing` lets the initial mount reuse a round already kicked off by
  // hovering/focusing the Infinite tab (see infiniteRoundPrefetch.ts)
  // instead of paying for a second, redundant server round trip.
  function beginRound(next: DriverFilter, existing?: Promise<void>) {
    if (startingRef.current) return;
    startingRef.current = true;
    setStatus("loading");
    setGuesses([]);
    setTarget(null);
    startTransition(async () => {
      try {
        await (existing ?? startInfiniteRound(next));
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

  // Mount only — applying a filter below starts its own fresh round
  // explicitly, so this shouldn't re-fire when `filter` changes.
  useEffect(() => {
    beginRound(filter, consumeInfiniteRoundPrefetch(filter) ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Applying is what starts the round: the filter decides the target, so there
  // is no coherent state where the panel has been applied but the board is
  // still playing the previous pool's driver.
  function handleApplyFilter(next: DriverFilter) {
    setFilterOpen(false);
    setFilter(next);
    writeDriverFilterPreference("infinite", next, referenceYear);
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

        setGuesses((prev) => [...prev, { guessedDriver: response.guessedDriver, result: response.result }]);

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

  // Same rule as daily: an already-guessed driver is withheld from the
  // suggestions rather than allowed to burn a turn on a row the grid is already
  // showing (audit 2026-07-29 §4.7). A new round clears `guesses`, so this
  // empties with it.
  const guessedDriverIds = useMemo(() => new Set(guesses.map((g) => g.guessedDriver.id)), [guesses]);

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
        {/* The mode's only two controls, paired. Both are `disabled` while a
            round loads: the overlay covers them, but covering isn't disabling
            -- an overlay stops pointers, not keyboard focus. */}
        <div className="flex shrink-0 items-center gap-2">
          <DriverFilterButton
            filter={filter}
            matchCount={matchingDrivers.length}
            referenceYear={referenceYear}
            onOpen={() => setFilterOpen(true)}
            disabled={isLoading}
          />
          {/* FILLED, at full text strength. On this site the difference between
              a live control and a dead one is exactly that: /online's Duel card
              is `bg-surface-2` + `text-text`, and its Knockout "coming soon"
              card is an unfilled border with muted text. This button had the
              second set, so it read as disabled even when it wasn't. Hover is a
              brightness lift like the accent buttons use, at 125 rather than
              110 because surface-2 is dark enough that 110 is imperceptible. */}
          <button
            onClick={() => beginRound(filter)}
            disabled={isLoading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-semibold text-text transition hover:brightness-125 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:hover:brightness-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              className="h-4 w-4"
              aria-hidden="true"
            >
              {/* Two arrows crossing — "give me a different one", not "reload
                this one", which is what a circular refresh arrow would say. */}
              <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
            New driver
          </button>
        </div>
      </header>

      {status === "error" ? (
        // Replaces the whole play area rather than sitting above a dead board:
        // there is no round, so an input and six empty rows would be controls
        // that can't do anything. The header survives -- the filter is still
        // worth changing when nothing started, and its "New driver" button does
        // the same thing as Retry, which is fine but isn't discoverable as
        // error recovery on its own. That's what this says.
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-text-muted">
            Couldn&apos;t start a round. Check your connection and try again.
          </p>
          <button
            onClick={() => beginRound(filter)}
            className="rounded-lg border border-accent-weak bg-accent-weak/40 px-4 py-2 text-sm font-semibold text-accent transition hover:border-accent/50 hover:bg-accent-weak/60 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* The filter's state, as a caption on the input rather than as a
              control: what you are guessing from belongs next to where you
              guess, while the thing that CHANGES it lives with the other chrome
              up in the header. Not a button, so nothing here competes with the
              input for the tap.

              Grouped at gap-1.5 inside the board's gap-4 column, because a
              caption sitting the same distance from its input as from
              everything else is not a caption, just another row. */}
          <div className="flex flex-col gap-1.5">
            <DriverFilterSummary
              filter={filter}
              matchCount={matchingDrivers.length}
              referenceYear={referenceYear}
            />

            <DriverAutocomplete
              drivers={poolDrivers}
              onSelect={handleSelect}
              disabled={isLoading || isPending || isRoundOver}
              guessedDriverIds={guessedDriverIds}
            />
          </div>

          {!isRoundOver && (
            <p className="text-center text-sm text-text-muted">
              {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left
            </p>
          )}

          <GuessGrid
            guesses={guesses}
            maxGuesses={MAX_GUESSES}
            showFlags={showFlags}
            pending={guessPending}
          />

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

      {/* Mounted unconditionally so Modal can play its own exit transition --
          the same one-way-latch reasoning as GameModals, minus the lazy chunk
          (this one is part of the Infinite window, not the global shell). */}
      <DriverFilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        drivers={allDrivers}
        filter={filter}
        onApply={handleApplyFilter}
        referenceYear={referenceYear}
      />
    </div>
  );
}
