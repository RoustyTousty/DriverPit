import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { defaultDriverFilter } from "@/lib/game/driverFilter";

import { DriverFilterButton } from "./DriverFilterButton";

// One thing worth pinning, and it is the thing an icon-only button gets wrong:
// its NAME. The control used to carry the filter summary as visible text; the
// summary now lives above the guess input instead, so `aria-label` is the only
// name this button has. Delete it -- or let it drift from what the panel
// actually holds -- and a screen reader announces "button", which is the whole
// filter made unreachable. `tsc` cannot see any of that.

const YEAR = 2026;

describe("DriverFilterButton", () => {
  it("names itself with the whole filter, not just 'filter'", () => {
    render(
      <DriverFilterButton
        filter={{
          fromYear: 1990,
          toYear: 1999,
          nationality: "Brazil",
          team: "McLaren",
          achievement: "champion",
        }}
        matchCount={3}
        referenceYear={YEAR}
        onOpen={vi.fn()}
      />,
    );

    // Every criterion, in the same words describeDriverFilter puts on screen --
    // so the spoken control and the visible caption cannot describe different
    // pools.
    expect(
      screen.getByRole("button", {
        name: "Driver filter: 1990–1999 · Brazil · McLaren · World champions. 3 drivers. Change",
      }),
    ).toBeInTheDocument();
  });

  it("says what an untouched filter is, rather than going quiet", () => {
    render(
      <DriverFilterButton
        filter={defaultDriverFilter(YEAR)}
        matchCount={103}
        referenceYear={YEAR}
        onOpen={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Driver filter: 2006–2026. 103 drivers. Change" }),
    ).toBeInTheDocument();
  });

  it("opens the panel and stays inert while a round is loading", async () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <DriverFilterButton
        filter={defaultDriverFilter(YEAR)}
        matchCount={103}
        referenceYear={YEAR}
        onOpen={onOpen}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);

    rerender(
      <DriverFilterButton
        filter={defaultDriverFilter(YEAR)}
        matchCount={103}
        referenceYear={YEAR}
        onOpen={onOpen}
        disabled
      />,
    );

    // Not just visually covered by the loading overlay -- an overlay stops
    // pointers, not the keyboard.
    expect(screen.getByRole("button")).toBeDisabled();
    await user.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
