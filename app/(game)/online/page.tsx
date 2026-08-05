import { DuelRoot } from "@/components/duel/DuelRoot";
import { listAllDriverOptionsWithActivity } from "@/lib/db/queries";
import { DAILY_POOL_WINDOW, poolCutoffYear } from "@/lib/game/poolWindow";

// The Online tab's landing (mode select -> lobby -> live match -> results):
// Duel, Custom, and Knockout still to come (see CLAUDE.md). Not per-user, so
// ISR rather than force-dynamic -- see app/infinite/page.tsx for why.
//
// Fetches the FULL roster, the same query /infinite already serves under the
// same 1-hour ISR, rather than listPoolDriverOptions(DAILY_POOL_WINDOW). A
// custom lobby's filter panel needs every driver to compute its cascading
// counts, and a custom match's autocomplete needs THAT match's filtered set
// rather than the 20-year pool. Costs roughly 250 rows -> 800 on a cached
// route.
//
// Both lists are then derived client-side from pure predicates already in the
// repo (poolCutoffYear here, matchesDriverFilter in the lobby), so there is one
// source and no "which list am I on" bug.
export const revalidate = 3600;

export default async function OnlinePage() {
  const referenceYear = new Date().getUTCFullYear();
  const allDrivers = await listAllDriverOptionsWithActivity();

  // A ranked duel still plays out of DAILY_POOL_WINDOW, so its autocomplete
  // gets exactly the list it always did -- narrowed from the full roster here
  // instead of by a second query.
  const cutoff = poolCutoffYear(DAILY_POOL_WINDOW, referenceYear);
  const eligibleDrivers = allDrivers
    .filter((driver) => cutoff === null || driver.lastActiveYear >= cutoff)
    .map((driver) => ({
      id: driver.id,
      fullName: driver.fullName,
      nationality: driver.nationality,
    }));

  return (
    <DuelRoot eligibleDrivers={eligibleDrivers} allDrivers={allDrivers} referenceYear={referenceYear} />
  );
}
