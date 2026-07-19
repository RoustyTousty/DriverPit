import type { Profile } from "@/components/auth/AuthProvider";
import { AvatarGlyph } from "@/components/ui/AvatarGlyph";

// Purely presentational -- `remainingMs` is owned by the parent (DuelMatch),
// which runs a single useServerCountdown instance for whatever phase is
// active (this reveal, or later the round timer) rather than each display
// component running its own clock.
export function MatchFoundReveal({
  me,
  opponent,
  remainingMs,
}: {
  me: Profile;
  opponent: { username: string; displayName: string | null; avatarUrl: string };
  remainingMs: number;
}) {
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const isGo = remainingMs <= 0;

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center">
      <p className="text-xs font-semibold tracking-wide text-accent uppercase">Opponent found</p>

      <div className="flex w-full items-center justify-center gap-4">
        <div className="flex flex-1 flex-col items-center gap-2">
          <AvatarGlyph avatarUrl={me.avatarUrl} size="md" />
          <p className="max-w-full truncate text-sm font-semibold text-text">
            {me.displayName || me.username}
          </p>
        </div>

        <span className="text-lg font-bold text-text-muted">VS</span>

        <div className="flex flex-1 flex-col items-center gap-2">
          <AvatarGlyph avatarUrl={opponent.avatarUrl} size="md" />
          <p className="max-w-full truncate text-sm font-semibold text-text">
            {opponent.displayName || opponent.username}
          </p>
        </div>
      </div>

      <div
        className={`font-mono text-5xl font-bold tabular-nums transition-colors motion-reduce:transition-none ${
          isGo ? "text-accent" : "text-text"
        }`}
        aria-live="polite"
      >
        {isGo ? "GO!" : secondsLeft}
      </div>

      {isGo && <p className="text-xs text-text-muted">Round 1 is starting…</p>}
    </div>
  );
}
