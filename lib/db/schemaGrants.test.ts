import "dotenv/config";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "./index";

// The grant-policy check audit 2026-07-27 asks for by name in three places:
// §3.1's "Remaining" (the CI query over `proacl`), §3.11's "whatever CI check
// §2.6 adds should assert on `role_table_grants` as well", and §2.6 itself,
// whose whole point is that a rule nothing runs is a rule nobody keeps.
//
// WHY A CHECK AND NOT A COMMENT. Twice now this project has believed a
// migration said something it did not:
//
//   * drizzle/0038 revoked EXECUTE on daily_state/daily_submit_guess FROM
//     PUBLIC and stopped there. Supabase's bootstrap runs `ALTER DEFAULT
//     PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon,
//     authenticated, service_role`, so both functions ALSO held individually
//     named grants to `anon` that a PUBLIC revoke leaves standing. Caught only
//     by reading pg_proc.proacl back from the live database (drizzle/0039).
//   * The identical trap on TABLES: every application table arrived with the
//     full write set granted to `anon` and `authenticated` by name, denied by
//     RLS alone, on tables whose contents are now read back as the
//     authoritative outcome of a game (drizzle/0042).
//
// Both were found by reading the live catalogue and could not have been found
// any other way. So this file reads the live catalogue -- and, more to the
// point, it does so on every push.
//
// HOW IT WORKS. Two declarations below state the intended access for every
// function and every relation in `public`. Each asserts against reality in
// both directions, which is what makes a NEW function or table fail here until
// someone writes its grant decision down. That is the habit CLAUDE.md's
// "Schema" section asks for, mechanised.
//
// Needs a real Supabase-shaped Postgres (the `anon` / `authenticated` roles
// have to exist). Opt in, same convention as the other DB suites:
//   RUN_DB_INTEGRATION_TESTS=1 npx vitest run lib/db/schemaGrants.test.ts
const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1";

// The three grantees that describe what a browser can reach. `service_role`
// and `postgres` are deliberately not modelled: they are the trusted server
// connection, they hold everything, and asserting on them would only produce
// noise. PUBLIC is included because it is the *default* -- an entry showing
// PUBLIC is an entry where nobody ever made a decision.
type Grantee = "PUBLIC" | "anon" | "authenticated";

