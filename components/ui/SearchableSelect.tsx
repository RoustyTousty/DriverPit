"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { normalizeSearchText } from "@/lib/game/fuzzyMatch";

export interface SearchableOption {
  value: string;
  /** How many drivers this option would leave. Rendered beside it, and a 0 is
   *  information rather than a reason to hide the row. */
  count: number;
}

// A select for lists too long to scroll: nationality (40-odd) and constructor
// (170-odd) in Infinite's driver filter.
//
// Native <select> was the first cut and was wrong twice over: it renders in the
// OS's own chrome, which on a dark custom UI reads as a foreign control, and it
// cannot show the per-option counts that make the filter legible. This is the
// same ARIA 1.2 combobox pattern DriverAutocomplete implements -- DOM focus
// stays in the search input, `activeIndex` is the keyboard cursor, and
// `aria-activedescendant` is what tells a screen reader where that cursor is.
// The options are deliberately NOT focusable; moving real focus into the list is
// the other valid pattern, and half of each is what produces a listbox you can
// open and not use.
export function SearchableSelect({
  label,
  anyLabel,
  value,
  options,
  onChange,
  hint,
  disabled = false,
}: {
  label: string;
  /** The "no filter" row, always first and always available. */
  anyLabel: string;
  value: string | null;
  options: SearchableOption[];
  onChange: (value: string | null) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const listboxId = `${id}-listbox`;
  const hintId = `${id}-hint`;
  const optionId = (index: number) => `${id}-option-${index}`;

  // `null` is the clear row, so the whole list is one array and the keyboard
  // cursor doesn't have to special-case a header.
  const rows = useMemo(() => {
    const folded = normalizeSearchText(query.trim());
    const matched = folded
      ? options.filter((option) => normalizeSearchText(option.value).includes(folded))
      : options;
    return [null, ...matched] as (SearchableOption | null)[];
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  // Focus the search box on open and put the cursor on the current value, so
  // opening a 170-entry list lands on where you already are rather than at "Any".
  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    const current = value === null ? 0 : options.findIndex((o) => o.value === value) + 1;
    setActiveIndex(Math.max(0, current));
  }, [isOpen, value, options]);

  // Keep the keyboard cursor in view. The list is scrollable and arrowing past
  // its edge would otherwise move an invisible selection.
  useEffect(() => {
    if (!isOpen) return;
    const active = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex))}`);
    // Optional call, not just optional chaining on the lookup: scrollIntoView
    // is one of the layout APIs jsdom does not implement, so a component test
    // would throw here on a control that works fine in a browser.
    active?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeIndex]);

  function select(row: SearchableOption | null) {
    onChange(row === null ? null : row.value);
    setIsOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(rows.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        if (rows.length > 0) select(rows[Math.min(activeIndex, rows.length - 1)]);
        break;
      case "Escape":
        // stopPropagation, not just preventDefault: this lives inside a Modal
        // that closes from a listener on `document`, which never consults
        // defaultPrevented -- so one Escape would otherwise dismiss the list AND
        // the dialog around it. Same lesson as DriverAutocomplete.
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        setQuery("");
        triggerRef.current?.focus();
        break;
      case "Tab":
        setIsOpen(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-xs font-semibold tracking-wide text-text-muted uppercase">
        {label}
      </span>

      {/* The positioning context is the TRIGGER's wrapper, not the whole
          control. `absolute top-full` resolves against the nearest positioned
          ancestor, so with `relative` on the outer box the panel opened below
          the hint text underneath the button instead of below the button --
          visibly detached, and worse the further the hint wrapped. Anything
          added to this control that isn't the popup belongs outside this div. */}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-describedby={hint ? hintId : undefined}
          disabled={disabled}
          onClick={() => setIsOpen((open) => !open)}
          // No hover border. The site outlines on FOCUS and nowhere else, and
          // an accent hairline on hover reads as a rendering artifact rather
          // than as feedback; hover is a muted->full text step, same as every
          // other secondary control here.
          className="group flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <span
            id={`${id}-value`}
            className={`min-w-0 truncate text-sm transition-colors ${
              value === null ? "text-text-muted group-hover:text-text" : "font-semibold text-text"
            }`}
          >
            {value ?? anyLabel}
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className={`h-4 w-4 shrink-0 text-text-muted transition-[transform,color] duration-200 group-hover:text-text motion-reduce:transition-none ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
            <div className="border-b border-border p-2">
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded
                aria-controls={listboxId}
                aria-label={`Search ${label.toLowerCase()}`}
                aria-activedescendant={optionId(activeIndex)}
                autoComplete="off"
                value={query}
                placeholder="Search…"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none transition placeholder:text-text-muted focus:border-accent"
              />
            </div>

            <ul ref={listRef} id={listboxId} role="listbox" aria-label={label} className="max-h-56 overflow-y-auto">
              {rows.map((row, index) => {
                const isSelected = row === null ? value === null : row.value === value;
                const isActive = index === activeIndex;
                return (
                  <li
                    key={row?.value ?? "__any__"}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      select(row);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm transition ${
                      isSelected
                        ? "bg-accent-weak text-accent"
                        : isActive
                          ? "bg-surface-2 text-text"
                          : "text-text"
                    }`}
                  >
                    <span className="min-w-0 truncate">{row?.value ?? anyLabel}</span>
                    {row && (
                      <span
                        className={`shrink-0 font-mono text-xs tabular-nums ${
                          isSelected ? "text-accent/70" : "text-text-muted"
                        }`}
                      >
                        {row.count}
                      </span>
                    )}
                  </li>
                );
              })}

              {rows.length === 1 && (
                // Only the clear row survived the search. Saying so beats a panel
                // that looks broken -- same rule as DriverAutocomplete's
                // "No driver in this pool matches".
                <li className="px-3 py-2 text-sm text-text-muted" role="presentation">
                  Nothing matches “{query.trim()}”
                </li>
              )}
              </ul>
          </div>
        )}
      </div>

      {hint && (
        <span id={hintId} className="text-xs text-text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}
