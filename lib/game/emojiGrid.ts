import type { ExactFeedback, GuessResult, OrderedFeedback, TeamFeedback } from "./compare";

const FEEDBACK_EMOJI: Record<ExactFeedback | OrderedFeedback | TeamFeedback, string> = {
  exact: "🟩",
  correct: "🟩",
  historical: "🟧",
  miss: "⬛",
  higher: "🔼",
  lower: "🔽",
};

function resultToEmojiRow(result: GuessResult): string {
  return [
    result.nationality,
    result.team,
    result.age,
    result.debutYear,
    result.careerWins,
  ]
    .map((feedback) => FEEDBACK_EMOJI[feedback])
    .join("");
}

export function buildShareText({
  puzzleNumber,
  results,
  won,
  maxGuesses,
}: {
  puzzleNumber: number;
  results: GuessResult[];
  won: boolean;
  maxGuesses: number;
}): string {
  const score = won ? `${results.length}/${maxGuesses}` : `X/${maxGuesses}`;
  const grid = results.map(resultToEmojiRow);
  return [`DriverPit — Daily #${puzzleNumber}`, score, "", ...grid].join(
    "\n",
  );
}
