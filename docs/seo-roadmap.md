# SEO roadmap

The plan for turning DriverPit from a site with no organic traffic into one with a
compounding content engine, split into passes that can each be done in one session
with no memory of the others.

**This file is the spec. `docs/seo-prompts.md` is the paste-ready prompt for each
pass and deliberately contains no detail of its own — it points here, so the two
cannot drift.**

Read the standing constraints below before any pass. They are the repo rules that a
fresh context will otherwise violate, and most of them fail silently rather than
loudly.

---

## Status

**Pass 0 — technical foundation. DONE 2026-08-06.** Do not redo it; read
CLAUDE.md's "SEO & page metadata" section for what it established and why.

Shipped: `app/sitemap.ts`, `app/robots.ts`, `metadataBase` + `title.template` in the
root layout, `buildPageMetadata` (`lib/seo/metadata.ts`) applied to all nine pages,
a generated OG card (`app/opengraph-image.tsx`), `WebSite`/`VideoGame`/`FAQPage`
JSON-LD, a 308 at `/`, `noindex` on `/auth/*` via `app/auth/layout.tsx`, and the FAQ
extracted to data in `lib/marketing/faqContent.ts`. Plus the nightly encrypted
backup (`.github/workflows/db-backup.yml`), which is not SEO but was a prerequisite
for promoting anything.

**Pass 1 — production verification. CODE DONE 2026-08-07; the human steps below
are still open.** `npm run seo:audit` (`scripts/seoAudit.ts`, rules in
`scripts/seoAuditChecks.ts`, 43 unit tests) ships and passes end to end.

It earned its keep on the first run, against `next dev`, by finding a defect
Pass 0 could not see: **no page emitted `og:image`.** Setting `openGraph` in a
page's metadata replaces the parent's resolved value, so `buildPageMetadata`
was silently discarding the generated card on all nine pages — the route
existed, returned a correct PNG, and nothing referenced it. Fixed by defaulting
`image` in the builder from `OG_IMAGE` (`lib/seo/site.ts`); see CLAUDE.md.

It also fixed an assumption in its own parser worth knowing before writing any
tooling that reads this site's HTML: **Next 15 streams metadata**, so title,
canonical and the og tags land ~30KB past `</head>` for anything not in Next's
`htmlLimitedBots` list. Reading `<head>` alone reports every page as untagged.

Still to do by hand, in order: set `NEXT_PUBLIC_SITE_URL` in Vercel for
Production and redeploy, run `SEO_AUDIT_URL=https://<domain> npm run seo:audit`
against it, then Search Console, Bing, the GitHub repo description, and a social
card debugger. Details under "Pass 1" below.

**Pass 2 — daily recap data layer and images. DONE 2026-08-07.** Do not redo it;
read CLAUDE.md's "The daily recap" for what it established and why.

Shipped: `getDailyRecap()` (`lib/db/dailyRecap.ts`, one CTE query on the trusted
connection), `components/recap/RecapCard.tsx` with `MIN_RECAP_SAMPLE = 25`, the
`/api/recap/[date]/image?format=portrait|wide` route, its
`outputFileTracingIncludes` entry, 20 unit tests in `lib/recap/format.test.ts`
and an 8-test database-tier suite in `lib/db/dailyRecap.test.ts`.

Three things Pass 3 inherits and should not re-derive:

- **`target.driverCode` is `string | null`**, not the `string` sketched below —
  `drivers.driver_code` is nullable across the historical roster.
- **The date guard is pinned by a populated fixture day 400 days in the
  FUTURE**, not by "today". Asserting only on today passes on any database
  where today's target has not been pinned yet, which is most of them.
- **Satori clips text rather than shrinking it.** `fitTextSize` is not
  cosmetic: without it "Ferrari" loses its last letter and "United States of
  America" overprints its own tile label. Anything new added to the card that
  holds roster text needs the same fit against a real box.

**Pass 3 — `/archive/[date]` pages. DONE 2026-08-07.** Do not redo it; read
CLAUDE.md's "The archive" for what it established and why.

Shipped: `app/(info)/archive/[date]/page.tsx`, `app/(info)/archive/page.tsx` and
`app/(info)/archive/page/[page]/page.tsx`, the summary generator
(`lib/recap/summary.ts`, 18 tests), four guarded archive queries added to
`lib/db/dailyRecap.ts` (7 more DB-tier tests), `breadcrumbJsonLd`, sitemap
integration, a footer link, and the finished daily board's link into the
archive. `SEO_AUDIT_URL=… npm run seo:audit` passes 116 checks over 23 URLs.

