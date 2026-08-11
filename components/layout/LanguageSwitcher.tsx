"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { Link, usePathname } from "@/lib/i18n/navigation";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/locales";

// The human half of locale discovery, in Settings → General.
//
// A DROPDOWN, matching the rest of the site's controls -- but built here rather
// than reusing SearchableSelect, which is shaped for the driver filter's 40-odd
// nationalities and 170-odd constructors: it carries a search box and a required
// per-option `count`, and six languages need neither. What it shares is the
// trigger's look, so a control still looks like a control.
//
// It is NOT a native <select>. That renders in the OS's own chrome, which this
// UI already rejected once for exactly this reason (CLAUDE.md, "Infinite's
// driver filter").
//
// THE OPTIONS STAY REAL ANCHORS. A <select> + onChange would work, but a link
// costs nothing extra and keeps two things: middle-click / open-in-new-tab
// behave as a reader expects, and each option carries `hreflang`, which is the
// machine-readable statement of what it points at. Crawlability was already
// given up when this moved out of the footer -- discovery is the hreflang set on
// every page plus one <loc> per locale in the sitemap, neither of which depends
// on this component.
export function LanguageSwitcher() {
  const t = useTranslations("nav.language");
  const active = useLocale() as Locale;
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // Close on a click anywhere outside. `mousedown` rather than `click` so a
  // press that starts outside dismisses before the release lands somewhere
  // unexpected.
  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Escape" || !isOpen) return;
    // STOPPING PROPAGATION IS LOAD-BEARING: this panel lives inside a Modal that
    // closes from a `document` keydown listener, so without this one Escape
    // would shut the dropdown and the whole settings dialog together. Same trap,
    // same fix, as SearchableSelect.
    event.stopPropagation();
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-text">{t("label")}</p>
      <p className="text-xs text-text-muted">{t("description")}</p>

      <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-label={t("choose")}
          // Input-shaped, so it takes the input focus treatment: the 1px border
          // turns accent and the ring sits directly outside it at 1px, totalling
          // the same 2px a button's `ring-2` gives. See CLAUDE.md's focus rule.
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text transition hover:bg-surface-2/80 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        >
          <span>{LOCALE_NAMES[active]}</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 motion-reduce:transition-none ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {isOpen && (
          <ul
            id={listId}
            className="absolute z-10 mt-1 flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg"
          >
            {LOCALES.map((locale) => {
              const current = locale === active;
              return (
                <li key={locale}>
                  <Link
                    href={pathname}
                    locale={locale}
                    // The BCP-47 tag, which is what a consumer reads. Same
                    // rule as the hreflang set.
                    hrefLang={locale}
                    aria-current={current ? "true" : undefined}
                    onClick={() => setIsOpen(false)}
                    className={`block px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      current
                        ? "bg-accent-weak font-semibold text-accent"
                        : "text-text-muted hover:bg-surface hover:text-text"
                    }`}
                  >
                    {LOCALE_NAMES[locale]}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
