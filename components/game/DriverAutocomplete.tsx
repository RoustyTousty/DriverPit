"use client";

import { useTranslations } from "next-intl";

import { memo, useId, useMemo, useState } from "react";

import { Flag } from "@/components/ui/Flag";
import {
  buildSearchIndex,
  fuzzyFilter,
  partitionSearchIndex,
  sampleSearchIndex,
  type SearchEntry,
} from "@/lib/game/fuzzyMatch";

export interface DriverOption {
  id: number;
  fullName: string;
  nationality: string;
}

interface DriverAutocompleteProps {
  drivers: DriverOption[];
  onSelect: (driver: DriverOption) => void;
  disabled?: boolean;
  /** Overrides the translated default. */
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
  // The text input itself, for callers that disable this control TEMPORARILY.
  // Disabling a focused element drops focus to <body>, so a keyboard player
  // loses their place and Tab restarts from the top of the page -- the same
  // failure audit 2026-07-29 §4.7 fixed for the duel's solve panel. Only the
  // caller knows whether a disable is temporary (the duel's guess cooldown:
  // restore focus after) or terminal (a finished day: leave it alone), so the
  // restore lives there and this is how it reaches the element.
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const NO_ENTRIES: SearchEntry<DriverOption>[] = [];

// How many suggestions the panel shows, typed or not. One constant because the
// two paths must agree: an empty query drawing a different number of drivers
// than a typed one would resize the dropdown on the first keystroke.
const SUGGESTION_LIMIT = 8;

// Drawn in an event handler, never in render -- see sampleSearchIndex.
function newSampleSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

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
  placeholder,
  guessedDriverIds,
  inputRef,
}: DriverAutocompleteProps) {
  const t = useTranslations("game");
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Which random eight an empty query offers. Re-rolled once per open (below),
  // so the faces change between guesses instead of being one fixed set for the
  // session -- and NOT on every render, which is what a Math.random() in the
  // memo would give: the duel's 10Hz round clock re-renders this component, and
  // a list that reshuffles under the cursor ten times a second is unusable.
  // Never rendered at seed 0: opening the list sets a real seed in the same
  // batch that sets `isOpen`.
  const [sampleSeed, setSampleSeed] = useState(0);
  const listboxId = useId();

  // The three ways the panel opens. Only path that re-rolls: typing does not,
  // so deleting a query back to empty returns the same eight rather than
  // silently swapping them.
  function openList() {
    setIsOpen(true);
    setSampleSeed(newSampleSeed());
  }

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

  const trimmedQuery = query.trim();

  // Nothing typed yet is not a search, so it isn't ranked like one: fuzzyFilter
  // answers an empty query with the head of the pool, which is alphabetical, so
  // the box always opened on the same eight A-names. An empty query draws a
  // random eight instead; the moment there's a query it is the fuzzy ranking
  // again, untouched.
  const matches = useMemo(
    () =>
      trimmedQuery === ""
        ? sampleSearchIndex(availableIndex, SUGGESTION_LIMIT, sampleSeed)
        : fuzzyFilter(trimmedQuery, availableIndex, SUGGESTION_LIMIT),
    [trimmedQuery, availableIndex, sampleSeed],
  );
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

  // "The popup is displayed", which is what `aria-expanded`, `Escape` and the
  // panel below all actually mean -- as opposed to `isOpen`, which is only this
  // component's intent to show one. They differ when there is nothing to show
  // (an empty pool), and announcing "expanded" over an absent listbox is the
  // kind of ARIA promise §4.5/§4.7 exist to stop.
  const isPanelOpen = isOpen && (matches.length > 0 || noMatches || alreadyGuessed !== null);

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
        openList();
        return;
      }
      // Guarded on emptiness because `matches.length - 1` is -1 with no
      // results, which would park the cursor on a nonexistent option and
      // leave the list with nothing marked when results come back.
      if (matches.length === 0) return;
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      // Opens a closed list, exactly as ArrowDown does. Returning early here
      // instead left Escape (or a blur) as a one-way door: with the query
      // unchanged, `matches` is unchanged, so nothing about typing the same
      // letters again would bring the list back -- the player had to edit the
      // query to get their suggestions returned. The cursor is deliberately
      // left where it was rather than jumped to the last suggestion: the APG's
      // "ArrowUp moves visual focus to the last suggested value" resolves an
      // *unset* visual focus, and this list has none -- `activeIndex` is always
      // on an option (0 by default, reset on every keystroke), so the list
      // reopens where the player left it.
      if (!isOpen) {
        openList();
        return;
      }
      if (matches.length === 0) return;
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      if (isOpen && matches[activeIndex]) {
        event.preventDefault();
        selectDriver(matches[activeIndex]);
      }
    } else if (event.key === "Escape") {
      // Swallowed only when there is a popup to dismiss, and then swallowed
      // properly. Both halves are load-bearing:
      //
      // `stopPropagation` is the one that matters -- `Modal` closes from a
      // listener on `document`, which does not consult `defaultPrevented`, so
      // preventDefault alone would still let one Escape close the dropdown AND
      // the dialog around it. React dispatches from the (portal) root
      // container, below `document`, so stopping the native event here reaches
      // the dialog's listener in time.
      //
      // The `!isPanelOpen` guard is the other half: with no popup open, Escape
      // belongs to whatever contains this input, and eating it would make a
      // dialog take two presses to close. Deliberately NOT the APG's optional
      // "clears the textbox" -- that would be a second, invisible meaning for
      // the key that just closed the popup.
      if (!isPanelOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
    }
    // Home/End are deliberately absent, and this is the one place this
    // component does NOT follow PoolSelect. PoolSelect is a select-only
    // combobox (a <button>), where Home/End can only mean first/last option.
    // This one is *editable*, and the APG is explicit that for an editable
    // combobox Home and End belong to the editing cursor -- "moves visual
    // focus to the textbox and places the editing cursor at the beginning of
    // the field" -- even when visual focus is in the popup. Binding them to
    // the option list would take away the only keys that jump the caret
    // through a half-typed name, in the one mode where guessing is timed.
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
        // The one attribute of the combobox set that was missing: `list` is
        // what tells a screen reader this input suggests values in a popup
        // rather than completing them inline (`both`) or not at all (`none`),
        // which is the difference between announcing the suggestions as they
        // arrive and treating the input as a plain text field.
        aria-autocomplete="list"
        aria-expanded={isPanelOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          isPanelOpen && matches[activeIndex]
            ? `${listboxId}-${matches[activeIndex].id}`
            : undefined
        }
        ref={inputRef}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        disabled={disabled}
        placeholder={placeholder ?? t("guessPlaceholder")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          setActiveIndex(0);
        }}
        onFocus={openList}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg border border-border bg-surface-2 px-4 py-3 text-base text-text outline-none transition placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
      />

      {/* The panel stays mounted on a no-match query so the dropdown doesn't
          just vanish, which read as "the app broke" and gave no clue whether
          the name was misspelled or simply outside the pool (audit
          2026-07-27 §4.3). The listbox itself is always the element
          `aria-controls` names, empty or not. */}
      {isPanelOpen && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <ul
            id={listboxId}
            role="listbox"
            aria-label={t("suggestions")}
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
        {!isPanelOpen
          ? ""
          : alreadyGuessed
            ? t("alreadyGuessed", { driver: alreadyGuessed.fullName })
            : noMatches
              ? t("noDrivers")
              : ""}
      </span>
    </div>
  );
});
