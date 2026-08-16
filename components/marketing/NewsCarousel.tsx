"use client";

import { useEffect, useRef, useState } from "react";

import type { NewsItemWithImage } from "@/lib/news/fetchNews";
import { formatRelativeTime } from "@/lib/news/relativeTime";
import { usePrefersReducedMotion } from "@/lib/settings/usePrefersReducedMotion";

const AUTO_ADVANCE_MS = 6000;
const SWIPE_THRESHOLD_PX = 40;

// A plain icon button in the control row under the card, NOT an overlay on the
// photo. Two things were wrong with the previous treatment, and both were
// consequences of it living on top of the image: it was invisible until the
// pointer entered a 64px zone with nothing marking it (a control you have to
// discover by accident is a control most people never find), and even once
// revealed it sat over the picture, which is the one part of this card that is
// supposed to be uninterrupted. Down here it is simply always there, in the
// site's icon-button language verbatim -- the same rounded-lg, muted stroke,
// surface-2 hover and accent-only focus ring as TopBar's buttons and Modal's
// close -- so the carousel reads as part of the site rather than as a widget
// dropped onto it.
//
// Still hidden below `sm`: touch has no hover, the dots are already tappable,
// and the card itself takes a swipe (see handleTouchEnd).
function NavButton({ direction, onClick }: { direction: "prev" | "next"; onClick: () => void }) {
  const isPrev = direction === "prev";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isPrev ? "Previous story" : "Next story"}
      className="hidden h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition hover:border-text-muted/40 hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4" aria-hidden="true">
        <path d={isPrev ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}

