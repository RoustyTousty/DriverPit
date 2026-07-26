import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// The clock every duel countdown corrects against -- deliberately the
// DATABASE's now(), not the Next.js server's Date.now(). Every timestamp a
// client ever counts down to (duel_rounds.started_at/ends_at,
// intermission_ends_at) is stamped by Postgres, and in any real deployment the
// app server and the database are two different machines whose clocks are never
// guaranteed to agree (a ~1.4s gap was measured between a local dev server and
// this project's Supabase instance -- enough to reject perfectly legitimate
// first guesses as "round not started"). Measuring the offset against the same
// clock that does the stamping removes that whole error class;
// duel_submit_guess's 2s grace (drizzle/0025) stays as a safety net for the
// residual round-trip asymmetry.
//
// One warm PostgREST hop (public.duel_server_time, drizzle/0034) rather than
// the Server Action this used to be. Speed matters twice over here: the caller
// estimates the offset as serverNow - (t0 + t1) / 2, which assumes the round
// trip is roughly symmetrical, so a short trip is both a smaller and a more
// stable error term than a serverless invocation's.
export async function getServerTime(): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("duel_server_time");
  if (error) throw error;
  return new Date(data as string).toISOString();
}
