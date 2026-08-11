# SEO passes — prompts to paste

One prompt per session. Run `/clear` between passes: each is written to work with no
memory of the others, and a fresh context is cheaper and less error-prone than a
long one.

**These prompts deliberately contain no detail.** Everything they need lives in
`docs/seo-roadmap.md`, so there is one source of truth and nothing to keep in sync.
If you want to change what a pass does, edit the roadmap, not the prompt.

**Do them in order.** The dependency table in the roadmap says which ones genuinely
require an earlier pass; where there is no dependency, the order is by value per
hour. Passes 1 and 4 are small — do not skip them because they look minor. Pass 1 is
the one that proves the work already shipped is actually live and correct.

Pass 0 (the technical foundation) is **already done** — do not ask for it again.

Unlike `custom-lobbies-prompts.md`, **keep this file** when the passes are finished:
the roadmap it points at is a standing reference, and passes 6 and 7 are explicitly
gated on Search Console data that will not exist for weeks.

---

## How to run this efficiently

**One pass per session, `/clear` in between.** Each pass ends at a green typecheck and
a green test run. Carrying pass 1's context into pass 6 costs tokens and buys nothing
— the roadmap is the handoff.

**Let the roadmap do the explaining.** Every prompt starts by pointing at a section of
`docs/seo-roadmap.md`. Re-deriving the plan from the codebase costs far more than
reading one section, and the decisions in there were made with the whole picture in
view.

**Ask for a plan before code on the two risky passes.** Pass 4 touches the
auth-reactivity model and pass 7 replaces middleware that currently refreshes the
Supabase session — both fail in ways that look like something else (players signed
out at random). Passes 1, 2, 3, 5, 6 and 8 are additive enough to go straight to
implementation.

**Approve the migration in pass 4 before it is applied.** Read the `.sql` yourself; it
deletes rows from `auth.users`.

### Verification, in order of cost

```powershell
npm run typecheck                      # fast, run constantly
npm run lint                           # fast
npm test                               # both vitest projects, no database needed
npm run test:dom                       # just the jsdom components
```

**Do not ask Claude to run `next build`** — it hangs before compiling on this machine.
Typecheck plus vitest is the real signal; the build runs in CI.

Database-tier suites are opt-in and rate-limited — one full run can exhaust the
Supabase per-IP anonymous sign-in quota for about an hour:

```powershell
$env:RUN_DB_INTEGRATION_TESTS="1"; npx vitest run lib/db/dailyRecap.test.ts
```

---

## Pass 1 — Production verification and measurement

```
Read docs/seo-roadmap.md — the "Standing constraints" section and the "Pass 1"
section — then implement Pass 1 in full.

Build scripts/seoAudit.ts and its npm script, and at the end give me the list of
human steps (Vercel env var, Search Console, Bing, the GitHub repo description) as a
checklist I can work through. Don't start any later pass.
```

**Note:** this pass needs the site deployed with `NEXT_PUBLIC_SITE_URL` set in Vercel.
If it isn't yet, do that first — the audit has nothing to check otherwise.

---

## Pass 2 — Daily recap data layer and images

```
Read docs/seo-roadmap.md — the "Standing constraints" section and the "Pass 2"
section — then implement Pass 2 in full.

Verify the card by actually rendering a PNG for a real past date and looking at it,
per the "Verifying an OG image without a build" note in the constraints. Don't start
Pass 3.
```

**Note:** the DB-tier test in this pass needs `RUN_DB_INTEGRATION_TESTS=1` and a
database. It burns the Supabase per-IP anonymous sign-in quota — one full run can
lock out reruns for about an hour, so let it run once rather than iterating on it.

---

## Pass 3 — /archive/[date] pages

```
Read docs/seo-roadmap.md — the "Standing constraints" section and the "Pass 3"
section — then implement Pass 3 in full.

Pay particular attention to the auto-written summary paragraph: it is what stops
these being thin pages, so several sentence shapes chosen by the data, not one
template with numbers substituted. Show me the rendered text for three different
past days with different outcomes so I can judge whether it reads like a person
wrote it.
```

This is the pass that matters most. Everything before it is plumbing and everything
after it is multiplication.

---

## Pass 4 — Crawler hygiene and install signals

```
Read docs/seo-roadmap.md — the "Standing constraints" section and the "Pass 4"
section — then implement Pass 4 in full.

For part (a), tell me which of the two options you chose and why before you write
the code — it touches the auth-reactivity model in CLAUDE.md and I want to see the
reasoning first.
```

---

## Pass 5 — Serve the game at /

```
Read docs/seo-roadmap.md — the "Standing constraints" section and the "Pass 5"
section — then implement Pass 5 in full.

Check the ModeTabs active-state logic carefully; the roadmap explains the trap.
After the change, list every internal link that pointed at /daily and confirm each
one now points at / rather than at a redirect.
```

---

## Pass 6 — Driver pages

```
Read docs/seo-roadmap.md — the "Standing constraints" section and the "Pass 6"
section — then implement Pass 6 in full.

Start with the ranked pool only. Before generating anything, show me the inclusion
predicate and how many drivers pass it — if a page would have nothing on it beyond a
name and a template, it should not exist.
```

---

## Pass 7 — Internationalisation

```
Read docs/seo-roadmap.md — the "Standing constraints" section and the "Pass 7"
section — then implement Pass 7 in full.

Start with middleware.ts: it already refreshes the Supabase session and next-intl
also wants middleware, so they have to be composed rather than replaced. Get that
right and prove it (sign in, reload, confirm the session survives) before touching
any page.
```

Largest and riskiest pass. Consider doing it on a branch.

---

## Pass 8 — Launch kit

```
Read docs/seo-roadmap.md — the "Standing constraints" section and the "Pass 8"
section — then produce docs/launch-kit.md as specified.

This pass is copy, not code. Write the community posts as something worth reading on
its own; anything that reads like an advert will be removed by moderators and will
cost more than it earns.
```

---

## After each pass

`npm run typecheck && npm run lint && npm test` must be green. **Do not run
`npm run build` locally** — it stalls before compiling on this machine; CI's build
job is what proves the production build.

Commit per pass, so a pass that goes wrong can be reverted on its own.

Once Pass 3 is live, give Search Console two to four weeks before judging anything.
Indexing a new archive is not instant, and the query data it produces is what should
decide how far to take passes 6 and 7.
