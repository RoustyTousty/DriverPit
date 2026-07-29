// Single source of truth for whether real ads are configured at all.
// Both must be set — a manually-placed display unit needs the account-level
// client ID and the specific ad unit's slot ID, and the slot only exists
// once the unit has been created in AdSense, which happens after approval.
export function getAdsenseClientId(): string | null {
  const value = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  return value && value.length > 0 ? value : null;
}

function getAdsenseSlotId(): string | null {
  const value = process.env.NEXT_PUBLIC_ADSENSE_SLOT;
  return value && value.length > 0 ? value : null;
}

export interface AdsenseUnit {
  clientId: string;
  slotId: string;
}

// THE "are real ads on?" check. Returns the pair or null rather than a boolean,
// because every caller that wants the answer also wants the two ids to render
// with -- a boolean left AdSlot re-deriving `clientId !== null && slotId !==
// null` inline for the narrowing, which is how the boolean version
// (isAdsenseConfigured) ended up with no callers at all (audit §2.1).
export function getAdsenseUnit(): AdsenseUnit | null {
  const clientId = getAdsenseClientId();
  const slotId = getAdsenseSlotId();
  return clientId !== null && slotId !== null ? { clientId, slotId } : null;
}

// Funding Choices (the CMP loader) is keyed by the bare publisher id —
// "pub-XXXXXXXXXXXXXXXX" — while the AdSense client id used elsewhere is
// "ca-pub-XXXXXXXXXXXXXXXX". Same account, different prefix convention.
export function getPublisherId(clientId: string): string {
  return clientId.replace(/^ca-/, "");
}
