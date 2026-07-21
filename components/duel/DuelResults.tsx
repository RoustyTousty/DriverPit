"use client";

import { useEffect, useState } from "react";

import type { Profile } from "@/components/auth/AuthProvider";
import { useSettingsModal } from "@/components/layout/SettingsModalContext";
import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { getDuelResults, type DuelResultsData } from "@/lib/duel/actions";

import type { MatchEndReason } from "./DuelMatch";

// CLAUDE.md's Duel "Match end": rendered back in the site shell (DuelMatch
// flips ActiveMatchContext off the moment its phase hits "finished", which
// restores the mode tabs, marketing, and the ad slot around this panel) --
// big WIN/LOSE, final score, rating delta, per-round breakdown, CTAs.
//
// The headline/score render instantly from props (the parent already knows
// them, live or reloaded); the rating delta and per-round breakdown come
// from one getDuelResults fetch, because the client deliberately never
// computes ratings or tracks the opponent's per-round detail itself -- it
// only reads what closeRound already stored server-side (rating_delta_a/b,
// duel_round_results).
export function DuelResults({
  matchId,
  me,
  opponentHandle,
  opponentAvatarUrl,
  winnerId,
  myScore,
  theirScore,
  endReason,
  rematchPending,
  onRematch,
  onFindNewOpponent,
  onBackToModes,
}: {
  matchId: number;
  me: Profile;
  opponentHandle: string;
  opponentAvatarUrl: string;
  winnerId: string | null;
  myScore: number;
  theirScore: number;
  // How the match ended (DuelMatch's MatchEndReason) -- a forfeit gets a
  // subtitle explaining the abrupt result, and no Rematch CTA: the pairing
  // is over because someone left, so "run it back" isn't on the table the
  // way it is after a played-out finish.
  endReason: MatchEndReason;
  rematchPending: boolean;
  onRematch: () => void;
  onFindNewOpponent: () => void;
  onBackToModes: () => void;
}) {
  const { openSettings } = useSettingsModal();
  const [details, setDetails] = useState<DuelResultsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDuelResults(matchId).then((res) => {
      if (!cancelled && res.ok) setDetails(res);
    });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  // Props render the headline instantly; once the fetch lands, the stored
  // (server-authoritative) values take over -- covers the client whose
  // match_end broadcast was missed and would otherwise show winnerId null
  // ("Draw") for a match it actually won or lost.
  const effectiveWinnerId = details ? details.winnerId : winnerId;
  const effectiveMyScore = details ? details.myScore : myScore;
  const effectiveTheirScore = details ? details.theirScore : theirScore;

  const isDraw = effectiveWinnerId === null;
  const iWon = effectiveWinnerId === me.id;
  const myHandle = me.displayName || me.username;
  const ratingDelta = details?.myRatingDelta ?? null;
  const wasForfeit = endReason !== "completed" || details?.status === "abandoned";
  const reasonLine =
    endReason === "forfeitMe" ? "You forfeited" : endReason === "forfeitOpponent" ? "Opponent left — you win." : null;

  return (
    <div className="flex flex-col items-center gap-5 px-4 py-8 text-center">
      <div className="flex flex-col items-center gap-1">
        <p
          className={`text-4xl font-bold tracking-wide uppercase ${
            iWon ? "text-accent" : "text-text"
          }`}
        >
          {isDraw ? "Draw" : iWon ? "Win" : "Lose"}
        </p>
        {reasonLine && <p className="text-sm text-text-muted">{reasonLine}</p>}
        <p className="font-mono text-xl tabular-nums text-text-muted">
          {effectiveMyScore} — {effectiveTheirScore}
        </p>
        {ratingDelta !== null && (
          <p
            className={`font-mono text-sm font-semibold tabular-nums ${
              ratingDelta > 0 ? "text-correct" : ratingDelta < 0 ? "text-red-400" : "text-text-muted"
            }`}
          >
            {ratingDelta > 0 ? `+${ratingDelta}` : `${ratingDelta}`}{" "}
            <span className="text-xs font-normal text-text-muted">rating</span>
          </p>
        )}
      </div>

      <div className="w-full rounded-lg border border-border">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center justify-start gap-2">
            <AvatarGlyph avatarUrl={me.avatarUrl} size="sm" />
            <span className="truncate text-xs font-semibold text-text">{myHandle}</span>
          </div>
          <span className="text-[10px] tracking-wide text-text-muted uppercase">vs</span>
          <div className="flex min-w-0 items-center justify-end gap-2">
            <span className="truncate text-xs font-semibold text-text">{opponentHandle}</span>
            <AvatarGlyph avatarUrl={opponentAvatarUrl} size="sm" />
          </div>
        </div>

        {details ? (
          details.rounds.map((round) => {
            const iTookRound = round.myPoints > round.theirPoints;
            const theyTookRound = round.theirPoints > round.myPoints;
            return (
              <div
                key={round.roundIndex}
                className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
              >
                <div className="flex items-baseline justify-start gap-2">
                  <span
                    className={`font-mono text-sm font-bold tabular-nums ${
                      iTookRound ? "text-text" : "text-text-muted"
                    }`}
                  >
                    +{round.myPoints}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-text-muted">
                    {round.mySolveMs !== null ? `${(round.mySolveMs / 1000).toFixed(1)}s` : "DNF"}
                  </span>
                </div>
                <span className="text-[10px] tracking-wide text-text-muted uppercase">
                  R{round.roundIndex + 1}
                </span>
                <div className="flex items-baseline justify-end gap-2">
                  <span className="font-mono text-xs tabular-nums text-text-muted">
                    {round.theirSolveMs !== null ? `${(round.theirSolveMs / 1000).toFixed(1)}s` : "DNF"}
                  </span>
                  <span
                    className={`font-mono text-sm font-bold tabular-nums ${
                      theyTookRound ? "text-text" : "text-text-muted"
                    }`}
                  >
                    +{round.theirPoints}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <p className="px-3 py-4 text-xs text-text-muted">Loading round breakdown…</p>
        )}
      </div>

      {me.isGuest && iWon && (
        <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-accent-weak bg-accent-weak/40 p-3 text-left">
          <div>
            <p className="text-sm font-semibold text-accent">Save your progress</p>
            <p className="text-xs text-text-muted">
              Create an account to keep your duel rating and record.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openSettings("profile")}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.98]"
          >
            Sign up
          </button>
        </div>
      )}

      <div className="flex w-full flex-col gap-2 pt-1">
        {!wasForfeit && (
          <button
            type="button"
            onClick={onRematch}
            disabled={rematchPending}
            className="w-full rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.98] disabled:opacity-50"
          >
            {rematchPending ? "Waiting for opponent…" : "Rematch"}
          </button>
        )}
        <button
          type="button"
          onClick={onFindNewOpponent}
          className={`w-full rounded-lg px-4 py-3 text-base font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            wasForfeit
              ? "bg-accent text-bg hover:brightness-110 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.98]"
              : "border border-border text-text hover:bg-surface-2"
          }`}
        >
          Find new opponent
        </button>
        <button
          type="button"
          onClick={onBackToModes}
          className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Back to modes
        </button>
      </div>
    </div>
  );
}
