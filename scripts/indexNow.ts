// Pushes changed URLs to IndexNow, so Bing, Yandex, Seznam and Naver learn about
// a new archive day without waiting to be crawled again:
//
//   npm run indexnow           -- DRY RUN: plans and posts nothing
//   npm run indexnow:commit    -- actually submits
//
// Google does not participate in IndexNow and there is no equivalent push for
// it; the Google half is Search Console (see docs/seo-roadmap.md). This is the
// half that can be automated, and it is worth automating because app/sitemap.ts
// gains an archive entry every midnight UTC with nobody deploying.
//
// The rules live in ../lib/seo/indexNow.ts (pure, unit-tested in the static CI
// tier). This file is the I/O: which origin, the state file, the POST and the
// exit code. Same split as seoAudit.ts / seoAuditChecks.ts.
//
// FAILS CLOSED, like db:seed and i18n:translate: the write is behind a flag that
// lives INSIDE the package.json script string rather than being forwarded. That
// is not preference -- Windows PowerShell 5.1 drops a bare `--` when invoking a
// native command, so `npm run indexnow -- --commit` arrives as no arguments at
// all. Here that produces a dry run, which is the harmless direction.

import "dotenv/config";

import { readFileSync, writeFileSync } from "node:fs";

import { normalizeOrigin } from "../lib/seo/site";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  INDEXNOW_KEY_PATH,
  buildPayload,
  chunkUrls,
  describeResponse,
  foreignUrls,
  parseSitemapEntries,
  planSubmission,
  type SubmissionState,
} from "../lib/seo/indexNow";

const TARGET_ENV_VAR = "INDEXNOW_URL";
const SITE_URL_ENV_VAR = "NEXT_PUBLIC_SITE_URL";

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "DriverPit-indexnow (+https://github.com/RoustyTousty/DriverScrabble)";

/**
 * Resolves the origin to submit for, and **refuses to guess**.
 *
 * `lib/seo/site.ts` falls back to localhost so a dev build renders; that
 * fallback is exactly wrong here, where the consequence of guessing is either a
 * 422 for every URL or -- worse -- submitting a preview deployment's URLs as if
 * they were the real site. Same reasoning, same shape, as `resolveAuditOrigin`.
 */
function resolveOrigin(): string {
  const origin =
    normalizeOrigin(process.env[TARGET_ENV_VAR]) ?? normalizeOrigin(process.env[SITE_URL_ENV_VAR]);
  if (origin) return origin;

  throw new Error(
    `No origin to submit for. Set ${TARGET_ENV_VAR} (or ${SITE_URL_ENV_VAR}), e.g.\n` +
      `  ${TARGET_ENV_VAR}=https://driverpit.app npm run indexnow`,
  );
}

/** `--commit` writes; anything else is a dry run. An unknown flag is an error, not a shrug. */
function resolveWriteMode(argv: string[]): boolean {
  let commit = false;
  for (const arg of argv) {
    if (arg === "--commit") commit = true;
    else if (arg.startsWith("--state=")) continue;
    else throw new Error(`Unrecognised argument: ${arg}`);
  }
  return commit;
}

function resolveStatePath(argv: string[]): string | null {
  const flag = argv.find((arg) => arg.startsWith("--state="));
  return flag ? flag.slice("--state=".length) : null;
}

/**
 * The previous run's state, or null when there isn't one.
 *
 * A missing or unreadable file is null rather than an error, and that is the
 * whole contract with the workflow: the GitHub Actions cache can evict at any
 * time, and the right response to "I don't know what I sent last time" is to
 * send everything, not to fail a scheduled job.
 */