Four things later passes inherit:

- **Page 1 is `/archive`; `/archive/page/1` 404s.** Two URLs for one list is
  duplicate content. Pass 5 changes `/daily` → `/`; it must not reintroduce an
  alias here.
- **The date guard is `UTC_TODAY` in `lib/db/dailyRecap.ts`, embedded by four
  queries.** A fifth way to list days gets the same fragment, in that file.
- **The day page's `og:image` is `/api/recap/[date]/image?format=wide`**, not an
  `opengraph-image.tsx`. There is exactly one Satori route and one
  `outputFileTracingIncludes` entry for recap cards.
- **Run the summary generator against real days before building on it.** Both
  of its serious defects (a "most popular" claim from one player, a driver named
  three times in two sentences) were invisible in the code and obvious in the
  output.

**Pass 4 — crawler hygiene and install signals. DONE 2026-08-08.** Do not redo
it; read CLAUDE.md's "Identity is acquired on the first interaction that needs
one" for what it established and why.

**(a) chose option 2, deferred acquisition — not user-agent sniffing.** The
deciding argument was not the one the option list gives: option 1 leaves a
skipped crawler with `identityStatus === "loading"` forever, so `/daily` renders
a permanently blurred skeleton and Googlebot indexes a loading state. Fixing
that needs a "render playable with no identity" branch, which is the bulk of
option 2 — so option 1's honest cost was option 2's work *plus* a UA list that
is never complete.

Shipped: `ensureIdentity()` + the three-valued `IdentityStatus`, ten interaction
call sites, `sweep_abandoned_guests` (drizzle/0059) with its grant declaration
and `.github/workflows/guest-cleanup.yml`, `app/manifest.ts`, and 11 new tests.

Three things later passes inherit:

- **`identityStatus === "anonymous"` is PROVEN no session; `"loading"` is
  unknown.** Any new game surface must branch on that distinction, not on
  `userId === null`. Collapsing them reintroduces the replay flash.
- **Nothing may call `ensureIdentity()` from an effect.** A render is what
  crawlers do; the whole saving is that they never interact.
- **`updateUser`/`linkIdentity` need an identity first.** Any new auth entry
  point has to mint the guest before upgrading it, or it silently creates a
  second account.

Still open by hand: the sweep has deleted nothing yet — on 2026-08-08 no guest
was 60 days old (the site is three weeks old), so the first real deletion is
around 2026-09-01. `PRODUCTION_DATABASE_URL` must already be set for it, and it
is worth one manual dry run from the Actions tab before the first scheduled one.

**Pass 5 — serve the game at `/`. DONE 2026-08-08.** Do not redo it; read
CLAUDE.md's "Site architecture" and "SEO & page metadata" for what it
established and why.

Shipped: the daily route's files moved from `app/(game)/daily/` up to
`app/(game)/` (`page.tsx`, `loading.tsx`, `DailyGame.tsx`,
`NextPuzzleCountdown.tsx` and their tests), `app/(game)/daily/page.tsx` became
the 308 back into `/`, `ModeTabs` got an explicit active-state rule plus a
`dom`-tier suite, and every internal reference to `/daily` was repointed —
sitemap, `videoGameJsonLd`, `manifest.start_url`, both top bars, the footer,
both archive surfaces and the auth flows' `DEFAULT_NEXT`.

Four things later passes inherit:

- **The active-tab rule is exact-match on `/`, prefix on everything else.** Every
  route is under `/`, so a prefix test lights Daily up everywhere; the prefix arm
  stays for a future nested route. `ModeTabs.test.tsx` pins "exactly one active
  tab", which is the property, not the three cases.
- **`app/(game)/loading.tsx` is the daily skeleton**, and it is safe there only
  because `/infinite` and `/online` each have a nested `loading.tsx`. A new game
  route without one would inherit a fallback labelled "Daily".
- **There is no site-wide canonical any more.** Any new page that skips
  `buildPageMetadata` now emits no canonical rather than a wrong one. That is
  deliberate; do not restore a layout-level default to "fix" it.
- **`DEFAULT_NEXT` is exported from `lib/auth/oauthCallback.ts`.** A new auth
  entry point takes it from there rather than spelling a path.

