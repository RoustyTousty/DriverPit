import { describe, expect, it } from "vitest";

import { compare, isWin, type Driver, type GuessResult } from "./compare";
import { guessHeat, proximityPoints, speedPoints } from "./duelScoring";

const ROUND_MS = 45_000;

describe("speedPoints", () => {
  it("scores the maximum for an instant (0ms) solve", () => {
    const instant = speedPoints(0, ROUND_MS);
    const aTouchLater = speedPoints(2_000, ROUND_MS);
    expect(instant).toBeGreaterThan(aTouchLater);
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
    // Every field maxed out -- not a combination compare() could actually
    // produce for a non-winning guess (that would be a win), but it pins
    // down the function's absolute ceiling regardless of real achievability.
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
    expect(isWin(result)).toBe(false);

    const points = proximityPoints(result);
    expect(points).toBeGreaterThan(0);
    expect(points).toBeLessThan(speedPoints(ROUND_MS, ROUND_MS));
  });
});

describe("guessHeat", () => {
  it("is 0 for a total miss and 1 for a perfect (winning) result", () => {
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