function readState(path: string | null): SubmissionState | null {
  if (!path) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as SubmissionState;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, body: await response.text() };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commit = resolveWriteMode(argv);
  const statePath = resolveStatePath(argv);
  const origin = resolveOrigin();

  // First line, before any network call, because the difference between the two
  // modes is whether anything leaves this machine -- same reason seed.ts prints
  // its mode before the download.
  console.log(`Mode:   ${commit ? "REAL SUBMIT" : "DRY RUN"}`);
  console.log(`Origin: ${origin}`);
  console.log(`State:  ${statePath ?? "(none — will submit every sitemap URL)"}\n`);

  // The key file, first. A submission with an unreachable key comes back 403,
  // and 403 reads as "wrong key" when on this site the overwhelmingly likelier
  // cause is that the file is being locale-rewritten into a path that does not
  // exist -- the exact bug that had /ads.txt returning 404 in production for
  // four months (see middleware.ts). Checking it here names the real problem.
  const keyFile = await fetchText(`${origin}${INDEXNOW_KEY_PATH}`);
  if (keyFile.status !== 200 || keyFile.body.trim() !== INDEXNOW_KEY) {
    throw new Error(
      `Key file check failed at ${origin}${INDEXNOW_KEY_PATH}\n` +
        `  status: ${keyFile.status}, body: ${JSON.stringify(keyFile.body.slice(0, 80))}\n` +
        `  Expected 200 and exactly "${INDEXNOW_KEY}".\n` +
        `  If this is a 404, check middleware.ts's matcher excludes root .txt files.`,
    );
  }
  console.log(`ok  key file served at ${INDEXNOW_KEY_PATH}`);

  const sitemap = await fetchText(`${origin}/sitemap.xml`);
  if (sitemap.status !== 200) {
    throw new Error(`Sitemap fetch failed: ${sitemap.status} at ${origin}/sitemap.xml`);
  }

  const entries = parseSitemapEntries(sitemap.body);
  if (entries.length === 0) {
    throw new Error(
      `Sitemap parsed to zero URLs at ${origin}/sitemap.xml. ` +
        `It returned 200, so this is a shape problem, not a reachability one.`,
    );
  }
  console.log(`ok  sitemap parsed: ${entries.length} URLs`);

  const plan = planSubmission(entries, readState(statePath));
  console.log(`ok  plan: ${plan.reason}`);

  const foreign = foreignUrls(origin, plan.urls);
  if (foreign.length > 0) {
    throw new Error(
      `${foreign.length} sitemap URL(s) are not on ${origin}, which would get the whole ` +
        `batch rejected with 422:\n  ${foreign.slice(0, 5).join("\n  ")}\n` +
        `This means ${SITE_URL_ENV_VAR} disagrees with the origin being submitted for.`,
    );
  }

  for (const url of plan.urls) console.log(`    ${url}`);

  if (plan.urls.length === 0) {
    console.log("\nNothing to submit.");
    writeState(statePath, plan.nextState, commit);
    return;
  }

  if (!commit) {
    console.log(
      `\nDRY RUN — nothing submitted. ${plan.urls.length} URL(s) would go to ${INDEXNOW_ENDPOINT}.`,
    );
    console.log("Run `npm run indexnow:commit` to submit.");
    return;
  }

  let failed = 0;
  for (const batch of chunkUrls(plan.urls)) {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "user-agent": USER_AGENT },
      body: JSON.stringify(buildPayload(origin, batch)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const { ok, message } = describeResponse(response.status);
    console.log(`\n${ok ? "ok  " : "FAIL"} ${batch.length} URL(s): ${response.status} ${message}`);
    if (!ok) failed += 1;
  }

  if (failed > 0) {
    // Deliberately do NOT persist state on a failed submit: recording URLs as
    // sent when they were rejected would skip them on every future run, and the
    // whole point of the state file is that a URL gets submitted at least once.
    process.exitCode = 1;
    console.error("\nSubmission failed; state not updated so these URLs are retried next run.");
    return;
  }

  writeState(statePath, plan.nextState, commit);
  console.log("\nIndexNow submission complete.");
}

/**
 * Persists the state, but only after a real submit.
 *
 * A dry run that wrote state would make the very next real run believe those
 * URLs had already been sent -- so rehearsing the command once would silently
 * cost the site its next batch of indexing.
 */
function writeState(path: string | null, state: SubmissionState, commit: boolean): void {
  if (!path || !commit) return;
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(`ok  state written to ${path}`);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
