import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DriverAutocomplete, type DriverOption } from "./DriverAutocomplete";

// Audit 2026-07-29 §2.6 -- the component tier this is the first tenant of.
//
// §3.9 + §4.7's duplicate-guess fix closed with "not verified in a browser":
// the server refusal is pinned by a DB test and `partitionSearchIndex` by a
// pure one, but "the dropdown withholds the driver and says so" is a fact about
// a rendered DOM, and there was no tier that could see one. This is that tier.
//
// What is asserted here is deliberately behaviour a player can observe -- what
// the listbox offers, what the panel says, what the live region announces --
// never internals. A rewrite of the markup that keeps those true should keep
// these green.

const DRIVERS: DriverOption[] = [
  { id: 1, fullName: "Lewis Hamilton", nationality: "United Kingdom" },
  { id: 2, fullName: "Max Verstappen", nationality: "Netherlands" },
  { id: 3, fullName: "Carlos Sainz Jr.", nationality: "Spain" },
  { id: 4, fullName: "Lando Norris", nationality: "United Kingdom" },
];

function setup(guessedDriverIds?: ReadonlySet<number>) {
  const onSelect = vi.fn();
  render(
    <DriverAutocomplete
      drivers={DRIVERS}
      onSelect={onSelect}
      guessedDriverIds={guessedDriverIds}
    />,
  );
  return { onSelect, user: userEvent.setup() };
}

function optionNames(): string[] {
  return within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .map((option) => option.textContent?.trim() ?? "");
}

describe("DriverAutocomplete", () => {
  it("suggests matching drivers and reports the pick to its caller", async () => {
    const { onSelect, user } = setup();

    await user.type(screen.getByRole("combobox"), "hamil");
    expect(optionNames()).toEqual(["Lewis Hamilton"]);

    await user.click(screen.getByRole("option", { name: /Lewis Hamilton/ }));
    expect(onSelect).toHaveBeenCalledWith(DRIVERS[0]);
    // The query clears so the next guess starts from empty rather than from the
    // last driver's name.
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("withholds an already-guessed driver from the suggestions", async () => {
    const { user } = setup(new Set([1]));

    await user.type(screen.getByRole("combobox"), "hamil");
    expect(screen.queryByRole("option", { name: /Lewis Hamilton/ })).toBeNull();
  });

  // The half that is easy to get wrong, and the reason the fix withholds rather
  // than filters: silently dropping the driver makes the panel claim the pool
  // doesn't contain him, which is false and reads as a broken search.
  it("names the withheld driver instead of dropping it silently", async () => {
    const { user } = setup(new Set([1]));

    await user.type(screen.getByRole("combobox"), "hamil");

    expect(screen.getByText(/— already guessed/)).toHaveTextContent(
      "Lewis Hamilton — already guessed",
    );
    expect(screen.queryByText(/No driver in this pool matches/)).toBeNull();
  });

  it("announces the withheld driver to a screen reader", async () => {
    const { user } = setup(new Set([1]));

    await user.type(screen.getByRole("combobox"), "hamil");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Lewis Hamilton is already guessed.",
    );
  });

  // "typing 'sai' with one Sainz already guessed should still offer the others,
  // and still say where the missing one went" -- the component's own comment.
  it("keeps offering the drivers that are still guessable", async () => {
    const { user } = setup(new Set([1]));

    await user.type(screen.getByRole("combobox"), "l");

    expect(optionNames()).toContain("Lando Norris");
    expect(optionNames()).not.toContain("Lewis Hamilton");
    expect(screen.getByText(/— already guessed/)).toBeInTheDocument();
  });

  it("still reports a genuinely absent driver as absent", async () => {
    const { user } = setup(new Set([1]));

    await user.type(screen.getByRole("combobox"), "schumacher");

    expect(screen.getByText(/No driver in this pool matches/)).toBeInTheDocument();
    expect(screen.queryByText(/already guessed/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("No drivers found.");
  });

  it("selects the highlighted option with the keyboard", async () => {
    const { onSelect, user } = setup();

    const input = screen.getByRole("combobox");
    await user.type(input, "l");
    await user.keyboard("{ArrowDown}{Enter}");

    // ArrowDown moves off the first match, so this is the second one -- i.e.
    // the keyboard path is genuinely driving the selection, not just Enter
    // taking whatever was already active.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).not.toBe(DRIVERS[0]);
  });

  it("marks the active option for assistive tech", async () => {
    const { user } = setup();

    const input = screen.getByRole("combobox");
    await user.type(input, "l");

    const active = input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(screen.getByRole("option", { selected: true }).id).toBe(active);
  });
});
