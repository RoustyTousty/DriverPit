import { describe, expect, it } from "vitest";

import { compare, type Driver } from "./compare";
import { guessAnnouncement, guessTileLabels, tileAriaLabel, tileValueLabel } from "./tileLabel";

const TODAY = new Date("2026-07-17T00:00:00Z");

describe("tileAriaLabel", () => {
  it("says the column, the guessed value, and the verdict", () => {
    expect(tileAriaLabel("nationality", "Netherlands", "exact")).toBe("Nationality: Netherlands. Correct.");
    expect(tileAriaLabel("nationality", "Germany", "miss")).toBe(
      "Nationality: Germany. Not the target's nationality.",
    );
  });

  it("distinguishes a historical team from a plain team miss", () => {
    expect(tileAriaLabel("team", "Toro Rosso", "historical")).toBe(
      "Team: Toro Rosso. Not the target's current team, but they raced for it in the past.",
    );
    expect(tileAriaLabel("team", "Mercedes", "miss")).toBe("Team: Mercedes. Not a team the target has raced for.");
  });

  it("says the em-dash 'no team' value in words", () => {
    // The guess RPCs render a null last_team as "—", which a screen reader
    // reads as "dash" or drops entirely. It is always a team miss (compare.ts).
    expect(tileAriaLabel("team", "—", "miss")).toBe("Team: no team on record. Not a team the target has raced for.");
    expect(tileAriaLabel("team", "", "miss")).toBe("Team: no team on record. Not a team the target has raced for.");
  });

  it("phrases higher/lower per column, about the target rather than the guess", () => {
    expect(tileAriaLabel("age", 28, "higher")).toBe("Age: 28. The target is older.");
    expect(tileAriaLabel("age", 28, "lower")).toBe("Age: 28. The target is younger.");
    expect(tileAriaLabel("debutYear", 2015, "higher")).toBe("Debut year: 2015. The target debuted later.");
    expect(tileAriaLabel("debutYear", 2015, "lower")).toBe("Debut year: 2015. The target debuted earlier.");
    expect(tileAriaLabel("careerWins", 60, "higher")).toBe("Career wins: 60. The target has more wins.");
    expect(tileAriaLabel("careerWins", 60, "lower")).toBe("Career wins: 60. The target has fewer wins.");
  });

  it("puts the closeness wash into words, in three bands", () => {
    expect(tileAriaLabel("age", 28, "higher", 0.9)).toBe("Age: 28. The target is older, very close.");
    expect(tileAriaLabel("age", 28, "higher", 0.4)).toBe("Age: 28. The target is older, close.");
    expect(tileAriaLabel("age", 28, "higher", 0.01)).toBe("Age: 28. The target is older, far off.");
    // Band edges are inclusive at the top of the band.
    expect(tileAriaLabel("age", 28, "higher", 0.6)).toContain("very close");
    expect(tileAriaLabel("age", 28, "higher", 0.25)).toMatch(/, close\.$/);
  });

  it("has no closeness clause when the value is correct", () => {
    expect(tileAriaLabel("careerWins", 60, "correct")).toBe("Career wins: 60. Correct.");
  });
});

describe("tileValueLabel", () => {
  it("names the column without a verdict, for the answer reveal", () => {
    expect(tileValueLabel("debutYear", 2015)).toBe("Debut year: 2015");
    expect(tileValueLabel("team", "—")).toBe("Team: no team on record");
  });
});

describe("guessTileLabels", () => {
  const target: Driver = {
    nationality: "Netherlands",
    team: "Red Bull",
    previousTeams: ["Red Bull", "Toro Rosso"],
    dateOfBirth: "1997-09-30",
    dateOfDeath: null,
    debutYear: 2015,
    careerWins: 60,
  };

  it("labels a real comparison, each column against its own result field", () => {
    const guess: Driver = {
      nationality: "United Kingdom",
      team: "Toro Rosso",
      previousTeams: ["Toro Rosso"],
      dateOfBirth: "1985-01-07",
      dateOfDeath: null,
      debutYear: 2007,
      careerWins: 105,
    };

    const labels = guessTileLabels(
      {
        nationality: guess.nationality,
        team: guess.team,
        age: 41,
        debutYear: guess.debutYear,
        careerWins: guess.careerWins,
      },
      compare(guess, target, TODAY),
    );

    expect(labels).toEqual({
      nationality: "Nationality: United Kingdom. Not the target's nationality.",
      team: "Team: Toro Rosso. Not the target's current team, but they raced for it in the past.",
      // 41 vs 28 -> "younger"; 13 of the 30-year range, squared, is ~0.32.
      age: "Age: 41. The target is younger, close.",
      // 2007 vs 2015 -> "later"; 8 of the 20-year range, squared, is ~0.36.
      debutYear: "Debut year: 2007. The target debuted later, close.",
      // 105 vs 60 -> "fewer"; 45 of the 70-win range, squared, is ~0.13.
      careerWins: "Career wins: 105. The target has fewer wins, far off.",
    });
  });

  it("labels the winning guess as correct across the board", () => {
    const labels = guessTileLabels(
      { nationality: "Netherlands", team: "Red Bull", age: 28, debutYear: 2015, careerWins: 60 },
      compare(target, target, TODAY),
    );

    expect(Object.values(labels).every((label) => label.endsWith("Correct."))).toBe(true);
  });
});

describe("guessAnnouncement", () => {
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
    nationality: "United Kingdom",
    team: "Toro Rosso",
    previousTeams: ["Toro Rosso"],
    dateOfBirth: "1985-01-07",
    dateOfDeath: null,
    debutYear: 2007,
    careerWins: 105,
  };

  const values = {
    nationality: guess.nationality,
    team: guess.team,
    age: 41,
    debutYear: guess.debutYear,
    careerWins: guess.careerWins,
  };

  it("names the driver, the position in the board, and every column in row order", () => {
    expect(guessAnnouncement("Lewis Hamilton", values, compare(guess, target, TODAY), {
      guessNumber: 2,
      maxGuesses: 6,
    })).toBe(
      "Guess 2 of 6: Lewis Hamilton. " +
        "Nationality: United Kingdom. Not the target's nationality. " +
        "Team: Toro Rosso. Not the target's current team, but they raced for it in the past. " +
        "Age: 41. The target is younger, close. " +
        "Debut year: 2007. The target debuted later, close. " +
        "Career wins: 105. The target has fewer wins, far off.",
    );
  });

  it("says exactly what the tiles say, so the two can never drift", () => {
    // The whole reason it composes guessTileLabels instead of paraphrasing it:
    // a compare.ts rule change has to move both or neither.
    const result = compare(guess, target, TODAY);
    const labels = guessTileLabels(values, result);
    const spoken = guessAnnouncement("Lewis Hamilton", values, result, { guessNumber: 1, maxGuesses: 6 });

    for (const label of Object.values(labels)) expect(spoken).toContain(label);
  });
});
