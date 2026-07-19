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
export function PoolSelect({ value, options, onChange, disabled = false }: PoolSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
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

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label="Driver pool"
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
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
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm transition ${
                  isSelected ? "bg-accent-weak text-accent" : "text-text hover:bg-surface-2"
                }`}
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
