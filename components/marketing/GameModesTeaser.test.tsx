import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GameModes } from "./GameModes";
import { GameModesTeaser } from "./GameModesTeaser";

// The two mode lists deliberately differ, and the difference is one entry — so
// it is exactly the kind of thing that gets quietly re-added by someone tidying
// them into agreement. Pinned as rendered names rather than as array contents:
// what matters is what a player sees on each page.
//
// Custom is a variant of Duel, not another thing to learn. The home teaser
// answers "what is there to play here?" in one glance and omits it; the full
// page is where the rules live and lists it last, so it reads after the mode it
// varies.
//
// NEITHER LIST MAY CARRY KNOCKOUT, and that is now the load-bearing assertion
// here rather than a detail. AdSense rejected the site on 2026-08-12 citing
// "links to content that does not exist"; an unbuilt mode advertised with a
// "coming soon" pill on two indexed pages is the clearest instance of that on
// the site. The pill made it feel honest, which is exactly why it survived four
// content passes without anyone questioning it — so the guard is a test rather
// than a comment. It comes back when the mode does.

function renderedModeNames(): string[] {
  // Every mode's name is the bold label inside its card. Reading them in
  // document order is what makes this assert "these modes, in this order"
  // instead of just counting cards.
  return Array.from(document.querySelectorAll("span.font-bold")).map((el) => el.textContent ?? "");
}

describe("the home page's Game modes teaser", () => {
  it("lists exactly Daily, Infinite and Duel", () => {
    render(<GameModesTeaser />);

    expect(renderedModeNames()).toEqual(["Daily", "Infinite", "Duel"]);
  });

  it("does not offer Custom", () => {
    render(<GameModesTeaser />);

    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
  });
});

describe("the /game-modes page", () => {
  it("lists all four playable modes, with Custom last", () => {
    // The control case for the assertion above: without it, "the teaser has no
    // Custom" passes just as well for a Custom entry that got deleted outright.
    render(<GameModes />);

    expect(renderedModeNames()).toEqual(["Daily", "Infinite", "Duel", "Custom"]);
  });
});

describe("modes that do not exist yet", () => {
  it("advertises Knockout on neither list", () => {
    // Asserted on both, separately from the ordering above, because the two
    // lists are edited independently and it went back into one of them once
    // already. `queryByText` and not the bold-label helper: a future "coming
    // soon" treatment might not use that class, and this must fail whatever
    // shape it comes back in.
    const teaser = render(<GameModesTeaser />);
    expect(screen.queryByText("Knockout")).not.toBeInTheDocument();
    teaser.unmount();

    render(<GameModes />);
    expect(screen.queryByText("Knockout")).not.toBeInTheDocument();
  });
});
