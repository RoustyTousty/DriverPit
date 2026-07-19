"use client";

import { useEffect, useRef, useState } from "react";

import { getAdsenseClientId, getAdsenseSlotId } from "@/components/ads/adsenseConfig";
import { useAdConsent } from "@/components/ads/useAdConsent";

// Fixed min-height reserves layout space so this never causes a layout
// shift, whether it's showing the placeholder or a live ad. Renders the
// real unit only once both the account is configured (env) and the
// visitor has actually granted ad consent — until then, always the
// placeholder. Falls back to the placeholder again if the ad request
// itself fails, rather than leaving an empty box.
export function AdSlot() {
  const clientId = getAdsenseClientId();
  const slotId = getAdsenseSlotId();
  const consent = useAdConsent();
  const requested = useRef(false);
  const [requestFailed, setRequestFailed] = useState(false);

  const canServe = clientId !== null && slotId !== null && consent === "granted" && !requestFailed;

  useEffect(() => {
    if (!canServe || requested.current) return;
    requested.current = true;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      if (typeof window.adsbygoogle.push !== "function") throw new Error("adsbygoogle not ready");
      window.adsbygoogle.push({});
    } catch {
      // Ad library not loaded/blocked/erroring — show the placeholder
      // instead of an empty reserved box.
      setRequestFailed(true);
    }
  }, [canServe]);

  return (
    <div className="flex min-h-[100px] w-full max-w-[520px] items-center justify-center rounded-lg border border-border bg-surface text-xs text-text-muted">
      {canServe ? (
        <ins
          className="adsbygoogle block w-full"
          style={{ display: "block" }}
          data-ad-client={clientId}
          data-ad-slot={slotId ?? undefined}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      ) : (
        "Advertisement"
      )}
    </div>
  );
}
