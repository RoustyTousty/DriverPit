import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { duelChannelName } from "../duel/liveMatch";
import { db } from "./index";
import { duelMatches } from "./schema";

// Audit 2026-07-29 §3.4 (and §0.2, which it subsumes): the duel:{matchId}
// Realtime channel was unauthenticated. `supabase.channel()` is public unless it
// asks not to be, so any signed-in user -- and AuthProvider signs everyone in on
// first visit -- could join duel:{N} for arbitrary N and post arbitrary events.
// Nothing there wrote the database; what it stole was the round, live, in a
// rated match.
//
// The fix is two halves that only work together: `private: true` on the client
// (lib/duel/useDuelChannel.ts) and drizzle/0046's realtime.messages policies.
// This suite pins the half that can be checked without a browser, and pins it
// against the LIVE database rather than against the migration text.
//
// HOW REALTIME ASKS. On a join to a private channel Realtime opens a
// transaction, sets the caller's role and JWT claims from their token, sets
// `realtime.topic` to the channel name, and asks realtime.messages two
// questions: may this role SELECT a row on this topic (may receive), and may it
// INSERT one (may broadcast, and may track presence). Both are reproduced below
// on the trusted connection -- SET LOCAL ROLE authenticated plus the same two
// settings -- which is as close to the real check as it gets without a
// WebSocket.
//
// Needs a real Supabase-shaped Postgres (the `authenticated` role has to exist,
// and so does the `realtime` schema). Opt in, same convention as the other DB
// suites, and never against production:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/duelRealtimeAuthorization.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

interface Access {
  read: boolean;
  write: boolean;
}

// Thrown to unwind the probe transaction: nothing it does may survive it, seed
// row included. A sentinel rather than drizzle's tx.rollback(), whose own throw
// would discard the answer we came for.
const ROLLBACK = Symbol("rollback");

// One rolled-back transaction per question, impersonating `userId` on `topic`.
// The seed row goes in first, as the owner and so RLS-exempt, which makes the
// SELECT that follows a test of the policy rather than a test of whether any
// message happens to exist on that topic.
async function accessAs(userId: string, topic: string): Promise<Access> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  let access: Access = { read: false, write: false };

  await db
    .transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO realtime.messages (topic, extension, event, private, payload)
        VALUES (${topic}, 'broadcast', 'fixture', true, '{}'::jsonb)`);

      await tx.execute(sql`SET LOCAL ROLE authenticated`);
      await tx.execute(sql`SELECT set_config('request.jwt.claims', ${claims}, true)`);
      await tx.execute(sql`SELECT set_config('realtime.topic', ${topic}, true)`);

      const rows = await tx.execute<{ c: number }>(sql`
        SELECT count(*)::int AS c FROM realtime.messages WHERE topic = ${topic}`);
      const read = rows[0].c > 0;

      // Last, deliberately: a refusal here is error 42501, which aborts the
      // transaction, so nothing may need to run after it.
      let write = true;
      try {
        await tx.execute(sql`
          INSERT INTO realtime.messages (topic, extension, event, private, payload)
          VALUES (${topic}, 'broadcast', 'probe', true, '{}'::jsonb)`);
      } catch {
        write = false;
      }

      access = { read, write };
      throw ROLLBACK;
    })
    .catch((err) => {
      if (err !== ROLLBACK) throw err;
    });

  return access;
}

describe.skipIf(!RUN)("duel realtime authorization (integration)", () => {
  const matchIds: number[] = [];

  afterAll(async () => {
    if (matchIds.length > 0) await db.delete(duelMatches).where(inArray(duelMatches.id, matchIds));
  });

  // Two ids that satisfy duel_matches' FK to profiles. Existing rows are reused
  // whenever there are any: every anonymous sign-in comes out of a per-IP hourly
  // quota this tier already runs close to, and this suite needs identities only
  // to name them in a JWT claim, never to authenticate as them.
  async function twoPlayers(): Promise<[string, string]> {
    const rows = await db.execute<{ id: string }>(sql`SELECT id FROM public.profiles LIMIT 2`);
    if (rows.length === 2) return [rows[0].id, rows[1].id];

    const signUp = async () => {
      const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
      return data.user.id;
    };
    return [await signUp(), await signUp()];
  }

  async function newMatch(): Promise<{ id: number; a: string; b: string }> {
    const [a, b] = await twoPlayers();
    const [match] = await db
      .insert(duelMatches)
      .values({ playerA: a, playerB: b, status: "active", currentRound: 0 })
      .returning();
    matchIds.push(match.id);
    return { id: match.id, a, b };
  }

  // A participant of nothing. A bare uuid rather than a real account, because
  // the check under test never reads profiles -- and because an attacker's
  // identity is the cheapest thing in this whole system to obtain.
  const STRANGER = "00000000-0000-0000-0000-0000000000ff";

  it("lets both participants read and write their own match topic", async () => {
    const match = await newMatch();
    const topic = duelChannelName(match.id);
    // The TS half of the contract, asserted where it is used: `duel:` lives in
    // two languages -- duelChannelName and the regex in drizzle/0046 -- and if
    // they ever drift, nothing errors anywhere. Every duel channel just stops
    // joining.
    expect(topic).toBe(`duel:${match.id}`);

    expect(await accessAs(match.a, topic)).toEqual({ read: true, write: true });
    expect(await accessAs(match.b, topic)).toEqual({ read: true, write: true });
  });

  // THE security property. `read: false` is "cannot listen in on someone else's
  // duel"; `write: false` is §3.4 itself -- no forged round_end, round_start,
  // match_end or forfeit from a second signed-in session.
  it("refuses a non-participant both directions", async () => {
    const match = await newMatch();
    expect(await accessAs(STRANGER, duelChannelName(match.id))).toEqual({ read: false, write: false });
  });

  it("scopes a participant to their own match, not to duel topics generally", async () => {
    const match = await newMatch();
    const notMine = duelChannelName(match.id + 1_000_000);
    expect(await accessAs(match.a, notMine)).toEqual({ read: false, write: false });
  });

  // The predicate is reached with whatever string a client passed to channel(),
  // so a parse that could raise would be an exception thrown inside an RLS check
  // rather than a denial -- and an erroring policy is a broken channel for
  // everyone, not just the caller who sent the junk. substring() with a capture
  // group returns NULL when it doesn't match, and NULL never equals an id, which
  // is what makes the whole thing total.
  it("is total: junk topics are a plain false, never an error", async () => {
    const topics = [
      "lobby",
      "",
      "duel:",
      "duel:abc",
      "duel:-1",
      "duel:1.5",
      "duel:99999999999999999999", // past int4, and past the regex's {1,9} bound
      "duel:1 or true",
      "realtime:duel:1",
      "duel:1\nduel:2",
    ];

    for (const topic of topics) {
      const rows = await db.execute<{ ok: boolean }>(sql`
        SELECT public.duel_topic_participant(${topic}) AS ok`);
      expect(rows[0].ok, `topic ${JSON.stringify(topic)}`).toBe(false);
    }
  });

  it("keeps RLS on realtime.messages, where those policies are the whole gate", async () => {
    const [row] = await db.execute<{ rls: boolean; policies: number }>(sql`
      SELECT c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      WHERE c.oid = 'realtime.messages'::regclass`);

    // RLS on with no policy is deny-all, which is the safe direction. RLS *off*
    // would make every private channel joinable by anyone again, silently: the
    // client would go on asking for `private: true` and go on being given it.
    expect(row.rls).toBe(true);
    expect(row.policies).toBeGreaterThanOrEqual(2);
  });
});
