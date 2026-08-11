# DriverPit

A daily guessing game where you find the mystery Formula 1 driver in six tries. Each guess is compared
to the target across five attributes — nationality, team, age, debut year and career wins — and the
tiles tell you how close you got.

Four modes, three of them built:

| Mode | Route | What it is |
|---|---|---|
| **Daily** | `/` | One driver a day, the same for everyone, resets at UTC midnight. Progress is stored per account and follows you across devices. |
| **Infinite** | `/infinite` | Unlimited rounds from a driver pool you choose (current season → the entire historical roster). |
| **Duel** | `/online` | Real-time 1v1. Three rounds, matchmade opponent, tug-of-war scoring, Elo. |
| **Knockout** | `/online` | 20-player elimination. Planned, not built — shown as "coming soon". |

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres + Auth + Realtime) ·
Drizzle ORM · deployed on Vercel.

---

## Prerequisites

- **Node 22+** and npm.
- **A Supabase project.** Not optional — there is no local/offline mode. Auth, the driver roster,
  the daily board, matchmaking and every guess evaluation live in Postgres.

Everything below assumes a **scratch** Supabase project, not one with real players in it. The
migrations rewrite grants and policies, and the opt-in test suites create real users and matches.

## Setup

```bash
git clone <this repo> && cd DriverScrabble
npm install
cp .env.example .env      # then fill it in -- see below
npm run db:migrate        # create the schema, RPCs, policies and grants
npm run db:seed           # pull the driver roster from F1DB (dry run -- see below)
npm run db:seed:commit    # ...and keep it
npm run dev               # http://localhost:3000
```

### 1. Environment

Copy `.env.example` to `.env` and fill in three values from **Supabase Dashboard → Project
Settings**. `.env.example` documents each one; the short version:

| Variable | Where from | Notes |
|---|---|---|
| `DATABASE_URL` | Database → Connection string | Use the **pooled** connection (port 6543). `lib/db` sets `prepare: false` because that port is PgBouncer in transaction mode. |
| `NEXT_PUBLIC_SUPABASE_URL` | API | Public by design. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | API | Public by design — every visitor holds it, which is why access control is RLS + `EXECUTE` grants, never secrecy. |

`NEXT_PUBLIC_ADSENSE_CLIENT` / `NEXT_PUBLIC_ADSENSE_SLOT` are optional. Until **both** are set the
ad slot renders a neutral placeholder, which is the normal state in development.

### 2. Enable anonymous sign-ins

**Supabase Dashboard → Authentication → Sign In / Providers → Anonymous sign-ins: on.**

Every first-time visitor is silently signed in anonymously, so they have a real identity for duels
and stats from the first page view. Without this the app cannot bootstrap an identity and no board
will load. Signing in later with email or Google *links* to that anonymous user rather than
replacing it, so guest progress carries over.

Enable **Email** and **Google** too if you want the upgrade paths. For Google you also need the
OAuth callback (`/auth/callback`) allowed in the Supabase redirect URL list.

### 3. Migrations

```bash
npm run db:migrate
```

Applies everything in `drizzle/` in journal order: tables, RLS policies, the `SECURITY DEFINER`
RPCs the browser calls, the `leaderboard` view and the `auth.users` signup triggers.

Most migrations from `0005` onward are **hand-written SQL** — functions, policies, views and
triggers are things `drizzle-kit generate` cannot express. Adding one means writing the `.sql` file
*and* appending its entry to `drizzle/meta/_journal.json` by hand. `npm run db:generate` is only
for plain table/column diffs.

### 4. Seed the driver roster

```bash
F1DB_RELEASE=v2026.11.0 npm run db:seed          # rehearse: full write, rolled back
F1DB_RELEASE=v2026.11.0 npm run db:seed:commit   # ...and keep it
```

Downloads a pinned **[F1DB](https://github.com/f1db/f1db)** release and upserts every driver who
has ever started a race. This is currently the only way driver data gets in or gets updated —
re-run it after a race weekend to refresh wins and teams. `F1DB_RELEASE` is required and has no
default (`latest` is available but has to be typed).

**The seed fails closed.** `npm run db:seed` performs the whole write and then rolls it back, so
you read the reconciliation report against the real table before anything commits; keeping the
write takes `db:seed:commit`. The default is that way round because the flag is the part a shell
can eat — Windows PowerShell 5.1 drops the bare `--` in `npm run db:seed -- --dry-run`, npm
swallows the flag as its own, and that once committed a 792-row refresh nobody asked for. A lost
`--commit` costs a re-run. Either way the first line of output names the mode.

It is an **idempotent upsert keyed on F1DB's own driver slug, and `drivers.id` is never
reassigned** (other tables hold foreign keys to it). Nothing is ever deleted: drivers the release
no longer mentions are kept and reported.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (Turbopack). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. Four rules, deliberately narrow — see the header comment in `eslint.config.mjs` for what was measured and what was rejected. No style rules. |
| `npm test` | Vitest, both projects: `node` (pure logic) and `dom` (components in jsdom). Needs no database, runs offline. |
| `npm run test:dom` | Just the component suites — the fast loop while working on a component. |
| `npm run build` / `npm start` | Production build. Measure performance here, never on `next dev`. |
| `npm run db:migrate` / `db:seed` / `db:seed:commit` / `db:generate` | See above. |

### Integration tests

The suites that pin TypeScript against its plpgsql mirror — the `compare_drivers` and duel-scoring
parity tests, the RPC behaviour tests, the matchmaking self-match guards and the grant policy in
`lib/db/schemaGrants.test.ts` — are gated behind an opt-in flag so `npm test` stays instant:

```bash
RUN_DB_INTEGRATION_TESTS=1 npm test
```

They write real rows (anonymous users, probe days, duel matches) and clean up after themselves, but
"cleans up after itself" is not "safe against live players". Scratch project only.

CI (`.github/workflows/ci.yml`) runs the same thing on every push in a second tier that **self-skips
when the three repository secrets are absent**, so fork pull requests stay green.

## Where things are

```
app/(game)/       / (daily), /infinite, /online -- the persistent game shell
app/(info)/       /about, /faq, /how-to-play, ... -- standalone content pages
components/game/  the shared board: tiles, guess rows, autocomplete, pool select
components/duel/  live-match UI: staging, countdown, tug-of-war, results
lib/game/         PURE rules -- compare, scoring, pool windows, timing constants
lib/db/           Drizzle schema + queries. No SQL inlined in components.
drizzle/          every migration, including all RPCs, policies and triggers
docs/             the 2026-07-27 codebase audit and its resolutions
CLAUDE.md         the real architecture document -- design decisions and the
                  reasoning behind them, far past what this file covers
```

**Read `CLAUDE.md` before changing anything non-trivial.** It records why things are the way they
are — why guesses go through a Postgres RPC instead of a Server Action, why the daily answer is
random rather than derived from the date, why a win is driver identity and not tile equality, and
which invariants must not be "tidied up".

## Deploying

Vercel, with the same environment variables set on the project. Vercel cannot hold WebSockets, so
all realtime goes through Supabase Realtime.

`npm run db:migrate` is **not** run by the build — apply migrations yourself against the target
database before deploying a change that depends on one.
