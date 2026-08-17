import { describe, expect, it } from "vitest";

import { compare } from "../game/compare";
import { MAX_GUESSES } from "../game/constants";
import {
  createRng,
  guessHeat,
  guessPoolFor,
  MAX_GUESS_ROWS,
  MIN_GUESS_ROWS,
  pickTargets,
  pickWrongGuesses,
  planBoards,
  promoTier,
  toComparable,
  toDriverSummary,
  type PromoDriver,
} from "./select";

const TODAY = new Date("2026-08-16T00:00:00.000Z");
const YEAR = 2026;

function driver(overrides: Partial<PromoDriver> & Pick<PromoDriver, "id">): PromoDriver {
  return {
    slug: `driver-${overrides.id}`,
    fullName: `Driver ${overrides.id}`,
    driverCode: "TST",
    nationality: "United Kingdom",
    team: "Ferrari",
    previousTeams: ["Ferrari"],
    dateOfBirth: "1990-01-01",
    dateOfDeath: null,
    debutYear: 2015,
    careerWins: 0,
    lastActiveYear: 2026,
    championshipWins: 0,
    podiums: 0,
    polePositions: 0,
    ...overrides,
  };
}

// A roster wide enough that every heat band and every tier is populated.
function roster(): PromoDriver[] {
  const drivers: PromoDriver[] = [];
  let id = 1;
  for (const lastActiveYear of [2026, 2024, 2012, 2008, 1998, 1975]) {
    for (let i = 0; i < 12; i += 1) {
      drivers.push(
        driver({
          id: id++,
          lastActiveYear,
          debutYear: lastActiveYear - (i % 8) - 1,
          nationality: i % 3 === 0 ? "United Kingdom" : i % 3 === 1 ? "Germany" : "Brazil",
          team: i % 4 === 0 ? "Ferrari" : i % 4 === 1 ? "McLaren" : i % 4 === 2 ? "Williams" : "Renault",
          previousTeams: i % 2 === 0 ? ["Ferrari", "McLaren"] : ["Williams"],
          dateOfBirth: `${lastActiveYear - 25 - (i % 10)}-03-04`,
          careerWins: i * 4,
          podiums: i * 3,
          championshipWins: i % 5,
          polePositions: i * 2,
        }),
      );
    }
  }
  return drivers;
}

describe("promoTier", () => {
  it("splits on the current season and the 20-year daily window", () => {
    expect(promoTier(2026, YEAR)).toBe("current-era");
    // One season out of the current grid is already MEDIUM: the EASY claim is
    // "racing right now", not "recently".
    expect(promoTier(2025, YEAR)).toBe("mid-era");
    expect(promoTier(2006, YEAR)).toBe("mid-era");
    expect(promoTier(2005, YEAR)).toBe("legacy");
    expect(promoTier(1961, YEAR)).toBe("legacy");
  });
});

describe("guessPoolFor", () => {
  const drivers = roster();

  it("grades the two modern tiers against the whole daily pool, not their own band", () => {
    // The fix for a 22-driver current season: difficulty comes from the answer,
    // grading comes from the guesses. Both modern tiers see the same 20-year
    // pool the real game gives a player.
    const easy = guessPoolFor("current-era", drivers, YEAR);
    const medium = guessPoolFor("mid-era", drivers, YEAR);

    expect(easy.map((d) => d.id).sort()).toEqual(medium.map((d) => d.id).sort());
    expect(easy.every((d) => d.lastActiveYear >= YEAR - 20)).toBe(true);
    expect(easy.length).toBeGreaterThan(
      drivers.filter((d) => promoTier(d.lastActiveYear, YEAR) === "current-era").length,
    );
  });

  it("keeps legacy on its own pool", () => {
    // A 2024 driver guessed against a 1955 target is five grey tiles.
    const pool = guessPoolFor("legacy", drivers, YEAR);
    expect(pool.every((d) => promoTier(d.lastActiveYear, YEAR) === "legacy")).toBe(true);
  });
});

