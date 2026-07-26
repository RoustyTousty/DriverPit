"use client";

import { useEffect, useRef, useState } from "react";

import type { NewsItem } from "@/lib/news/fetchNews";
import { formatRelativeTime } from "@/lib/news/relativeTime";
import { usePrefersReducedMotion } from "@/lib/settings/usePrefersReducedMotion";

const AUTO_ADVANCE_MS = 6000;
const SWIPE_THRESHOLD_PX = 40;

// A generous invisible hover target at each edge, holding one small icon
// button -- hidden below `sm` entirely, since there's no hover state on touch
// to reveal it and a small floating button is hard to land a tap on; mobile
// gets a swipe gesture on the card itself instead (see NewsCarousel).
//
// The hover zone is a hit area ONLY: no fill, no gradient. It used to wash an
// accent gradient across 80px of the card from each side, which broke the
// orange discipline the design system is built on (accent = active tab,
// primary button, logo mark, correct tile -- not a decorative glow) and read as
// a different site's component. The button carries its own surface + hairline
// border instead, so it stays legible over any photo without tinting the card.
// Its styling is the site's icon-button language verbatim (TopBar's
// settings/leaderboard buttons, Modal's close button): rounded-lg, muted
// stroke icon, background-darkens hover, accent only on the focus ring.
function EdgeNav({ direction, onClick }: { direction: "prev" | "next"; onClick: () => void }) {
  const isPrev = direction === "prev";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isPrev ? "Previous story" : "Next story"}
      className={`group/nav absolute top-0 z-10 hidden h-full w-16 items-center opacity-0 transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none motion-reduce:transition-none sm:flex ${
        isPrev ? "left-0 justify-start pl-2" : "right-0 justify-end pr-2"
      }`}
    >
      {/* The focus ring lives here, driven by the BUTTON's focus via the named
          group -- focus lands on the 64px hit area, so a ring on that would
          outline an invisible box (and a focus-visible: rule on this span
          would never fire at all, since the span is never itself focused). */}
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface/90 text-text-muted backdrop-blur transition group-hover/nav:bg-surface-2 group-hover/nav:text-text group-focus-visible/nav:ring-2 group-focus-visible/nav:ring-accent">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4" aria-hidden="true">
          <path d={isPrev ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
        </svg>
      </span>
    </button>
  );
}

// Auto-advances on a timer, paused while the card has hover or focus and
// disabled outright under the OS reduced-motion setting -- an auto-playing
// carousel is exactly what WCAG 2.2.2 flags, so it needs a real off switch, not
// just a slower default. Edge hover zones and larger-hit-area dots handle
// desktop nav; touch devices swipe the card itself instead (see
// handleTouchEnd).
export function NewsCarousel({ items }: { items: NewsItem[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const autoAdvanceDisabled = prefersReducedMotion || items.length <= 1;
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // Depends on `index` (not just a bare interval) so any manual nav --
  // arrow, dot, swipe, or the auto-advance tick itself -- restarts the
  // countdown from zero instead of a click landing right before an
  // untimely jump.
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

  function handleTouchStart(event: React.TouchEvent) {
    if (items.length <= 1) return;
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  // A horizontal drag past the threshold switches stories instead of
  // following the card's link -- preventDefault on touchend suppresses the
  // emulated click that would otherwise fire right after. A short tap (or a
  // predominantly vertical drag, i.e. the page scrolling) falls through and
  // the link click behaves normally.
  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || items.length <= 1) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY)) return;

    event.preventDefault();
    go(deltaX < 0 ? 1 : -1);
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
      <div
        className="group relative overflow-hidden rounded-lg border border-border bg-surface-2 transition hover:border-accent/40"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {/* Fixed aspect ratio regardless of the source image's own
              dimensions -- object-cover fills/crops to it either way -- so
              swapping between a small thumbnail and a large hero image
              never changes the card's height. */}
          <div className="aspect-video max-h-64 w-full overflow-hidden bg-surface">
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
            {/* Always exactly one line, truncated with an ellipsis -- a
                title that wrapped to 2-3 lines changed the card's height on
                every auto-advance, which read as a jerk. */}
            <p className="truncate font-semibold text-text">{item.title}</p>
            <p className="mt-1 text-xs text-text-muted">
              {item.source} · {formatRelativeTime(item.publishedAt)}
            </p>
          </div>
        </a>

        {items.length > 1 && (
          <>
            <EdgeNav direction="prev" onClick={() => go(-1)} />
            <EdgeNav direction="next" onClick={() => go(1)} />
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
