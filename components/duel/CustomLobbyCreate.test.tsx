import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DriverWithActivity } from "@/lib/db/queries";

import { CustomLobbyCreate } from "./CustomLobbyCreate";

// What the host is about to create, checked where a player can see it.
//
// Two of these guard decisions whose failure mode is silent. The default pool
// is the sharper one: it is a value nobody looks at again once it renders, and
// getting it wrong (this screen used to open on ALL TIME while every other mode
// on the site opens on the last 20 seasons) produces a perfectly working game
// whose first round is a driver from 1953. Nothing errors; the host just quietly
// hosts something they did not choose.
const REFERENCE_YEAR = 2026;

function driver(id: number, debutYear: number, lastActiveYear: number): DriverWithActivity {
  return {
    id,
    fullName: `Driver ${id}`,
    nationality: "Italy",
    teams: ["Ferrari"],
    debutYear,
    lastActiveYear,
    careerWins: 0,
    championshipWins: 0,
    podiums: 0,
    polePositions: 0,
  } as DriverWithActivity;
}

// One inside the 20-year window, two well outside it, so "how many drivers"
// distinguishes the default span from all-time rather than counting the same
// number either way.
const ROSTER = [driver(1, 2015, REFERENCE_YEAR), driver(2, 1950, 1955), driver(3, 1960, 1968)];

function renderCreate() {
  const onCreate = vi.fn();
  render(
    <CustomLobbyCreate
      allDrivers={ROSTER}
      referenceYear={REFERENCE_YEAR}
      pending={false}
      error={null}
      onCreate={onCreate}
    />,
  );
  return { onCreate };
}

describe("CustomLobbyCreate", () => {
  // The reported bug. defaultDriverFilter(2026) is 2006-2026, the same span
  // DAILY_POOL_WINDOW resolves to and the same one Infinite opens on.
  it("opens on the last 20 seasons, like every other mode", () => {
    renderCreate();
    // The span, in the shared caption Infinite also renders.
    expect(screen.getByText("2006–2026")).toBeInTheDocument();
    // And the count is that span's, not the whole roster's -- the failure being
    // guarded is specifically "it counted every driver ever", so the two
    // pre-1970 entries must be excluded.
    expect(screen.getByText("1 driver")).toBeInTheDocument();
    // Also pinned through the filter button's accessible name, which is the
    // only name it has (it is icon-only).
    expect(
      screen.getByRole("button", { name: /driver filter: 2006–2026\. 1 drivers/i }),
    ).toBeInTheDocument();
  });

  it("creates with the span it displayed", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderCreate();

    await user.click(screen.getByRole("button", { name: /create game/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({ fromYear: 2006, toYear: REFERENCE_YEAR }),
      }),
    );
  });

  // duel_lobbies.mode is CHECK (mode IN ('duel')) and duel_lobby_create takes no
  // mode parameter, so a knockout lobby cannot be stored. The control that would
  // ask for one must therefore be genuinely unpressable, not merely faded.
  it("offers Duel and shows Knockout as not yet available", () => {
    renderCreate();
    const duel = screen.getByRole("radio", { name: /duel/i });
    const knockout = screen.getByRole("radio", { name: /knockout/i });

    expect(duel).toBeChecked();
    expect(knockout).toBeDisabled();
  });

  it("carries the picked rounds and clock into the config it reports", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderCreate();

    await user.click(screen.getByRole("radio", { name: "5" }));
    await user.click(screen.getByRole("radio", { name: "30s" }));
    await user.click(screen.getByRole("button", { name: /create game/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ rounds: 5, roundSeconds: 30 }),
    );
  });
});
