import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ArchiveSearch } from "./ArchiveSearch";
import type { ArchiveDayRowData } from "./ArchiveDayRow";

// What the search must be, from outside: an ADDITIVE layer over a
// server-rendered, crawlable list.
//
// The rule it exists to protect is the one thing about this component that
// cannot be seen by reading it: with an empty box the page must show the
// server-rendered rows and their pagination, because that markup is what a
// crawler and a reader with no JavaScript get. A version that always renders
// its own client-side list would look identical in a browser and would quietly
// replace the paginated document the archive is.
//
// The matching rules themselves are pinned in lib/recap/archiveSearch.test.ts;
// what is pinned here is the wiring — which list is on screen, what is
// announced, and whether clearing gets the page back.

function day(over: Partial<ArchiveDayRowData> & { date: string }): ArchiveDayRowData {
  return {
    puzzleNumber: 1,
    driverName: "Someone",
    dateLabel: "1 January 2026",
    players: 3,
    completed: 3,
    solved: 2,
    ...over,
  };
}

const INDEX: ArchiveDayRowData[] = [
  day({ date: "2026-07-31", puzzleNumber: 25, driverName: "Jules Bianchi", dateLabel: "31 July 2026" }),
  day({ date: "2026-07-05", puzzleNumber: 20, driverName: "Lewis Hamilton", dateLabel: "5 July 2026" }),
  day({ date: "2025-03-02", puzzleNumber: 2, driverName: "Max Verstappen", dateLabel: "2 March 2025" }),
];

function renderSearch() {
  return render(
    <ArchiveSearch index={INDEX}>
      <p data-testid="server-list">the server-rendered page</p>
    </ArchiveSearch>,
  );
}

const box = () => screen.getByRole("textbox", { name: /find a puzzle/i });

describe("ArchiveSearch", () => {
  it("shows the server-rendered list until something is typed", () => {
    renderSearch();

    expect(screen.getByTestId("server-list")).toBeInTheDocument();
    // And no client-side copy of it alongside — two lists of the same days is
    // the duplicate this component exists to avoid.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("replaces it with matching days while a query is active", async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.type(box(), "hamilton");

    expect(screen.queryByTestId("server-list")).not.toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Lewis Hamilton");
    expect(links[0]).toHaveAttribute("href", "/archive/2026-07-05");
  });

  // Results appear with no navigation, so a screen reader is told how many
  // there are; without this the box is silent and the page appears unchanged.
  it("announces the result count in a live region", async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.type(box(), "july");

    expect(screen.getByRole("status")).toHaveTextContent("2 puzzles found");
  });

  it("says so when nothing matches, rather than showing an empty list", async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.type(box(), "senna");

    expect(screen.getByRole("status")).toHaveTextContent(/nothing in the archive matches/i);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("gets the paginated page back when the query is cleared", async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.type(box(), "hamilton");
    await user.click(screen.getByRole("button", { name: /clear search/i }));

    expect(screen.getByTestId("server-list")).toBeInTheDocument();
    // Focus goes back to the box, not to <body>: the clear button unmounts on
    // click, and dropping focus to the top of the document is how a keyboard
    // user loses their place mid-search.
    expect(box()).toHaveFocus();
  });

  it("clears on Escape, which is the key people press to abandon a search", async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.type(box(), "hamilton");
    await user.keyboard("{Escape}");

    expect(box()).toHaveValue("");
    expect(screen.getByTestId("server-list")).toBeInTheDocument();
  });
});
