import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { countryCode } from "../game/flags";
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

  // Audit 2026-07-29 §5.2d, drizzle/0047. The per-column half of §5.2: the
  // script's guards (scripts/releaseGuards.ts) catch a renamed column or a dead
  // canary before the write, and these catch a value that can't be true of a
  // real driver, inside the seed's own transaction. That matters because §5.1
  // deliberately traded the old seed's loud foreign-key failure for an in-place
  // UPDATE of 792 live rows -- there is no longer anything else that stops a
  // mis-parsed release from committing.
  describe("value constraints on drivers", () => {
    // Every probe below runs inside a transaction that always rolls back, and
    // asserts on the CONSTRAINT NAME rather than on "the write failed" -- a
    // not-null violation or a permission error would satisfy the weaker test
    // and prove nothing about the constraint being here.
    async function violation(mutation: string): Promise<string | undefined> {
      try {
        await db.transaction(async (tx) => {
          const [row] = await tx.execute<{ id: number }>(
            sql`SELECT id FROM public.drivers ORDER BY id LIMIT 1`,
          );
          await tx.execute(
            sql.raw(`UPDATE public.drivers SET ${mutation} WHERE id = ${row.id}`),
          );
        });
      } catch (err) {
        return (err as { cause?: { constraint_name?: string } })?.cause
          ?.constraint_name;
      }
      return undefined;
    }

    it("rejects negative career wins", async () => {
      expect(await violation("career_wins = -1")).toBe("drivers_career_wins_check");
    });

    it("rejects a debut after the last active year", async () => {
      expect(await violation("debut_year = last_active_year + 1")).toBe(
        "drivers_season_order_check",
      );
    });

    it("rejects a season before F1 existed", async () => {
      expect(await violation("debut_year = 1949, last_active_year = 1949")).toBe(
        "drivers_season_range_check",
      );
    });

    it("rejects a season in the future", async () => {
      expect(
        await violation(
          "last_active_year = EXTRACT(YEAR FROM CURRENT_DATE)::int + 2",
        ),
      ).toBe("drivers_season_range_check");
    });

    it("rejects a death before birth", async () => {
      expect(await violation("date_of_death = date_of_birth - 1")).toBe(
        "drivers_death_after_birth_check",
      );
    });

    // The immutable form of "no future date of birth": a driver born in or
    // after their own debut season. With the range check above, that makes a
    // future birth date unreachable.
    it("rejects a birth date at or after the debut season", async () => {
      expect(await violation("date_of_birth = make_date(debut_year, 1, 1)")).toBe(
        "drivers_born_before_debut_check",
      );
    });

    // The constraints are only correct if the roster they guard satisfies them
    // today -- otherwise the next seed rolls back on real data rather than on a
    // bad release. Verified at 792 rows / zero violations when 0047 was written.
    it("holds for every row currently in the table", async () => {
      const rows = await db.execute<{ bad: number }>(sql`
        SELECT count(*)::int AS bad FROM public.drivers
        WHERE career_wins < 0
           OR debut_year > last_active_year
           OR debut_year < 1950
           OR last_active_year > EXTRACT(YEAR FROM CURRENT_DATE)::int + 1
           OR (date_of_death IS NOT NULL AND date_of_death <= date_of_birth)
           OR date_of_birth >= make_date(debut_year, 1, 1)`);
      expect(rows[0]?.bad).toBe(0);
    });
  });

  // Audit 2026-07-29 §5.2c. lib/game/flags.test.ts used to assert the
  // nationality map against a hand-copied duplicate of its own keys, which is
  // true by construction and cannot notice a nationality entering, leaving or
  // being renamed in the roster. This asks the roster instead -- cheap, because
  // the whole answer is one indexed-free scan of 792 rows on the trusted
  // connection, and it needs no anonymous sign-in.
  //
  // Two failure modes, and the second is the sharper one. §5.1 made the seed
  // upsert in place and KEEP rows a release no longer mentions, so an upstream
  // country rename leaves the old spelling behind on the un-refreshed drivers
  // and writes the new one on the rest -- one country, two strings, and
  // compare_drivers compares nationality by string equality.
  describe("nationality coverage (lib/game/flags.ts)", () => {
    let nationalities: string[];

    beforeAll(async () => {
      const rows = await db.execute<{ nationality: string }>(
        sql`SELECT DISTINCT nationality FROM public.drivers ORDER BY nationality`,
      );
      nationalities = rows.map((r) => r.nationality);
    });

    it("maps every nationality the roster actually holds", () => {
      expect(nationalities.length).toBeGreaterThan(0);

      // A raw F1DB slug ("united-states-of-america") shows up here too, which is
      // the seed lookup miss §5.2b counts -- read scripts/seed.ts's warnings
      // from the last run before assuming this is just a new country.
      const unmapped = nationalities.filter((n) => countryCode(n) === null);
      expect(
        unmapped,
        "unmapped nationality in drivers: add it to COUNTRY_CODES, or check " +
          "whether the seed fell back to a slug (audit §5.2b)",
      ).toEqual([]);
    });

    it("does not hold one country under two different nationality strings", () => {
      const namesByCode = new Map<string, string[]>();
      for (const nationality of nationalities) {
        const code = countryCode(nationality);
        if (code === null) continue; // the test above owns that failure
        namesByCode.set(code, [...(namesByCode.get(code) ?? []), nationality]);
      }

      const split = [...namesByCode.entries()].filter(
        ([, names]) => names.length > 1,
      );
      expect(
        split,
        "two spellings of one country in drivers.nationality -- those drivers " +
          "report a nationality MISS against each other",
      ).toEqual([]);
    });

    // The column is NOT NULL, which does not stop an empty string. A blank
    // nationality renders as a blank tile and matches no other driver.
    it("holds no blank nationality", () => {
      expect(nationalities.filter((n) => n.trim() === "")).toEqual([]);
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
