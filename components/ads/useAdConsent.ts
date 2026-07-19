"use client";

import { useEffect, useState } from "react";

type ConsentState = "denied" | "granted";

interface ConsentParams {
  [key: string]: unknown;
}

const AD_CONSENT_KEYS = ["ad_storage", "ad_user_data", "ad_personalization"] as const;
type AdConsentKey = (typeof AD_CONSENT_KEYS)[number];

// Belt-and-suspenders on top of Consent Mode v2: the ad tag itself already
// respects the live consent state, but AdSlot uses this to decide whether
// to render the real unit at all, so we never even issue an ad request pre
// consent. Works by intercepting dataLayer.push, since every gtag() call —
// including the consent updates Google's CMP issues on the visitor's
// behalf — is just a push of an arguments-like object onto that array.
// Avoids depending on any of the CMP's own (less stable) internal callback
// APIs, and merges signals incrementally in case the CMP updates them
// across more than one call rather than all at once.
export function useAdConsent(): ConsentState {
  const [consent, setConsent] = useState<ConsentState>("denied");

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.dataLayer = window.dataLayer || [];
    const originalPush = window.dataLayer.push.bind(window.dataLayer);
    const known: Partial<Record<AdConsentKey, string>> = {};

    function handleConsentUpdate(params: ConsentParams) {
      for (const key of AD_CONSENT_KEYS) {
        if (typeof params[key] === "string") known[key] = params[key] as string;
      }
      const granted = AD_CONSENT_KEYS.every((key) => known[key] === "granted");
      setConsent(granted ? "granted" : "denied");
    }

    window.dataLayer.push = ((...args: unknown[]) => {
      for (const entry of args) {
        if (entry == null || typeof entry !== "object") continue;
        const iterator = (entry as Partial<Iterable<unknown>>)[Symbol.iterator];
        if (typeof iterator !== "function") continue;

        const [command, action, params] = Array.from(entry as Iterable<unknown>);
        if (command === "consent" && action === "update" && params && typeof params === "object") {
          handleConsentUpdate(params as ConsentParams);
        }
      }
      return originalPush(...args);
    }) as typeof window.dataLayer.push;

    return () => {
      window.dataLayer.push = originalPush;
    };
  }, []);

  return consent;
}
