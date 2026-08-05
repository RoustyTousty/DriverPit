import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOBBY_CODE_ALPHABET, LOBBY_CODE_LENGTH } from "../duel/customLobby";
import type { DriverFilter } from "../game/driverFilter";
import { db } from "./index";
import { duelLobbies, duelMatches } from "./schema";

// duel_lobbies and its six RPCs (drizzle/0057).
//
// The table has NO client grants and NO RLS policy, so these functions are the
// entire access path to it -- which means everything worth asserting about
// custom lobbies is asserted here or nowhere. Each case below runs as a real
// anonymous guest holding the public anon key, which is the strongest position
// an attacker can reach, so a rejection here means the `anon` role is closed too.
//
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/customLobby.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

interface Guest {
  id: string;
  client: SupabaseClient;
}

async function createGuest(): Promise<Guest> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`fixture guest sign-in failed: ${error?.message}`);
  return { id: data.user.id, client };
}

describe.skipIf(!RUN)("duel_lobbies and its RPCs (integration)", () => {
  // THREE guests and three device ids for the whole file. Supabase rate-limits
  // anonymous sign-in per IP per hour and the DB tier runs every suite in one
  // go, so a fresh set per case would spend quota the other suites here also
  // draw on. `host` and `joiner` are the pair; `stranger` is the third party
  // that must be refused a consumed code and must not see a match id.
  let host: Guest;
  let joiner: Guest;
  let stranger: Guest;
  const HOST_DEVICE = "fixture-device-host";
  const JOINER_DEVICE = "fixture-device-joiner";
  const STRANGER_DEVICE = "fixture-device-stranger";

  const codes: string[] = [];
  const matchIds: number[] = [];
  let currentYear: number;

  // Wide enough that pick_filtered_driver always finds someone, so a failure is
  // never "the roster changed under the fixture".
  let filter: DriverFilter;

  beforeAll(async () => {
    host = await createGuest();
    joiner = await createGuest();
    stranger = await createGuest();

    const [{ year }] = await db.execute<{ year: number }>(sql`SELECT extract(year FROM now())::int AS year`);
    currentYear = Number(year);
    filter = { fromYear: 1950, toYear: currentYear, nationality: null, team: null, achievement: "any" };
  });

  afterAll(async () => {
    // Lobbies first: duel_lobbies.match_id is ON DELETE CASCADE from
    // duel_matches, so deleting the matches would take the rows with them --
    // fine either way, but this keeps the cleanup independent of that.
    if (codes.length > 0) await db.delete(duelLobbies).where(inArray(duelLobbies.code, codes));
    if (matchIds.length > 0) await db.delete(duelMatches).where(inArray(duelMatches.id, matchIds));
  });

  async function create(
    guest: Guest,
    deviceId: string,
    overrides: Partial<{ rounds: number; roundSeconds: number; filter: DriverFilter }> = {},
  ): Promise<string> {
    const f = overrides.filter ?? filter;
    const { data, error } = await guest.client.rpc("duel_lobby_create", {
      p_rounds: overrides.rounds ?? 3,
      p_round_seconds: overrides.roundSeconds ?? 60,
      p_from_year: f.fromYear,
      p_to_year: f.toYear,
      p_nationality: f.nationality,
      p_team: f.team,
      p_achievement: f.achievement,
      p_device_id: deviceId,
    });
    if (error) throw new Error(`duel_lobby_create failed: ${error.message}`);
    const code = data as string;
    codes.push(code);
    return code;
  }

  async function join(guest: Guest, deviceId: string, code: string) {
    return guest.client.rpc("duel_lobby_join", { p_code: code, p_device_id: deviceId }).single();
  }

  // --- the code itself ----------------------------------------------------

  describe("codes are server-generated and unambiguous", () => {
    it("hands back six characters from the 31-character alphabet", async () => {
      const code = await create(host, HOST_DEVICE);
      expect(code).toHaveLength(LOBBY_CODE_LENGTH);
      for (const character of code) {
        expect(LOBBY_CODE_ALPHABET, `"${character}" is not in the code alphabet`).toContain(character);
      }
      // The characters a person confuses when retyping. Their absence is the
      // whole reason for a custom alphabet rather than base36.
      expect(code).not.toMatch(/[01OIL]/);
    });

    // There is no parameter to pass one in -- which is the point. Asserted
    // anyway, because "the client cannot choose the code" is the property that
    // stops someone squatting AAAAAA and intercepting whoever types it.
    it("has no client-supplied-code parameter at all", async () => {
      const { error } = await host.client.rpc("duel_lobby_create", {
        p_code: "AAAAAA",
        p_rounds: 3,
        p_round_seconds: 60,
        p_from_year: 1950,
        p_to_year: currentYear,
        p_nationality: null,
        p_team: null,
        p_achievement: "any",
        p_device_id: HOST_DEVICE,
      });
      expect(error).not.toBeNull();
    });

    it("stores the config the host asked for", async () => {
      const code = await create(host, HOST_DEVICE, { rounds: 5, roundSeconds: 30 });
      const [lobby] = await db.select().from(duelLobbies).where(eq(duelLobbies.code, code));
      expect(lobby.rounds).toBe(5);
      expect(lobby.roundSeconds).toBe(30);
      expect(lobby.matchId).toBeNull();
      expect(lobby.mode).toBe("duel");
      expect(lobby.hostId).toBe(host.id);
    });

    // Clamped rather than rejected: these come off a three-button row, so an
    // out-of-range value is a stale client, and the CHECK would only turn it
    // into an opaque error.
    it("re-clamps a config the client should never have sent", async () => {
      const code = await create(host, HOST_DEVICE, { rounds: 99, roundSeconds: 9999 });
      const [lobby] = await db.select().from(duelLobbies).where(eq(duelLobbies.code, code));
      expect(lobby.rounds).toBe(5);
      expect(lobby.roundSeconds).toBe(180);
    });

    it("re-validates the achievement server-side", async () => {
      const { error } = await host.client.rpc("duel_lobby_create", {
        p_rounds: 3,
        p_round_seconds: 60,
        p_from_year: 1950,
        p_to_year: currentYear,
        p_nationality: null,
        p_team: null,
        p_achievement: "not-a-tier",
        p_device_id: HOST_DEVICE,
      });
      expect(error?.message).toMatch(/achievement/i);
    });

    it("requires a device id -- a blank one would opt the host out of the self-join guard", async () => {
      const { error } = await host.client.rpc("duel_lobby_create", {
        p_rounds: 3,
        p_round_seconds: 60,
        p_from_year: 1950,
        p_to_year: currentYear,
        p_nationality: null,
        p_team: null,
        p_achievement: "any",
        p_device_id: "   ",
      });
      expect(error?.message).toMatch(/device id/i);
    });

    // The failure this prevents surfaces at duel_begin_round otherwise --
    // mid-countdown, to two people, with the match already created.
    it("refuses a filter matching nobody", async () => {
      const { error } = await host.client.rpc("duel_lobby_create", {
        p_rounds: 3,
        p_round_seconds: 60,
        p_from_year: 1950,
        p_to_year: currentYear,
        p_nationality: "Nowhereland",
        p_team: null,
        p_achievement: "any",
        p_device_id: HOST_DEVICE,
      });
      expect(error?.message).toMatch(/no drivers match/i);
    });

    // Converge, don't error: a host who navigated away and back cannot see the
    // old row to cancel it, so creating again must replace it.
    it("replaces the host's previous open lobby rather than erroring", async () => {
      const first = await create(host, HOST_DEVICE);
      const second = await create(host, HOST_DEVICE);
      expect(second).not.toBe(first);

      const rows = await db.select().from(duelLobbies).where(eq(duelLobbies.hostId, host.id));
      const open = rows.filter((r) => r.matchId === null);
      expect(open).toHaveLength(1);
      expect(open[0].code).toBe(second);
    });
  });

  // --- the table is unreachable except through the RPCs -------------------

  describe("duel_lobbies is unreachable with the anon key", () => {
    // The sharpest one. Every open lobby's code lives in this table, and a code
    // IS the access control -- a readable duel_lobbies is every private game in
    // the app behind one query.
    it("cannot be read", async () => {
      const code = await create(host, HOST_DEVICE);
      const { data, error } = await host.client.from("duel_lobbies").select("*");
      // Either a hard privilege failure or zero rows; what must never happen is
      // the code coming back.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      expect(JSON.stringify(data ?? [])).not.toContain(code);
    });

    it("cannot be written", async () => {
      const { error: insertError } = await stranger.client.from("duel_lobbies").insert({
        code: "ZZZZZZ",
        host_id: stranger.id,
        host_device_id: STRANGER_DEVICE,
        rounds: 3,
        round_seconds: 60,
        filter: {},
      });
      expect(insertError).not.toBeNull();

      const code = await create(host, HOST_DEVICE);
      const { error: updateError } = await stranger.client
        .from("duel_lobbies")
        .update({ host_id: stranger.id })
        .eq("code", code);
      expect(updateError).not.toBeNull();

      const { error: deleteError } = await stranger.client.from("duel_lobbies").delete().eq("code", code);
      expect(deleteError).not.toBeNull();
      // And it is genuinely still there.
      const [lobby] = await db.select().from(duelLobbies).where(eq(duelLobbies.code, code));
      expect(lobby).toBeDefined();
      expect(lobby.hostId).toBe(host.id);
    });
  });

  // --- state --------------------------------------------------------------

  describe("duel_lobby_state", () => {
    it("previews the config and the host's handle to anyone with the code", async () => {
      const code = await create(host, HOST_DEVICE, { rounds: 1, roundSeconds: 90 });
      const { data, error } = await stranger.client.rpc("duel_lobby_state", { p_code: code }).maybeSingle();
      expect(error).toBeNull();

      const row = data as { rounds: number; round_seconds: number; host_id: string; is_host: boolean };
      expect(row.rounds).toBe(1);
      expect(row.round_seconds).toBe(90);
      expect(row.host_id).toBe(host.id);
      expect(row.is_host).toBe(false);
    });

    it("normalizes case, spaces and dashes -- a code is read off a screen", async () => {
      const code = await create(host, HOST_DEVICE);
      const scrambled = `${code.slice(0, 3).toLowerCase()}- ${code.slice(3).toLowerCase()}`;
      const { data } = await stranger.client.rpc("duel_lobby_state", { p_code: scrambled }).maybeSingle();
      expect((data as { code: string } | null)?.code).toBe(code);
    });

    it("returns nothing for a code that does not exist", async () => {
      const { data } = await stranger.client.rpc("duel_lobby_state", { p_code: "ZZZZZZ" }).maybeSingle();
      expect(data).toBeNull();
    });

    // THE disclosure rule. match_id names the private realtime channel
    // (duel:{matchId}), so a third party holding a guessed or forwarded code
    // must not learn it.
    it("returns match_id to the host and the joiner, and NULL to everyone else", async () => {
      const code = await create(host, HOST_DEVICE);
      const { data: joined, error } = await join(joiner, JOINER_DEVICE, code);
      expect(error).toBeNull();
      const matchId = (joined as { match_id: number }).match_id;
      matchIds.push(matchId);

      const asHost = await host.client.rpc("duel_lobby_state", { p_code: code }).maybeSingle();
      expect((asHost.data as { match_id: number | null; is_host: boolean }).match_id).toBe(matchId);
      expect((asHost.data as { is_host: boolean }).is_host).toBe(true);

      const asJoiner = await joiner.client.rpc("duel_lobby_state", { p_code: code }).maybeSingle();
      expect((asJoiner.data as { match_id: number | null }).match_id).toBe(matchId);

      const asStranger = await stranger.client.rpc("duel_lobby_state", { p_code: code }).maybeSingle();
      expect(
        (asStranger.data as { match_id: number | null }).match_id,
        "a third party with the code learned the private channel's match id",
      ).toBeNull();
    });
  });

  // --- join ---------------------------------------------------------------

  describe("duel_lobby_join", () => {
    it("creates an unranked match carrying the lobby's config", async () => {
      const custom: DriverFilter = {
        fromYear: 1990,
        toYear: 1999,
        nationality: null,
        team: null,
        achievement: "any",
      };
      const code = await create(host, HOST_DEVICE, { rounds: 5, roundSeconds: 30, filter: custom });
      const { data, error } = await join(joiner, JOINER_DEVICE, code);
      expect(error).toBeNull();

      const row = data as { match_id: number; opponent_id: string; you_are: string };
      matchIds.push(row.match_id);
      // match_or_queue's exact row shape, so the client reuses toMatchResult:
      // the host is player_a, so the joiner is 'b' and their opponent is the host.
      expect(row.you_are).toBe("b");
      expect(row.opponent_id).toBe(host.id);

      const [match] = await db.select().from(duelMatches).where(eq(duelMatches.id, row.match_id));
      expect(match.ranked).toBe(false);
      expect(match.rounds).toBe(5);
      expect(match.roundSeconds).toBe(30);
      expect(match.filter).toEqual(custom);
      expect(match.playerA).toBe(host.id);
      expect(match.playerB).toBe(joiner.id);
      expect(match.status).toBe("lobby");

      // And the lobby is now consumed.
      const [lobby] = await db.select().from(duelLobbies).where(eq(duelLobbies.code, code));
      expect(lobby.matchId).toBe(row.match_id);
    });

    // A double-click or a reload must not create a second match.
    it("is idempotent for a participant", async () => {
      const code = await create(host, HOST_DEVICE);
      const first = await join(joiner, JOINER_DEVICE, code);
      const firstId = (first.data as { match_id: number }).match_id;
      matchIds.push(firstId);

      const second = await join(joiner, JOINER_DEVICE, code);
      expect(second.error).toBeNull();
      expect((second.data as { match_id: number }).match_id).toBe(firstId);

      const all = await db.select().from(duelMatches).where(eq(duelMatches.playerB, joiner.id));
      expect(all.filter((m) => m.id === firstId)).toHaveLength(1);
    });

    it("refuses a consumed code to a third party", async () => {
      const code = await create(host, HOST_DEVICE);
      const first = await join(joiner, JOINER_DEVICE, code);
      matchIds.push((first.data as { match_id: number }).match_id);

      const { error } = await join(stranger, STRANGER_DEVICE, code);
      expect(error?.message).toMatch(/already been used/i);
    });

    it("refuses the host's own identity", async () => {
      const code = await create(host, HOST_DEVICE);
      const { error } = await join(host, "some-other-device", code);
      expect(error?.message).toMatch(/your own lobby/i);
    });

    // THE guard that matters. Signing out mints a fresh anonymous identity, so
    // the two user ids genuinely differ and the identity check above passes --
    // only the device can tell "someone else" from "the same person, again".
    // Accepted side effect, same as the queue's: two people sharing one browser
    // profile cannot play each other.
    it("refuses the host's own BROWSER even under a different identity", async () => {
      const code = await create(host, HOST_DEVICE);
      const { error } = await join(stranger, HOST_DEVICE, code);
      expect(error?.message).toMatch(/this browser/i);

      const [lobby] = await db.select().from(duelLobbies).where(eq(duelLobbies.code, code));
      expect(lobby.matchId, "a self-match was created").toBeNull();
    });

    it("refuses an unknown code", async () => {
      const { error } = await join(joiner, JOINER_DEVICE, "ZZZZZZ");
      expect(error?.message).toMatch(/does not exist/i);
    });

    it("requires a device id", async () => {
      const code = await create(host, HOST_DEVICE);
      const { error } = await join(joiner, "  ", code);
      expect(error?.message).toMatch(/device id/i);
    });

    // Told apart from a wrong code deliberately: to someone holding a link,
    // "expired" and "wrong" are different things to do something about.
    it("refuses a stale lobby, and says so", async () => {
      const code = await create(host, HOST_DEVICE);
      await db.execute(sql`
        UPDATE public.duel_lobbies SET last_seen_at = now() - interval '5 minutes' WHERE code = ${code}`);

      const { error } = await join(joiner, JOINER_DEVICE, code);
      expect(error?.message).toMatch(/expired|does not exist/i);
    });
  });

  // --- heartbeat, cancel, sweep -------------------------------------------

  describe("liveness and teardown", () => {
    it("the heartbeat refreshes the caller's own open lobby only", async () => {
      const code = await create(host, HOST_DEVICE);
      await db.execute(sql`
        UPDATE public.duel_lobbies SET last_seen_at = now() - interval '60 seconds' WHERE code = ${code}`);

      // Somebody else's beat does nothing -- and says so, so a client that is
      // not the host stops beating.
      const { data: byStranger } = await stranger.client.rpc("duel_lobby_heartbeat", { p_code: code });
      expect(byStranger).toBe(false);
      const [untouched] = await db.select().from(duelLobbies).where(eq(duelLobbies.code, code));
      expect(Date.now() - untouched.lastSeenAt.getTime()).toBeGreaterThan(30_000);

      const { data: byHost } = await host.client.rpc("duel_lobby_heartbeat", { p_code: code });
      expect(byHost).toBe(true);
      const [refreshed] = await db.select().from(duelLobbies).where(eq(duelLobbies.code, code));
      expect(Date.now() - refreshed.lastSeenAt.getTime()).toBeLessThan(30_000);
    });

    it("the heartbeat reports false once the lobby is consumed, so the client stops", async () => {
      const code = await create(host, HOST_DEVICE);
      const joined = await join(joiner, JOINER_DEVICE, code);
      matchIds.push((joined.data as { match_id: number }).match_id);

      const { data } = await host.client.rpc("duel_lobby_heartbeat", { p_code: code });
      expect(data).toBe(false);
    });

    it("cancel deletes the caller's own open lobby and is idempotent", async () => {
      const code = await create(host, HOST_DEVICE);

      const { data: first } = await host.client.rpc("duel_lobby_cancel", { p_code: code });
      expect(first).toBe(true);
      expect(await db.select().from(duelLobbies).where(eq(duelLobbies.code, code))).toHaveLength(0);

      // Safe twice, and safe when never created -- it is called on every exit
      // from the waiting screen and from signOutAndReset.
      const { data: second, error } = await host.client.rpc("duel_lobby_cancel", { p_code: code });
      expect(error).toBeNull();
      expect(second).toBe(false);
      const { error: neverExisted } = await host.client.rpc("duel_lobby_cancel", { p_code: "ZZZZZZ" });
      expect(neverExisted).toBeNull();
    });

    it("cancel cannot delete somebody else's lobby", async () => {
      const code = await create(host, HOST_DEVICE);
      const { data } = await stranger.client.rpc("duel_lobby_cancel", { p_code: code });
      expect(data).toBe(false);
      expect(await db.select().from(duelLobbies).where(eq(duelLobbies.code, code))).toHaveLength(1);
    });

    // A consumed lobby belongs to a live match: its host stopped beating the
    // moment the match started, so the staleness rule must not touch it or the
    // joiner's idempotent re-join breaks.
    it("the sweep drops stale OPEN lobbies and leaves consumed ones alone", async () => {
      const staleCode = await create(host, HOST_DEVICE);
      const consumedCode = await create(joiner, JOINER_DEVICE);
      const joined = await join(host, HOST_DEVICE, consumedCode);
      matchIds.push((joined.data as { match_id: number }).match_id);

      await db.execute(sql`
        UPDATE public.duel_lobbies SET last_seen_at = now() - interval '5 minutes'
        WHERE code IN (${staleCode}, ${consumedCode})`);

      const { error } = await stranger.client.rpc("duel_sweep_stale_lobbies");
      expect(error).toBeNull();

      expect(await db.select().from(duelLobbies).where(eq(duelLobbies.code, staleCode))).toHaveLength(0);
      expect(await db.select().from(duelLobbies).where(eq(duelLobbies.code, consumedCode))).toHaveLength(1);
    });
  });
});
