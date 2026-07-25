import type { DailyBoardState } from "@/lib/game/dailyBoard";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Board hydration in one warm PostgREST hop -- replaces the dailyState() Server
// Action (lib/db/dailyProgressActions.ts) and its serverless cold start, the
// whole fix for the slow board load (PLAN-fast-guesses.md Phase 1).
//
// daily_state() (drizzle/0030) returns the entire board as one jsonb object
// already shaped like DailyBoardState (camelCase keys, tiles recomputed
// server-side via compare_drivers), so -- unlike the columnar submit RPC --
// there's no row->camel mapping to do here. The target is present only once the
// day is complete; the RPC never puts it on the wire mid-round.
export async function fetchDailyState(): Promise<DailyBoardState> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("daily_state");
  if (error) throw error;
  return data as DailyBoardState;
}
