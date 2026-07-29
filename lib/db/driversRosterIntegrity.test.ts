import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "./index";

// Regression coverage for audit 2026-07-27 §5.1 and drizzle/0043.
//
// Two properties, and the second is the one the audit didn't reach:
//
//   1. `drivers` is re-seedable in place -- there is a stable, unique natural
//      key (`f1db_id`) to upsert on, so `drivers.id` is never reassigned. Four
//      things store that id, one of them (daily_progress.guesses) with no
//      foreign key to complain if it goes wrong.
//   2. A browser cannot WRITE the table. `drivers` has RLS disabled -- unlike
//      the nine tables drizzle/0042 swept, where RLS denied the write and the
//      leftover grant was inert -- so on this table the grant WAS the access.
//
// Needs a real Postgres + Supabase project. Opt in, same convention as the
// other DB suites (never against production):
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/driversRosterIntegrity.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

describe.skipIf(!RUN)("drivers roster integrity (integration)", () => {
  describe("the seed's upsert key", () => {
    it("has a unique constraint on f1db_id", async () => {
      const rows = await db.execute<{ def: string }>(sql`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.drivers'::regclass AND contype = 'u'`);
      expect(rows.map((r) => r.def)).toContain("UNIQUE (f1db_id)");
    });

    // Nullable is load-bearing, not an oversight: rows imported before
    // drizzle/0043 carry no slug until the next seed adopts them by natural
    // key, and Postgres exempts NULLs from UNIQUE so that state is legal.
    it("allows the pre-adoption NULL state", async () => {
      const rows = await db.execute<{ is_nullable: string }>(sql`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'drivers'
          AND column_name = 'f1db_id'`);
      expect(rows[0]?.is_nullable).toBe("YES");
    });

    it("rejects two rows claiming the same slug", async () => {
      // Inside a transaction that always rolls back -- this is the real table.
      let caught: unknown;
      try {
        await db.transaction(async (tx) => {
          const ids = await tx.execute<{ id: number }>(
            sql`SELECT id FROM public.drivers ORDER BY id LIMIT 2`,
          );
          await tx.execute(
            sql`UPDATE public.drivers SET f1db_id = 'probe-duplicate' WHERE id = ${ids[0].id}`,
          );
          await tx.execute(
            sql`UPDATE public.drivers SET f1db_id = 'probe-duplicate' WHERE id = ${ids[1].id}`,
          );
        });
      } catch (err) {
        caught = err;
      }

      // Drizzle wraps the driver error ("Failed query: ..."), so the constraint
      // name lives on the cause -- assert on that rather than on the wrapper,
      // which would pass for any failure at all.
      const cause = (caught as { cause?: { constraint_name?: string } } | undefined)?.cause;
      expect(cause?.constraint_name).toBe("drivers_f1db_id_unique");
    });

    // The whole point of §5.1: a re-seed must not renumber ids, because these
    // four references would all silently follow the numbers rather than the
    // drivers. Asserting the references exist so the constraint's purpose
    // can't quietly disappear.
    it("still has the references that make id reassignment unsafe", async () => {
      const fks = await db.execute<{ table_name: string }>(sql`
        SELECT c.conrelid::regclass::text AS table_name
        FROM pg_constraint c
        WHERE c.contype = 'f' AND c.confrelid = 'public.drivers'::regclass`);
      const tables = fks.map((r) => r.table_name);
      expect(tables).toEqual(
        expect.arrayContaining(["duel_rounds", "infinite_rounds", "daily_targets"]),
      );

      // daily_progress.guesses stores driver ids with NO foreign key at all --
      // the one that would break without an error.
      const guesses = await db.execute<{ data_type: string }>(sql`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'daily_progress'
          AND column_name = 'guesses'`);
      expect(guesses[0]?.data_type).toBe("ARRAY");
    });
  });

  describe("client write grants on drivers", () => {
    let client: SupabaseClient;
    let driverId: number;

    beforeAll(async () => {
      client = anonClient();
      const rows = await db.execute<{ id: number }>(
        sql`SELECT id FROM public.drivers ORDER BY id LIMIT 1`,
      );
      driverId = rows[0].id;
    });

    // Every filter below matches at most the one row it names, and each write
    // is rejected before it can touch it -- but the assertion is on the ERROR,
    // because "zero rows changed" would also be true of a silently ignored
    // write, and that is exactly the failure mode this pins.
    it("refuses an UPDATE from the browser's anon key", async () => {
      const { error } = await client
        .from("drivers")
        .update({ career_wins: 0 })
        .eq("id", driverId);
      expect(error?.code).toBe("42501");
    });

    it("refuses a DELETE", async () => {
      const { error } = await client.from("drivers").delete().eq("id", driverId);
      expect(error?.code).toBe("42501");
    });

    it("refuses an INSERT", async () => {
      const { error } = await client.from("drivers").insert({
        full_name: "Grant Probe",
        nationality: "Nowhere",
        date_of_birth: "1990-01-01",
        debut_year: 2000,
        last_active_year: 2000,
      });
      expect(error?.code).toBe("42501");
    });

    // A signed-in guest holds `authenticated`, which the Supabase bootstrap
    // grants separately from `anon` -- revoking one and not the other is the
    // trap drizzle/0039 documented for functions.
    it("refuses the same writes from a signed-in guest", async () => {
      const guest = anonClient();
      const { error: signInError } = await guest.auth.signInAnonymously();
      expect(signInError).toBeNull();

      const { error } = await guest
        .from("drivers")
        .update({ career_wins: 999 })
        .eq("id", driverId);
      expect(error?.code).toBe("42501");
    });

    // The revoke is only correct if it costs a player nothing. Nothing reads
    // /rest/v1/drivers today, but the pool is public by design and SELECT was
    // deliberately left alone (same call drizzle/0042 made).
    it("still allows reads", async () => {
      const { data, error } = await client
        .from("drivers")
        .select("id, full_name")
        .limit(1);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });
});