describe("createRng", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    const a = Array.from({ length: 6 }, createRng("alpha"));
    const b = Array.from({ length: 6 }, createRng("alpha"));
    const c = Array.from({ length: 6 }, createRng("beta"));

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("stays in [0, 1)", () => {
    const rng = createRng("range");
    for (let i = 0; i < 500; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("guessHeat", () => {
  it("reads an all-correct row hotter than an all-miss row", () => {
    const target = driver({ id: 1 });
    const identical = guessHeat(compare(toComparable(target), toComparable(target), TODAY));

    const cold = driver({
      id: 2,
      nationality: "Brazil",
      team: "Williams",
      previousTeams: ["Williams"],
      dateOfBirth: "1955-01-01",
      debutYear: 1975,
      careerWins: 60,
    });
    const coldHeat = guessHeat(compare(toComparable(cold), toComparable(target), TODAY));

    expect(identical).toBeGreaterThan(coldHeat);
    expect(identical).toBeLessThanOrEqual(1);
    expect(coldHeat).toBeGreaterThanOrEqual(0);
  });

  it("rates a shared nationality above a shared-nothing guess", () => {
    const target = driver({ id: 1, nationality: "Germany" });
    const sameNation = driver({
      id: 2,
      nationality: "Germany",
      team: "Williams",
      previousTeams: ["Williams"],
      dateOfBirth: "1960-01-01",
      debutYear: 1980,
      careerWins: 55,
    });
    const otherNation = { ...sameNation, id: 3, nationality: "Brazil" };

    expect(guessHeat(compare(toComparable(sameNation), toComparable(target), TODAY))).toBeGreaterThan(
      guessHeat(compare(toComparable(otherNation), toComparable(target), TODAY)),
    );
  });
});

describe("pickWrongGuesses", () => {
  const drivers = roster();
  const target = drivers[0];

  it("never returns the target", () => {
    const guesses = pickWrongGuesses(target, drivers, TODAY, createRng("s"));
    expect(guesses.every((guess) => guess.id !== target.id)).toBe(true);
  });

  it("returns as many distinct drivers as asked for", () => {
    for (let count = MIN_GUESS_ROWS; count <= MAX_GUESS_ROWS; count += 1) {
      const guesses = pickWrongGuesses(target, drivers, TODAY, createRng("s"), count);
      expect(guesses, `count ${count}`).toHaveLength(count);
      expect(new Set(guesses.map((guess) => guess.id)).size, `count ${count}`).toBe(count);
    }
  });

  it("gives the hottest row a country or team hit", () => {
    // The property that makes a board look solvable rather than like five
    // columns of orange gradient: the last row hands the reader something
    // certain. Swept over seeds and counts because it is enforced per band.
    for (let count = MIN_GUESS_ROWS; count <= MAX_GUESS_ROWS; count += 1) {
      for (let seed = 0; seed < 12; seed += 1) {
        const guesses = pickWrongGuesses(target, drivers, TODAY, createRng(`hit-${seed}`), count);
        const last = guesses[guesses.length - 1];
        const result = compare(toComparable(last), toComparable(target), TODAY);

        expect(
          result.nationality === "exact" || result.team === "exact" || result.team === "historical",
          `count ${count} seed ${seed}: ${last.fullName}`,
        ).toBe(true);
      }
    }
  });

  it("never returns a row where all five tiles come back exact", () => {
    // The doppelganger case: a driver matching the target on every compared
    // attribute renders as an all-green row above empty answer slots, which
    // reads as a broken board. See isFullMatch in select.ts.
    const twin = { ...target, id: 999, slug: "twin", fullName: "Twin", podiums: 500 };
    const guesses = pickWrongGuesses(target, [...drivers, twin], TODAY, createRng("s"));

    expect(guesses.some((guess) => guess.id === 999)).toBe(false);
  });

  it("escalates monotonically down the board, on every seed", () => {
    // Not just first-vs-last: the band fallback can borrow from a neighbour and
    // return rows out of order, which was a real defect against the live roster
    // before pickWrongGuesses sorted its result. Swept over seeds because a
    // single one only exercises one set of bands.
    for (let seed = 0; seed < 40; seed += 1) {
      const guesses = pickWrongGuesses(target, drivers, TODAY, createRng(`escalate-${seed}`));
      const heats = guesses.map((guess) =>
        guessHeat(compare(toComparable(guess), toComparable(target), TODAY)),
      );

      expect(heats, `seed ${seed}`).toEqual([...heats].sort((a, b) => a - b));
    }
  });

  it("degrades to fewer rows rather than repeating a driver on a tiny pool", () => {
    const tiny = [target, drivers[1]];
    const guesses = pickWrongGuesses(target, tiny, TODAY, createRng("tiny"));

    expect(new Set(guesses.map((guess) => guess.id)).size).toBe(guesses.length);
    expect(guesses.length).toBeLessThanOrEqual(1);
  });
});

describe("pickTargets", () => {
  it("returns one driver per tier in escalating order", () => {
    const picked = pickTargets(roster(), YEAR, createRng("targets"));

    expect(picked.map((entry) => entry.tier)).toEqual(["current-era", "mid-era", "legacy"]);
    for (const { tier, driver: chosen } of picked) {
      expect(promoTier(chosen.lastActiveYear, YEAR)).toBe(tier);
    }
  });

  it("draws a wide spread of answers across seeds", () => {
    // The defect this exists for: with the target shortlist at 10 per tier, two
    // unrelated seeds both returned Niki Lauda for HARD, and the carousel looked
    // like it was ignoring --seed entirely. A per-tier shortlist that narrows
    // again would reproduce that with nothing else failing.
    const perTier = new Map<string, Set<number>>();

    for (let seed = 0; seed < 60; seed += 1) {
      for (const { tier, driver } of pickTargets(roster(), YEAR, createRng(`spread-${seed}`))) {
        const seen = perTier.get(tier) ?? new Set<number>();
        seen.add(driver.id);
        perTier.set(tier, seen);
      }
    }

    for (const [tier, seen] of perTier) {
      expect(seen.size, `tier ${tier} drew only ${seen.size} distinct answers`).toBeGreaterThan(5);
    }
  });

  it("throws rather than silently dropping a tier", () => {
    const currentOnly = roster().filter((d) => promoTier(d.lastActiveYear, YEAR) === "current-era");
    expect(() => pickTargets(currentOnly, YEAR, createRng("x"))).toThrow(/no drivers in tier/);
  });
});

describe("planBoards", () => {
  const drivers = roster();

  it("is reproducible under a seed", () => {
    const describe1 = (boards: ReturnType<typeof planBoards>) =>
      boards.map((b) => [b.target.slug, ...b.guesses.map((g) => g.slug)].join("|"));

    expect(describe1(planBoards(drivers, YEAR, TODAY, createRng("run")))).toEqual(
      describe1(planBoards(drivers, YEAR, TODAY, createRng("run"))),
    );
  });

  it("draws each board's guesses from that tier's guess pool", () => {
    for (const board of planBoards(drivers, YEAR, TODAY, createRng("tiers"))) {
      const allowed = new Set(guessPoolFor(board.tier, drivers, YEAR).map((d) => d.id));
      for (const guess of board.guesses) {
        expect(allowed.has(guess.id), `${board.label}: ${guess.fullName}`).toBe(true);
      }
    }
  });

  it("never shows a legacy board a driver from the modern era", () => {
    // The one tier where a wide pool would actively hurt: an all-grey row.
    for (let seed = 0; seed < 20; seed += 1) {
      const legacy = planBoards(drivers, YEAR, TODAY, createRng(`legacy-${seed}`)).find(
        (board) => board.tier === "legacy",
      );
      for (const guess of legacy?.guesses ?? []) {
        expect(promoTier(guess.lastActiveYear, YEAR), guess.fullName).toBe("legacy");
      }
    }
  });

  it("shows between MIN and MAX rows, leaving at least one slot empty", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      for (const board of planBoards(drivers, YEAR, TODAY, createRng(`rows-${seed}`))) {
        expect(board.guesses.length, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_GUESS_ROWS);
        expect(board.guesses.length, `seed ${seed}`).toBeLessThanOrEqual(MAX_GUESS_ROWS);
        // The slide sells an UNFINISHED board, so a filled grid is a bug even if
        // every row on it is correct.
        expect(board.guesses.length, `seed ${seed}`).toBeLessThan(MAX_GUESSES);
      }
    }
  });

  it("varies the row count across seeds rather than sitting on one value", () => {
    // Guards the reason the count was made variable at all: a MIN..MAX range
    // that always returns MIN is indistinguishable from the fixed three it
    // replaced, and nothing else in the suite would notice.
    const counts = new Set<number>();
    for (let seed = 0; seed < 40; seed += 1) {
      for (const board of planBoards(drivers, YEAR, TODAY, createRng(`vary-${seed}`))) {
        counts.add(board.guesses.length);
      }
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it("labels the boards EASY / MEDIUM / HARD", () => {
    expect(planBoards(drivers, YEAR, TODAY, createRng("labels")).map((b) => b.label)).toEqual([
      "EASY",
      "MEDIUM",
      "HARD",
    ]);
  });
});

describe("toDriverSummary", () => {
  it("derives age from the birth date, and freezes it at death", () => {
    const living = toDriverSummary(driver({ id: 1, dateOfBirth: "1990-01-01" }), TODAY);
    expect(living.age).toBe(36);

    const deceased = toDriverSummary(
      driver({ id: 2, dateOfBirth: "1940-01-01", dateOfDeath: "1970-01-01" }),
      TODAY,
    );
    expect(deceased.age).toBe(30);
  });
});