// Auto-advances on a timer, paused while the card has hover or focus and
// disabled outright under the OS reduced-motion setting -- an auto-playing
// carousel is exactly what WCAG 2.2.2 flags, so it needs a real off switch, not
// just a slower default. Desktop navigates with the arrows and dots in the
// control row below the card; touch devices swipe the card itself instead (see
// handleTouchEnd).
export function NewsCarousel({ items: allItems }: { items: NewsItemWithImage[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Stories whose image URL looked fine server-side but doesn't actually load
  // -- a 404, a hotlink block, an expired CDN signature. Only the browser can
  // find that out, and the answer is the same as for an item that never had an
  // image: drop the story rather than frame an empty box. Keyed by link, so it
  // survives the list being re-sorted or re-fetched.
  const [brokenLinks, setBrokenLinks] = useState<ReadonlySet<string>>(() => new Set());
  const [loadedLink, setLoadedLink] = useState<string | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const items = allItems.filter((item) => !brokenLinks.has(item.link));
  // Clamped rather than reset: dropping a broken story shortens the list under
  // whatever the reader was looking at, and sending them back to the first
  // story because an unrelated image 404'd is a worse answer than showing them
  // the one that took its place.
  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1);
  const item = items[safeIndex];
  const autoAdvanceDisabled = prefersReducedMotion || items.length <= 1;

  // Depends on `safeIndex` (not just a bare interval) so any manual nav --
  // arrow, dot, swipe, or the auto-advance tick itself -- restarts the
  // countdown from zero instead of a click landing right before an
  // untimely jump.
  useEffect(() => {
    if (autoAdvanceDisabled || paused) return;
    // Inline rather than calling go(1): `go` is recreated every render, so
    // depending on it would restart this timer on every render instead of only
    // when the index actually moves. Same arithmetic, off the same clamped
    // index the effect already depends on.
    const timeout = setTimeout(() => setIndex((safeIndex + 1) % items.length), AUTO_ADVANCE_MS);
    return () => clearTimeout(timeout);
  }, [safeIndex, autoAdvanceDisabled, paused, items.length]);

  // Warms every story's image the first time the carousel comes into view, so
  // stepping between them is a cache hit rather than a network round trip.
  //
  // This is the whole fix for "the previous image stays up for a second or
  // two". The old code swapped `src` on ONE persistent <img>, and a browser
  // keeps showing the old bitmap until the new one has decoded -- so the wrong
  // story was on screen, captioned with the right story's title, for as long as
  // the fetch took. The keyed <img> below fixes the *correctness* of that (a
  // new element can't show the old picture); this fixes the *speed*, which is
  // what stops the honest version being a blank box instead.
  //
  // Behind an IntersectionObserver rather than firing on mount: the news
  // section sits below the game window, the ad slot and four marketing blocks,
  // so most visits never reach it and shouldn't pay five image downloads for
  // the privilege. Runs once and disconnects.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      for (const story of allItems) {
        const preload = new Image();
        preload.src = story.imageUrl;
      }
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [allItems]);

  // Steps from the CLAMPED index, not the raw one. They differ for exactly as
  // long as it takes a dropped story to shrink the list under a reader who was
  // past that point, and stepping from a stale index there lands somewhere
  // neither adjacent to nor explicable from what is on screen.
  function go(delta: number) {
    setIndex((safeIndex + delta + items.length) % items.length);
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

  // Every story's image failed to load. Rare, but the alternative is a card
  // with no picture and no caption in it, which is worse than the section
  // simply not being there.
  if (!item) return null;

  return (
    <div
      className="flex flex-col gap-3"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* No `relative` any more -- nothing is positioned over the card now that
          the arrows moved into the control row below it. */}
      <div
        ref={cardRef}
        className="group overflow-hidden rounded-lg border border-border bg-surface-2 transition hover:border-accent"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {/* Fixed 16:9 regardless of the source image's own dimensions --
              object-cover fills/crops to it either way -- so swapping between a
              small thumbnail and a large hero image never changes the card's
              height.

              The `max-h-64` that used to sit here was the bug: it beat the
              aspect ratio, so the real box was ~2.8:1 and every photo lost
              roughly half its height to the crop. Measured 2026-08-05, the
              feeds ship 1200x800 (3:2) and 1920x1080 (16:9) images, so 16:9 is
              the ratio that actually fits them -- exactly for Sky Sports, with
              a mild even trim top and bottom for the 3:2 three.

              No placeholder branch: getLatestNews only returns items that have
              an image (NewsItemWithImage), because an empty grey box with a
              caption under it reads as a broken load, not as a story. */}
          <div className="aspect-video w-full overflow-hidden bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element -- external CDN thumbnail, not worth a remotePatterns entry per source */}
            <img
              // KEYED BY STORY, and this is load-bearing rather than tidy.
              // Without it React reuses one <img> across slides and only
              // changes its `src`, which a browser answers by leaving the OLD
              // bitmap on screen until the new one decodes -- so the previous
              // story's photo sat under the next story's headline for a second
              // or two. A new element starts empty, so it can only ever show
              // its own picture or nothing.
              key={item.link}
              src={item.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setLoadedLink(item.link)}
              // The image URL survived server-side validation and still didn't
              // load. Drop the story, same as one that never had an image.
              onError={() =>
                setBrokenLinks((broken) => new Set(broken).add(item.link))
              }
              className={`h-full w-full object-cover transition duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${
                // Fades in over the card's own surface rather than popping.
                // Only reachable on a cache miss -- once the preload above has
                // run, `onLoad` fires in the same frame and this is never seen.
                loadedLink === item.link ? "opacity-100" : "opacity-0"
              }`}
            />
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
      </div>

      {/* One control row: arrows flanking the dots, all of it below the photo
          and none of it on top of it. The arrows are `hidden sm:flex`, so on
          mobile this collapses to exactly the centred dot row it was before --
          `justify-center` on the shared row keeps the dots centred in both
          cases rather than shifting when the arrows appear. */}
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-2">
          <NavButton direction="prev" onClick={() => go(-1)} />

          <div className="flex items-center">
            {items.map((story, i) => (
              <button
                key={story.link}
                type="button"
                aria-label={`Show story ${i + 1} of ${items.length}`}
                aria-current={i === safeIndex}
                onClick={() => setIndex(i)}
                className="flex items-center justify-center rounded-full p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span
                  className={`block h-1.5 rounded-full transition-all ${
                    i === safeIndex ? "w-5 bg-accent" : "w-1.5 bg-border"
                  }`}
                />
              </button>
            ))}
          </div>

          <NavButton direction="next" onClick={() => go(1)} />
        </div>
      )}
    </div>
  );
}
