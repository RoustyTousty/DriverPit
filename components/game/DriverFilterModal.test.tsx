import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DriverWithActivity } from "@/lib/db/queries";
import { defaultDriverFilter, type DriverFilter } from "@/lib/game/driverFilter";

import { DriverFilterModal } from "./DriverFilterModal";

// Infinite's pool picker, which drizzle/0053 turned from five presets into four
// composable criteria. What is pinned here is what a player can observe: the
// counts are real, the pickers only offer combinations that exist, an
// impossible filter cannot be applied, and Apply hands back exactly what was
// composed.
//
// That last one is load-bearing. The applied filter is what infinite_start_round
// draws the round's target from, so a modal that reported a filter subtly
// different from the one it displayed would produce a target outside the pool
// the board autocompletes -- unwinnable, and silent.

const YEAR = 2026;

function driver(over: Partial<DriverWithActivity> & { id: number }): DriverWithActivity {
  return {
    fullName: `Driver ${over.id}`,
    nationality: "United Kingdom",
    debutYear: 2015,
    lastActiveYear: 2020,
    teams: ["McLaren"],
    careerWins: 0,
    championshipWins: 0,
    podiums: 0,
    polePositions: 0,
    ...over,
  };
}

// A deliberately small roster with one driver per interesting shape, so every
// count in the assertions below can be read off by hand.
const ROSTER: DriverWithActivity[] = [
  driver({ id: 1, fullName: "Champion Brit", championshipWins: 2, careerWins: 20, podiums: 40, polePositions: 15 }),
  driver({ id: 2, fullName: "Winner Brit", careerWins: 3, podiums: 9, polePositions: 1 }),
  driver({ id: 3, fullName: "Podium Italian", nationality: "Italy", teams: ["Ferrari"], podiums: 2 }),
  driver({ id: 4, fullName: "Nobody Italian", nationality: "Italy", teams: ["Ferrari", "Minardi"] }),
  driver({
    id: 5,
    fullName: "Old Timer",
    debutYear: 1958,
    lastActiveYear: 1962,
    nationality: "Italy",
    teams: ["Maserati"],
    podiums: 1,
  }),
];

const ALL_TIME: DriverFilter = { ...defaultDriverFilter(YEAR), fromYear: 1950 };

function setup(filter: DriverFilter = defaultDriverFilter(YEAR)) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <DriverFilterModal
      open
      onClose={onClose}
      drivers={ROSTER}
      filter={filter}
      onApply={onApply}
      referenceYear={YEAR}
    />,
  );
  return { onApply, onClose, user: userEvent.setup() };
}

type User = ReturnType<typeof userEvent.setup>;

function matchCount(): string {
  return screen.getByRole("status").textContent ?? "";
}

function achievement(name: RegExp): HTMLElement {
  return screen.getByRole("radio", { name });
}