Still open by hand: nothing in this pass, but the two verification steps are
worth folding into Pass 1's remaining list — re-run
`SEO_AUDIT_URL=… npm run seo:audit` after the deploy (it is the thing that
proves `/daily` 308s and that no sitemap URL is a redirect), and submit `/` in
Search Console so the change of address is noticed sooner than a recrawl.

**Pass 6 — driver pages. DONE 2026-08-08.** Do not redo it; read CLAUDE.md's
"Driver pages" for what it established and why.

**The scope was cut from the ~103 the spec below assumes to 5, on measured
numbers, and that is the pass working rather than the pass being skipped.**
Production on 2026-08-08: 103 in the ranked pool, 47 with a win/podium/pole/
title, 14 who have been the daily answer — but only 14 finished days, 3 distinct
players, 29 guesses in total, and **8 of the 14 days had no players at all**. So
the spec's premise ("career data from `drivers`, plus what only this site has")
inverts: the site-unique half is empty for almost everyone, and publishing on the
career record would have shipped 47 pages of F1DB data that Wikipedia states
better. The bar chosen instead is the site-unique half alone.

Shipped: `lib/drivers/pageEligibility.ts` (the predicate, 9 tests),
`lib/drivers/summary.ts` (21 tests), `listDriverArchiveEvidence` + `getDriverPage`
in `lib/db/dailyRecap.ts` (5 more DB-tier tests), `app/(info)/drivers/[slug]/page.tsx`,
`components/drivers/`, `driverPersonJsonLd`, sitemap entries, and the
archive-day → driver cross-link.

Four things later passes inherit:

- **The predicate is pure and has four callers.** `generateStaticParams`, the
  page's `notFound()`, the sitemap, and the archive day page's link condition.
  A fifth place that needs to know who has a page calls it too — never a
  `HAVING` clause, or the sitemap starts listing 404s.
- **The set grows with no code change.** A driver becomes eligible the first
  time they are the answer on a day somebody finishes; `dynamicParams` is left
  at its default and the sitemap is hourly, so the page appears within one
  revalidate window.
- **`UTC_TODAY` is now six queries wide**, and the two new ones are the sharpest:
  a driver page lists the days its subject was the answer, so a missing boundary
  publishes today's answer under a name.
- **Run the summary generator against the real roster after any change.** Four
  defects surfaced that way and none was visible in the code.

**Pass 7 — internationalisation. CODE DONE 2026-08-08; the marketing body copy is
still English.** Six locales (`en` unprefixed, `es`, `pt-BR`, `it`, `nl`, `de`),
routed by `lib/i18n/`, with the Supabase session refresh and next-intl composed
rather than replaced. Read CLAUDE.md's "Internationalisation" for what it
established and why.

**What is genuinely translated:** every page's title and description, the whole
nav and footer, all 15 FAQ entries, and — the part that matters most, because it
is the archive that compounds — both auto-written summary generators, so an
archive day page and a driver page are real prose in all six languages.

**What is not:** the body copy of `/about`, `/how-to-play`, `/game-modes` and the
two legal pages is still English on every locale. Those five components hold
their strings as JSX and were never externalised. That is a half-translated page
under a full `hreflang` claim, so **finish those before promoting the prefixed
locales anywhere.** The roadmap's own rule on the legal pages still applies when
they are done: say they are translations of an English original.

Three defects this pass found, all of which were silent:

- **The five non-English catalogues were byte-identical copies of English** —
  scaffolding from an earlier session, 80 keys each, shipped under a complete
  hreflang set. Six URLs of the same English page is worse than one.
- **Four message namespaces the code already referenced did not exist**
  (`archive`, `archive.meta`, `driverPage`, `driverSummary`, `recapSummary`), so
  `/archive` rendered `<title>archive.meta.indexTitle</title>` **in English**.
- **`/sitemap.xml`, `/robots.txt` and `/manifest.webmanifest` all 404'd**, because
  the locale matcher rewrote them into `/en/...`. Every page still rendered; the
  only symptom would have been Search Console reporting a missing sitemap weeks
  later. Pinned now by a matcher test in `composedMiddleware.test.ts`.

Two smaller things worth not re-deriving: `Intl` reads a bare `en` as *American*
English, so dates rendered "August 7, 2026" and lists gained an Oxford comma while
this site's own copy says "colour" — hence `intlLocale()`, which maps `en` to
`en-GB` for formatting only and never for `hreflang`. And the footer's links were
`next/link`, so every one of them walked a Spanish reader back to the English site.

