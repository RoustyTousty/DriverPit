import { listAllDriverOptionsWithActivity } from "@/lib/db/queries";

import { InfiniteGame } from "./InfiniteGame";

// The roster itself isn't per-user or per-request -- only the weekly
// Jolpica cron changes it (see CLAUDE.md) -- and per-request round state
// lives in server actions / a session cookie, not this page's data. An
// hour of ISR staleness here is unnoticeable and turns every mode switch
// back into a cache hit instead of a fresh ~800-row query.
export const revalidate = 3600;

export default async function InfinitePage() {
  const allDrivers = await listAllDriverOptionsWithActivity();

  return <InfiniteGame allDrivers={allDrivers} />;
}
