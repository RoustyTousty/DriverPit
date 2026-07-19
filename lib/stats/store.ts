import { MAX_GUESSES } from "@/lib/game/constants";

const STORAGE_KEY = "f1dw:stats";

export interface StatsState {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  // Index i holds the count of wins solved in i + 1 guesses.
  guessDistribution: number[];
  lastResult: { won: boolean; guessCount: number } | null;
}

function emptyStats(): StatsState {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: Array(MAX_GUESSES).fill(0),
    lastResult: null,
  };
}

export function readStats(): StatsState {
  if (typeof window === "undefined") return emptyStats();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStats();
    const parsed = JSON.parse(raw) as Partial<StatsState>;
    const base = emptyStats();
    return {
      ...base,
      ...parsed,
      guessDistribution:
        parsed.guessDistribution?.length === MAX_GUESSES
          ? parsed.guessDistribution
          : base.guessDistribution,
    };
  } catch {
    return emptyStats();
  }
}

function writeStats(stats: StatsState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

export function resetStats(): StatsState {
  const stats = emptyStats();
  writeStats(stats);
  return stats;
}
