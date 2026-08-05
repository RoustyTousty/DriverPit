import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GameModes } from "./GameModes";
import { GameModesTeaser } from "./GameModesTeaser";

// The two mode lists deliberately differ, and the difference is one entry — so
// it is exactly the kind of thing that gets quietly re-added by someone tidying
// them into agreement. Pinned as rendered names rather than as array contents:
// what matters is what a player sees on each page.
//
// Custom is a variant of Duel, not a fifth thing to learn. The home teaser
// answers "what is there to play here?" in one glance and lists four; the full
// page is where the rules live and lists five, with Custom last so it reads
// after the mode it varies.

function renderedModeNames(): string[] {
  // Every mode's name is the bold label inside its card. Reading them in
  // document order is what makes this assert "these modes, in this order"
  // instead of just counting cards.
  return Array.from(document.querySelectorAll("span.font-bold")).map((el) => el.textContent ?? "");
}

describe("the home page's Game modes teaser", () => {
  it("lists exactly Daily, Infinite, Duel and Knockout", () => {
    render(<GameModesTeaser />);

    expect(renderedModeNames()).toEqual(["Daily", "Infinite", "Duel", "Knockout"]);
  });

  it("does not offer Custom", () => {
    render(<GameModesTeaser />);

    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
  });
});

describe("the /game-modes page", () => {
  it("lists all five, with Custom last", () => {
    // The control case for the assertions above: without it, "the teaser has no
    // Custom" passes just as well for a Custom entry that got deleted outright.
    render(<GameModes />);

    expect(renderedModeNames()).toEqual(["Daily", "Infinite", "Duel", "Knockout", "Custom"]);
  });
});
