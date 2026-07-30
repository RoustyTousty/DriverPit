"use client";

import { memo, useId, useMemo, useState } from "react";

import { Flag } from "@/components/ui/Flag";
import { buildSearchIndex, fuzzyFilter, partitionSearchIndex, type SearchEntry } from "@/lib/game/fuzzyMatch";

export interface DriverOption {
  id: number;
  fullName: string;
  nationality: string;
}

interface DriverAutocompleteProps {
  drivers: DriverOption[];
  onSelect: (driver: DriverOption) => void;
  disabled?: boolean;
  placeholder?: string;
  // Drivers this round has already had guessed. They're withheld from the
  // suggestions and named back to the player when they type one -- a duplicate
  // guess burnt one of six turns for a comparison the board is already showing
  // (audit 2026-07-29 §4.7), and the server rejects it outright now
  // (drizzle/0049), so offering it would be offering an error.
  //
  // A Set rather than an array so callers can memoize one stable reference per
  // guess: this component is memo()'d, and a fresh array literal per render
  // would defeat that on identity alone.
  guessedDriverIds?: ReadonlySet<number>;
}

const NO_ENTRIES: SearchEntry<DriverOption>[] = [];

// memo'd because two of the three modes re-render around it on a timer -- the
// duel's round clock at 10Hz, daily's next-puzzle countdown at 1Hz -- and none
// of what it draws is a function of that. Callers get the benefit only if
// `drivers` and `onSelect` are stable across those ticks (the duel pins
// onSelect with a ref-latched useCallback; see DuelMatch); where they aren't,
// this is simply the same work it was already doing.
export const DriverAutocomplete = memo(function DriverAutocomplete({
  drivers,
  onSelect,
  disabled = false,
  placeholder = "Guess a driver…",
  guessedDriverIds,
}: DriverAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();

  // Folded search keys are built once per pool, not once per driver per
  // keystroke -- `drivers` is a stable reference in all three modes (a server
  // prop in daily/duel, memoized on the pool window in Infinite), so this runs
  // when the pool changes and never on typing. See lib/game/fuzzyMatch.ts.
  const searchIndex = useMemo(() => buildSearchIndex(drivers, (d) => d.fullName), [drivers]);

  // Re-partitioned when a guess lands, not when a key is pressed, and it
  // re-uses the index entries rather than rebuilding them -- so suggesting from
  // the un-guessed drivers costs the same per keystroke as suggesting from all
  // of them (see partitionSearchIndex).
  const { included: availableIndex, excluded: guessedIndex } = useMemo(() => {
    if (!guessedDriverIds || guessedDriverIds.size === 0) {
      return { included: searchIndex, excluded: NO_ENTRIES };
    }
    return partitionSearchIndex(searchIndex, (driver) => guessedDriverIds.has(driver.id));
  }, [searchIndex, guessedDriverIds]);

  const matches = useMemo(() => fuzzyFilter(query, availableIndex, 8), [query, availableIndex]);

  const trimmedQuery = query.trim();
  // The best already-guessed driver the query names, if any. Withholding one
  // silently would turn "Hamilton" into "No driver in this pool matches
  // Hamilton" -- a false statement about the pool, at the moment the player is
  // most likely to think the search is broken.
  const alreadyGuessed = useMemo(
    () =>
      trimmedQuery === "" || guessedIndex.length === 0
        ? null
        : (fuzzyFilter(trimmedQuery, guessedIndex, 1)[0] ?? null),
    [trimmedQuery, guessedIndex],
  );
  const noMatches = trimmedQuery !== "" && matches.length === 0 && alreadyGuessed === null;

  function selectDriver(driver: DriverOption) {
    onSelect(driver);
    setQuery("");
    setIsOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      // Guarded on emptiness because `matches.length - 1` is -1 with no
      // results, which would park the cursor on a nonexistent option and
      // leave the list with nothing marked when results come back.
      if (matches.length === 0) return;
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length === 0) return;
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      if (isOpen && matches[activeIndex]) {
        event.preventDefault();
        selectDriver(matches[activeIndex]);
      }
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div
      className="relative w-full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsOpen(false);
        }
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && matches[activeIndex]
            ? `${listboxId}-${matches[activeIndex].id}`
            : undefined
        }
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg border border-border bg-surface-2 px-4 py-3 text-base text-text outline-none transition placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent disabled:opacity-50"
      />

      {/* The panel stays mounted on a no-match query so the dropdown doesn't
          just vanish, which read as "the app broke" and gave no clue whether
          the name was misspelled or simply outside the pool (audit
          2026-07-27 §4.3). The listbox itself is always the element
          `aria-controls` names, empty or not. */}
      {isOpen && (matches.length > 0 || noMatches || alreadyGuessed !== null) && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Driver suggestions"
            className="max-h-64 overflow-y-auto"
          >
            {matches.map((driver, index) => (
              <li
                key={driver.id}
                id={`${listboxId}-${driver.id}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectDriver(driver);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex cursor-pointer items-center gap-2 px-4 py-3 text-base transition ${
                  index === activeIndex ? "bg-accent-weak text-accent" : "text-text"
                }`}
              >
                <Flag nationality={driver.nationality} className="shrink-0 text-lg" />
                <span className="truncate">{driver.fullName}</span>
              </li>
            ))}
          </ul>

          {/* Sits under the remaining suggestions rather than replacing them:
              typing "sai" with one Sainz already guessed should still offer the
              others, and still say where the missing one went. */}
          {alreadyGuessed && (
            <p
              // The separator only exists to divide it from suggestions above;
              // with none, it would be a hairline across the top of the panel.
              className={`line-clamp-2 px-4 py-3 text-sm wrap-break-word text-text-muted ${
                matches.length > 0 ? "border-t border-border" : ""
              }`}
            >
              <span className="text-text">{alreadyGuessed.fullName}</span> — already guessed
            </p>
          )}

          {/* line-clamp + wrap-break-word so a long paste can't stretch the
              panel down the page or push its own width past the input. */}
          {noMatches && (
            <p className="line-clamp-2 px-4 py-3 text-sm wrap-break-word text-text-muted">
              No driver in this pool matches “<span className="text-text">{trimmedQuery}</span>”
            </p>
          )}
        </div>
      )}

      {/* Persistent live region rather than one that mounts with the message:
          a region announces its *changes*, and screen readers routinely miss
          the initial content of one that appears already populated. Both
          messages are states, not events -- each is announced once when it
          begins, not re-read on every further keystroke that lands in it. */}
      <span role="status" aria-live="polite" className="sr-only">
        {!isOpen
          ? ""
          : alreadyGuessed
            ? `${alreadyGuessed.fullName} is already guessed.`
            : noMatches
              ? "No drivers found."
              : ""}
      </span>
    </div>
  );
});
