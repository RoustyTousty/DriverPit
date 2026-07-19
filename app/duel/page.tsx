import { DuelRoot } from "@/components/duel/DuelRoot";
import { listPoolDriverOptions } from "@/lib/db/queries";
import { DAILY_POOL_WINDOW } from "@/lib/game/poolWindow";

// Duel always plays out of the 10-year pool (see CLAUDE.md) -- fetched
// server-side up front, same pattern as app/daily/page.tsx, so the guess
// input has its driver list the moment a match starts. Not per-user, so
// ISR instead of force-dynamic -- see app/infinite/page.tsx for why.
export const revalidate = 3600;

export default async function DuelPage() {
  const eligibleDrivers = await listPoolDriverOptions(DAILY_POOL_WINDOW, new Date().getUTCFullYear());

  return <DuelRoot eligibleDrivers={eligibleDrivers} />;
}
