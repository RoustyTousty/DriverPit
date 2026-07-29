"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { PoolWindow } from "@/lib/game/poolWindow";

export interface PoolSelectOption {
  value: PoolWindow;
  tier: string;
  label: string;
  count: number;
}

interface PoolSelectProps {
  value: PoolWindow;
  options: PoolSelectOption[];
  onChange: (value: PoolWindow) => void;
  disabled?: boolean;
}

// A dropdown styled to match DriverAutocomplete's listbox (same surface,
// border, and accent-highlight treatment) rather than a native <select>,
// so the driver pool picker reads as part of the same design language as
// the driver search box directly below it.
//
// Not being a native <select> means every key a <select> handles has to be
// implemented here, or the control is openable and then unusable without a
// mouse -- which is what it was. It follows the ARIA 1.2 combobox pattern,
// the same one DriverAutocomplete implements: DOM focus never leaves the
// trigger, `activeIndex` is the keyboard cursor, and `aria-activedescendant`
// is what tells a screen reader which option that cursor is on. The options
// are deliberately NOT focusable (no tabIndex) -- moving real focus into the
// list is the other valid pattern, but half of each is what produces a
// listbox you can open and not use.
export function PoolSelect({ value, options, onChange, disabled = false }: PoolSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Only meaningful while open; every open() seeds it from the current value,
  // so arrowing starts where the player already is rather than at the top.
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Armed by a keyboard selection only; see the restore effect below.
  const restoreFocusRef = useRef(false);
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const current = options[selectedIndex] ?? options[0];
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    // Kept alongside the trigger's own Escape handling rather than replaced by
    // it: Safari doesn't focus a <button> when you click it, so a panel opened
    // by mouse there can be open with focus still on <body>, where a handler
    // bound to the trigger never fires.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Choosing a pool restarts the round, and the caller disables this button
  // while that runs -- but a browser blurs an element the moment it becomes
  // disabled, so focus drops to <body> and Tab restarts from the top of the
  // page. A keyboard user would lose their place every time they used this
  // control *successfully*. Take focus back when the button returns, unless
  // something else has claimed it in the meantime.
  useEffect(() => {
    if (disabled || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) triggerRef.current?.focus();
  }, [disabled]);

  function openAt(index: number) {
    setActiveIndex(index);
    setIsOpen(true);
  }

  function selectAt(index: number) {
    const option = options[index];
    setIsOpen(false);
    if (option) onChange(option.value);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (isOpen) setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        else openAt(selectedIndex);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (isOpen) setActiveIndex((i) => Math.max(i - 1, 0));
        else openAt(selectedIndex);
        break;
      case "Home":
        if (!isOpen) break;
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        if (!isOpen) break;
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        // preventDefault in both branches: without it the browser synthesizes a
        // click from Enter/Space on a <button>, which would re-toggle whatever
        // this just did (select-then-reopen, or open-then-close). It also stops
        // Space scrolling the page.
        event.preventDefault();
        if (isOpen) {
          restoreFocusRef.current = true;
          selectAt(activeIndex);
        } else {
          openAt(selectedIndex);
        }
        break;
      case "Escape":
        if (isOpen) setIsOpen(false);
        break;
      case "Tab":
        // Focus is leaving -- let it, but don't leave the panel orphaned open
        // behind it.
        setIsOpen(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? optionId(activeIndex) : undefined}
        aria-label="Driver pool"
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openAt(selectedIndex))}
        onKeyDown={handleKeyDown}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-left text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent disabled:opacity-50"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-semibold">{current.tier}</span>
          <span className="truncate text-xs text-text-muted">{current.label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-text-muted">{current.count} drivers</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className={`h-4 w-4 text-text-muted transition-transform duration-200 motion-reduce:transition-none ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Driver pool"
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                onClick={() => selectAt(index)}
                // The accent ring is the keyboard cursor, and it reads as the
                // same thing the site's `focus:ring-2 focus:ring-accent` does
                // everywhere else -- which is accurate, since this row is where
                // focus effectively is. It's `ring-inset` because an outset ring
                // would be clipped by the panel's `overflow-hidden` on the first
                // and last rows. Selection keeps the accent fill it always had,
                // so the two states stay legible when they land on one row.
                className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm transition ${
                  isSelected
                    ? "bg-accent-weak text-accent"
                    : isActive
                      ? "bg-surface-2 text-text"
                      : "text-text hover:bg-surface-2"
                } ${isActive ? "ring-2 ring-inset ring-accent" : ""}`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="font-semibold">{option.tier}</span>
                  <span className={isSelected ? "text-accent/70" : "text-text-muted"}>{option.label}</span>
                </span>
                <span className={isSelected ? "text-accent/70" : "text-text-muted"}>{option.count}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
