"use client";

import { useEffect, useRef, useState } from "react";

import type { GuessResult } from "@/lib/game/compare";
import { guessAnnouncement, type GuessTileValues } from "@/lib/game/tileLabel";

// Audit 2026-07-29 §4.1: the tiles are readable (role="img" + tileLabel.ts),
// the EVENT wasn't. Submitting a guess produced nothing in speech at all -- the
// grid silently grew a row and a screen reader user had to navigate back into
// it to learn what happened, on every guess of every game.
//
// Structural prop rather than GuessGrid's `Guess`, which pulls lib/db's
// DriverSummary in -- same reason lib/game/tileLabel.ts states GuessTileValues
// structurally. It also keeps the import one-way (GuessGrid imports this).
export interface AnnouncedGuess {
  guessedDriver: GuessTileValues & { fullName: string };
  result: GuessResult;
}

export function GuessAnnouncer({
  guesses,
  maxGuesses,
  pending,
}: {
  guesses: AnnouncedGuess[];
  maxGuesses: number;
  pending: boolean;
}) {
  const [message, setMessage] = useState("");
  const countRef = useRef(guesses.length);
  // "A guess was in flight from THIS client since the last time the list
  // settled." It is what separates a submit from a restore, below.
  const submittedRef = useRef(false);

  useEffect(() => {
    if (pending) {
      submittedRef.current = true;
      return;
    }

    const previous = countRef.current;
    countRef.current = guesses.length;
    const wasSubmitted = submittedRef.current;
    submittedRef.current = false;

    // THE gate, and the reason this isn't just "announce the last element".
    // A daily board is server-authoritative and resumable: daily_state() drops
    // a day's worth of already-played guesses in at once, which is a change to
    // the list but not an event the player just caused. Announcing it would
    // read the previous session's last guess aloud on every page load. Only a
    // guess that passed through the optimistic pending row is one this client
    // submitted (DailyGame/InfiniteGame both set it before the RPC leaves).
    if (!wasSubmitted || guesses.length <= previous) return;

    const latest = guesses[guesses.length - 1];
    if (!latest) return;
    setMessage(
      guessAnnouncement(latest.guessedDriver.fullName, latest.guessedDriver, latest.result, {
        guessNumber: guesses.length,
        maxGuesses,
      }),
    );
  }, [guesses, pending, maxGuesses]);

  // Persistent region that starts empty, never one that mounts already
  // populated -- a live region announces its *changes*, and screen readers
  // routinely miss the initial content of one that appears with text already in
  // it. Same shape and same reason as DriverAutocomplete's "No drivers found".
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {message}
    </span>
  );
}
