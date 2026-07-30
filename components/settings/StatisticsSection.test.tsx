import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserStats } from "@/components/auth/AuthProvider";
import { MAX_GUESSES } from "@/lib/game/constants";

import { StatisticsSection } from "./StatisticsSection";

// Audit 2026-07-29 §0.6, as rendered DOM. The bug was one hardcoded array --
// `stats?.guessDistribution ?? [0, 0, 0, 0, 0]` -- and its entire symptom is a
// count of elements on screen: a viewer whose stats hadn't arrived saw FIVE
// bars, then six once they did. That is a fact about a render rather than about
// a value, which is why it is pinned here and not in the pure suite beside
// guessDistribution.test.ts (§2.6).
//
// Scope note: the *other* half of the same bug -- a legacy five-bucket row from
// before drizzle/0016 -- is normalised upstream in AuthProvider.toUserStats, so
// by the time this component sees it the array is already MAX_GUESSES long.
// That rule is pinned where it lives: normalizeDistribution's own unit tests.
// Asserting it again here would only be re-testing the mock.

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: useAuthMock }));

function statsWith(guessDistribution: number[]): UserStats {
  return {
    userId: "u1",
    gamesPlayed: 10,
    wins: 7,
    currentStreak: 2,
    maxStreak: 5,
    guessDistribution,
    lastResult: null,
    lastDailyDate: "2026-07-30",
    duelRating: 1000,
    duelWins: 0,
    duelLosses: 0,
  };
}

// Structural rather than class-based: the bars are the wrapper immediately
// after the section heading, one element per row, each leading with its guess
// number. Reading the number off each row is what makes the assertion say
// "these bars, in this order" instead of just counting nodes.
function renderedGuessNumbers(): string[] {
  const heading = screen.getByText("Guess distribution");
  const rows = heading.nextElementSibling?.children ?? [];
  return Array.from(rows).map((row) => row.firstElementChild?.textContent ?? "");
}

beforeEach(() => {
  useAuthMock.mockReset();
});

describe("StatisticsSection guess distribution", () => {
  it("renders MAX_GUESSES bars before stats have loaded", () => {
    useAuthMock.mockReturnValue({ stats: null, loading: false });

    render(<StatisticsSection />);

    // Pre-fix this was five: the fallback was a hardcoded [0, 0, 0, 0, 0].
    expect(renderedGuessNumbers()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(renderedGuessNumbers()).toHaveLength(MAX_GUESSES);
  });

  it("renders the same bars once stats arrive, so the chart doesn't grow a row", () => {
    useAuthMock.mockReturnValue({ stats: statsWith([1, 2, 3, 0, 1, 0]), loading: false });

    render(<StatisticsSection />);

    expect(renderedGuessNumbers()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("shows the loading state instead of any bars while auth is resolving", () => {
    useAuthMock.mockReturnValue({ stats: null, loading: true });

    render(<StatisticsSection />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Guess distribution")).not.toBeInTheDocument();
  });
});
