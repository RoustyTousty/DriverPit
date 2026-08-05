import { ModeIcon, type GameModeId } from "./ModeIcon";

interface ModeInfo {
  id: GameModeId;
  name: string;
  tag?: string;
  summary: string;
  points: string[];
}

// Summaries are one clause per fact, in the same clipped register the home
// teaser and the /online mode select use. Custom is last: it is a variant of
// Duel rather than a fifth way to play, and reading it after Duel is what makes
// "the same match, on your terms" land.
//
// This page is also where the guess-decay rule is explained in full. It used to
// be a line on /online as well, which was the wrong place for it -- a landing
// screen is where you choose a mode, not where you learn its scoring, and the
// rule is surfaced where it actually applies: live in the match, as the "Solve
// now +N" figure and the "×0.88 on a solve" caption.
const MODES: ModeInfo[] = [
  {
    id: "daily",
    name: "Daily",
    summary: "One driver a day, the same for everyone, 6 guesses.",
    points: [
      "One driver, chosen for everyone, every day",
      "Resets at 00:00 UTC worldwide",
      "Drawn from the last 20 seasons of drivers",
      "6 guesses, tracked in your stats and streak",
      "Your progress follows your account across devices",
    ],
  },
  {
    id: "infinite",
    name: "Infinite",
    summary: "Unlimited rounds, your own driver pool, 6 guesses.",
    points: [
      "Unlimited rounds — play as much as you want",
      "Any span of seasons from 1950 to today, on a slider",
      "Narrow it by nationality, team, or achievement — champions, race winners, pole sitters",
      "6 guesses per round",
      "Practice only: nothing here counts toward your stats or streak",
    ],
  },
  {
    id: "duel",
    name: "Duel",
    summary: "1v1, one target, 3 rounds — highest score wins.",
    points: [
      "Matched against another player at a similar rating",
      "3 rounds, a different driver in each",
      "Both of you race the same clock, with unlimited guesses",
      "Solving scores by speed: the faster you find the driver, the more the round pays",
      "Miss the round and your closest guess still earns a little",
      "Guess carefully — after the third wrong guess, every further one cuts what a solve is worth",
      "Highest total across the 3 rounds takes the match, and your rating moves with the result",
    ],
  },
  {
    id: "knockout",
    name: "Knockout",
    tag: "Coming soon",
    summary: "20 players, one target, 3 rounds — the bottom 5 go out each round.",
    points: [
      "20 players guess the same driver at once",
      "New clues reveal automatically every few seconds",
      "The slowest 5 players are eliminated each round",
      "3 rounds, one winner",
    ],
  },
  {
    id: "custom",
    name: "Custom",
    summary: "The same match, by invite, on your terms.",
    points: [
      "Host a game and share a six-character code or a link",
      "1, 3 or 5 rounds, on a 30, 60 or 90 second clock",
      "Pick the driver pool yourself — seasons, nationality, team or achievement",
      "The same board, timer and scoring as Duel, guess decay included",
      "Unranked: nothing counts toward your rating, your record or the leaderboard",
    ],
  },
];

export function GameModes() {
  return (
    <section id="game-modes" className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-text">Game modes</h2>
      <div className="flex flex-col gap-4">
        {MODES.map((mode) => (
          <div key={mode.name} className="rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-weak text-accent"
                aria-hidden="true"
              >
                <ModeIcon mode={mode.id} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-text">{mode.name}</span>
                  {mode.tag && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                      {mode.tag}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-text-muted">{mode.summary}</p>
              </div>
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
              {mode.points.map((point) => (
                <li key={point} className="flex gap-2 text-sm text-text-muted">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
