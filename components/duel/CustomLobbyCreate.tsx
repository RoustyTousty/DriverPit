"use client";

import { useMemo, useState } from "react";

import { DriverFilterButton } from "@/components/game/DriverFilterButton";
import { DriverFilterModal } from "@/components/game/DriverFilterModal";
import { DriverFilterSummary } from "@/components/game/DriverFilterSummary";
import type { DriverWithActivity } from "@/lib/db/queries";
import { matchesDriverFilter, type DriverFilter } from "@/lib/game/driverFilter";
import {
  DEFAULT_MATCH_CONFIG,
  ROUNDS_OPTIONS,
  ROUND_SECONDS_OPTIONS,
} from "@/lib/game/customMatchConfig";
import {
  DEFAULT_ONLINE_MODE,
  ONLINE_MODES,
  modeHasSetting,
  type OnlineModeId,
} from "@/lib/game/onlineModes";

import {
  readDriverFilterPreference,
  writeDriverFilterPreference,
} from "@/lib/settings/driverFilter";

// Step one of hosting: which game, then that game's shape.
//
// THE MODE PICKER IS FIRST because it decides what the rest of the screen even
// asks. A duel is rounds and a clock; a knockout will be a player count and a
// hint interval. So the controls below are driven by the selected mode's own
// `settings` list (lib/game/onlineModes.ts) rather than hardcoded here -- adding
// Knockout means adding its spec and its controls, not restructuring this
// screen. Today exactly one mode is selectable and Knockout renders disabled,
// which is honest: duel_lobbies.mode is CHECK (mode IN ('duel')), so a knockout
// lobby cannot be stored at all yet.
//
// Rounds and round length stay the PRIMARY controls -- always visible, because
// they are what a person actually wants to change ("best of five", "make it
// quick"). The driver filter sits behind a secondary "Change" button, because
// most custom games are about who you are playing, not which drivers are in the
// pool.
//
// The filter panel itself is components/game/DriverFilterModal, REUSED
// UNMODIFIED -- the same component Infinite opens, so a custom lobby gets the
// cascading per-option counts and the live "142 drivers" line for free. It
// already takes exactly the props needed ({ open, onClose, drivers, filter,
// onApply, referenceYear }); if this screen ever seems to need a variant of it,
// that is the signal to change the shared one, not to fork it.
export function CustomLobbyCreate({
  allDrivers,
  referenceYear,
  pending,
  error,
  onCreate,
}: {
  allDrivers: DriverWithActivity[];
  referenceYear: number;
  pending: boolean;
  error: string | null;
  onCreate: (config: { rounds: number; roundSeconds: number; filter: DriverFilter }) => void;
}) {
  const [mode, setMode] = useState<OnlineModeId>(DEFAULT_ONLINE_MODE);
  const [rounds, setRounds] = useState(DEFAULT_MATCH_CONFIG.rounds);
  const [roundSeconds, setRoundSeconds] = useState(DEFAULT_MATCH_CONFIG.roundSeconds);
  // Persisted, exactly as Infinite's is, under its OWN key (see
  // lib/settings/driverFilter.ts for why the two scopes do not share one):
  // hosting a second game should not mean re-composing the pool you just
  // composed, and people host in runs.
  //
  // The fallback when nothing is stored is defaultDriverFilter -- the last 20
  // seasons, the same span daily, a ranked duel and Infinite all use. It used to
  // open on all-time, which made "Custom" quietly mean "and also a pool you did
  // not ask for": a friendly game's first round could be a driver from 1953,
  // with nothing erroring. The whole roster is still one click away in the panel.
  //
  // Lazy initializer, so localStorage is read on the client only. Safe here with
  // no hydration caveat at all, unlike Infinite: this screen is only ever
  // reached by pressing Custom, so it does not exist during SSR.
  const [filter, setFilter] = useState<DriverFilter>(() =>
    readDriverFilterPreference("custom", referenceYear),
  );
  const [filterOpen, setFilterOpen] = useState(false);

  // The same predicate the SQL mirrors (lib/game/driverFilter.ts), so this
  // number is the set the rounds will actually be drawn from -- not an estimate.
  // Memoized because it is a scan of the whole roster and this component
  // re-renders on every chip press.
  const matchCount = useMemo(
    () => allDrivers.filter((driver) => matchesDriverFilter(driver, filter)).length,
    [allDrivers, filter],
  );

  const empty = matchCount === 0;

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
          Game
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {ONLINE_MODES.map((spec) => {
            const selected = spec.id === mode;
            return (
              <button
                key={spec.id}
                type="button"
                role="radio"
                aria-checked={selected}
                // Not merely styled as unavailable: a knockout lobby is
                // unrepresentable in the database today, so the control that
                // would create one must not be pressable.
                disabled={!spec.available}
                onClick={() => setMode(spec.id)}
                // Three states, not two-plus-an-override. The unavailable one
                // is spelled out on its own branch so it carries NO hover rule
                // at all -- `:hover` still matches a disabled <button>, so an
                // unconditional `hover:border-text-muted` with a later
                // `hover:border-border` to undo it was two rules fighting for
                // the same property and depending on source order to settle it.
                // Matches /online's Knockout card: bg-surface, opacity-60,
                // hairline border, inert. The cursor is the only hover feedback,
                // and it says "not this one" rather than "press me".
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  !spec.available
                    ? "cursor-not-allowed border-border bg-surface opacity-60"
                    : selected
                      ? "border-accent bg-accent-weak/40"
                      : "border-border bg-surface-2 hover:border-text-muted"
                }`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className={`text-sm font-bold ${selected ? "text-accent" : "text-text"}`}>
                    {spec.label}
                  </span>
                  {/* The same words as /online's card ("Coming soon"), not an
                      abbreviation of them -- the two screens describe the same
                      unbuilt mode and should say so identically. */}
                  {!spec.available && (
                    <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                      Coming soon
                    </span>
                  )}
                </span>
                <span className="text-xs text-text-muted">{spec.blurb}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {modeHasSetting(mode, "rounds") && (
        <SettingChips
          label="Rounds"
          options={ROUNDS_OPTIONS}
          value={rounds}
          onChange={setRounds}
          format={(value) => String(value)}
        />
      )}

      {modeHasSetting(mode, "round-length") && (
        <SettingChips
          label="Time per round"
          options={ROUND_SECONDS_OPTIONS}
          value={roundSeconds}
          onChange={setRoundSeconds}
          format={(value) => `${value}s`}
        />
      )}

      {/* The pool caption and the button it acts on are ONE pairing, at
          Infinite's own gap-1.5 -- there the caption sits that far above the
          guess input for the same reason: it describes the pool the very next
          control draws from. At the form's gap-5 they read as two unrelated
          rows. The four setting groups above keep the wider rhythm. */}
      <div className="flex flex-col gap-1.5">
        {modeHasSetting(mode, "drivers") && (
          // One of four setting groups on this form, and labelled like the other
          // three (GAME / ROUNDS / TIME PER ROUND) rather than in the heavier
          // label+description shape it briefly wore. Four groups that look like
          // four groups; the caption below already says what the pool is, and the
          // filter button's accessible name says what the control does.
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
                Drivers
              </span>
              <DriverFilterButton
                filter={filter}
                matchCount={matchCount}
                referenceYear={referenceYear}
                onOpen={() => setFilterOpen(true)}
              />
            </div>

            {/* The same caption Infinite renders, unchanged and unboxed. */}
            <DriverFilterSummary
              filter={filter}
              matchCount={matchCount}
              referenceYear={referenceYear}
            />

            {empty && (
              <p className="text-xs text-red-400">
                No drivers match this pool — widen it before creating the game.
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => onCreate({ rounds, roundSeconds, filter })}
          // Matching nothing is refused by the RPC too, but by then the host has
          // pressed a button that looked live -- same reason Infinite's Apply
          // disables itself on an empty filter.
          disabled={pending || empty}
          className="w-full rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.98] disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create game"}
        </button>
      </div>

      <DriverFilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        drivers={allDrivers}
        filter={filter}
        onApply={(next) => {
          setFilter(next);
          writeDriverFilterPreference("custom", next, referenceYear);
          setFilterOpen(false);
        }}
        referenceYear={referenceYear}
      />
    </div>
  );
}

/**
 * A segmented control over a short list of alternatives.
 *
 * A radio group, not a row of buttons: these ARE alternatives, so a screen
 * reader should announce "3, radio button, 2 of 3" and arrow keys should move
 * between them. Same reasoning as DriverFilterModal's achievement chips.
 *
 * The options are `flex-1` inside one bordered track rather than loose pills,
 * which is what makes it read as a single control with a current value instead
 * of three buttons that happen to be near each other.
 */
export function SettingChips<T extends number>({
  label,
  hint,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  /** Optional right-aligned note -- the current value in words, usually. */
  hint?: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
}) {
  const groupId = `setting-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={groupId} className="text-xs font-semibold tracking-wide text-text-muted uppercase">
          {label}
        </span>
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={groupId}
        className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1"
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={`flex-1 rounded-md px-3 py-2 font-mono text-sm tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                selected ? "bg-accent-weak text-accent" : "text-text-muted hover:text-text"
              }`}
            >
              {format(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
