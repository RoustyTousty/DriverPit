"use client";

import { useEffect, useMemo, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { SearchableSelect, type SearchableOption } from "@/components/ui/SearchableSelect";
import type { DriverWithActivity } from "@/lib/db/queries";
import {
  ACHIEVEMENTS,
  clampDriverFilter,
  defaultDriverFilter,
  FIRST_SEASON,
  matchesDriverFilter,
  type DriverFilter,
} from "@/lib/game/driverFilter";

import { YearRangeSlider } from "./YearRangeSlider";

// Infinite's driver pool, composed rather than chosen from five presets. The
// panel edits a DRAFT and commits on Apply -- not live -- because applying
// starts a new round (a new target, a cleared board), and a filter you are
// halfway through building is not a round you asked for. Cancel/Escape
// therefore genuinely discards, and the caller's round is untouched.
//
// EVERY NUMBER IN HERE IS REAL. The counts come from the same roster the
// autocomplete uses, through the same matchesDriverFilter the SQL mirrors, so
// "142 drivers" is the set the round will actually be drawn from.
//
// And every count is computed against the REST of the draft rather than in
// isolation -- see optionsExcludingSelf. That is what makes the pickers
// cascade: with 1994 selected there is no Aston Martin to pick, and with
// Germany selected the team list is the teams Germans actually drove for.
// A menu that offers a combination yielding nothing is a menu that lies.

interface DriverFilterModalProps {
  open: boolean;
  onClose: () => void;
  drivers: DriverWithActivity[];
  filter: DriverFilter;
  onApply: (filter: DriverFilter) => void;
  referenceYear: number;
}

/**
 * The values of one criterion that are still reachable, each with the number of
 * drivers picking it would leave.
 *
 * `blank` drops this criterion from the draft before counting, so an option's
 * number is what you would get if you chose it -- never zero-because-of-itself.
 * One pass over the roster per call rather than one per option: a 170-entry team
 * list re-counted per option would be 170 scans on every slider tick.
 *
 * The current selection is kept in the list even when it has fallen to zero.
 * Dropping it would make the control display a value its own menu denies, and
 * the zero is the explanation for the "No drivers match" line below.
 */
function optionsExcludingSelf(
  drivers: DriverWithActivity[],
  draft: DriverFilter,
  blank: (filter: DriverFilter) => DriverFilter,
  valuesOf: (driver: DriverWithActivity) => readonly string[],
  selected: string | null,
): SearchableOption[] {
  const withoutSelf = blank(draft);
  const counts = new Map<string, number>();
  for (const driver of drivers) {
    if (!matchesDriverFilter(driver, withoutSelf)) continue;
    // `previous_teams` is built from a Set in the seed, so no per-driver
    // de-duplication is needed here.
    for (const value of valuesOf(driver)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  if (selected !== null && !counts.has(selected)) counts.set(selected, 0);

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

export function DriverFilterModal({
  open,
  onClose,
  drivers,
  filter,
  onApply,
  referenceYear,
}: DriverFilterModalProps) {
  const [draft, setDraft] = useState<DriverFilter>(filter);

  // Re-seed the draft from the live filter every time the panel opens, so a
  // cancelled edit doesn't survive to the next open. Keyed on `open` alone:
  // re-seeding on every `filter` change would fight the player's own edits.
  useEffect(() => {
    if (open) setDraft(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const nationalityOptions = useMemo(
    () =>
      optionsExcludingSelf(
        drivers,
        draft,
        (f) => ({ ...f, nationality: null }),
        (d) => [d.nationality],
        draft.nationality,
      ),
    [drivers, draft],
  );

  const teamOptions = useMemo(
    () =>
      optionsExcludingSelf(
        drivers,
        draft,
        (f) => ({ ...f, team: null }),
        (d) => d.teams,
        draft.team,
      ),
    [drivers, draft],
  );

  const achievementCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { value } of ACHIEVEMENTS) {
      const candidate = { ...draft, achievement: value };
      counts.set(value, drivers.filter((d) => matchesDriverFilter(d, candidate)).length);
    }
    return counts;
  }, [drivers, draft]);

  const matchCount = achievementCounts.get(draft.achievement) ?? 0;
  const isEmpty = matchCount === 0;

  function update(patch: Partial<DriverFilter>) {
    setDraft((current) => clampDriverFilter({ ...current, ...patch }, referenceYear));
  }

  return (
    <Modal open={open} onClose={onClose} title="Driver filter">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <SectionLabel>Seasons</SectionLabel>
          <YearRangeSlider
            min={FIRST_SEASON}
            max={referenceYear}
            from={draft.fromYear}
            to={draft.toYear}
            onChange={({ from, to }) => update({ fromYear: from, toYear: to })}
          />
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel>Achievement</SectionLabel>
          {/* A single row of chips rather than five bordered rows: at 384px the
              cards were most of the panel's height for five mutually exclusive
              values. Radio semantics because they ARE alternatives -- ANDing
              "champion" with "pole sitter" is a filter nobody wants that also
              empties easily. */}
          <div role="radiogroup" aria-label="Achievement" className="flex flex-wrap gap-1.5">
            {ACHIEVEMENTS.map((option) => {
              const count = achievementCounts.get(option.value) ?? 0;
              const selected = draft.achievement === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  // The chip reads "Poles 20"; the spoken name is the whole
                  // thing, since "Poles" alone is not a sentence.
                  aria-label={`${option.label}, ${count} driver${count === 1 ? "" : "s"}`}
                  // A tier nobody in the current span reached stays visible but
                  // unpickable -- removing it would make the row reflow as the
                  // years move, and the zero is information.
                  disabled={count === 0}
                  onClick={() => update({ achievement: option.value })}
                  // Unselected chips sit at text-muted and lift to text on
                  // hover -- the same treatment the mode tabs and every other
                  // segmented control on the site use. Not a border tint: the
                  // accent belongs to the selected chip and to focus rings, and
                  // an outline appearing under the cursor reads as an artifact.
                  className={`group flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 ${
                    selected
                      ? "border-accent bg-accent-weak text-accent"
                      : "border-border bg-surface-2 text-text-muted hover:text-text disabled:hover:text-text-muted"
                  }`}
                >
                  <span aria-hidden="true">{option.short}</span>
                  <span
                    aria-hidden="true"
                    className={`font-mono text-xs tabular-nums ${
                      selected ? "text-accent/70" : "text-text-muted transition-colors group-hover:text-text"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <SearchableSelect
          label="Nationality"
          anyLabel="Any nationality"
          value={draft.nationality}
          options={nationalityOptions}
          onChange={(nationality) => update({ nationality })}
        />

        <SearchableSelect
          label="Team"
          anyLabel="Any team"
          value={draft.team}
          options={teamOptions}
          onChange={(team) => update({ team })}
          hint="Anyone who raced for them, at any point"
        />

        {/* The live count is this panel's whole feedback loop, so it sits with
            the actions rather than at the top: it is what Apply is about to do.
            An empty pool disables Apply instead of letting the RPC refuse the
            round after the board has already cleared. */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p
            role="status"
            aria-live="polite"
            className={`text-center text-sm ${isEmpty ? "text-red-400" : "text-text-muted"}`}
          >
            {isEmpty ? (
              "No drivers match this filter"
            ) : (
              <>
                <span className="font-mono font-bold tabular-nums text-text">{matchCount}</span>{" "}
                driver{matchCount === 1 ? "" : "s"} match this filter
              </>
            )}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDraft(defaultDriverFilter(referenceYear))}
              className="rounded-lg border border-border px-4 py-3 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={isEmpty}
              onClick={() => onApply(clampDriverFilter(draft, referenceYear))}
              className="flex-1 rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply &amp; play
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// The site's eyebrow treatment (duel headers, ResultCard), reused so the panel's
// four sections read as the same kind of heading the rest of the app uses.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{children}</h3>
  );
}
