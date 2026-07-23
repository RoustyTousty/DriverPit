"use server";

import type { DailyBoardState } from "../game/dailyBoard";
import { createSupabaseServerClient } from "../supabase/server";
import { dailyStateFor, dailySubmitGuessFor, migrateLocalDailyFor } from "./dailyProgress";

// The public daily persistence contract (CLAUDE.md schema: daily_state() /
// daily_submit_guess(driver_id)). These are the client-callable Server Actions
// that back the /daily game window (app/(game)/daily/DailyGame.tsx); they
// resolve the user from auth and delegate to the testable core in
// ./dailyProgress. Kept in their own "use server" module because such a module
// may only export async actions -- the core functions take a user id and must
// never be exposed as actions a client could call with someone else's id.

async function requireUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// Hydration: returns the authoritative board for the caller's current UTC day.
export async function dailyState(): Promise<DailyBoardState> {
  return dailyStateFor(await requireUserId());
}

// Appends one guess server-side (index resolved from the stored array, date
// from the DB clock) and returns the full authoritative board. On a completed
// or exhausted day it returns the current board unchanged rather than throwing.
export async function dailySubmitGuess(guessDriverId: number): Promise<DailyBoardState> {
  const { board } = await dailySubmitGuessFor(await requireUserId(), guessDriverId);
  return board;
}

// Pushes pre-existing local daily guesses (read client-side from the legacy
// localStorage blob) onto the account for today, only if the server has no row
// for the day. Server precedence is absolute and the call is idempotent -- see
// migrateLocalDailyFor. Ids only; tiles/target/completion are recomputed
// server-side, never trusted from the client.
export async function migrateLocalDaily(localGuessIds: number[]): Promise<{ migrated: boolean }> {
  return migrateLocalDailyFor(await requireUserId(), localGuessIds);
}
