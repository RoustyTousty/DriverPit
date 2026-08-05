import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/ui/Modal";

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

  // Audit 2026-07-30, §4.7's residual: the keyboard/ARIA gaps left over after
  // §3.9's withholding fix. PoolSelect closed the same four items one component
  // over and PoolSelect.test.tsx pinned them; these are the counterparts, minus
  // Home/End, which is the one item where the two controls must NOT match --
  // see the last test in this file.

  it("announces itself as a list autocomplete, not a plain text field", () => {
    setup();

    // The one missing attribute of the combobox set: role, aria-expanded,
    // aria-controls and aria-activedescendant were all already here, so a
    // screen reader was told this input controls a listbox but not that the
    // listbox is populated from what gets typed.
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-autocomplete", "list");
  });

  it("says it is collapsed once the list is dismissed", async () => {
    const { user } = setup();

    const input = screen.getByRole("combobox");
    await user.type(input, "l");
    expect(input).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  // Escape used to be a one-way door: with the query unchanged the matches are
  // unchanged, so nothing about pressing the same keys again brought the list
  // back -- only editing the query did.
  it("reopens a dismissed list with ArrowUp, where ArrowDown already did", async () => {
    const { user } = setup();

    const input = screen.getByRole("combobox");
    await user.type(input, "l");
    const before = input.getAttribute("aria-activedescendant");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // Reopens where the player left the cursor rather than jumping it to the
    // last of eight fuzzy-ranked matches.
    expect(input.getAttribute("aria-activedescendant")).toBe(before);
  });

  it("still selects with ArrowUp once the list is open", async () => {
    const { onSelect, user } = setup();

    const input = screen.getByRole("combobox");
    await user.type(input, "l");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");

    // Down, down, up lands on the second match -- i.e. ArrowUp gaining an
    // open-the-list branch did not cost it its move-the-cursor one.
    const names = ["Lewis Hamilton", "Lando Norris", "Carlos Sainz Jr."];
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(names.indexOf(onSelect.mock.calls[0][0].fullName)).toBe(1);
  });

  // The latent one, made real by putting the component in the container the
  // audit named. `Modal` closes from a listener on `document`, which does not
  // consult defaultPrevented -- so this is a stopPropagation test, and it fails
  // against a fix that only calls preventDefault.
  describe("inside a Modal", () => {
    function setupInModal() {
      const onClose = vi.fn();
      render(
        <Modal open onClose={onClose} title="Guess a driver">
          <DriverAutocomplete drivers={DRIVERS} onSelect={vi.fn()} />
        </Modal>,
      );
      return { onClose, user: userEvent.setup() };
    }

    it("dismisses the dropdown without also closing the dialog", async () => {
      const { onClose, user } = setupInModal();

      await user.click(screen.getByRole("combobox"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      await user.keyboard("{Escape}");

      expect(screen.queryByRole("listbox")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    // The other half of the same guard: swallowing Escape unconditionally would
    // make the dialog take two presses to close for no visible reason.
    it("lets Escape reach the dialog once there is no dropdown", async () => {
      const { onClose, user } = setupInModal();

      await user.click(screen.getByRole("combobox"));
      await user.keyboard("{Escape}{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // An empty query is not a search, so it isn't answered like one. fuzzyFilter
  // hands back the head of the pool for one, and the pool arrives alphabetical
  // -- so the box opened on the same eight A-names for every player, every day.
  // The seed is what makes any of this testable: the draw is pure given one,
  // and one is taken (from Math.random) only when the list opens.
  describe("with nothing typed yet", () => {
    const POOL: DriverOption[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      fullName: `Driver ${String(i).padStart(2, "0")}`,
      nationality: "United Kingdom",
    }));

    function setupPool() {
      const view = render(<DriverAutocomplete drivers={POOL} onSelect={vi.fn()} />);
      return { ...view, user: userEvent.setup() };
    }

    it("offers a random slice of the pool, not the top of the alphabet", async () => {
      const { user } = setupPool();

      await user.click(screen.getByRole("combobox"));

      const shown = optionNames();
      expect(shown).toHaveLength(8);
      expect(new Set(shown).size).toBe(8);
      shown.forEach((name) => expect(POOL.map((d) => d.fullName)).toContain(name));
      expect(shown).not.toEqual(POOL.slice(0, 8).map((d) => d.fullName));
    });

    it("draws a fresh set each time the list is opened", async () => {
      const { user } = setupPool();
      const input = screen.getByRole("combobox");

      await user.click(input);
      const first = optionNames();

      await user.keyboard("{Escape}");
      await user.keyboard("{ArrowDown}");
      const second = optionNames();

      // Both open paths re-roll (focus and the arrow keys), which is the point:
      // the suggestions are a different eight between guesses rather than one
      // fixed "random" set for the whole session.
      expect(second).not.toEqual(first);
    });

    // THE stability property, and the reason the seed lives in state rather
    // than the draw living in the memo. This component re-renders on things
    // that have nothing to do with it -- the duel's round clock ticks at 10Hz --
    // and a list that reshuffles under the cursor is unusable.
    it("holds the same eight across re-renders it did not cause", async () => {
      const { user, rerender } = setupPool();

      await user.click(screen.getByRole("combobox"));
      const before = optionNames();

      rerender(
        <DriverAutocomplete drivers={POOL} onSelect={vi.fn()} placeholder="tick" />,
      );

      expect(optionNames()).toEqual(before);
    });

    it("keeps the same eight when a query is typed and deleted again", async () => {
      const { user } = setupPool();
      const input = screen.getByRole("combobox");

      await user.click(input);
      const before = optionNames();

      await user.type(input, "driver 1");
      await user.clear(input);

      expect(optionNames()).toEqual(before);
    });

    it("returns to the ranked order the moment something is typed", async () => {
      const { user } = setupPool();

      await user.type(screen.getByRole("combobox"), "driver 0");

      // Every "Driver 0N" scores identically on a substring hit, so the ranking
      // falls back to pool order -- i.e. the typed path is untouched by the
      // shuffle, which is the half of this that must NOT change.
      expect(optionNames()).toEqual([
        "Driver 00",
        "Driver 01",
        "Driver 02",
        "Driver 03",
        "Driver 04",
        "Driver 05",
        "Driver 06",
        "Driver 07",
      ]);
    });

    it("never offers an already-guessed driver among the random ones", async () => {
      const guessed = new Set(POOL.slice(0, 25).map((d) => d.id));
      render(
        <DriverAutocomplete drivers={POOL} onSelect={vi.fn()} guessedDriverIds={guessed} />,
      );
      const user = userEvent.setup();

      // 25 of 30 withheld, so the five that remain are the whole list -- the
      // sample draws from the partitioned index, not from the raw pool.
      await user.click(screen.getByRole("combobox"));

      expect([...optionNames()].sort()).toEqual(
        POOL.slice(25).map((d) => d.fullName),
      );
    });
  });

  // The deliberate divergence from PoolSelect, pinned so it isn't "made to
  // match" later. PoolSelect is a select-only combobox, where Home/End can only
  // mean first/last option; this one is editable, and the APG gives Home/End to
  // the editing cursor for an editable combobox even when visual focus is in
  // the popup. Binding them to the option list would take the only keys that
  // jump the caret through a half-typed name, in a mode where guessing is timed.
  it("leaves Home and End to the editing cursor", async () => {
    const { user } = setup();

    const input = screen.getByRole("combobox");
    await user.type(input, "sain");
    const active = input.getAttribute("aria-activedescendant");

    await user.keyboard("{Home}");
    expect(input.getAttribute("aria-activedescendant")).toBe(active);
    expect((input as HTMLInputElement).selectionStart).toBe(0);

    await user.keyboard("{End}");
    expect(input.getAttribute("aria-activedescendant")).toBe(active);
    expect((input as HTMLInputElement).selectionStart).toBe("sain".length);
  });
});