**Remaining passes, in the order they should be done.** Dependencies are noted; where
there is none, the order is by value per hour.

**Pass 7a — generated catalogues. DONE 2026-08-09.** `messages/en.json` is now the
only catalogue a human edits; `npm run i18n:translate` regenerates the other five.
See CLAUDE.md's "The catalogues are generated" for the ICU validator, the
source-hash manifest, and why the dry run makes no API calls. It needs
`ANTHROPIC_API_KEY`, which this repo does not have — the script fails closed
rather than silently skipping, and the hand-written translations stay in place and
working until it is first run with a key.

**This is what makes 7b tractable**: externalising the five components' body copy
is now an English-only job, and the other five languages follow from one command.

| # | Pass | Size | Depends on |
|---|---|---|---|
| 7b | Externalise the five marketing/legal components' body copy (English only — the rest is `npm run i18n:translate`) | M | Pass 7 |
| 8 | Launch kit (copy, not code) | S | Pass 3 (done) |

---

## Standing constraints

Every pass inherits these. They are not style preferences; each one has cost real
time or real data in this repo before.

**Repo conventions**

- `CLAUDE.md` is the authority on architecture and is not optional reading. If a
  pass contradicts it, the pass is wrong — stop and say so.
- **No `any`.** ESLint enforces it. If a type is unclear, ask rather than widen.
- **`reportUnusedDisableDirectives` is an error.** An `eslint-disable` comment for a
  rule that is not in `eslint.config.mjs` fails the build. That config is
  deliberately narrow — four rules. Do not add rules as part of an SEO pass.
- Server Components by default; `"use client"` only where interactivity requires it.
  A client component cannot export `metadata` — put it on a server layout above.
- Every migration is hand-written SQL in `drizzle/`, numbered, **and** registered by
  hand in `drizzle/meta/_journal.json`. `drizzle-kit generate` is only for plain
  table/column diffs.
- Drizzle queries live in `lib/db/`. Never inline a query in a component.
- Focused, reviewable diffs. Do not refactor adjacent code that the pass does not
  require.

**Things that fail silently**

- **A new Postgres function or table needs an explicit grant decision** declared in
  `lib/db/schemaGrants.test.ts`, or the database CI tier fails. Postgres
  default-grants `EXECUTE` to `PUBLIC`, and Supabase's bootstrap *also* grants to
  `anon` and `authenticated` by name — so `REVOKE … FROM PUBLIC` alone closes
  nothing. Always name the grantees.
- **A constant duplicated into plpgsql needs a parity suite in the same change**, not
  a keep-in-sync comment. See CLAUDE.md, "Architecture constraints".
- **Satori (`next/og`) is not a browser.** Flexbox only, explicit `display: flex` on
  anything with more than one child, no CSS variables (use `lib/game/palette.ts`),
  ttf/otf fonts only. A layout that renders in Chrome is not evidence it renders
  here — verify by producing a PNG (see "Verifying an OG image" below).
- **Any file read at runtime by `next/og` must be named in `next.config.ts`'s
  `outputFileTracingIncludes`** for its route, or the route renders locally and 500s
  in production.

**Answer secrecy — the one security rule in this whole roadmap**

The daily answer is a random pick pinned server-side in `daily_targets`. It is a
secret because it is *unpredictable*, not because it is hidden.

- **Never build a TypeScript (or otherwise reproducible) "which driver is today"
  helper.** That is the leak that `lib/game/dailySelection.ts` documents at length.
  The puzzle *number* is safe to compute and display; the driver is not.
- **Anything that exposes a day's answer, guesses, or stats must refuse dates that
  are not finished**, with the current date resolved from the **database** clock, never
  the client and never the Node process. `>= today (UTC)` is refused.
- Publishing yesterday's answer is fine and is the entire point of the archive.

**Local environment quirks (measured on this machine)**

- **`next build` stalls before compiling.** Do not wait it out. Verify with
  `npm run typecheck`, `npm run lint` and `npm test`; CI's `build` job is what
  proves the production build.
- **PowerShell strips a bare `--`**, so `npm run x -- --flag` arrives as no flag at
  all. Never design a script whose safe behaviour depends on a forwarded flag —
  take configuration from an env var, or put the flag inside the `package.json`
  script string. This silently committed a 792-row roster write once.
