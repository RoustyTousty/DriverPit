import { describe, expect, it } from "vitest";

import { calculateAge, compare, isWin, type Driver } from "./compare";

const TODAY = new Date("2026-07-17T00:00:00Z");

const baseDriver: Driver = {
  nationality: "Netherlands",
  team: "Red Bull",
  previousTeams: ["Red Bull", "Toro Rosso"],
  dateOfBirth: "1997-09-30",
  dateOfDeath: null,
  debutYear: 2015,
  careerWins: 60,
};

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return { ...baseDriver, ...overrides };
}

describe("compare", () => {
  it("guessing the target itself: reports exact/correct on all five attributes", () => {
    const target = makeDriver();
    const guess = makeDriver();

    expect(compare(guess, target, TODAY)).toEqual({
      nationality: "exact",
      team: "exact",
      age: "correct",
      debutYear: "correct",
      careerWins: "correct",
    });
  });

  it("exact match on all five: each attribute reports exact/correct independently when only that attribute matches", () => {
    const target = makeDriver({
      nationality: "Germany",
      team: "Mercedes",
      dateOfBirth: "1985-01-06",
      debutYear: 2007,
      careerWins: 53,
    });

    const nationalityMatch = compare(
      makeDriver({ nationality: target.nationality }),
      target,
      TODAY,
    );
    expect(nationalityMatch.nationality).toBe("exact");

    const teamMatch = compare(makeDriver({ team: target.team }), target, TODAY);
    expect(teamMatch.team).toBe("exact");

    const ageMatch = compare(
      makeDriver({ dateOfBirth: target.dateOfBirth }),
      target,
      TODAY,
    );
    expect(ageMatch.age).toBe("correct");

    const debutYearMatch = compare(
      makeDriver({ debutYear: target.debutYear }),
      target,
      TODAY,
    );
    expect(debutYearMatch.debutYear).toBe("correct");

    const careerWinsMatch = compare(
      makeDriver({ careerWins: target.careerWins }),
      target,
      TODAY,
    );
    expect(careerWinsMatch.careerWins).toBe("correct");
  });

  it("all-miss: reports a miss/non-match on every attribute when nothing lines up", () => {
    const guess = makeDriver({
      nationality: "Spain",
      team: "Ferrari",
      previousTeams: ["Ferrari"],
      dateOfBirth: "1981-07-29",
      debutYear: 2001,
      careerWins: 32,
    });
    const target = makeDriver({
      nationality: "Germany",
      team: "Mercedes",
      previousTeams: ["Mercedes"],
      dateOfBirth: "1985-01-06",
      debutYear: 2007,
      careerWins: 53,
    });

    const result = compare(guess, target, TODAY);
    expect(result.nationality).toBe("miss");
    expect(result.team).toBe("miss");
    // target (born 1985, age 41) is younger than guess (born 1981, age 44)
    expect(result.age).toBe("lower");
    expect(result.ageCloseness).toBeCloseTo((1 - 3 / 30) ** 2);
    expect(result.debutYear).toBe("higher");
    expect(result.debutYearCloseness).toBeCloseTo((1 - 6 / 20) ** 2);
    expect(result.careerWins).toBe("higher");
    expect(result.careerWinsCloseness).toBeCloseTo((1 - 21 / 70) ** 2);
  });

  describe("team: historical vs current vs no relation", () => {
    it("reports exact when the guess matches the target's current team", () => {
      const target = makeDriver({ team: "Mercedes", previousTeams: ["Mercedes", "McLaren"] });
      const guess = makeDriver({ team: "Mercedes" });
      expect(compare(guess, target, TODAY).team).toBe("exact");
    });

    it("reports historical when the guess isn't the target's current team but is in their history", () => {
      const target = makeDriver({ team: "Mercedes", previousTeams: ["Mercedes", "McLaren"] });
      const guess = makeDriver({ team: "McLaren" });
      expect(compare(guess, target, TODAY).team).toBe("historical");
    });

    it("reports miss when the guess has no relation to the target's team history", () => {
      const target = makeDriver({ team: "Mercedes", previousTeams: ["Mercedes", "McLaren"] });
      const guess = makeDriver({ team: "Ferrari" });
      expect(compare(guess, target, TODAY).team).toBe("miss");
    });
  });

  describe("closeness", () => {
    it("is undefined when the attribute is an exact/correct match", () => {
      const target = makeDriver({ careerWins: 60 });
      const guess = makeDriver({ careerWins: 60 });
      expect(compare(guess, target, TODAY).careerWinsCloseness).toBeUndefined();
    });

    it("approaches 1 for a near-miss", () => {
      const target = makeDriver({ careerWins: 60 });
      const guess = makeDriver({ careerWins: 59 });
      expect(compare(guess, target, TODAY).careerWinsCloseness).toBeCloseTo((1 - 1 / 70) ** 2);
    });

    it("is clamped at 0 rather than going negative for a wildly-off guess", () => {
      const target = makeDriver({ careerWins: 105 });
      const guess = makeDriver({ careerWins: 0 });
      expect(compare(guess, target, TODAY).careerWinsCloseness).toBe(0);
    });

    it("falls off faster than linear — a moderate miss should read as clearly dim, not half-bright", () => {
      // debutYear range is 20; a plain linear falloff would give 10/20 off
      // a closeness of 0.5 (still fairly bright). Squaring should pull
      // that down well under half.
      const target = makeDriver({ debutYear: 2010 });
      const guess = makeDriver({ debutYear: 2000 });
      const result = compare(guess, target, TODAY);
      expect(result.debutYearCloseness).toBeCloseTo(0.25);
      expect(result.debutYearCloseness!).toBeLessThan(0.5);
    });
  });

  describe("higher/lower in both directions", () => {
    it("debutYear: reports higher when the target debuted later than the guess", () => {
      const guess = makeDriver({ debutYear: 2001 });
      const target = makeDriver({ debutYear: 2015 });
      expect(compare(guess, target, TODAY).debutYear).toBe("higher");
    });

    it("debutYear: reports lower when the target debuted earlier than the guess", () => {
      const guess = makeDriver({ debutYear: 2015 });
      const target = makeDriver({ debutYear: 2001 });
      expect(compare(guess, target, TODAY).debutYear).toBe("lower");
    });

    it("careerWins: reports higher when the target has more wins than the guess", () => {
      const guess = makeDriver({ careerWins: 10 });
      const target = makeDriver({ careerWins: 60 });
      expect(compare(guess, target, TODAY).careerWins).toBe("higher");
    });

    it("careerWins: reports lower when the target has fewer wins than the guess", () => {
      const guess = makeDriver({ careerWins: 60 });
      const target = makeDriver({ careerWins: 10 });
      expect(compare(guess, target, TODAY).careerWins).toBe("lower");
    });

    it("age: reports higher when the target is older than the guess", () => {
      const guess = makeDriver({ dateOfBirth: "2000-01-01" }); // age 26
      const target = makeDriver({ dateOfBirth: "1990-01-01" }); // age 36
      expect(compare(guess, target, TODAY).age).toBe("higher");
    });

    it("age: reports lower when the target is younger than the guess", () => {
      const guess = makeDriver({ dateOfBirth: "1990-01-01" }); // age 36
      const target = makeDriver({ dateOfBirth: "2000-01-01" }); // age 26
      expect(compare(guess, target, TODAY).age).toBe("lower");
    });
  });

  describe("a driver with 0 wins", () => {
    it("reports correct when both guess and target have 0 wins", () => {
      const guess = makeDriver({ careerWins: 0 });
      const target = makeDriver({ careerWins: 0 });
      expect(compare(guess, target, TODAY).careerWins).toBe("correct");
    });

    it("reports higher when the guess has 0 wins and the target has some", () => {
      const guess = makeDriver({ careerWins: 0 });
      const target = makeDriver({ careerWins: 5 });
      expect(compare(guess, target, TODAY).careerWins).toBe("higher");
    });

    it("reports lower when the target has 0 wins and the guess has some", () => {
      const guess = makeDriver({ careerWins: 5 });
      const target = makeDriver({ careerWins: 0 });
      expect(compare(guess, target, TODAY).careerWins).toBe("lower");
    });
  });

  describe("a deceased driver's age", () => {
    it("uses age at death, not current age, for a deceased target", () => {
      // Born 1936-01-01, died exactly on a birthday in 2020 -> age at death 84.
      const target = makeDriver({
        dateOfBirth: "1936-01-01",
        dateOfDeath: "2020-01-01",
      });
      // Alive guess, born 1997-09-30 -> age 28 as of TODAY (2026-07-17,
      // birthday hasn't occurred yet this year).
      const guess = makeDriver({ dateOfBirth: "1997-09-30", dateOfDeath: null });

      expect(compare(guess, target, TODAY).age).toBe("higher");
    });

    it("uses age at death even when it is lower than the living guess's current age", () => {
      // Died young: born 1990-01-01, died 1995-01-01 -> age at death 5.
      const target = makeDriver({
        dateOfBirth: "1990-01-01",
        dateOfDeath: "1995-01-01",
      });
      const guess = makeDriver({ dateOfBirth: "1997-09-30", dateOfDeath: null }); // age 28

      expect(compare(guess, target, TODAY).age).toBe("lower");
    });

    it("compares age at death correctly when both guess and target are deceased", () => {
      const guess = makeDriver({
        dateOfBirth: "1936-01-01",
        dateOfDeath: "1970-01-01", // age at death 34
      });
      const target = makeDriver({
        dateOfBirth: "1930-01-01",
        dateOfDeath: "1980-01-01", // age at death 50
      });

      expect(compare(guess, target, TODAY).age).toBe("higher");
    });
  });
});

