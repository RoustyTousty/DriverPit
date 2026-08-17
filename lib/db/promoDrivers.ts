import { isNotNull } from "drizzle-orm";

import type { PromoDriver } from "../promo/select";
import { db } from "./index";
import { drivers } from "./schema";

/**
 * Every driver, with every column `compare()` needs — the read behind the promo
 * carousel (`app/[locale]/promo`, `scripts/promo.ts`).
 *
 * It lives in its own file rather than in queries.ts because it is the only
 * roster read on the site that is not serving a player: the promo routes are
 * `noindex`, absent from the sitemap and rendered by a screenshot script. Kept
 * separate, the whole feature is one directory plus this file to delete.
 *
 * It is deliberately NOT one of the helpers queries.ts's closing comment forbids
 * bringing back. Those were target *pickers* — `getDailyDriverId` above all,
 * whose reproducibility was the leak drizzle/0038 closed. This selects no
 * target, takes no date, and every driver it returns ends up printed on a PNG.
 *
 * `f1db_id IS NOT NULL` because the slug is how a promo URL names a driver, the
 * same reasoning as the driver-page queries: the column is nullable for rows
 * predating drizzle/0043, and a driver with no slug is one the `?driver=` param
 * cannot spell. The seed adopts those rows on its next run.
 */
export async function listPromoDrivers(): Promise<PromoDriver[]> {
  const rows = await db
    .select({
      id: drivers.id,
      slug: drivers.f1dbId,
      fullName: drivers.fullName,
      driverCode: drivers.driverCode,
      nationality: drivers.nationality,
      lastTeam: drivers.lastTeam,
      previousTeams: drivers.previousTeams,
      dateOfBirth: drivers.dateOfBirth,
      dateOfDeath: drivers.dateOfDeath,
      debutYear: drivers.debutYear,
      careerWins: drivers.careerWins,
      lastActiveYear: drivers.lastActiveYear,
      championshipWins: drivers.championshipWins,
      podiums: drivers.podiums,
      polePositions: drivers.polePositions,
    })
    .from(drivers)
    .where(isNotNull(drivers.f1dbId))
    .orderBy(drivers.fullName);

  return rows.map((row) => ({
    ...row,
    // The slug is proven non-null by the WHERE above; the select type cannot
    // express that.
    slug: row.slug as string,
    // Matching SQL compare_drivers, which coalesces a null last_team to ''.
    // compareTeam() reads "" as a miss rather than as something two teamless
    // drivers can share.
    team: row.lastTeam ?? "",
  }));
}