- **`npm run db:migrate` fails on large statements** (~1400-byte MTU ceiling, exit 1
  with no message). Apply large migrations in chunks.
- The DB integration tier is opt-in behind `RUN_DB_INTEGRATION_TESTS=1` and burns
  the Supabase per-IP anonymous sign-in quota. A full run can lock out reruns for
  about an hour.

**Content rules**

- **Never write "Wordle" in anything user-facing.** Decided 2026-08-06 and recorded
  in CLAUDE.md. Not in a title, a description, an OG card, alt text, or the GitHub
  repo description. The historical `docs/audit-*.md` files still contain it and are
  deliberately left alone.
- **Never add `aggregateRating` or `review` structured data.** There are no ratings;
  fabricating them is a manual-action offence. `lib/seo/structuredData.test.ts`
  asserts their absence — keep that assertion.
- No keyword stuffing, no doorway pages, no spun text. Every page must be worth
  landing on. If a page's only content is a template with a name substituted in, it
  is thin content and will drag the domain down rather than lift it.

**Verifying an OG image without a build**

`next build` stalls locally, so render the component directly:

```bash
# _tsconfig.og.json: { "extends": "./tsconfig.json", "compilerOptions": { "jsx": "react-jsx" } }
# _preview.tsx: import the route's default export, await it, write response.arrayBuffer() to a .png
npx tsx --tsconfig _tsconfig.og.json _preview.tsx
```

Then **look at the PNG**. Delete the scratch files afterwards. This is how the
existing OG card was verified.

---

## Pass 1 — Production verification and measurement

**Goal.** Prove the Pass 0 tags are correct *on the deployed site*, and start
collecting the query data that should drive passes 6 and 8. Nothing after this is
worth doing blind.

**Why it is first.** `NEXT_PUBLIC_SITE_URL` is the single point of failure for every
canonical, the sitemap and the OG card, and a wrong value produces no error at all —
the pages render and the tags are simply wrong. That is discovered weeks later in
Search Console, or never.

**Code deliverable: `scripts/seoAudit.ts`, run as `npm run seo:audit`.**

Fetches the deployed site and asserts, failing with a specific message per check:

- `/robots.txt` is reachable, names the sitemap, and does not disallow `/`.
- `/sitemap.xml` parses, and **every URL in it returns 200** — not a redirect, not a
  404. A sitemap listing a redirect is a common and invisible own-goal.
- Every sitemap URL has a `<link rel="canonical">` that is absolute, on the expected
  origin, and equal to the URL that served it.
- No two pages share a `<title>`, and none is the bare site name.
- `og:title`, `og:description` and `og:image` are present on every page, and
  `og:title` is **not** identical across pages (the exact failure `buildPageMetadata`
  exists to prevent — it would mean the builder was bypassed).
- The `og:image` URL returns 200 with `content-type: image/png`.
- Every `application/ld+json` block parses as JSON and has `@context` and `@type`.
- `/auth/sign-in` carries `noindex` and is **not** blocked by robots.txt.

**Take the target URL from an env var** (`SEO_AUDIT_URL`, falling back to
`NEXT_PUBLIC_SITE_URL`), never from `process.argv` behind a `--` — see the
PowerShell note above. Exit non-zero on any failure so it can be a CI step later.

Do **not** wire it into `ci.yml` in this pass: it needs a deployed origin, and a job
that fails because a deploy is in progress is a job people learn to ignore.

**Human steps (list these in the pass output; they cannot be automated):**

1. Set `NEXT_PUBLIC_SITE_URL` in Vercel → Project → Settings → Environment
   Variables, for Production. Redeploy.
2. Google Search Console: add the property, verify by DNS, submit `/sitemap.xml`.
3. Bing Webmaster Tools: same, and it can import from Search Console.
4. Update the **GitHub repository description** — it still says "Wordle-style" and
   it is set on GitHub, not in this repo.
5. Paste the home URL into a social card debugger and confirm the OG image appears.

**Acceptance.** `npm run seo:audit` passes against production; typecheck, lint and
`npm test` are green.

---

## Pass 2 — Daily recap data layer and images — **DONE 2026-08-07**

*Kept as the spec it was built against. Where the shipped code differs, the
differences are listed under Status above and CLAUDE.md is the authority.*

**Goal.** Turn each finished day into a `DailyRecap` object and render it as a
shareable PNG. This is the foundation for both the archive pages (Pass 3) and the
social poster.

