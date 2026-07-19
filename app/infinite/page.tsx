import { listAllDriverOptionsWithActivity } from "@/lib/db/queries";

import { InfiniteGame } from "./InfiniteGame";

// Depends on live DB data (the full driver roster) and per-request round
// state, so it must never be statically prerendered at build time.
export const dynamic = "force-dynamic";

export default async function InfinitePage() {
  const allDrivers = await listAllDriverOptionsWithActivity();

  return <InfiniteGame allDrivers={allDrivers} />;
}
