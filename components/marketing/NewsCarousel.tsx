"use client";

import { useEffect, useState } from "react";

import type { NewsItem } from "@/lib/news/fetchNews";
import { formatRelativeTime } from "@/lib/news/relativeTime";
import { useSettings } from "@/lib/settings/useSettings";

const AUTO_ADVANCE_MS = 6000;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    function handleChange() {
      setReduced(query.matches);
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

function ChevronButton({ direction, onClick }: { direction: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "Previous story" : "Next story"}
      className={`absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg/80 text-text backdrop-blur transition hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        direction === "prev" ? "left-2" : "right-2"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4" aria-hidden="true">
        <path d={direction === "prev" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}

// Auto-advances on a timer, paused while the card has hover or focus and
// disabled outright under either reduced-motion signal (the in-app setting
// or the OS one) -- an auto-playing carousel is exactly what WCAG 2.2.2
// flags, so it needs a real off switch, not just a slower default. Arrows
// and larger-hit-area dots sit alongside it since the dots alone turned out
// too small to reliably tap.
export function NewsCarousel({ items }: { items: NewsItem[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const { reducedMotion } = useSettings();
  const prefersReducedMotion = usePrefersReducedMotion();
  const autoAdvanceDisabled = reducedMotion || prefersReducedMotion || items.length <= 1;

  // Depends on `index` (not just a bare interval) so any manual nav --
  // arrow, dot, or the auto-advance tick itself -- restarts the countdown
  // from zero instead of a click landing right before an untimely jump.
  useEffect(() => {
    if (autoAdvanceDisabled || paused) return;
    const timeout = setTimeout(() => {
      setIndex((i) => (i + 1) % items.length);
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timeout);
  }, [index, autoAdvanceDisabled, paused, items.length]);

  function go(delta: number) {
    setIndex((i) => (i + delta + items.length) % items.length);
  }

  const item = items[index];

  return (
    <div
      className="flex flex-col gap-3"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="group relative overflow-hidden rounded-lg border border-border bg-surface-2 transition hover:border-accent/40">
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <div className="aspect-video w-full overflow-hidden bg-surface">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- external CDN thumbnail, not worth a remotePatterns entry per source
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-text-muted">DriverPit</div>
            )}
          </div>
          <div className="p-4">
            <p className="font-semibold text-text">{item.title}</p>
            <p className="mt-1 text-xs text-text-muted">
              {item.source} · {formatRelativeTime(item.publishedAt)}
            </p>
          </div>
        </a>

        {items.length > 1 && (
          <>
            <ChevronButton direction="prev" onClick={() => go(-1)} />
            <ChevronButton direction="next" onClick={() => go(1)} />
          </>
        )}
      </div>

      {items.length > 1 && (
        <div className="flex items-center justify-center">
          {items.map((story, i) => (
            <button
              key={story.link}
              type="button"
              aria-label={`Show story ${i + 1} of ${items.length}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className="flex items-center justify-center rounded-full p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span
                className={`block h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-accent" : "w-1.5 bg-border"
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
