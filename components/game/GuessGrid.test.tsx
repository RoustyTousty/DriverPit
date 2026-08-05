import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DriverSummary } from "@/lib/db/queries";
import type { GuessResult } from "@/lib/game/compare";

import { GuessGrid, type Guess } from "./GuessGrid";

// Audit 2026-07-29 §4.1, both halves, verified as rendered DOM for the first
// time (§2.6). `tileLabel.ts` is already unit-tested as a pure function -- what
// was never checked is that the words reach an accessibility tree at all: that
// `Tile` really is atomic (role="img", so the raw value isn't read twice), that
// the code badge announces the driver's NAME rather than "V E R", and above all
// that `GuessAnnouncer` fires on a submitted guess and stays silent on a
// resumed one.
//
// That last rule is the subtle one and the reason this file exists rather than
// more pure tests: a daily board is server-authoritative and resumable, so
// `daily_state()` drops a whole day of guesses in at once. Announcing that would
// read the previous session's last guess aloud on every page load.

const HAMILTON: DriverSummary = {
  id: 1,
  fullName: "Lewis Hamilton",
  driverCode: "HAM",
  nationality: "United Kingdom",
  team: "Ferrari",
  age: 41,
  debutYear: 2007,
  careerWins: 105,
};

const NORRIS: DriverSummary = {
  id: 2,
  fullName: "Lando Norris",
  driverCode: "NOR",
  nationality: "United Kingdom",
  team: "McLaren",
  age: 26,
  debutYear: 2019,
  careerWins: 10,
};

const RESULT: GuessResult = {
  nationality: "exact",
  team: "historical",
  age: "lower",
  ageCloseness: 0.8,
  debutYear: "higher",
  debutYearCloseness: 0.4,
  careerWins: "correct",
};

function guess(driver: DriverSummary): Guess {
  return { guessedDriver: driver, result: RESULT };
}

describe("GuessGrid tiles", () => {
  it("gives every comparison tile its meaning in text, not only in colour", () => {
    render(<GuessGrid guesses={[guess(HAMILTON)]} maxGuesses={6} />);

    // role="img" makes the tile atomic: the label is what's announced and the
    // contents are skipped, so "105" isn't read twice.
    const tiles = screen.getAllByRole("img");
    const labels = tiles.map((tile) => tile.getAttribute("aria-label"));

    expect(labels).toContain("Nationality: United Kingdom. Correct.");
    expect(labels).toContain(
      "Team: Ferrari. Not the target's current team, but they raced for it in the past.",
    );
    // The direction and the closeness band, which exist only as opacity and an
    // aria-hidden arrow glyph on screen.
    expect(labels).toContain("Age: 41. The target is younger, very close.");
    expect(labels).toContain("Debut year: 2007. The target debuted later, close.");
    expect(labels).toContain("Career wins: 105. Correct.");
  });

  it("announces the driver's name from the rotated code badge", () => {
    render(<GuessGrid guesses={[guess(HAMILTON)]} maxGuesses={6} />);

    // Not "H A M", which is what a rotated three-letter code reads as.
    expect(screen.getByRole("img", { name: "Lewis Hamilton" })).toBeInTheDocument();
  });

  // Audit 2026-07-30 §4.7's remaining half. The value span is line-clamp-2, so
  // a 320px phone clips "Scuderia AlphaTauri" with nothing to recover it --
  // aria-label put the value in speech and did nothing for a sighted reader.
  it("lets a sighted reader recover a clipped value from the tile", () => {
    render(<GuessGrid guesses={[guess(HAMILTON)]} maxGuesses={6} />);

    // On the span INSIDE role="img", never on the tile itself: a title beside
    // an aria-label becomes the accessible description, which would say the
    // value a second time right after the label that already said it.
    const tiles = screen.getAllByRole("img");
    expect(tiles.some((tile) => tile.hasAttribute("title"))).toBe(false);

    expect(screen.getByTitle("Ferrari")).toBeInTheDocument();
    // Carries one despite being short, because "Show flags" replaces this
    // tile's text with a flag glyph and the tooltip is then the only reading.
    expect(screen.getByTitle("United Kingdom")).toBeInTheDocument();
  });

  it("leaves the numeric tiles untooltipped, since digits cannot clip", () => {
    const { container } = render(<GuessGrid guesses={[guess(HAMILTON)]} maxGuesses={6} />);

    // A tooltip repeating a fully-visible "105" is noise, so the count of
    // titled elements is the two text columns and nothing else.
    expect(container.querySelectorAll("[title]")).toHaveLength(2);
    expect(screen.queryByTitle("105")).not.toBeInTheDocument();
  });

  it("keeps the board a fixed height as guesses land", () => {
    const { container } = render(<GuessGrid guesses={[guess(HAMILTON)]} maxGuesses={6} />);
    const rows = container.querySelectorAll(".flex.gap-1");

    // 1 column-label row + 1 guess + 5 empty slots.
    expect(rows.length).toBe(7);
  });
});

describe("GuessAnnouncer, through the grid that renders it", () => {
  function announcement(): string {
    return screen.getByRole("status").textContent ?? "";
  }

  it("starts empty, because a live region announces its changes", () => {
    render(<GuessGrid guesses={[]} maxGuesses={6} />);
    expect(announcement()).toBe("");
  });

  it("says nothing when a part-played day hydrates all at once", () => {
    // Exactly what daily_state() does on load: guesses appear without this
    // client ever having raised `pending`.
    render(<GuessGrid guesses={[guess(HAMILTON), guess(NORRIS)]} maxGuesses={6} />);
    expect(announcement()).toBe("");
  });

  it("announces a guess that passed through the pending row", () => {
    const { rerender } = render(<GuessGrid guesses={[]} maxGuesses={6} />);

    // The optimistic submit: DailyGame/InfiniteGame raise `pending` before the
    // RPC leaves, then swap in the authoritative row when it returns.
    rerender(<GuessGrid guesses={[]} maxGuesses={6} pending />);
    rerender(<GuessGrid guesses={[guess(HAMILTON)]} maxGuesses={6} />);

    expect(announcement()).toContain("Guess 1 of 6: Lewis Hamilton.");
    // Composed from the same guessTileLabels the tiles use, so the spoken row
    // and the spoken tile cannot drift -- this is that label verbatim.
    expect(announcement()).toContain(
      "Team: Ferrari. Not the target's current team, but they raced for it in the past.",
    );
  });

  it("counts the guess it announces", () => {
    const { rerender } = render(<GuessGrid guesses={[guess(HAMILTON)]} maxGuesses={6} />);

    rerender(<GuessGrid guesses={[guess(HAMILTON)]} maxGuesses={6} pending />);
    rerender(<GuessGrid guesses={[guess(HAMILTON), guess(NORRIS)]} maxGuesses={6} />);

    expect(announcement()).toContain("Guess 2 of 6: Lando Norris.");
  });

  it("stays silent when a hydrate lands after a submit it did not cause", () => {
    // A second device's board catching up: the list grows with no pending row
    // in between. The player at this keyboard did nothing.
    const { rerender } = render(<GuessGrid guesses={[guess(HAMILTON)]} maxGuesses={6} />);
    rerender(<GuessGrid guesses={[guess(HAMILTON), guess(NORRIS)]} maxGuesses={6} />);

    expect(announcement()).toBe("");
  });
});
