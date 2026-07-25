import { DriverCodeBadge } from "./GuessGrid";

// The end-of-round answer card, shared by daily and infinite (which carried
// two near-identical copies of a centered one-line banner).
//
// Built from what BOTH modes actually have at the end of a round: daily's
// target is only { driverId, name, code } -- tiles and stats are deliberately
// never sent for the answer -- so this shows the code, the name, and how many
// guesses it took. Anything richer (the five stats, duel's intermission reveal)
// would need the daily RPC to return more, which isn't worth widening the
// answer payload for.
//
// Leads with the real DriverCodeBadge from the board rows rather than an icon
// or emoji: the answer reads as one more row in the grid it belongs to, and
// there's no second definition of that badge to drift.
export function ResultCard({
  won,
  driverName,
  driverCode,
  guessesUsed,
  maxGuesses,
}: {
  won: boolean;
  // Null only if a round somehow ends without the server disclosing the answer.
  // The name line is dropped rather than the whole card, so "out of guesses"
  // still gets said.
  driverName: string | null;
  driverCode: string | null;
  guessesUsed: number;
  maxGuesses: number;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 ${
        won ? "border-accent/40 bg-accent-weak/40" : "border-border bg-surface-2"
      }`}
    >
      <DriverCodeBadge code={driverCode} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Same eyebrow treatment as the duel's "Opponent found" / "Finding an
            opponent" headers. Accent on a win is the only color here -- the
            card itself stays a tint, not an orange fill. */}
        <p
          className={`text-xs font-semibold tracking-wide uppercase ${won ? "text-accent" : "text-text-muted"}`}
        >
          {won ? "Solved" : "Out of guesses"}
        </p>

        {driverName && (
          <p className="truncate text-lg leading-tight font-bold text-text">{driverName}</p>
        )}

        {/* Mono tabular for the counts, per the site's data/UI type split. Said
            the same way win or lose, so the card's shape never jumps. */}
        <p className="text-xs text-text-muted">
          <span className="font-mono tabular-nums">{guessesUsed}</span> of{" "}
          <span className="font-mono tabular-nums">{maxGuesses}</span> guesses
        </p>
      </div>
    </div>
  );
}