function trigger(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${label}`) });
}

/** Open one of the two searchable selects and read back what it offers, as
 *  "<value> <count>". The name and the count are sibling spans, so plain
 *  textContent would run them together ("Italy3"). */
async function optionsOf(user: User, label: string): Promise<string[]> {
  await user.click(trigger(label));
  const list = within(screen.getByRole("listbox", { name: label }))
    .getAllByRole("option")
    .map((option) =>
      [...option.children]
        .map((child) => child.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" "),
    );
  await user.keyboard("{Escape}");
  return list;
}

async function pick(user: User, label: string, value: string) {
  await user.click(trigger(label));
  await user.click(
    within(screen.getByRole("listbox", { name: label })).getByRole("option", {
      name: new RegExp(`^${value}`),
    }),
  );
}

describe("DriverFilterModal", () => {
  it("counts the drivers the current filter admits", () => {
    // The default span is the last 20 seasons (2006-2026), which excludes the
    // 1958 driver and admits the other four.
    setup();
    expect(matchCount()).toContain("4");
  });

  it("shows how many drivers each achievement tier would leave", () => {
    setup();

    // Read straight off ROSTER within the default span: 1 champion, 2 race
    // winners, 3 podium finishers, 2 pole sitters. Each is counted against the
    // REST of the draft, so a tier's number is what picking it would give.
    const group = screen.getByRole("radiogroup", { name: "Achievement" });
    expect(within(group).getByRole("radio", { name: "World champions, 1 driver" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Race winners, 2 drivers" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Podium finishers, 3 drivers" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Pole sitters, 2 drivers" })).toBeInTheDocument();
  });

  it("narrows the count as criteria are added, without touching the live filter", async () => {
    const { user, onApply } = setup();

    await user.click(achievement(/World champions/));
    expect(matchCount()).toContain("1");

    // Editing is a DRAFT: nothing has been applied, so the caller's round is
    // still running under the old filter.
    expect(onApply).not.toHaveBeenCalled();
  });

  it("hands back exactly the composed filter on Apply", async () => {
    const { user, onApply } = setup();

    await user.click(achievement(/Race winners/));
    await pick(user, "Nationality", "United Kingdom");
    await user.click(screen.getByRole("button", { name: /Apply/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toEqual({
      fromYear: 2006,
      toYear: YEAR,
      nationality: "United Kingdom",
      team: null,
      achievement: "race-winner",
    });
  });

  // The cascade. A picker that offers a value yielding nothing is a picker that
  // lies, and the combinations are far too many to check by playing: 40-odd
  // nationalities x 170-odd teams x 5 tiers x any span.
  describe("only offers combinations that exist", () => {
    it("drops values ruled out by the season span", async () => {
      const { user } = setup();

      // Maserati and its driver are outside the default 2006-2026 span, so
      // neither the team nor a "Maserati" option should be offered at all.
      expect(await optionsOf(user, "Team")).toEqual([
        "Any team",
        "Ferrari 2",
        "McLaren 2",
        "Minardi 1",
      ]);
    });

    it("widens again as the span reaches further back", async () => {
      const { user } = setup(ALL_TIME);

      expect(await optionsOf(user, "Team")).toContain("Maserati 1");
    });

    it("narrows the team list to the teams that nationality actually drove for", async () => {
      const { user } = setup(ALL_TIME);

      await pick(user, "Nationality", "Italy");

      // The Italians drove Ferrari, Minardi and Maserati; McLaren is British
      // here and must not be offered.
      expect(await optionsOf(user, "Team")).toEqual([
        "Any team",
        "Ferrari 2",
        "Maserati 1",
        "Minardi 1",
      ]);
    });

    it("narrows the nationality list to the nationalities on that team", async () => {
      const { user } = setup(ALL_TIME);

      await pick(user, "Team", "Ferrari");

      // And the reverse direction, which is the half that is easy to leave out.
      expect(await optionsOf(user, "Nationality")).toEqual(["Any nationality", "Italy 2"]);
    });

    it("narrows by achievement too", async () => {
      const { user } = setup(ALL_TIME);

      await user.click(achievement(/Race winners/));

      // Only the two Brits have wins, so Italy stops being offered.
      expect(await optionsOf(user, "Nationality")).toEqual([
        "Any nationality",
        "United Kingdom 2",
      ]);
    });

    it("counts each option against the rest of the draft, not on its own", async () => {
      const { user } = setup(ALL_TIME);

      // All-time, Italy has 3 drivers. Under "Podium finishers" only two of
      // them qualify, and the option's number must say 2 -- a count computed in
      // isolation would still read 3.
      expect(await optionsOf(user, "Nationality")).toContain("Italy 3");

      await user.click(achievement(/Podium finishers/));
      expect(await optionsOf(user, "Nationality")).toContain("Italy 2");
    });

    // A positioning bug jsdom cannot see -- it has no layout, so `absolute
    // top-full` computes nothing here. What IS checkable is the structure the
    // rule resolves against: the popup must share a positioned wrapper with the
    // trigger alone. Team is the case that broke, because its hint sits under
    // the button and the popup was resolving against the whole control, opening
    // below the hint instead of below the button.
    it("anchors the popup to its trigger, not to the whole control", async () => {
      const { user } = setup(ALL_TIME);

      await user.click(trigger("Team"));

      const popup = screen.getByRole("listbox", { name: "Team" }).parentElement!;
      const anchor = trigger("Team").parentElement!;
      expect(anchor).toContainElement(popup);
      // The hint is what the popup used to be pushed below, so it must sit
      // outside that wrapper.
      expect(anchor).not.toHaveTextContent("Anyone who raced for them");
    });

    it("keeps showing a selection that has fallen to zero", async () => {
      const { user } = setup(ALL_TIME);

      await pick(user, "Team", "Maserati");
      expect(matchCount()).toContain("1");

      // Moving the span off that career leaves the control displaying a value
      // its own menu would no longer offer. Dropping it silently would be a
      // control whose value disagrees with its list; the 0 is the explanation
      // for the empty state below it.
      fireEvent.change(screen.getByLabelText("First season"), { target: { value: "2000" } });

      expect(matchCount()).toMatch(/No drivers match/);
      expect(trigger("Team")).toHaveTextContent("Maserati");
      expect(await optionsOf(user, "Team")).toContain("Maserati 0");
    });
  });

  // The guard that keeps an impossible filter out of infinite_start_round. The
  // RPC refuses it too, but by then the board has already cleared for a round
  // that will never start.
  it("refuses to apply a filter no driver matches", async () => {
    const { user, onApply } = setup(ALL_TIME);

    await pick(user, "Team", "Maserati");
    fireEvent.change(screen.getByLabelText("First season"), { target: { value: "2000" } });

    expect(matchCount()).toMatch(/No drivers match/);
    expect(screen.getByRole("button", { name: /Apply/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Apply/ }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("disables a tier that nobody in the current selection reached", async () => {
    const { user } = setup();

    await pick(user, "Nationality", "Italy");

    // Visible with its zero rather than removed: a row of chips that reflows as
    // the years move is harder to use than one with a greyed chip.
    expect(achievement(/World champions/)).toBeDisabled();
    expect(achievement(/World champions, 0 drivers/)).toBeInTheDocument();
    expect(achievement(/Podium finishers/)).toBeEnabled();
  });

  it("resets every criterion at once, not just the years", async () => {
    const { user, onApply } = setup({
      fromYear: 1950,
      toYear: 1960,
      nationality: "Italy",
      team: "Maserati",
      achievement: "podium",
    });

    // Only the 1958 driver satisfies all of that.
    expect(matchCount()).toContain("1");

    await user.click(screen.getByRole("button", { name: "Reset" }));
    await user.click(screen.getByRole("button", { name: /Apply/ }));

    expect(onApply).toHaveBeenCalledWith(defaultDriverFilter(YEAR));
  });

  it("exposes the year span as two labelled sliders", () => {
    setup();

    // Native range inputs, so they are keyboard-operable and announce their
    // value without any of it being reimplemented.
    const first = screen.getByLabelText("First season") as HTMLInputElement;
    const last = screen.getByLabelText("Last season") as HTMLInputElement;
    expect(first.type).toBe("range");
    expect(first.value).toBe("2006");
    expect(last.value).toBe(String(YEAR));
    expect(first.min).toBe("1950");
    expect(last.max).toBe(String(YEAR));
  });

  it("keeps the two thumbs from crossing", async () => {
    const { user, onApply } = setup();

    // fireEvent rather than userEvent: jsdom has no layout, so user-event can't
    // drag a range thumb, and its keyboard path calls setSelectionRange, which
    // jsdom refuses on a range input. A change event is exactly what both a drag
    // and an arrow key produce.
    const first = screen.getByLabelText("First season");
    const last = screen.getByLabelText("Last season");

    fireEvent.change(first, { target: { value: "2020" } });
    expect(first).toHaveValue("2020");

    // Dragging the UPPER thumb below the lower one clamps rather than
    // inverting: a reversed span matches nobody, which reads as broken.
    fireEvent.change(last, { target: { value: "1950" } });
    expect(last).toHaveValue("2020");
    expect(first).toHaveValue("2020");

    // And the same in the other direction.
    fireEvent.change(first, { target: { value: String(YEAR) } });
    expect(first).toHaveValue("2020");

    await user.click(screen.getByRole("button", { name: /Apply/ }));
    expect(onApply.mock.calls[0][0]).toMatchObject({ fromYear: 2020, toYear: 2020 });
  });

  it("re-filters as the span moves", () => {
    setup();
    expect(matchCount()).toContain("4");

    // Reaching back to 1950 brings the one historical driver into the pool.
    fireEvent.change(screen.getByLabelText("First season"), { target: { value: "1950" } });
    expect(matchCount()).toContain("5");

    // A span entirely after that career ends drops them again -- the overlap
    // test, seen from the UI.
    fireEvent.change(screen.getByLabelText("First season"), { target: { value: "1970" } });
    expect(matchCount()).toContain("4");
  });
});