**Nothing new is recorded.** Every stat already exists: `daily_progress.guesses` is
the ordered `int[]` of every guess by every player for a UTC day,
`daily_results` has `won`/`guess_count` per player, `daily_targets` has the answer.

**`lib/db/dailyRecap.ts`**

```ts
export interface DailyRecap {
  date: string;            // UTC day, YYYY-MM-DD
  puzzleNumber: number;
  target: { id: number; fullName: string; driverCode: string; nationality: string;
            lastTeam: string | null; age: number; debutYear: number; careerWins: number };
  players: number;         // distinct players with a daily_progress row
  completed: number;
  solved: number;
  solveRate: number;       // solved / completed, 0 when completed is 0
  averageGuesses: number | null;   // over solved games only
  distribution: number[];  // length 6, index 0 = solved in 1
  topGuesses: { driverId: number; fullName: string; count: number; share: number }[]; // top 5
  commonOpener: { fullName: string; count: number } | null;
}
```

- One query with CTEs, on the trusted Drizzle connection. **Not a new RPC** — a
  plain query needs no grant decision and both consumers (the page and the image
  route) are server-side.
- `getDailyRecap(date)` returns `null` for a date with no `daily_targets` row.
- **It refuses any date that is not finished**, comparing against
  `(now() at time zone 'utc')::date` **in SQL**. Returning `null` is correct here;
  the caller renders a 404.
- Ties in `topGuesses` and `commonOpener` must break deterministically (count desc,
  then driver id) or the same day renders two different images on two requests.

**`components/recap/RecapCard.tsx`** — Satori-safe, reusing `lib/seo/ogFonts.ts` and
`lib/game/palette.ts`. Layout: the answer as a real board row (driver code badge +
the five attribute tiles, matching `GuessGrid`'s look), then players / solve rate /
average guesses, then the 1–6 distribution as bars, then the top 5 guessed drivers
with share bars.

**Sample-size guard.** Below `MIN_RECAP_SAMPLE` (start at 25 players) the card omits
the top-guesses block and the distribution rather than charting `n = 3`. Put the
constant in the same module as the card and export it; Pass 3 and the poster both
need to know.

**`app/api/recap/[date]/image/route.tsx`** — `?format=portrait|wide`, defaulting to
portrait (1080×1350: the best Instagram size, and fine on Reddit and Bluesky). Wide
is 1200×630 for the archive page's social card. Cache hard — a finished day never
changes. 404 on an unfinished or unknown date.

**Remember `outputFileTracingIncludes`** for this route in `next.config.ts`.

**Tests.** Pure formatting helpers (share percentages, the summary numbers) in the
`node` project. A `describe.skipIf` DB-tier suite in `lib/db/` asserting: a finished
day returns a recap whose numbers match hand-computed fixtures; **today returns
`null`**; a future date returns `null`. That middle assertion is the security one —
write it so it fails if the date comparison is removed.

**Acceptance.** A PNG rendered locally for a real past date looks right (verify by
producing the file and viewing it); typecheck, lint, tests green.

---

## Pass 3 — `/archive/[date]` pages — **DONE 2026-08-07**

*Kept as the spec it was built against. Where the shipped code differs, the
differences are listed under Status above and CLAUDE.md is the authority.*

**Goal.** The content engine. One indexable page per finished day, forever — the
only asset here that compounds.

**Why it works.** Daily-puzzle traffic is overwhelmingly "answer" and "hints"
queries, and you are the authoritative source for your own. Each page carries data
nobody else has, and they interlink into a growing internal structure that all
points at today's puzzle.

**Build:**

- `app/archive/[date]/page.tsx` — ISR. The answer with its five attributes, the
  stats, the distribution, the top 5 guessed drivers, the recap image, prev/next day
  links, and a link to today's puzzle.
- `app/archive/[date]/opengraph-image.tsx` — the wide recap card.
- `app/archive/page.tsx` — a reverse-chronological index, paginated. This is what
  makes the day pages crawlable rather than orphaned.
- `generateMetadata` per day: title carrying the puzzle number and date, description
  carrying the answer and the solve rate.
- `BreadcrumbList` JSON-LD (`Home → Archive → date`) via the existing
  `components/seo/JsonLd.tsx`.
- **Sitemap integration**: `app/sitemap.ts` gains the archive URLs, read from the
  dates present in `daily_targets` (finished ones only). Keep the hand-kept static
  list; append the dynamic entries.
- A link from the daily result card to yesterday's recap — internal linking and a
  genuine retention hook.

**The auto-written paragraph is what stops these being thin pages.** Two or three
sentences composed from the numbers: how many played, how many solved it, whether
that was hard or easy against the running average, the most common opener, and the
most common wrong answer. Derived, specific, unique per day. Keep it a pure function
so it is unit-testable, and write several sentence shapes chosen by the data rather
than one template with numbers substituted — a page that reads identically 365 times
is the thin content this is meant to avoid.

**Rules.**

- 404 for an unfinished date, an unknown date, or a malformed one. The route must
  not be a way to ask about today.
- Do not `generateStaticParams` the entire history — ISR on demand, so a two-year-old
  archive does not slow every build.

**Acceptance.** A past date renders with correct numbers; today and tomorrow 404;
the sitemap contains the archive URLs; typecheck, lint, tests green.

---

## Pass 4 — Crawler hygiene and install signals — **DONE 2026-08-08**

*Kept as the spec it was built against. Where the shipped code differs, the
differences are listed under Status above and CLAUDE.md is the authority.*

**Goal.** Stop crawling from costing money, and add the cheap engagement signals.

**a) Anonymous sign-in on bot renders — a real cost, not a theoretical one.**
`components/auth/AuthProvider.tsx` calls `signInAnonymously()` for any visitor with
no session. Googlebot executes JavaScript and does not carry cookies between
renders, so **every crawl of every page mints a permanent `auth.users` +
`profiles` + `user_stats` row**. As indexing ramps up that inflates the Supabase MAU
meter (free tier: 50k) and consumes the 500 MB with rows representing nobody.