/** Rendered as a stable, comparable string so a failure diff is readable. */
function render(grantees: Grantee[]): string {
  return grantees.length === 0 ? "(none)" : grantees.join(", ");
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

// Keyed by `name(identity args)` -- the same identity PostgREST resolves an
// RPC through, so an overload is a separate entry with its own decision.
//
// `open` marks a grant nobody asked for: a Supabase default-privilege leftover
// that no migration has swept yet. It is not "approved" -- it is *recorded*, so
// that the count can only go down. See the ratchet test at the bottom.
const FUNCTION_POLICY: Record<string, { grantees: Grantee[]; open?: boolean; why: string }> = {
  // -- Answer-bearing. These two ARE the daily secret. Reachable over
  //    PostgREST, daily_target_id simply returns the day's driver id straight
  //    past daily_targets' deny-all RLS (drizzle/0038, audit §3.1).
  "compare_drivers(p_guess_driver_id integer, p_target_driver_id integer, p_as_of timestamp with time zone)":
    { grantees: [], why: "the guess-evaluation core; callers reach it through the SECURITY DEFINER RPCs" },
  "daily_target_id(p_date date)":
    { grantees: [], why: "returns the day's answer; must never be client-reachable" },

  // -- Trusted duel lifecycle. No auth.uid() check of their own by design;
  //    drizzle/0034 revoked EXECUTE and added the thin _client wrappers below
  //    rather than putting ~120 lines of scoring rules at risk to add four
  //    lines of authorization.
  "duel_begin_round(p_match_id integer, p_round_index integer)":
    { grantees: [], why: "no auth check inside; browsers go through duel_begin_round_client" },
  "duel_close_round(p_match_id integer, p_round_index integer)":
    { grantees: [], why: "no auth check inside; browsers go through duel_close_round_client" },
  "duel_forfeit(p_match_id integer, p_forfeited_player uuid)":
    { grantees: [], why: "takes the forfeited player as a parameter; trusted connection only" },
  "duel_state(p_match_id integer)":
    { grantees: [], why: "no auth check inside; trusted connection only" },

  // -- Client-callable, correctly narrowed. `authenticated` and nothing else:
  //    every visitor is signed in (anonymously at minimum), so the `anon` role
  //    is never the one making a real request. drizzle/0039 proved the narrowing
  //    costs the player nothing -- dailyTargetSecrecy.test.ts asserts daily_state
  //    still succeeds for a signed-in guest.
  "daily_state()":
    { grantees: ["authenticated"], why: "board hydration; auth.uid() inside" },
  "daily_submit_guess(p_guess_driver_id integer)":
    { grantees: ["authenticated"], why: "the daily guess hop; auth.uid() inside" },
  "duel_heartbeat(p_match_id integer)":
    { grantees: ["authenticated"], why: "refreshes the CALLER'S OWN last_seen column; auth.uid() inside" },
  "duel_topic_participant(p_topic text)":
    { grantees: ["authenticated"], why: "realtime.messages' RLS predicate (drizzle/0046); Realtime evaluates it as the JWT's role, so `authenticated` is the one grantee it needs" },

  // -- Client-callable, still carrying a named `anon` grant from the bootstrap.
  //    Hygiene rather than exposure, and the reason is uniform: each one reads
  //    auth.uid() as its first act, which is NULL for the `anon` role, so every
  //    one of them rejects the request it should reject. §3.1's open sweep.
  "duel_begin_round_client(p_match_id integer, p_round_index integer)":
    { grantees: ["anon", "authenticated"], open: true, why: "participant check via auth.uid(); anon is a bootstrap leftover" },
  "duel_close_round_client(p_match_id integer, p_round_index integer)":
    { grantees: ["anon", "authenticated"], open: true, why: "participant check via auth.uid(); anon is a bootstrap leftover" },
  "duel_server_time()":
    { grantees: ["anon", "authenticated"], open: true, why: "returns now(); nothing to protect, but still an undecided anon grant" },
  "duel_leave_queue()":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "dequeues auth.uid()'s own row only" },
  "duel_queue_heartbeat()":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "refreshes auth.uid()'s own row only" },
  "duel_sweep_stale_queue()":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "deletes only rows already past QUEUE_STALE_MS; no caller identity involved" },
  "duel_submit_guess(p_match_id integer, p_round_index integer, p_guess_driver_id integer)":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "participant check via auth.uid()" },
  "match_or_queue(p_pool_window text, p_device_id text)":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "queues auth.uid() only; self-match guards are inside the locked SELECT" },
  "infinite_start_round(p_pool_window text)":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "writes auth.uid()'s own infinite_rounds row" },
  "infinite_submit_guess(p_guess_driver_id integer)":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "reads auth.uid()'s own round; target withheld while status = continue" },

  // -- Signup machinery. handle_new_user / handle_user_updated return `trigger`,
  //    which PostgREST will not expose as an RPC at all, so their grants are
  //    inert. gen_guest_username() genuinely is callable and genuinely is
  //    harmless: it returns a random `userNNNNNN` string.
  "gen_guest_username()":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "returns a random handle; no input, no state read" },
  "handle_new_user()":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "trigger function; not exposable over PostgREST" },
  "handle_user_updated()":
    { grantees: ["PUBLIC", "anon", "authenticated"], open: true, why: "trigger function; not exposable over PostgREST" },
};

