import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordDailyResultForUser } from "../stats/recordDailyResult";
import { db } from "./index";
import { dailyProgress, dailyResults, duelMatches, profiles, userStats } from "./schema";

// Regression coverage for audit 2026-07-27 §3.2 / §3.3 / §3.7 -- "stop trusting
// client-supplied outcomes in Server Actions". Three instances of one mistake,
// so what has to be proven is one property three ways:
//
//   the server records what IT observed, and a client cannot substitute a
//   different answer -- not through the action's parameters, not by writing the
//   table the action reads back.
//
// Deliberately at this level rather than against the Server Actions themselves:
// a "use server" export resolves its caller through next/headers, which has no
// meaning outside a request. The rules worth pinning all live below that --
// recordDailyResultForUser's derivation, duel_heartbeat's write scope, and the
// table grants both of them stand on.
//
// Needs a real Postgres + Supabase project. Opt in, same convention as the other
// DB suites (never against production):
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/serverAuthoritativeWrites.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

interface Guest {
  id: string;
  // The client a real browser would hold: public anon key, signed in
  // anonymously. The strongest position an attacker can reach, so a rejection
  // here means the `anon` role (weaker) is closed too.
  client: SupabaseClient;
}

async function createGuest(): Promise<Guest> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
  return { id: data.user.id, client };
}

// The database's own UTC day -- the same expression daily_submit_guess and
// recordDailyResultForUser resolve. Never the test runner's clock, which is the
// split-brain this fix exists to remove (§3.10).
async function dbToday(): Promise<string> {
  const rows = await db.execute<{ d: string }>(sql`SELECT (now() AT TIME ZONE 'UTC')::date::text AS d`);
  return rows[0].d;
}