describe("calculateAge", () => {
  it("computes current age as of the given date for a living driver", () => {
    expect(calculateAge("1997-09-30", null, TODAY)).toBe(28);
  });

  it("computes age at death for a deceased driver, ignoring the reference date", () => {
    expect(calculateAge("1936-01-01", "2020-01-01", TODAY)).toBe(84);
  });

  it("does not subtract a year when the reference date is exactly the birthday", () => {
    expect(calculateAge("1990-03-05", null, new Date("2020-03-05T00:00:00Z"))).toBe(30);
  });

  it("subtracts a year when the birthday has not yet occurred this year", () => {
    expect(calculateAge("1990-03-05", null, new Date("2020-03-04T00:00:00Z"))).toBe(29);
  });
});

describe("isWin", () => {
  it("returns true when every attribute is exact/correct", () => {
    expect(
      isWin({
        nationality: "exact",
        team: "exact",
        age: "correct",
        debutYear: "correct",
        careerWins: "correct",
      }),
    ).toBe(true);
  });

  it("returns false when a single attribute is not exact/correct", () => {
    expect(
      isWin({
        nationality: "exact",
        team: "exact",
        age: "correct",
        debutYear: "higher",
        careerWins: "correct",
      }),
    ).toBe(false);
  });

  it("returns false when nothing matches", () => {
    expect(
      isWin({
        nationality: "miss",
        team: "miss",
        age: "lower",
        debutYear: "lower",
        careerWins: "lower",
      }),
    ).toBe(false);
  });
});