// The subset whose closure is a security property rather than bookkeeping.
// Spelled out separately so that loosening one of them fails a test that says
// what broke, not just "the policy map is out of date".
const MUST_BE_UNREACHABLE = [
  "compare_drivers",
  "daily_target_id",
  "duel_begin_round",
  "duel_close_round",
  "duel_forfeit",
  "duel_state",
] as const;

type FunctionGrantRow = {
  identity: string;
  name: string;
  grants_public: boolean;
  grants_anon: boolean;
  grants_authenticated: boolean;
};

// aclexplode() over `coalesce(proacl, acldefault(...))` is the load-bearing
// detail: a function nobody has touched has a NULL proacl, which means the
// built-in default -- EXECUTE to PUBLIC -- and reading NULL as "no grants"
// would report the most open case as the most closed one.
const FUNCTION_GRANTS = sql`
  SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS identity,
         p.proname AS name,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS grants_public,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS grants_anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS grants_authenticated
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
  ORDER BY identity`;

function liveFunctionGrantees(row: FunctionGrantRow): Grantee[] {
  const out: Grantee[] = [];
  if (row.grants_public) out.push("PUBLIC");
  // has_function_privilege() is transitive through PUBLIC, so a named role
  // reads as true whenever PUBLIC holds it. That is the honest answer for
  // "can this role execute it", and PUBLIC being listed alongside is what
  // distinguishes "granted" from "never decided".
  if (row.grants_anon) out.push("anon");
  if (row.grants_authenticated) out.push("authenticated");
  return out;
}

// ---------------------------------------------------------------------------
// Tables and views
// ---------------------------------------------------------------------------

// Per relation, the privileges each client role may hold. SELECT is kept
// wherever a real self-SELECT policy depends on it (drizzle/0042 explains why
// the four deny-all tables keep an inert one rather than take a behaviour risk
// inside a security patch).
const RELATION_POLICY: Record<string, { anon: string[]; authenticated: string[]; rls: boolean; why: string }> = {
  drivers: { anon: ["SELECT"], authenticated: ["SELECT"], rls: false,
    why: "the one table with RLS DISABLED, so its grants ARE its access control (drizzle/0043). Reads are public by design; the pool ships to the browser" },

  profiles: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "profiles_update_own backs Settings -> Profile, but the UPDATE behind it is COLUMN-level now (drizzle/0045) and so does not appear here -- see COLUMN_GRANT_POLICY" },
  user_stats: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "every write goes through lib/stats/actions.ts on the trusted connection; local_stats_merged_at is a marker the client must not be able to clear" },

  daily_progress: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "recordDailyResult reads won/guess_count/date back off this table -- a client UPDATE here re-forges §3.2 through one more hop" },
  daily_results: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "the per-day idempotency guard; a writable guard guards nothing" },
  daily_targets: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "holds the day's answer; deny-all RLS, and the SELECT grant is inert" },
  infinite_rounds: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "holds the round's answer; written only by infinite_start_round / infinite_submit_guess" },

  duel_matches: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "score, winner, ratings and the last_seen_* liveness columns forfeitMatch checks" },
  duel_rounds: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "server-stamped round clocks and the round's target driver" },
  duel_round_results: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "per-round points; derivable source of score_a/score_b" },
  matchmaking_queue: { anon: ["SELECT"], authenticated: ["SELECT"], rls: true,
    why: "a writable queue row is the rating-farming vector all of drizzle/0032 exists to close" },

  leaderboard: { anon: ["SELECT"], authenticated: ["SELECT"], rls: false,
    why: "owner-privileged read of public columns (drizzle/0009), so it is NOT checked against RLS -- which is why drizzle/0048 finally took the bootstrap's write set off it, the sweep drizzle/0042 missed" },
};

const WRITE_PRIVILEGES = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

type RelationGrantRow = { table_name: string; grantee: string; privs: string };

const RELATION_GRANTS = sql`
  SELECT table_name, grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
  GROUP BY table_name, grantee
  ORDER BY table_name, grantee`;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