describe.skipIf(!RUN)("server-authoritative writes (integration)", () => {
  const guests: Guest[] = [];
  const matchIds: number[] = [];
  let driverIds: number[] = [];
  let today: string;

  beforeAll(async () => {
    today = await dbToday();
    const rows = await db.execute<{ id: number }>(sql`SELECT id FROM public.drivers ORDER BY id LIMIT 3`);
    driverIds = rows.map((r) => r.id);
    if (driverIds.length < 3) throw new Error("fixture needs at least 3 drivers seeded");
  });

  afterAll(async () => {
    const ids = guests.map((g) => g.id);
    if (matchIds.length > 0) await db.delete(duelMatches).where(inArray(duelMatches.id, matchIds));
    if (ids.length > 0) {
      await db.delete(dailyResults).where(inArray(dailyResults.userId, ids));
      await db.delete(dailyProgress).where(inArray(dailyProgress.userId, ids));
    }
    // The guest auth users and their profiles/user_stats rows are left behind
    // on purpose -- the anon key can't delete auth.users, and they're
    // indistinguishable from any other guest who visited once.
  });

  async function newGuest(): Promise<Guest> {
    const guest = await createGuest();
    guests.push(guest);
    return guest;
  }

  // --- §3.2: the daily result is read, never accepted --------------------

  describe("recordDailyResultForUser derives the outcome from daily_progress", () => {
    it("records exactly what the board says -- a win in 3", async () => {
      const guest = await newGuest();
      await db.insert(dailyProgress).values({
        userId: guest.id,
        date: today,
        guesses: driverIds,
        completed: true,
        won: true,
      });

      const result = await recordDailyResultForUser(guest.id);
      expect(result).toEqual({ ok: true, recorded: true });

      const [recorded] = await db.select().from(dailyResults).where(eq(dailyResults.userId, guest.id));
      expect(recorded.won).toBe(true);
      expect(recorded.guessCount).toBe(3);
      // Resolved by the DATABASE clock, matching the row it describes.
      expect(recorded.date).toBe(today);

      const [stats] = await db.select().from(userStats).where(eq(userStats.userId, guest.id));
      expect(stats.gamesPlayed).toBe(1);
      expect(stats.wins).toBe(1);
      expect(stats.currentStreak).toBe(1);
      expect(stats.guessDistribution[2]).toBe(1);
      expect(stats.lastDailyDate).toBe(today);
    });

    it("is a no-op on a second call -- the daily_results guard still holds", async () => {
      const guest = guests[guests.length - 1];
      const second = await recordDailyResultForUser(guest.id);
      expect(second).toEqual({ ok: true, recorded: false });

      const [stats] = await db.select().from(userStats).where(eq(userStats.userId, guest.id));
      expect(stats.gamesPlayed).toBe(1);
      expect(stats.wins).toBe(1);
    });

    // The forgery §3.2 describes, at its root: there is no argument to pass, so
    // the only question left is whether an UNFINISHED day can be recorded.
    it("refuses a day that isn't complete, and writes nothing", async () => {
      const guest = await newGuest();
      await db.insert(dailyProgress).values({
        userId: guest.id,
        date: today,
        guesses: [driverIds[0]],
        completed: false,
      });

      expect(await recordDailyResultForUser(guest.id)).toEqual({ ok: false, reason: "no-completed-day" });

      const rows = await db.select().from(dailyResults).where(eq(dailyResults.userId, guest.id));
      expect(rows).toHaveLength(0);
      const [stats] = await db.select().from(userStats).where(eq(userStats.userId, guest.id));
      expect(stats.gamesPlayed).toBe(0);
      expect(stats.lastDailyDate).toBeNull();
    });

    it("refuses when there's no board at all", async () => {
      const guest = await newGuest();
      expect(await recordDailyResultForUser(guest.id)).toEqual({ ok: false, reason: "no-completed-day" });
      const [stats] = await db.select().from(userStats).where(eq(userStats.userId, guest.id));
      expect(stats.gamesPlayed).toBe(0);
    });
  });

  // --- §3.3: absence is proven, not asserted -----------------------------

  describe("duel_heartbeat is the server's own evidence of presence", () => {
    async function stale(matchId: number): Promise<{ a: boolean; b: boolean }> {
      // The exact predicate lib/duel/actions.ts#forfeitMatch runs, against the
      // same clock that wrote the timestamps.
      const rows = await db.execute<{ a: boolean; b: boolean }>(sql`
        SELECT now() - last_seen_a > (10::double precision * interval '1 second') AS a,
               now() - last_seen_b > (10::double precision * interval '1 second') AS b
        FROM public.duel_matches WHERE id = ${matchId}`);
      return rows[0];
    }

    async function backdateBoth(matchId: number): Promise<void> {
      await db.execute(sql`
        UPDATE public.duel_matches
        SET last_seen_a = now() - interval '30 seconds', last_seen_b = now() - interval '30 seconds'
        WHERE id = ${matchId}`);
    }

    async function newMatch(a: Guest, b: Guest, status = "active"): Promise<number> {
      const [match] = await db
        .insert(duelMatches)
        .values({ playerA: a.id, playerB: b.id, status, currentRound: 0 })
        .returning();
      matchIds.push(match.id);
      return match.id;
    }

    it("a fresh match starts with both players present", async () => {
      const [a, b] = [await newGuest(), await newGuest()];
      const matchId = await newMatch(a, b);
      expect(await stale(matchId)).toEqual({ a: false, b: false });
    });

    // THE security property: a client can vouch for itself and nobody else. If
    // this ever regresses, the §3.3 forfeit-on-demand is back with extra steps.
    it("refreshes only the caller's own column", async () => {
      const [a, b] = [await newGuest(), await newGuest()];
      const matchId = await newMatch(a, b);
      await backdateBoth(matchId);
      expect(await stale(matchId)).toEqual({ a: true, b: true });

      const { data, error } = await a.client.rpc("duel_heartbeat", { p_match_id: matchId });
      expect(error).toBeNull();
      expect(data).toBe(true);

      // A is present again; B is untouched and still forfeitable.
      expect(await stale(matchId)).toEqual({ a: false, b: true });
    });

    it("does nothing for a non-participant", async () => {
      const [a, b] = [await newGuest(), await newGuest()];
      const stranger = await newGuest();
      const matchId = await newMatch(a, b);
      await backdateBoth(matchId);

      const { data } = await stranger.client.rpc("duel_heartbeat", { p_match_id: matchId });
      expect(data).toBe(false);
      expect(await stale(matchId)).toEqual({ a: true, b: true });
    });

    it("reports a terminal match so the client stops beating", async () => {
      const [a, b] = [await newGuest(), await newGuest()];
      const matchId = await newMatch(a, b, "finished");
      const { data } = await a.client.rpc("duel_heartbeat", { p_match_id: matchId });
      expect(data).toBe(false);
    });
  });

  // --- drizzle/0042: the tables those derivations read ---------------------

  describe("client write grants on server-authoritative tables", () => {
    // Asserting on `error` specifically, not "error or zero rows". RLS already
    // returned zero rows before drizzle/0042; the point of the migration is
    // that the GRANT is gone too, so a write is now a privilege failure and
    // stops depending on one RLS flag per table.
    it("a signed-in browser cannot write daily_progress -- the row §3.2 reads back", async () => {
      const guest = await newGuest();
      const { error: updateError } = await guest.client
        .from("daily_progress")
        .update({ completed: true, won: true })
        .eq("user_id", guest.id);
      expect(updateError).not.toBeNull();

      const { error: insertError } = await guest.client
        .from("daily_progress")
        .insert({ user_id: guest.id, date: today, guesses: [driverIds[0]], completed: true, won: true });
      expect(insertError).not.toBeNull();
    });

    it("a signed-in browser cannot write user_stats -- where §3.7's marker lives", async () => {
      const guest = await newGuest();
      const { error: streakError } = await guest.client
        .from("user_stats")
        .update({ max_streak: 9999 })
        .eq("user_id", guest.id);
      expect(streakError).not.toBeNull();

      const { error: markerError } = await guest.client
        .from("user_stats")
        .update({ local_stats_merged_at: null })
        .eq("user_id", guest.id);
      expect(markerError).not.toBeNull();
    });

    it("a signed-in browser cannot write daily_results -- the idempotency guard", async () => {
      const guest = await newGuest();
      const { error } = await guest.client
        .from("daily_results")
        .insert({ user_id: guest.id, date: today, won: true, guess_count: 1 });
      expect(error).not.toBeNull();
    });

    it("a signed-in browser cannot write duel_matches -- ratings and liveness", async () => {
      const [a, b] = [await newGuest(), await newGuest()];
      const [match] = await db
        .insert(duelMatches)
        .values({ playerA: a.id, playerB: b.id, status: "active", currentRound: 0 })
        .returning();
      matchIds.push(match.id);

      const { error } = await a.client
        .from("duel_matches")
        .update({ last_seen_b: new Date(Date.now() - 60_000).toISOString(), winner_id: a.id })
        .eq("id", match.id);
      expect(error).not.toBeNull();
    });

    // The revokes are only correct if they cost a player nothing. Two reads a
    // real feature depends on, and the one write that legitimately remains.
    it("leaves the reads and the profile write a player actually needs", async () => {
      const guest = await newGuest();

      const { data: stats, error: statsError } = await guest.client
        .from("user_stats")
        .select("*")
        .eq("user_id", guest.id)
        .maybeSingle();
      expect(statsError).toBeNull();
      expect(stats).not.toBeNull();

      // Settings -> Profile. profiles keeps UPDATE for `authenticated`, but
      // only on the two columns that screen actually edits (drizzle/0045).
      const { error: nameError } = await guest.client
        .from("profiles")
        .update({ display_name: "grant probe" })
        .eq("id", guest.id);
      expect(nameError).toBeNull();

      const { error: avatarError } = await guest.client
        .from("profiles")
        .update({ avatar_url: "Apex" })
        .eq("id", guest.id);
      expect(avatarError).toBeNull();
    });

    // Audit §3.6, both halves, on ONE guest: every extra newGuest() spends an
    // anonymous sign-in against a per-IP hourly quota this suite already runs
    // close to, and each assertion below is a rejection -- there is no state to
    // keep them apart.
    //
    // profiles_update_own passes for all of these: the row IS the caller's. The
    // row filter was never the thing that had to say no, and RLS cannot say it
    // (a policy sees the old row in USING and the new one in WITH CHECK, and
    // can compare neither to the other). The column grant is what refuses.
    // Probed through PostgREST rather than read off the catalogue
    // (schemaGrants.test.ts does that) because what matters here is that the
    // write is refused, not how.
    it("a signed-in browser cannot write the profile columns Settings does not edit", async () => {
      const guest = await newGuest();

      // The one that mattered: the leaderboard filters on is_guest, so a
      // writable flag is a top-of-board entry from a session that never played.
      const { error: guestFlag } = await guest.client
        .from("profiles")
        .update({ is_guest: false })
        .eq("id", guest.id);
      expect(guestFlag).not.toBeNull();

      // Handle impersonation.
      const { error: username } = await guest.client
        .from("profiles")
        .update({ username: "max_verstappen" })
        .eq("id", guest.id);
      expect(username).not.toBeNull();

      const [row] = await db.select().from(profiles).where(eq(profiles.id, guest.id));
      expect(row.isGuest).toBe(true);
      expect(row.username).toMatch(/^user\d{6}$/);

      // The other half of §3.6: the two columns that ARE writable are bounded
      // server-side now. maxLength={32} on ProfileSection's input is
      // client-only, and PostgREST is reachable without ever loading it.
      for (const displayName of ["x".repeat(33), "  padded  ", "two\nlines", ""]) {
        const { error } = await guest.client
          .from("profiles")
          .update({ display_name: displayName })
          .eq("id", guest.id);
        expect(error, `display_name ${JSON.stringify(displayName)} should be rejected`).not.toBeNull();
      }
    });
  });
});
