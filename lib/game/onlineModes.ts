// Which online game a custom lobby is for, and which settings that game has.
//
// A custom lobby has always been "a duel you configured yourself". Once
// Knockout exists it stops being that, and the create screen has to ask which
// game before it can know what to ask NEXT -- a duel is rounds and a clock, a
// knockout is a player count and a hint interval. This module is where that
// answer lives, so the question has one definition rather than an assumption
// spread across the create screen.
//
// THE DATABASE IS THE LIMIT, NOT THIS FILE. `duel_lobbies.mode` carries
// CHECK (mode IN ('duel')) and `duel_lobby_create` takes no mode parameter at
// all -- it writes the column default. So `available: false` is not a UI
// preference somebody could flip on to ship a feature: a knockout lobby is
// literally unrepresentable until a migration widens that CHECK and the RPC
// learns to accept the value. Flipping the flag alone would produce a lobby
// that is still a duel, wearing a Knockout label -- which is worse than a
// disabled button, because it looks like it worked.
//
// Pure, so the picker and any future summary share one list. No SQL mirror and
// so no parity suite: nothing here is duplicated in plpgsql (CLAUDE.md's rule
// is about duplicated constants, and the one constant that IS duplicated -- the
// set of legal modes -- lives in the CHECK and is enforced by it).

export type OnlineModeId = "duel" | "knockout";

/**
 * One control group on the create screen. The create screen renders these in
 * the order a mode lists them and knows how to draw each one; a mode that does
 * not list an id simply does not show that control.
 */
export type MatchSettingId = "rounds" | "round-length" | "drivers";

export interface OnlineModeSpec {
  id: OnlineModeId;
  label: string;
  /** One line under the label in the picker -- what the game IS, not its rules. */
  blurb: string;
  /** False renders the card disabled with a "Soon" pill. See the header. */
  available: boolean;
  /** Which controls this mode's custom games expose, in render order. */
  settings: readonly MatchSettingId[];
}

export const ONLINE_MODES: readonly OnlineModeSpec[] = [
  {
    id: "duel",
    label: "Duel",
    blurb: "1v1 race, fastest guess takes the round.",
    available: true,
    settings: ["rounds", "round-length", "drivers"],
  },
  {
    id: "knockout",
    label: "Knockout",
    blurb: "20 players, elimination each round.",
    available: false,
    // Deliberately empty rather than a guess at Knockout's controls. Its own
    // settings (player count, the global hint-reveal interval) belong here when
    // the mode is built -- which is the whole reason `settings` is per-mode
    // rather than a fixed list hardcoded into the create screen.
    settings: [],
  },
];

/** What the create screen opens on. The only mode that can currently be hosted. */
export const DEFAULT_ONLINE_MODE: OnlineModeId = "duel";

export function onlineModeSpec(id: OnlineModeId): OnlineModeSpec {
  const spec = ONLINE_MODES.find((mode) => mode.id === id);
  // Unreachable through the picker (it renders ONLINE_MODES), so this is the
  // "a stored/forwarded value stopped being valid" path -- fall back to the one
  // mode that certainly exists rather than crash the screen.
  return spec ?? ONLINE_MODES[0];
}

/** Does this mode expose that control? Drives what the create screen renders. */
export function modeHasSetting(id: OnlineModeId, setting: MatchSettingId): boolean {
  return onlineModeSpec(id).settings.includes(setting);
}