// The third grant surface, and the one it is easiest to forget exists: a
// COLUMN-level grant is invisible to information_schema.role_table_grants, so
// the two checks above would report `profiles` as having no client write at all
// while Settings -> Profile writes to it every day.
//
// Keyed `table.column`, valued by the client grantees holding each privilege.
// Same both-directions rule as the maps above: an undeclared column grant fails
// here, and so does a declared one that has gone away.
const COLUMN_GRANT_POLICY: Record<string, { grantees: Grantee[]; priv: string; why: string }> = {
  "profiles.display_name": { priv: "UPDATE", grantees: ["authenticated"],
    why: "ProfileSection's display-name form; shape bounded by profiles_display_name_shape (drizzle/0045)" },
  "profiles.avatar_url": { priv: "UPDATE", grantees: ["authenticated"],
    why: "AvatarPicker writes a DiceBear seed; shape bounded by profiles_avatar_url_shape (drizzle/0045)" },
};

type ColumnGrantRow = { table_name: string; column_name: string; grantee: string; priv: string };

// pg_attribute.attacl directly, not information_schema.column_privileges: the
// latter folds table-level grants in as per-column rows, so it cannot tell a
// deliberate column grant apart from a table-wide one. attacl is NULL until
// someone grants on the column specifically, which is exactly the distinction
// this map is about.
const COLUMN_GRANTS = sql`
  SELECT c.relname AS table_name,
         a.attname AS column_name,
         COALESCE(r.rolname, 'PUBLIC') AS grantee,
         acl.privilege_type AS priv
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN LATERAL aclexplode(a.attacl) acl
  LEFT JOIN pg_roles r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND a.attacl IS NOT NULL
    AND COALESCE(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
  ORDER BY 1, 2, 3, 4`;

