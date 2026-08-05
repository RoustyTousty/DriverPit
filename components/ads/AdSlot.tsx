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
    <div className="flex min-h-[100px] w-full max-w-160 items-center justify-center rounded-lg border border-border bg-surface text-xs text-text-muted">
      {canServe && unit ? (
        <ins
          ref={insRef}
          className="adsbygoogle block w-full"
          style={{ display: "block" }}
          data-ad-client={unit.clientId}
          data-ad-slot={unit.slotId}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      ) : (
        "Advertisement"
      )}
    </div>
  );
}
