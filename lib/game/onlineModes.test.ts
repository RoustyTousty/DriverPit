import { describe, expect, it } from "vitest";

import {
  DEFAULT_ONLINE_MODE,
  ONLINE_MODES,
  modeHasSetting,
  onlineModeSpec,
} from "./onlineModes";

describe("online modes", () => {
  // The one that matters. `available` is the client's copy of a CHECK
  // constraint it cannot see: duel_lobbies.mode is CHECK (mode IN ('duel')) and
  // duel_lobby_create takes no mode parameter, so hosting anything else is a
  // failed insert at best and a mislabelled duel at worst. Marking a mode
  // available here is therefore never the change that ships it -- the migration
  // is, and this assertion is what makes someone go find that out.
  it("offers only modes the database can actually store", () => {
    const available = ONLINE_MODES.filter((mode) => mode.available).map((mode) => mode.id);
    expect(available).toEqual(["duel"]);
  });

  it("gives the default mode a real spec", () => {
    const spec = onlineModeSpec(DEFAULT_ONLINE_MODE);
    expect(spec.available).toBe(true);
    expect(spec.settings.length).toBeGreaterThan(0);
  });

  // A mode that can be picked but exposes no controls would render a create
  // screen with a button and nothing to configure.
  it("gives every available mode at least one setting", () => {
    for (const mode of ONLINE_MODES.filter((m) => m.available)) {
      expect(mode.settings.length, `${mode.id} has no settings`).toBeGreaterThan(0);
    }
  });

  it("keeps ids unique", () => {
    expect(new Set(ONLINE_MODES.map((m) => m.id)).size).toBe(ONLINE_MODES.length);
  });

  it("reports a mode's own settings, not another's", () => {
    expect(modeHasSetting("duel", "rounds")).toBe(true);
    expect(modeHasSetting("duel", "round-length")).toBe(true);
    expect(modeHasSetting("duel", "drivers")).toBe(true);
    expect(modeHasSetting("knockout", "rounds")).toBe(false);
  });

  // Unreachable through the picker, which renders ONLINE_MODES -- this is the
  // stored-value-went-stale path, and it must not throw on a screen.
  it("falls back rather than throwing on an unknown id", () => {
    expect(onlineModeSpec("nope" as never).id).toBe("duel");
  });
});