describe.skipIf(!RUN)("client grants match the declared policy (integration)", () => {
  describe("functions (pg_proc.proacl)", () => {
    it("every function in `public` has a grant decision on record", async () => {
      const rows = await db.execute<FunctionGrantRow>(FUNCTION_GRANTS);
      const live = rows.map((r) => r.identity).sort();
      const declared = Object.keys(FUNCTION_POLICY).sort();

      // Both directions. An undeclared function is the case this file exists
      // for -- a new RPC arriving with the bootstrap's grants and nobody having
      // decided anything. A declared-but-absent one means the map has gone
      // stale and is no longer describing this database.
      expect(live.filter((f) => !declared.includes(f))).toEqual([]);
      expect(declared.filter((f) => !live.includes(f))).toEqual([]);
    });

    it("holds exactly the declared EXECUTE grants, per function", async () => {
      const rows = await db.execute<FunctionGrantRow>(FUNCTION_GRANTS);

      // Compared as one whole-map diff rather than per row: a drifted grant is
      // then reported next to what it was supposed to be, instead of failing on
      // whichever function happens to sort first.
      const actual: Record<string, string> = {};
      const expected: Record<string, string> = {};
      for (const row of rows) {
        const policy = FUNCTION_POLICY[row.identity];
        if (!policy) continue; // reported by the test above
        actual[row.identity] = render(liveFunctionGrantees(row));
        expected[row.identity] = render(policy.grantees);
      }
      expect(actual).toEqual(expected);
    });

    it("keeps the answer-bearing and trusted-lifecycle functions unreachable", async () => {
      // The security half, asserted by name so that a regression here reads as
      // "the daily answer is public again", not as a policy-map mismatch.
      const rows = await db.execute<FunctionGrantRow>(FUNCTION_GRANTS);
      const reachable = rows
        .filter((r) => (MUST_BE_UNREACHABLE as readonly string[]).includes(r.name))
        .filter((r) => r.grants_public || r.grants_anon || r.grants_authenticated)
        .map((r) => r.identity);
      expect(reachable).toEqual([]);
    });
  });

  describe("tables and views (information_schema.role_table_grants)", () => {
    it("every relation in `public` has a grant decision on record", async () => {
      const rows = await db.execute<RelationGrantRow>(RELATION_GRANTS);
      const live = [...new Set(rows.map((r) => r.table_name))].sort();
      const declared = Object.keys(RELATION_POLICY).sort();

      expect(live.filter((t) => !declared.includes(t))).toEqual([]);
      expect(declared.filter((t) => !live.includes(t))).toEqual([]);
    });

    it("holds exactly the declared privileges, per relation and role", async () => {
      const rows = await db.execute<RelationGrantRow>(RELATION_GRANTS);

      const actual: Record<string, string> = {};
      const expected: Record<string, string> = {};
      for (const row of rows) {
        const policy = RELATION_POLICY[row.table_name];
        if (!policy) continue;
        const key = `${row.table_name}.${row.grantee}`;
        actual[key] = row.privs;
        const declared = row.grantee === "anon" ? policy.anon : policy.authenticated;
        expected[key] = [...declared].sort().join(",");
      }
      expect(actual).toEqual(expected);
    });

    it("leaves no client write grant on a server-authoritative table", async () => {
      // The property drizzle/0042 bought and this check has to keep: grants and
      // RLS must have to fail together, so that reading a table back is a
      // guarantee rather than a bet on one flag per table.
      const rows = await db.execute<RelationGrantRow>(RELATION_GRANTS);
      //
      // No exceptions left. profiles lost its table-wide UPDATE to two named
      // columns (drizzle/0045), and the `leaderboard` view -- the one relation
      // this test used to have to skip -- lost the bootstrap's write set in
      // drizzle/0048. So the only client write grant anywhere in the schema is
      // not a TABLE grant at all.
      const offenders = rows
        .flatMap((r) =>
          r.privs
            .split(",")
            .filter((p) => WRITE_PRIVILEGES.includes(p))
            .map((p) => `${r.grantee} ${p} ON ${r.table_name}`),
        );
      expect(offenders).toEqual([]);
    });

    it("keeps RLS on every table whose grants assume it", async () => {
      const rows = await db.execute<{ relname: string; rls: boolean }>(sql`
        SELECT c.relname, c.relrowsecurity AS rls
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
        ORDER BY c.relname`);

      const actual: Record<string, boolean> = {};
      const expected: Record<string, boolean> = {};
      for (const row of rows) {
        const policy = RELATION_POLICY[row.relname];
        if (!policy) continue;
        actual[row.relname] = row.rls;
        expected[row.relname] = policy.rls;
      }
      // `drivers` is deliberately false here: it has no RLS, which is exactly
      // why drizzle/0043's revokes are the whole of its access control.
      expect(actual).toEqual(expected);
    });

    it("the leaderboard view stays non-auto-updatable", async () => {
      // Kept after drizzle/0048, and now genuinely defence in depth rather than
      // the only defence.
      //
      // The view is owner-privileged (the standard Supabase stand-in for a
      // SECURITY DEFINER read), so it is *not* checked against RLS. Until
      // drizzle/0048 it also held the bootstrap's full write set for both
      // client roles, and the single thing rejecting a write was that Postgres
      // only auto-updates a view over ONE relation -- this one joins profiles
      // to user_stats. "Don't simplify the view" was therefore a load-bearing
      // security constraint nobody would think to write down: flattening it, or
      // adding an INSTEAD OF trigger, would have turned those standing grants
      // into real writes to user_stats AS THE OWNER, past the RLS that is the
      // only thing protecting duel_rating and the streak columns the board
      // ranks on.
      //
      // The grants are gone, so that specific trap is closed by RELATION_POLICY
      // above. This stays because the two should have to fail together, exactly
      // as grants and RLS do everywhere else in this file: re-granting a write
      // set here is only dangerous on a view that is also updatable.
      //
      // Assert the property rather than the shape: is_updatable/is_insertable_into
      // is Postgres' own answer to "would a write succeed here", so this passes
      // for any future definition that stays non-updatable.
      const [view] = await db.execute<{ is_updatable: string; is_insertable_into: string }>(sql`
        SELECT is_updatable, is_insertable_into
        FROM information_schema.views
        WHERE table_schema = 'public' AND table_name = 'leaderboard'`);

      expect(view).toBeDefined();
      expect(view.is_updatable).toBe("NO");
      expect(view.is_insertable_into).toBe("NO");
    });
  });

  describe("columns (pg_attribute.attacl)", () => {
    it("holds exactly the declared column grants", async () => {
      const rows = await db.execute<ColumnGrantRow>(COLUMN_GRANTS);

      const byColumn = new Map<string, Grantee[]>();
      for (const row of rows) {
        const key = `${row.table_name}.${row.column_name}`;
        byColumn.set(key, [...(byColumn.get(key) ?? []), row.grantee as Grantee]);
      }

      const actual = Object.fromEntries([...byColumn].map(([key, g]) => [key, render(g)]));
      const expected = Object.fromEntries(
        Object.entries(COLUMN_GRANT_POLICY).map(([key, p]) => [key, render(p.grantees)]),
      );

      expect(actual).toEqual(expected);
    });

    it("grants only UPDATE at the column level", async () => {
      // The map above records one privilege per column because that is all
      // that exists. A column-level SELECT or INSERT would be a different kind
      // of decision and should be made deliberately, not inherited from here.
      const rows = await db.execute<ColumnGrantRow>(COLUMN_GRANTS);
      const unexpected = rows
        .filter((r) => r.priv !== COLUMN_GRANT_POLICY[`${r.table_name}.${r.column_name}`]?.priv)
        .map((r) => `${r.grantee} ${r.priv} ON ${r.table_name}.${r.column_name}`);
      expect(unexpected).toEqual([]);
    });

    it("leaves exactly two profile columns writable by a client", async () => {
      // §3.6 stated as the property rather than as a grant list, and asked of
      // EVERY column rather than of a list someone has to remember to extend.
      // `is_guest` is what the leaderboard filters on, so a client that can
      // write it is a top-of-board entry from a session that never played a
      // game; `username` is handle impersonation.
      //
      // has_column_privilege() is transitive -- it answers "would this write
      // succeed", folding the table grant, the column grant and PUBLIC into one
      // answer -- which is the only form of the question worth asserting.
      const rows = await db.execute<{ column_name: string; writable: boolean }>(sql`
        SELECT a.attname AS column_name,
               bool_or(has_column_privilege(g.role::name, 'public.profiles', a.attname, 'UPDATE')) AS writable
        FROM pg_attribute a
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(role)
        WHERE a.attrelid = 'public.profiles'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        GROUP BY 1
        ORDER BY 1`);

      expect(rows.filter((r) => r.writable).map((r) => r.column_name)).toEqual([
        "avatar_url",
        "display_name",
      ]);
      // Sanity: the query found the table at all.
      expect(rows.map((r) => r.column_name)).toContain("is_guest");
    });
  });

  describe("the ratchet", () => {
    it("adds no new default-privilege leftovers", async () => {
      // Every `open: true` entry above is a grant the Supabase bootstrap made
      // and no migration has swept -- audit §3.1's remaining "explicit-anon
      // revoke sweep across the duel/infinite RPCs". None is exposure: each of
      // those functions reads auth.uid() as its first act, which is NULL for
      // the `anon` role, so each rejects exactly what it should.
      //
      // Recording them is not approving them. This asserts the count can only
      // fall: sweeping one means deleting its `open` flag, and a NEW function
      // arriving with the bootstrap's grants cannot be added to the list
      // without failing here first.
      const open = Object.entries(FUNCTION_POLICY)
        .filter(([, p]) => p.open)
        .map(([identity]) => identity);
      expect(open.length).toBeLessThanOrEqual(13);
    });
  });
});