Two options — pick one and say why in the code:

1. Skip the anon sign-in for known crawler user agents. Smallest diff, but user-agent
   sniffing is never complete.
2. Defer it until an identity is actually needed (the first guess, opening the
   leaderboard, entering `/online`) rather than on mount. Strictly better — it also
   removes a network hop from first paint — but it touches the auth-reactivity model
   in CLAUDE.md, so read that section first and preserve every invariant.

Do **not** change what a real player experiences. Every visitor must still end up
with an identity before they can play.

**b) A guest cleanup sweep.** Guest rows with no `daily_results`, no
`daily_progress` and no duel history, older than 60 days, are garbage. A migration
adding a `SECURITY DEFINER` function plus a monthly workflow (model it on
`db-backup.yml`). **Declare its grant decision in `lib/db/schemaGrants.test.ts`** —
this function must not be client-callable. Delete in batches; a single unbounded
`DELETE` across `auth.users` will hold locks for a long time.

**c) `app/manifest.ts`** — name, short name, icons (`app/icon.png` exists),
`display: "standalone"`, theme colour from `lib/game/palette.ts`. Makes the game
installable, which is a retention feature that happens to be a quality signal.

**Acceptance.** A crawler-simulating request creates no `auth.users` row; a real
first visit still resolves to a playable board; typecheck, lint, tests green.

---

## Pass 5 — Serve the game at `/` — **DONE 2026-08-08**

*Kept as the spec it was built against. Where the shipped code differs, the
differences are listed under Status above and CLAUDE.md is the authority.*

**Goal.** Stop spending a redirect on the most-linked URL the site has.

Currently `app/(game)/page.tsx` 308s to `/daily`. A permanent redirect passes signals
correctly, but the root URL still is not a page, and it is the URL people link to.

**Do:** move the daily game to `/` (its `generateMetadata`, its `revalidate`, its
`VideoGame` JSON-LD), and 308 `/daily` → `/` so existing inbound links and anything
already indexed still resolve.

**The one non-obvious part:** `components/layout/ModeTabs.tsx` decides the active tab
from the pathname, and the daily tab's href becomes `/`. Check the active-state
comparison handles the root path — a naive `startsWith` matches every route against
`/` and lights up every tab at once.

