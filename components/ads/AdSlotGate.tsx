"use client";

import { useActiveMatch } from "@/components/duel/ActiveMatchContext";

import { AdSlot } from "./AdSlot";
import { getAdsenseUnit } from "./adsenseConfig";

// Decides whether the ad slot is on screen at all. Two reasons it isn't, and
// they are the same kind of question, which is why they sit together here
// rather than one of them being buried inside AdSlot:
//
//  - A live match owns the screen (see "Site architecture" in CLAUDE.md).
//  - AdSense isn't configured, so there is no ad to show and there won't be on
//    this build. Reserving 100px of the page for a grey box reading
//    "Advertisement" is just a hole in the layout: the reservation exists to
//    stop an arriving ad shifting the page, and nothing is arriving.
//
// Checked HERE rather than inside AdSlot so an unconfigured build mounts none
// of it -- no useAdConsent, and so no patching of window.dataLayer.push for a
// consent signal nothing is waiting on.
//
// NEXT_PUBLIC_* values are inlined at build time, so this is a constant per
// deployment: there is no flash of a slot that then vanishes, and no server/
// client mismatch. Setting both env vars brings the slot back with no other
// change.
export function AdSlotGate() {
  const { active } = useActiveMatch();
  if (active || getAdsenseUnit() === null) return null;
  return <AdSlot />;
}
