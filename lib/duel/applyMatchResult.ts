import { eq } from "drizzle-orm";

import { db } from "../db";
import { duelMatches, userStats } from "../db/schema";
import { updateDuelRatings } from "../game/duelRating";

// THE single writer of duel_rating / duel_wins / duel_losses. Both callers are
// in lib/duel/actions.ts -- applyMatchRatings (normal finish) and forfeitMatch
// (forfeit / disconnect / sign-out) -- and there is no other writer anywhere in
// the repo. That is what makes the unranked short-circuit below one line in one
// place rather than a rule every duel code path has to remember.
//
// Kept in a plain (non-"use server") module for the same reason
// recordDailyResultForUser is: every export of a "use server" file is an HTTP
// endpoint whose action id ships in the client bundle, and this function takes
// `winnerId` -- an outcome -- as a parameter. Exported from actions.ts it would
// be "tell the server who won this match, and which two players to pay",
// callable from a devtools console. The only ways in are the two cookie-resolved
// actions, which read all four arguments off a match row they have already
// authorized the caller against.
//
// EXACTLY ONCE PER MATCH, and duel_matches.rating_delta_a is what enforces it.
// This used to lean on the caller for that: it ran inside the same Server
// Action as duel_close_round, so that RPC's own row lock -- which hands
// `advanced: true` to exactly one racing caller -- meant this could only be
// reached once. Closing a round is now a separate client-side RPC, so that
// coupling is gone and the guarantee has to live here. Both players' clients
// observe the same finish and both call in; a forfeit can land on top of a
// finish; a reconnecting client can arrive late.
//
// The null check alone would be a check-then-act race (two callers both read
// null, both apply, ratings move twice). Taking the match row FOR UPDATE first
// serializes them, so the second caller reads the row the first one wrote and
// returns those deltas instead of applying its own.
export async function applyMatchResult(
  matchId: number,
  playerA: string,
  playerB: string,
  winnerId: string | null,
): Promise<{ ratingDeltaA: number; ratingDeltaB: number }> {
  return db.transaction(async (tx) => {
    const [match] = await tx.select().from(duelMatches).where(eq(duelMatches.id, matchId)).for("update");
    if (!match) return { ratingDeltaA: 0, ratingDeltaB: 0 };

    // Unranked (custom lobby): no Elo, no W/L, no rating_delta. Read off the
    // row -- never accepted as a parameter, per CLAUDE.md's "Server Actions
    // never accept an outcome": the client does not get to say which matches
    // count. Placed AFTER the lock and BEFORE the user_stats reads, so the
    // unranked branch writes nothing at all and is trivially re-entrant.
    //
    // drizzle/0054's duel_matches_unranked_no_rating_check is the half of this
    // that survives someone reordering the function: it makes an unranked row
    // carrying a rating delta unrepresentable, so a regression aborts the
    // transaction instead of quietly feeding friendly games to the leaderboard.
    if (!match.ranked) return { ratingDeltaA: 0, ratingDeltaB: 0 };

    // Already settled -- report what was actually written, don't re-apply.
    // Checked on A alone because both are written in the one statement below.
    if (match.ratingDeltaA !== null) {
      return { ratingDeltaA: match.ratingDeltaA, ratingDeltaB: match.ratingDeltaB ?? 0 };
    }

    const [statsA] = await tx.select().from(userStats).where(eq(userStats.userId, playerA));
    const [statsB] = await tx.select().from(userStats).where(eq(userStats.userId, playerB));
    if (!statsA || !statsB) return { ratingDeltaA: 0, ratingDeltaB: 0 };

    const outcome = winnerId === null ? "draw" : winnerId === playerA ? "a" : "b";
    const { ratingA, ratingB } = updateDuelRatings(statsA.duelRating, statsB.duelRating, outcome);
    const ratingDeltaA = ratingA - statsA.duelRating;
    const ratingDeltaB = ratingB - statsB.duelRating;

    await tx
      .update(userStats)
      .set({
        duelRating: ratingA,
        duelWins: statsA.duelWins + (outcome === "a" ? 1 : 0),
        duelLosses: statsA.duelLosses + (outcome === "b" ? 1 : 0),
      })
      .where(eq(userStats.userId, playerA));

    await tx
      .update(userStats)
      .set({
        duelRating: ratingB,
        duelWins: statsB.duelWins + (outcome === "b" ? 1 : 0),
        duelLosses: statsB.duelLosses + (outcome === "a" ? 1 : 0),
      })
      .where(eq(userStats.userId, playerB));

    await tx.update(duelMatches).set({ ratingDeltaA, ratingDeltaB }).where(eq(duelMatches.id, matchId));

    return { ratingDeltaA, ratingDeltaB };
  });
}
