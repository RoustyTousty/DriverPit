"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Modal } from "@/components/ui/Modal";
import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { getLeaderboard, type DuelLeaderboardEntry, type StreakLeaderboardEntry } from "@/lib/leaderboard/actions";

type Board = "duel" | "streak";

const BOARDS: { value: Board; label: string }[] = [
  { value: "streak", label: "Daily streak" },
  { value: "duel", label: "Duel rating" },
];

// Always exactly this many slots at the top, real entries or not -- with
// only a handful of accounts so far, a board that just stops after 2-3 real
// rows reads as broken rather than "not many people yet." Matches Row's
// layout (rank column, sm AvatarGlyph) so a real row slotting into an empty
// one later doesn't shift anything around it.
const TOP_SLOTS = 10;

function EmptySlotRow({ rank }: { rank: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2">
      <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-text-muted">{rank}</span>
      <div className="h-7 w-7 shrink-0 rounded-full border-2 border-dashed border-border" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-sm text-text-muted">Open</p>
    </div>
  );
}

function Row({
  rank,
  username,
  displayName,
  avatarUrl,
  metric,
  metricLabel,
  isYou,
}: {
  rank: number;
  username: string;
  displayName: string | null;
  avatarUrl: string;
  metric: React.ReactNode;
  metricLabel: string;
  isYou: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
        isYou ? "border-accent bg-accent-weak/40" : "border-border"
      }`}
    >
      <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-text-muted">{rank}</span>
      <AvatarGlyph avatarUrl={avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text">{displayName || username}</p>
        {isYou && <p className="text-[10px] tracking-wide text-accent uppercase">You</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="font-mono text-sm font-bold tabular-nums text-text">{metric}</span>
        <span className="text-[10px] tracking-wide text-text-muted uppercase">{metricLabel}</span>
      </div>
    </div>
  );
}

export function LeaderboardModal({
  open,
  onClose,
  onUpgrade,
}: {
  open: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}) {
  const { profile, userId } = useAuth();
  const [board, setBoard] = useState<Board>("streak");
  const [duelBoard, setDuelBoard] = useState<DuelLeaderboardEntry[]>([]);
  const [streakBoard, setStreakBoard] = useState<StreakLeaderboardEntry[]>([]);
  const [myDuelRank, setMyDuelRank] = useState<{ rank: number; entry: DuelLeaderboardEntry } | undefined>();
  const [myStreakRank, setMyStreakRank] = useState<{ rank: number; entry: StreakLeaderboardEntry } | undefined>();
  const [loading, setLoading] = useState(true);

  // Default to the streak tab each time the modal opens.
  useEffect(() => {
    if (open) setBoard("streak");
  }, [open]);

  // Re-fetches on identity change too, not just on open: getLeaderboard()
  // resolves the caller's own rank (myDuelRank / myStreakRank) and the "You"
  // highlight, so a sign-in/out while the modal is open must re-resolve those
  // for the new identity rather than keep the previous player's rows.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getLeaderboard().then((result) => {
      if (cancelled) return;
      setDuelBoard(result.duelBoard);
      setStreakBoard(result.streakBoard);
      setMyDuelRank(result.myDuelRank);
      setMyStreakRank(result.myStreakRank);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  return (
    <Modal open={open} onClose={onClose} title="Leaderboard">
      <div className="flex flex-col gap-4">
        {profile?.isGuest && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-accent-weak bg-accent-weak/40 p-3">
            <div>
              <p className="text-sm font-semibold text-accent">You're playing as a guest</p>
              <p className="text-xs text-text-muted">Create an account to appear on the leaderboard.</p>
            </div>
            <button
              type="button"
              onClick={onUpgrade}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98]"
            >
              Sign up
            </button>
          </div>
        )}

        <div role="tablist" aria-label="Leaderboard" className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
          {BOARDS.map((tab) => {
            const active = tab.value === board;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setBoard(tab.value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active ? "bg-accent-weak text-accent" : "text-text-muted hover:text-text"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-text-muted">Loading…</p>
        ) : (
          <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
            {board === "duel"
              ? Array.from({ length: TOP_SLOTS }).map((_, index) => {
                  const entry = duelBoard[index];
                  return entry ? (
                    <Row
                      key={entry.id}
                      rank={index + 1}
                      username={entry.username}
                      displayName={entry.displayName}
                      avatarUrl={entry.avatarUrl}
                      metric={entry.duelRating}
                      metricLabel="Rating"
                      isYou={entry.id === profile?.id}
                    />
                  ) : (
                    <EmptySlotRow key={`empty-${index}`} rank={index + 1} />
                  );
                })
              : Array.from({ length: TOP_SLOTS }).map((_, index) => {
                  const entry = streakBoard[index];
                  return entry ? (
                    <Row
                      key={entry.id}
                      rank={index + 1}
                      username={entry.username}
                      displayName={entry.displayName}
                      avatarUrl={entry.avatarUrl}
                      metric={entry.currentStreak}
                      metricLabel="Streak"
                      isYou={entry.id === profile?.id}
                    />
                  ) : (
                    <EmptySlotRow key={`empty-${index}`} rank={index + 1} />
                  );
                })}

            {/* Not in the top slots above -- shown separately with a real
                rank/value instead of never appearing at all. */}
            {board === "duel" && myDuelRank && (
              <>
                <div className="my-1 border-t border-dashed border-border" aria-hidden="true" />
                <Row
                  rank={myDuelRank.rank}
                  username={myDuelRank.entry.username}
                  displayName={myDuelRank.entry.displayName}
                  avatarUrl={myDuelRank.entry.avatarUrl}
                  metric={myDuelRank.entry.duelRating}
                  metricLabel="Rating"
                  isYou
                />
              </>
            )}
            {board === "streak" && myStreakRank && (
              <>
                <div className="my-1 border-t border-dashed border-border" aria-hidden="true" />
                <Row
                  rank={myStreakRank.rank}
                  username={myStreakRank.entry.username}
                  displayName={myStreakRank.entry.displayName}
                  avatarUrl={myStreakRank.entry.avatarUrl}
                  metric={myStreakRank.entry.currentStreak}
                  metricLabel="Streak"
                  isYou
                />
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
