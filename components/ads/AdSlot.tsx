"use client";

import { useEffect, useRef, useState } from "react";

import { getAdsenseUnit } from "@/components/ads/adsenseConfig";
import { useAdConsent } from "@/components/ads/useAdConsent";

// The banner under the game window. Only mounted when AdSense is configured at
// all -- AdSlotGate checks that first, so an unconfigured build has no slot on
// the page rather than an empty reserved box.
//
// From here the rule is: reserve the space while an ad could still turn up, and
// COLLAPSE the moment it's clear one won't. The fixed min-height exists to stop
// an arriving ad shifting the page, so it is worth keeping right up until
// "arriving" stops being possible -- and worth nothing after that, when it is
// just a grey rectangle where an ad isn't.
//
// Two ways it stops being possible, neither knowable up front:
//
//  - `requestFailed`: adsbygoogle.push threw, which is what an ad blocker (or a
//    script that never loaded) looks like from in here. Nothing was requested,
//    so nothing is coming.
//  - `unfilled`: the request went out and AdSense had nothing to serve, which
//    it reports by stamping data-ad-status="unfilled" onto the <ins>. Common on
//    a new or low-traffic site, and it leaves the element empty -- so without
//    this the slot sits at full height showing nothing at all.
//
// Both COLLAPSE rather than falling back to the placeholder, which is a change
// of mind from the original design: an "Advertisement" label over an empty box
// tells the player nothing they wanted to know, and the shift from removing it
// happens once, where the wasted space was permanent.
//
// Consent is deliberately NOT a collapse condition. useAdConsent starts at
// "denied" and only flips once Google's CMP replays or collects a decision, so
// "denied" is indistinguishable from "not resolved yet" -- collapsing on it
// would remove and then restore the slot on every visit by a consenting
// visitor, which is exactly the shift this component exists to avoid.
//
// ---------------------------------------------------------------------------
// THE PRESENTATION IS A POLICY REQUIREMENT, NOT A STYLE CHOICE (2026-08-12).
//
// AdSense rejected this site partly under "Site behaviour: navigation", whose
// text forbids ads a user could mistake for a menu, a navigation element or a
// download link, and ads "placed in positions intuitively intended for
// navigation". This component was written to fail that, in three ways at once,
// and they were invisible because no ad has ever actually rendered here -- the
// env vars are unset in production, so nobody has seen what this looks like
// filled.
//
//  1. It wore `rounded-lg border border-border bg-surface`, which is BYTE FOR
//     BYTE the game window's own container in app/[locale]/(game)/layout.tsx.
//     An ad in that box is not merely near the site's furniture, it is dressed
//     as it.
//  2. It sits directly under the game and directly above the marketing
//     teasers, which are chevron'd rows that read as navigation -- so a
//     site-coloured panel in between reads as one more of them.
//  3. Its non-serving state rendered the word "Advertisement" as the CONTENT of
//     that panel, so the empty state looked like a UI element rather than like
//     nothing.
//
// So: no border, no surface fill, no radius -- the ad brings its own colours
// and must be visibly a guest on the page rather than part of it. A hairline
// rule above it brackets it off from the game window (the marketing divider
// already closes it from below). And the label is the literal string
// "Advertisement", which is one of the two wordings AdSense accepts ("Sponsored
// Links" is the other); it sits ABOVE the unit, outside it, and renders only
// when a request has actually gone out, so it never labels an empty space.
export function AdSlot() {
  const unit = getAdsenseUnit();
  const consent = useAdConsent();
  const insRef = useRef<HTMLModElement>(null);
  const requested = useRef(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [unfilled, setUnfilled] = useState(false);

  const canServe = unit !== null && consent === "granted" && !requestFailed && !unfilled;

  useEffect(() => {
    if (!canServe || requested.current) return;
    requested.current = true;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      if (typeof window.adsbygoogle.push !== "function") throw new Error("adsbygoogle not ready");
      window.adsbygoogle.push({});
    } catch {
      // Ad library not loaded, blocked, or erroring — give the space back
      // instead of holding it for an ad that was never requested.
      setRequestFailed(true);
    }
  }, [canServe]);

  // Watches for the fill verdict. AdSense writes data-ad-status onto the <ins>
  // asynchronously, some time after the push above, so an observer is the only
  // way to hear about it -- there's no callback and nothing to await. Read once
  // up front too, since on a fast connection the attribute can already be set
  // by the time this effect runs.
  useEffect(() => {
    const ins = insRef.current;
    if (!ins) return;

    const readStatus = () => {
      if (ins.getAttribute("data-ad-status") === "unfilled") setUnfilled(true);
    };

    readStatus();
    const observer = new MutationObserver(readStatus);
    observer.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
    return () => observer.disconnect();
  }, [canServe]);

  if (requestFailed || unfilled) return null;

  return (
    // RESERVING and PRESENTING are two different jobs and they are on two
    // different elements, which is what the old single-box version got wrong.
    //
    // The outer element only reserves: a height, and nothing you can see. It
    // holds whether or not a request has gone out yet -- that is the whole
    // point of it, and it is why consent is not a collapse condition (see
    // above). Drawing the rule here instead would put a hairline over 100px of
    // empty space, a few pixels above the marketing divider, on every visit
    // where consent has not resolved.
    <div className="flex min-h-25 w-full max-w-160 flex-col">
      {canServe && unit ? (
        // The presentation, which exists only once an ad has actually been
        // asked for. `border-t` rather than a full border: a rule ABOVE the ad
        // brackets it off from the game window without drawing a box around it
        // -- a box is what made it look like one of the site's own panels --
        // and the marketing divider already closes the region from below.
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {/* Outside the <ins>, never inside it: AdSense injects into that
              element, so anything placed within is overwritten on fill. The
              wording is fixed -- "Advertisement" and "Sponsored Links" are the
              only two labels the policy accepts, and an invented one ("Ad",
              "Partner", a logo) is itself a violation. Muted and small so it
              reads as an annotation on the page rather than as a heading in the
              content, but real text rather than a visually-hidden one: the
              label's job is to tell a SIGHTED reader that what follows is not
              ours. */}
          <span className="font-mono text-[10px] tracking-wide text-text-muted uppercase">
            Advertisement
          </span>
          <ins
            ref={insRef}
            className="adsbygoogle block w-full"
            style={{ display: "block" }}
            data-ad-client={unit.clientId}
            data-ad-slot={unit.slotId}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        </div>
      ) : null}
    </div>
  );
}
