"use client";

import { useId, useMemo, useState } from "react";

import { fuzzyFilter } from "@/lib/game/fuzzyMatch";

export interface DriverOption {
  id: number;
  fullName: string;
}

interface DriverAutocompleteProps {
  drivers: DriverOption[];
  onSelect: (driver: DriverOption) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function DriverAutocomplete({
  drivers,
  onSelect,
  disabled = false,
  placeholder = "Guess a driver…",
}: DriverAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();

  const matches = useMemo(
    () => fuzzyFilter(query, drivers, (d) => d.fullName, 8),
    [query, drivers],
  );

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
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
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

      {isOpen && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
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
              className={`cursor-pointer px-4 py-3 text-base transition ${
                index === activeIndex ? "bg-accent-weak text-accent" : "text-text"
              }`}
            >
              {driver.fullName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
