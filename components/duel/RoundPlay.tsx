"use client";

import { useEffect, useMemo, useRef } from "react";

import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { accuracyFactor, DUEL_BASELINE, dnfPoints, liveScore, weightedProximity } from "@/lib/game/duelScoring";
import { GUESS_COOLDOWN_MS } from "@/lib/game/duelTiming";
import { useSettings } from "@/lib/settings/useSettings";

import { ClosestGuessesBoard, type RankedGuess } from "./ClosestGuessesBoard";
import { OpponentPanel } from "./OpponentPanel";
import { RoundResultCards, type RoundResult } from "./RoundResultCards";
import { SolvePotential } from "./SolvePotential";
import { TugOfWarBar } from "./TugOfWarBar";

function formatSeconds(ms: number): string {
  return String(Math.ceil(ms / 1000)).padStart(2, "0");
}

interface OpponentProgress {
  guessCount: number;
  bestHeat: number;
  provisionalPoints: number;
  solved: boolean;
  solvedPoints: number | null;
}

export function RoundPlay({
  me,
  opponent,
  roundIndex,
  totalRounds,
  remainingMs,
  roundMs,
  guessCooldownUntil,
  confirmedScoreA,
  confirmedScoreB,
  isPlayerA,
  completedRounds,
  eligibleDrivers,
  onGuess,
  pendingGuess,
}: {
  me: {
    handle: string;
    avatarUrl: string;
    guesses: RankedGuess[];
    solved: boolean;
    roundPoints: number | null;
    // Null on a round resumed after the fact -- duel_state reports that I
    // solved, not when, so the card drops the time rather than inventing one.
    solveMs: number | null;
  };
  opponent: { handle: string; avatarUrl: string; progress: OpponentProgress };
  roundIndex: number;
  // The match's own round count (duel_matches.rounds), for the "Round N / M"
  // label and nothing else. This is the ONE remaining client-side consumer of a
  // round count, and it is purely cosmetic by design -- when the match actually
  // ends is duel_close_round's decision, which useDuelLifecycle reads out of
  // match_status rather than deriving. See lib/duel/liveMatch.ts.
  totalRounds: number;
  remainingMs: number;
  // This round's full length (ends_at - started_at, so the match's own
  // round_seconds), not the ROUND_MS default -- the solve-now readout needs the
  // same denominator the server scores against, and a custom lobby can set it
  // to 30 or 90.
  roundMs: number;
  // Local Date.now() deadline the input stays disabled until, from
  // useDuelLifecycle. Compared against the clock during render rather than
  // watched with a timer: this component already re-renders on the round
  // clock's 10Hz tick, so the input re-enables within a tick of the deadline
  // for free.
  guessCooldownUntil: number;
  // Confirmed score as of the *start* of this round -- deliberately not the
  // match's live running total. The moment either side solves, the RPC
  // writes that round's points into duel_matches.score_a/b immediately
  // (round-close hasn't happened yet) -- feeding that live total in here
  // would double it with `provisional` below, which represents this same
  // round's points a second way. See DuelMatch.tsx's roundStartScoreA/BRef.
  confirmedScoreA: number;
  confirmedScoreB: number;
  isPlayerA: boolean;
  completedRounds: RoundResult[];
  eligibleDrivers: DriverOption[];
  onGuess: (driver: DriverOption) => void;
  pendingGuess: boolean;
}) {
  const { showFlags } = useSettings();
  const timeUp = remainingMs <= 0;
  // Read straight off the clock during render, with no timer of its own: the
  // round countdown re-renders this component every COUNTDOWN_TICK_MS, so the
  // input re-enables within 100ms of the deadline. The one case where those
  // ticks stop is the round expiring, and the input is disabled then anyway.
  const cooling = guessCooldownUntil > Date.now();

  // Live standing (CLAUDE.md's Duel "Live standing"): baseline + confirmed
  // round points (already closed rounds) + this round's provisional --
  // locked speed points once solved, else the best proximity among guesses
  // so far. Derived straight from state already held here (myGuesses, the
  // opponent's last guess/solved broadcast), so the tug bar moves on every new
  // best guess and jumps on a solve, not only when duel_close_round actually
  // closes the round.
  //
  // Memoized on the guess list rather than recomputed per render because this
  // component re-renders on every countdown tick and the proximity scan is
  // field math over every guess of the round -- 10x a second for a value that
  // only changes when a guess lands (audit 2026-07-27 §1.0).
  const myConfirmed = isPlayerA ? confirmedScoreA : confirmedScoreB;
  const opponentConfirmed = isPlayerA ? confirmedScoreB : confirmedScoreA;
  // Guesses that were not the answer -- what decays this round's payout on both
  // paths (drizzle/0058). On a solve the last guess is the right one and is
  // excluded, exactly as duel_submit_guess excludes it; in a DNF every guess
  // counts, as duel_close_round counts them.
  const wrongGuesses = me.solved ? Math.max(0, me.guesses.length - 1) : me.guesses.length;
  const bestProximity = useMemo(
    () => Math.max(0, ...me.guesses.map((g) => weightedProximity(g.result))),
    [me.guesses],
  );

  // Withheld from the suggestions, same as daily/infinite (audit 2026-07-29
  // §4.7). Guesses are unlimited here so a duplicate costs no turn -- it costs
  // *seconds*, in the one mode where the clock is the score. `me.guesses` is
  // per-round (adoptRound clears it), so a driver guessed in round 1 is
  // suggestable again in round 2, where it's a different target.
  //
  // Memoized on the same dependency as the scan above, so it holds across the
  // 10Hz countdown re-renders instead of handing DriverAutocomplete's memo() a
  // new Set ten times a second.
  const guessedDriverIds = useMemo(
    () => new Set(me.guesses.map((g) => g.guessedDriver.id)),
    [me.guesses],
  );
  // Decayed, so the tug bar shows what duel_close_round would actually pay if
  // the round ended now -- an undecayed best-guess value would climb on every
  // wasted guess and then drop at the close.
  const myProvisional = me.solved ? (me.roundPoints ?? 0) : dnfPoints(bestProximity, wrongGuesses);
  const accuracy = accuracyFactor(wrongGuesses);
  const opponentProvisional = opponent.progress.solved
    ? (opponent.progress.solvedPoints ?? 0)
    : opponent.progress.provisionalPoints;
  const liveMine = liveScore({ baseline: DUEL_BASELINE, confirmedPoints: myConfirmed, provisional: myProvisional });
  const liveOpponent = liveScore({ baseline: DUEL_BASELINE, confirmedPoints: opponentConfirmed, provisional: opponentProvisional });

  // Stable prop objects, so OpponentPanel's memo() actually holds across the
  // ticks: a fresh literal every render would defeat it on identity alone.
  const myPanelStats = useMemo(
    () => ({ handle: me.handle, avatarUrl: me.avatarUrl, livePoints: liveMine, guessCount: me.guesses.length }),
    [me.handle, me.avatarUrl, liveMine, me.guesses.length],
  );
  const opponentPanelStats = useMemo(
    () => ({
      handle: opponent.handle,
      avatarUrl: opponent.avatarUrl,
      livePoints: liveOpponent,
      guessCount: opponent.progress.guessCount,
    }),
    [opponent.handle, opponent.avatarUrl, liveOpponent, opponent.progress.guessCount],
  );

  // Solving unmounts DriverAutocomplete, which is where the keyboard player's
  // focus was -- so focus dropped to <body> and Tab restarted from the top of
  // the page, mid-match, at the one moment they most need to stay put (audit
  // 2026-07-29 §4.7). The solved panel replaces the input in the same slot, so
  // it takes the focus too; being focused is also what gets the points read
  // out, since a region that mounts already populated is unreliably announced.
  //
  // Same shape and same guard as PoolSelect's restore (§4.5): only claim focus
  // if it was genuinely lost. If the player has opened the exit modal or tabbed
  // to something deliberately, taking it back would be the worse bug.
  // The other half of the same rule, for the other direction. Every guess
  // disables the input twice over -- once while the RPC is in flight, then for
  // the cooldown -- and disabling a focused element drops focus to <body>, so
  // without this a keyboard player would lose the input after EVERY guess and
  // have to Tab back through the page to reach it, mid-round. The disable is
  // temporary and self-clearing, so the focus has to be too.
  //
  // Same guard as the solved panel below: only reclaim focus if it was
  // genuinely lost. If the player has opened the exit modal or tabbed somewhere
  // deliberately during the wait, taking it back is the worse bug.
  const guessInputRef = useRef<HTMLInputElement>(null);
  const inputWasBlockedRef = useRef(false);
  const inputBlocked = pendingGuess || cooling;
  useEffect(() => {
    const justFreed = inputWasBlockedRef.current && !inputBlocked;
    inputWasBlockedRef.current = inputBlocked;
    // Not when the round is over or already solved -- the input is gone or
    // permanently disabled then, and there is nothing to return to.
    if (!justFreed || timeUp || me.solved) return;
    const active = document.activeElement;
    if (!active || active === document.body) guessInputRef.current?.focus();
  }, [inputBlocked, timeUp, me.solved]);

  const solvedPanelRef = useRef<HTMLDivElement>(null);
  const wasSolvedRef = useRef(me.solved);
  useEffect(() => {
    const justSolved = me.solved && !wasSolvedRef.current;
    wasSolvedRef.current = me.solved;
    // Not on mount: a client resuming mid-round arrives already solved, and
    // there is no focus of theirs to restore.
    if (!justSolved) return;
    const active = document.activeElement;
    if (!active || active === document.body) solvedPanelRef.current?.focus();
  }, [me.solved]);

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <TugOfWarBar liveMine={liveMine} liveOpponent={liveOpponent} />

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-muted">
            Round {roundIndex + 1} / {totalRounds}
          </span>
          <span
            className={`font-mono text-2xl font-bold tabular-nums ${timeUp ? "text-red-400" : "text-text"}`}
            aria-live="polite"
          >
            0:{formatSeconds(remainingMs)}
          </span>
        </div>

        {/* Hidden once solved: the solved panel below replaces it with the real
            earned points, and two competing "+N"s on one screen is one too
            many. Also hidden at time-up, when there is nothing left to solve
            for. */}
        {!me.solved && !timeUp && (
          <SolvePotential roundMs={roundMs} remainingMs={remainingMs} wrongGuesses={wrongGuesses} />
        )}
      </div>

      <OpponentPanel
        me={myPanelStats}
        opponent={opponentPanelStats}
        opponentBestHeat={opponent.progress.bestHeat}
        opponentSolved={opponent.progress.solved}
        opponentSolvedPoints={opponent.progress.solvedPoints}
      />

      <RoundResultCards results={completedRounds} />

      {/* Once solved, the input is dead weight -- it can't be used, and its
          "Solved — waiting on your opponent…" placeholder said the same thing
          as the line beneath it. It's replaced outright by what the player
          actually earned, which they'd otherwise not learn until the
          intermission. Green (--correct, the solved colour in the tile
          tokens), never accent: this is a passive result, and orange belongs
          to the tug bar directly above it -- two loud oranges competing is
          what made the old line read as shouting. */}
      {me.solved ? (
        <div className="flex flex-col gap-1">
          <div
            ref={solvedPanelRef}
            // Programmatic focus target only -- never in the tab order, so a
            // player who tabs past it once doesn't have to tab past it again.
            tabIndex={-1}
            className="flex items-center justify-between gap-3 rounded-lg border border-correct/40 bg-correct/10 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="text-xs font-semibold tracking-wide text-correct uppercase">Solved</span>
            <span className="flex items-baseline gap-3 font-mono tabular-nums">
              {me.solveMs !== null && (
                <span className="text-sm text-text-muted">{(me.solveMs / 1000).toFixed(1)}s</span>
              )}
              <span className="text-lg font-bold text-correct">+{me.roundPoints ?? 0}</span>
            </span>
          </div>

          {/* Turns dead waiting into the only thing that still matters: the
              timer is already on screen, this just points it at your time. */}
          <p className="text-center text-xs text-text-muted" aria-live="polite">
            {opponent.progress.solved
              ? `${opponent.handle} solved it too.`
              : timeUp
                ? `${opponent.handle} ran out of time.`
                : me.solveMs !== null
                  ? `${opponent.handle} has ${formatSeconds(remainingMs)}s to beat ${(me.solveMs / 1000).toFixed(1)}s.`
                  : `${opponent.handle} has ${formatSeconds(remainingMs)}s left.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          <DriverAutocomplete
            drivers={eligibleDrivers}
            onSelect={onGuess}
            disabled={pendingGuess || timeUp || cooling}
            placeholder="Guess a driver…"
            guessedDriverIds={guessedDriverIds}
            inputRef={guessInputRef}
          />

          {/* The cooldown, drawn rather than explained. A 2px line under the
              input draining left-to-right for exactly as long as the input is
              disabled -- no toast, no error, no copy: a wait the player can
              see the end of doesn't need a sentence. Keyed on the deadline so
              each guess restarts it, and unmounted the moment it lapses so
              nothing is left half-drawn.

              Deliberately below the input rather than replacing its
              placeholder: the placeholder is where the *action* is named, and
              swapping it for a countdown makes the control look broken for a
              second every guess. */}
          <div className="h-0.5 w-full overflow-hidden" aria-hidden="true">
            {cooling && (
              <div
                key={guessCooldownUntil}
                className="animate-guess-cooldown h-full w-full origin-left rounded-full bg-accent/60 motion-reduce:animate-none"
                style={{ animationDuration: `${GUESS_COOLDOWN_MS}ms` }}
              />
            )}
          </div>
        </div>
      )}

      {!me.solved && timeUp && <p className="text-center text-sm text-text-muted">Time's up for this round.</p>}

      {/* Parts left, count right, mono and muted -- DriverFilterSummary's
          idiom, and the same job: a caption that annotates the thing under it
          without competing with it. The multiplier appears only once a guess
          has actually cost something (accuracyFactor is exactly 1 until then),
          so the row reads as a guess counter right up to the moment it starts
          reading as a price. */}
      {me.guesses.length > 0 && (
        <div className="flex items-baseline justify-between gap-3 font-mono text-xs tabular-nums text-text-muted">
          <span>
            {me.guesses.length} {me.guesses.length === 1 ? "guess" : "guesses"}
          </span>
          {accuracy < 1 && <span>×{accuracy.toFixed(2)} on a solve</span>}
        </div>
      )}

      <ClosestGuessesBoard guesses={me.guesses} pending={pendingGuess} showFlags={showFlags} />
    </div>
  );
}
