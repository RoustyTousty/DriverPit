import { describe, expect, it } from "vitest";

import { compare, isWin, type Driver, type GuessResult } from "./compare";
import {
  accuracyFactor,
  dnfPoints,
  DUEL_BASELINE,
  FREE_GUESSES,
  guessHeat,
  liveScore,
  proximityPoints,
  solvePoints,
  speedPoints,
  tugFill,
} from "./duelScoring";
import { MIN_SOLVE_MS } from "./duelTiming";

const ROUND_MS = 45_000;

describe("speedPoints", () => {
  it("pays a sub-MIN_SOLVE_MS solve exactly what a MIN_SOLVE_MS one gets", () => {
    // The anti-script floor (drizzle/0058): no human reads the board and picks
    // a driver in under two seconds, so anything faster is not rewarded for
    // being faster. This is the assertion that fails if the clamp is ever
    // "tidied" back to GREATEST(ms, 0).
    expect(speedPoints(0, ROUND_MS)).toBe(speedPoints(MIN_SOLVE_MS, ROUND_MS));
    expect(speedPoints(50, ROUND_MS)).toBe(speedPoints(MIN_SOLVE_MS, ROUND_MS));
    expect(speedPoints(MIN_SOLVE_MS, ROUND_MS)).toBeGreaterThan(speedPoints(MIN_SOLVE_MS + 1_000, ROUND_MS));
  });

  it("scores the minimum for a solve that lands right at the buzzer", () => {
    const atBuzzer = speedPoints(ROUND_MS, ROUND_MS);
    const aTouchEarlier = speedPoints(ROUND_MS - 2_000, ROUND_MS);
    expect(atBuzzer).toBeLessThan(aTouchEarlier);
  });

  it("rewards a fast solve far more than a slow one, not just marginally more", () => {
    const fast = speedPoints(5_000, ROUND_MS); // 5s
    const slow = speedPoints(40_000, ROUND_MS); // 40s
    expect(fast).toBeGreaterThan(slow);
    // "far more", not just "more" -- guard the squared falloff shape, not
    // just its direction.
    expect(fast / slow).toBeGreaterThan(5);
  });

  it("is monotonically non-increasing as solve time increases", () => {
    const samples = [0, 1_000, 5_000, 10_000, 20_000, 30_000, 40_000, 44_000, 45_000];
    const scores = samples.map((ms) => speedPoints(ms, ROUND_MS));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("clamps a solve time below the floor to the same maximum as landing on it", () => {
    expect(speedPoints(-500, ROUND_MS)).toBe(speedPoints(MIN_SOLVE_MS, ROUND_MS));
  });

  it("clamps solve times beyond the round duration to the same minimum as landing exactly on it", () => {
    const atBuzzer = speedPoints(ROUND_MS, ROUND_MS);
    const wayOver = speedPoints(ROUND_MS + 30_000, ROUND_MS);
    expect(wayOver).toBe(atBuzzer);
  });

  it("clamps negative solve times to the same maximum as an instant solve", () => {
    const instant = speedPoints(0, ROUND_MS);
    const negative = speedPoints(-500, ROUND_MS);
    expect(negative).toBe(instant);
  });
});

// The whole point of drizzle/0058: unlimited guesses that are no longer free.
describe("accuracyFactor", () => {
  it("costs nothing up to and including the free allowance", () => {
    for (let wrong = 0; wrong <= FREE_GUESSES; wrong++) {
      expect(accuracyFactor(wrong)).toBe(1);
    }
  });

  it("decays strictly from the first guess past the allowance", () => {
    expect(accuracyFactor(FREE_GUESSES + 1)).toBeLessThan(1);
    for (let wrong = FREE_GUESSES + 1; wrong < 40; wrong++) {
      expect(accuracyFactor(wrong)).toBeLessThan(accuracyFactor(wrong - 1));
    }
  });

  it("is gentle across a human range and severe across a scripted one", () => {
    // The tuning claim itself, not just the shape. Counted in WRONG guesses,
    // so a six-guess solve passes 5 -- the off-by-one that decides whether the
    // guess that wins is treated as a mistake.
    const sixGuessSolve = accuracyFactor(5);
    const fortyFiveGuessSpray = accuracyFactor(44);
    // A bad-but-real round: still clearly worth playing out.
    expect(sixGuessSolve).toBeGreaterThan(0.75);
    // Nobody is deducing anything here; it has to be worth ~nothing.
    expect(fortyFiveGuessSpray).toBeLessThan(0.02);
  });

  it("never goes negative or inverts, however many guesses are thrown at it", () => {
    expect(accuracyFactor(500)).toBeGreaterThanOrEqual(0);
    expect(accuracyFactor(500)).toBeLessThan(accuracyFactor(100));
    // Defensive: a negative count is not reachable through the callers, but
    // Math.max in the exponent is what makes it harmless rather than a
    // multiplier ABOVE 1 -- which would pay a bonus for guessing badly.
    expect(accuracyFactor(-3)).toBe(1);
  });
});

describe("solvePoints", () => {
  it("pays the full speed curve while inside the free allowance", () => {
    expect(solvePoints(10_000, ROUND_MS, FREE_GUESSES)).toBe(speedPoints(10_000, ROUND_MS));
  });

  it("never decays the floor -- only the bonus above it", () => {
    // MIN_SPEED_POINTS is what makes "any solve beats any DNF" true. A solve
    // after a hundred guesses is worth very little, but it is still a solve.
    const sprayed = solvePoints(30_000, ROUND_MS, 100);
    expect(sprayed).toBe(100);
    const perfectDnf = proximityPoints(
      makeResult({ nationality: "exact", team: "exact", age: "correct", debutYear: "correct", careerWins: "correct" }),
    );
    expect(sprayed).toBeGreaterThan(perfectDnf);
  });

  it("makes a considered slow solve beat a sprayed fast one -- the whole point", () => {
    // The measured case from the audit that produced drizzle/0058: on the old
    // curve the spammer scored 845 to the thinker's 541. The cooldown means 45
    // guesses cannot land before ~45s, so this is the realistic pairing.
    const thoughtful = solvePoints(18_000, 60_000, 3);
    const sprayed = solvePoints(45_000, 60_000, 44);
    expect(thoughtful).toBeGreaterThan(sprayed);
    expect(thoughtful / sprayed).toBeGreaterThan(4);
  });

  it("still rewards speed between two equally efficient players", () => {
    // Guess discipline must not flatten the race -- this is a duel, and at
    // equal accuracy the faster solve has to win the round.
    expect(solvePoints(8_000, ROUND_MS, 4)).toBeGreaterThan(solvePoints(30_000, ROUND_MS, 4));
  });
});

describe("dnfPoints", () => {
  it("decays the consolation payout by the same factor a solve pays", () => {
    // Otherwise spraying is still optimal for a losing round: best-of-N rises
    // with N for free, and the proximity ceiling is most of a round's floor.
    expect(dnfPoints(60, FREE_GUESSES)).toBe(60);
    expect(dnfPoints(60, 20)).toBeLessThan(20);
  });

  it("stays under the worst possible solve at its own ceiling", () => {
    const ceiling = 75; // MAX_PROXIMITY_WEIGHT -- every attribute matched, still not the driver
    expect(dnfPoints(ceiling, 0)).toBeLessThan(solvePoints(ROUND_MS, ROUND_MS, 200));
  });

  it("is zero when nothing was close, whatever the guess count", () => {
    expect(dnfPoints(0, 0)).toBe(0);
    expect(dnfPoints(0, 30)).toBe(0);
  });
});

// Hand-built GuessResult fixtures give exact control over each field, which
// is what the weighted-sum cases below need. A realistic result built via
// compare() (further down) grounds the function in the real engine too.
function makeResult(overrides: Partial<GuessResult> = {}): GuessResult {
  return {
    nationality: "miss",
    team: "miss",
    age: "higher",
    debutYear: "higher",
    careerWins: "higher",
    ...overrides,
  };
}

describe("proximityPoints", () => {
  it("scores zero for a total miss (nothing matched, zero closeness on every numeric field)", () => {
    const zeroMatch = makeResult({
      ageCloseness: 0,
      debutYearCloseness: 0,
      careerWinsCloseness: 0,
    });
    expect(proximityPoints(zeroMatch)).toBe(0);

    // Omitting closeness entirely (as compare() does on an exact numeric
    // match, never on a genuine miss, but the function shouldn't crash
    // either way) must also fall back to zero credit, not NaN.
    expect(proximityPoints(makeResult())).toBe(0);
  });

  it("awards a weighted partial score for a partial-match DNF", () => {
    const partial = makeResult({
      nationality: "exact", // +15
      team: "historical", // +8
      age: "higher",
      ageCloseness: 0.5, // +7.5
      debutYear: "lower",
      debutYearCloseness: 0.2, // +3
      careerWins: "higher",
      careerWinsCloseness: 0, // +0
    });
    expect(proximityPoints(partial)).toBe(34);
  });

  it("gives full credit for ordered fields reported as 'correct', even with no closeness value", () => {
    const numbersRight = makeResult({
      nationality: "miss",
      team: "miss",
      age: "correct", // +15, no ageCloseness set
      debutYear: "correct", // +15
      careerWins: "correct", // +15
    });
    expect(proximityPoints(numbersRight)).toBe(45);
  });

  it("treats an exact team match as worth more than a historical one", () => {
    const exactTeam = proximityPoints(makeResult({ team: "exact" }));
    const historicalTeam = proximityPoints(makeResult({ team: "historical" }));
    expect(exactTeam).toBeGreaterThan(historicalTeam);
  });

  it("never outscores the worst possible solve, even at its own theoretical ceiling", () => {
    // Every field maxed out. This IS reachable without solving: a driver who
    // matches the target on all five attributes is still not the target (see
    // compare.ts#isWin), so the "any solve beats any DNF" floor has to hold on
    // the ceiling itself, not on the ceiling being unachievable.
    const ceiling = makeResult({
      nationality: "exact",
      team: "exact",
      age: "correct",
      debutYear: "correct",
      careerWins: "correct",
    });
    const worstPossibleSolve = speedPoints(ROUND_MS, ROUND_MS);
    expect(proximityPoints(ceiling)).toBeLessThan(worstPossibleSolve);
  });

  it("scores a realistic near-miss DNF built through the real comparison engine", () => {
    const target: Driver = {
      nationality: "Netherlands",
      team: "Red Bull",
      previousTeams: ["Red Bull", "Toro Rosso"],
      dateOfBirth: "1997-09-30",
      dateOfDeath: null,
      debutYear: 2015,
      careerWins: 60,
    };
    const guess: Driver = {
      nationality: "Netherlands", // exact
      team: "Toro Rosso", // historical -- in target.previousTeams
      previousTeams: ["Toro Rosso"],
      dateOfBirth: "1999-09-30", // 2 years off
      dateOfDeath: null,
      debutYear: 2017, // 2 years off
      careerWins: 55, // 5 off
    };
    const today = new Date("2026-07-17T00:00:00Z");

    const result = compare(guess, target, today);
    // A near miss, not a solve. What makes it a DNF is that it's a different
    // driver (isWin is driver identity); the tiles only say how close it got.
    expect(isWin(1, 2)).toBe(false);
    expect(result.team).toBe("historical");

    const points = proximityPoints(result);
    expect(points).toBeGreaterThan(0);
    expect(points).toBeLessThan(speedPoints(ROUND_MS, ROUND_MS));
  });
});

describe("guessHeat", () => {
  it("is 0 for a total miss and 1 for an all-attributes-match result", () => {
    expect(guessHeat(makeResult({ ageCloseness: 0, debutYearCloseness: 0, careerWinsCloseness: 0 }))).toBe(0);
    expect(
      guessHeat(
        makeResult({
          nationality: "exact",
          team: "exact",
          age: "correct",
          debutYear: "correct",
          careerWins: "correct",
        }),
      ),
    ).toBe(1);
  });

  it("always stays within 0-1", () => {
    const partial = makeResult({
      nationality: "exact",
      team: "historical",
      age: "higher",
      ageCloseness: 0.9,
    });
    const heat = guessHeat(partial);
    expect(heat).toBeGreaterThan(0);
    expect(heat).toBeLessThanOrEqual(1);
  });

  it("ranks a closer guess above a colder one, same ordering as proximityPoints", () => {
    const warm = makeResult({ nationality: "exact", age: "higher", ageCloseness: 0.8 });
    const cold = makeResult({ ageCloseness: 0.1 });
    expect(guessHeat(warm)).toBeGreaterThan(guessHeat(cold));
    expect(proximityPoints(warm)).toBeGreaterThan(proximityPoints(cold));
  });
});

describe("liveScore", () => {
  const cases: Array<{
    name: string;
    baseline: number;
    confirmedPoints: number;
    provisional: number;
    expected: number;
  }> = [
    { name: "match start, nothing yet", baseline: DUEL_BASELINE, confirmedPoints: 0, provisional: 0, expected: 100 },
    { name: "one confirmed round, current round untouched", baseline: DUEL_BASELINE, confirmedPoints: 140, provisional: 0, expected: 240 },
    { name: "still on round 1, best guess so far only", baseline: DUEL_BASELINE, confirmedPoints: 0, provisional: 22, expected: 122 },
    { name: "confirmed rounds plus a provisional lead in the current one", baseline: DUEL_BASELINE, confirmedPoints: 140, provisional: 340, expected: 580 },
  ];

  it.each(cases)("$name", ({ baseline, confirmedPoints, provisional, expected }) => {
    expect(liveScore({ baseline, confirmedPoints, provisional })).toBe(expected);
  });
});

describe("tugFill", () => {
  it("is exactly centered when both players are level", () => {
    expect(tugFill(100, 100)).toBe(0.5);
  });

  it("leans toward whoever is ahead", () => {
    expect(tugFill(240, 100)).toBeGreaterThan(0.5);
    expect(tugFill(100, 240)).toBeLessThan(0.5);
  });

  it("is symmetric -- swapping the two inputs mirrors around 0.5", () => {
    const mine = tugFill(300, 120);
    const theirs = tugFill(120, 300);
    expect(mine + theirs).toBeCloseTo(1, 10);
  });

  it("stays within (0, 1) for any positive scores, never fully snapping to an end", () => {
    expect(tugFill(1000, 1)).toBeLessThan(1);
    expect(tugFill(1, 1000)).toBeGreaterThan(0);
  });
});