Then update: the sitemap (`/` replaces `/daily`, priority 1), the canonical in the
root layout, `robots.ts` if it names paths, and any internal `Link` to `/daily`
(the logo, the tabs, the archive pages' "play today" links).

**Do this after Pass 3**, so the sitemap changes land once rather than twice.

**Acceptance.** `/` serves the game; `/daily` 308s to `/`; exactly one tab is active
on each route; no internal link points at a redirect.

---

## Pass 6 — Driver pages — **DONE 2026-08-08**

*Kept as the spec it was built against. Where the shipped code differs — most of
all in scope, 5 pages rather than ~103 — the differences and the numbers behind
them are under Status above, and CLAUDE.md is the authority.*

**Goal.** Programmatic pages that are worth landing on. **This pass can do real harm
if rushed** — several hundred templated pages on a young domain reads as doorway
content and drags the whole site.

**Scope it down.** Start with the ~103 drivers in the ranked pool
(`DAILY_POOL_WINDOW`), not all 792. Expand only if the first set earns impressions.

- Route `app/drivers/[slug]/page.tsx`, slug = `drivers.f1db_id` (already unique, and
  it is F1DB's own slug — do not invent a second slug scheme).
- Content: career data from `drivers`, **plus what only this site has** — how many
  times they have been the daily answer, on which dates (linking to those archive
  pages), and the average solve rate when they were. That cross-link is also what
  makes the archive pages non-orphaned.
- `Person` JSON-LD. No `aggregateRating`.
- Sitemap entries; `generateStaticParams` over the pool is fine at this size.

**The quality gate is the point of the pass.** A driver with no archive appearances
and three career races has nothing to say — exclude them rather than shipping a stub.
Write the inclusion rule as a pure, tested predicate so the threshold is explicit and
reviewable rather than implied by a query.

**Acceptance.** Every generated page has at least the data the predicate promises;
excluded drivers 404; typecheck, lint, tests green.

---

## Pass 7 — Internationalisation

**Goal.** Multiply the addressable queries. **The highest-ceiling pass here, and the
one most likely to destabilise the app — do it last.**

**Why it fits this site unusually well:** the game UI is nearly wordless (five column
labels and a few buttons), the marketing copy is roughly 2,000 words total, and F1's
audience is overwhelmingly non-English. Every competing F1 guessing game is
English-only. Suggested first locales: `es`, `pt-BR`, `it`, `nl`, `de`.

**The sharp edge, before anything else:** `middleware.ts` already exists and refreshes
the Supabase session on every real page request. `next-intl` also wants middleware.
They must be **composed** — the locale matcher running and then delegating to the
Supabase refresh, or vice versa — not replaced. Replacing it silently breaks session
refresh, and the symptom is players being signed out at random, which nobody will
connect to an i18n change.

Also: `hreflang` alternates on every page (via `buildPageMetadata`, so it happens in
one place), a locale-aware sitemap, `x-default`, and locale-aware canonicals. Do not
machine-translate the legal pages without saying they are translations of an English
original.

**Do not translate:** driver names, team names, or anything from `drivers`.

**Acceptance.** Session refresh still works across locales (test signing in and
reloading); every page emits correct `hreflang`; typecheck, lint, tests green.

---

## Pass 8 — Launch kit

**Goal.** The off-page half. Not code — Claude Code drafts the copy, a human posts it.

Produce `docs/launch-kit.md` containing:

- A one-paragraph, a one-sentence and a tweet-length description of the site.
- A list of "-dle game" directory and aggregator sites that accept submissions, with
  what each one asks for.
- Draft Show HN and Product Hunt posts. Both audiences punish marketing language;
  lead with what is technically interesting — the real-time duel, the server-authoritative
  scoring, the fact that the answer is unpredictable rather than merely hidden.
- Draft posts for the F1 subreddits and Discords, **written as content rather than
  promotion** — the daily stats image with a genuine observation about it. Include a
  note on each community's self-promotion rules, and the standing advice to
  participate before posting.
- A caption template for the daily recap post, per platform.

**Honest framing to keep in the document:** backlinks and authority are the binding
constraint, not on-page work, and this is the slowest part of the plan. Expect
months.

---

## Not doing, and why

- **`aggregateRating` / review markup** — no ratings exist; fabricating them is a
  manual-action offence.
- **"Wordle" anywhere user-facing** — trademark, decided 2026-08-06.
- **A hints page for today's puzzle** — the query pattern only exists once a brand
  does. Revisit if branded search appears in Search Console.
- **Pages for all 792 drivers** — thin content risk far exceeds the upside until the
  first 103 prove themselves.
- **Republishing the RSS news feed as indexable pages** — syndicated duplicate
  content. `lib/news` stays a retention feature.
- **Buying links, PBNs, AI-spun articles** — the site would not survive the first
  spam update, and the archive engine makes them unnecessary.
