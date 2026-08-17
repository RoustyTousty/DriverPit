import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright-core";

import { client } from "../lib/db";
import { PROMO_HEIGHT, PROMO_WIDTH } from "../lib/promo/frame";
import { listPromoDrivers } from "../lib/db/promoDrivers";
import {
  createRng,
  guessPoolFor,
  MAX_GUESS_ROWS,
  MIN_GUESS_ROWS,
  planBoards,
  pickWrongGuesses,
  promoTier,
  TIER_LABELS,
  type PromoBoard,
  type PromoDriver,
} from "../lib/promo/select";

/**
 * Renders the five-slide promo carousel by screenshotting the real app.
 *
 *   npm run dev          # terminal 1 -- this script does NOT start a server
 *   npm run promo        # terminal 2
 *
 * Output: out/promo/<YYYY-MM-DD>/01-teaser.png ... 05-cta.png
 *
 * CONFIGURATION IS READ FROM BOTH argv AND ENV, and that is not belt-and-braces
 * padding. Windows PowerShell 5.1 drops the bare `--` when npm invokes a native
 * command, so `npm run promo -- --seed=abc` arrives here as an empty argv --
 * measured on this repo, and documented at the top of scripts/sweepGuests.ts
 * where it once turned a seed dry run into a real 792-row write. Here the
 * consequence is only a different carousel, so the flags are supported as asked
 * AND mirrored as PROMO_SEED / PROMO_DRIVERS for the shell that eats them. The
 * resolved seed is printed before any work starts, so a dropped flag is visible
 * in the first line of output rather than inferred from the pictures.
 *
 * ON WINDOWS, USE THE ENV VARS OR `npm run promo:flags`. `npm run promo --
 * --flags` does NOT work in PowerShell -- measured, it prints "Nation: words".
 * That is the stripping described above, and it is why `promo:flags` exists as
 * its own package.json entry with the flag INSIDE the script string, the same
 * shape as db:seed:commit and i18n:translate:commit.
 *
 *   npm run promo                                      # words (default)
 *   npm run promo:flags                                # flag glyphs
 *   $env:PROMO_FLAGS="1"; npm run promo                # same, and combinable
 *   $env:PROMO_SEED="launch-a"; npm run promo          # PowerShell-safe
 *
 * Combining options is the env vars' job, since only one flag can be baked into
 * a package.json entry:
 *
 *   $env:PROMO_FLAGS="1"; $env:PROMO_SEED="launch-a"; npm run promo
 *
 * The argv forms below work when the script is called directly, which is what
 * a non-Windows shell or a CI step would do:
 *
 *   npx tsx scripts/promo.ts --flags --seed=launch-a
 */

const DEFAULT_BASE_URL = "http://localhost:3000";

// deviceScaleFactor 2 -- the frame is laid out at 1080x1350 CSS px and exported
// at 2160x2700, which is what every feed surface wants for a 4:5 image.
const DEVICE_SCALE_FACTOR = 2;

interface Options {
  seed: string;
  driverSlugs: string[] | null;
  baseUrl: string;
  /** Draw the nationality column as a flag glyph instead of the country name. */
  flags: boolean;
}

function readFlag(name: string, envName: string): string | undefined {
  const prefix = `--${name}=`;
  const fromArgv = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (fromArgv) return fromArgv.slice(prefix.length);
  const fromEnv = process.env[envName];
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/**
 * A switch, readable as `--flags`, `--flags=1`, `--no-flags`, or the env var.
 *
 * The bare form is supported because that is how anyone actually types a switch,
 * and the `=value` form because it is the only one the env var can express. The
 * explicit negative exists so an env var set in a shell profile can be turned
 * off for one run without unsetting it.
 *
 * Unrecognised values are REFUSED rather than treated as false: `--flags=yes`
 * silently meaning "no" would be discovered only by looking closely at a
 * finished image, which is exactly the class of failure this script keeps
 * getting bitten by.
 */
function readSwitch(name: string, envName: string, fallback: boolean): boolean {
  const argv = process.argv.slice(2);
  if (argv.includes(`--no-${name}`)) return false;
  if (argv.includes(`--${name}`)) return true;

  const raw = readFlag(name, envName);
  if (raw === undefined) return fallback;

  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`--${name} expects true/false (got "${raw}")`);
}

function parseOptions(): Options {
  // A FRESH seed per run. This was the UTC date, which made every run on a given
  // day produce the identical carousel -- reasoned as "a half-approved carousel
  // must not reshuffle under a copy tweak", which is a real need served by the
  // wrong default. Re-running to see different drivers is the common case by a
  // wide margin; pinning one is the rare case, and it already has --seed.
  //
  // Nothing is lost, because the seed is printed on the first line of every run
  // and echoed at the end: any carousel can be recreated after the fact. Short
  // and base36 so it is easy to read off a terminal and type back.
  const seed =
    readFlag("seed", "PROMO_SEED") ?? Math.random().toString(36).slice(2, 8);

  const rawDrivers = readFlag("drivers", "PROMO_DRIVERS");
  const driverSlugs = rawDrivers
    ? rawDrivers.split(",").map((slug) => slug.trim()).filter((slug) => slug.length > 0)
    : null;

  if (driverSlugs && driverSlugs.length !== 3) {
    throw new Error(
      `--drivers needs exactly 3 comma-separated slugs (got ${driverSlugs.length}): one answer per board slide.`,
    );
  }

  return {
    seed,
    driverSlugs,
    baseUrl: (process.env.PROMO_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    // Words by default. A promo image is read by people who have never seen the
    // game, and "United Kingdom" says what a 24px flag only says to someone who
    // already recognises it -- the same argument the archive pages make for
    // rendering nationality as text. Flags are the better-looking option once
    // the audience knows the game, hence the switch.
    flags: readSwitch("flags", "PROMO_FLAGS", false),
  };
}

/**
 * Fails before launching a browser if nothing is listening.
 *
 * Without this the first symptom is a Playwright navigation error several
 * seconds in, or -- worse on some setups -- five screenshots of a browser error
 * page, which are valid PNGs and look like a successful run in the output
 * directory.
 */
async function assertServerUp(baseUrl: string): Promise<void> {
  try {
    const response = await fetch(baseUrl, { method: "HEAD" });
    if (!response.ok && response.status >= 500) {
      throw new Error(`responded ${response.status}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No app at ${baseUrl} (${detail}).\n` +
        `Start one first:  npm run dev\n` +
        `Or point elsewhere:  PROMO_BASE_URL=https://... npm run promo`,
    );
  }
}

/** Boards built from three operator-chosen answers rather than from the seed. */
function boardsFromSlugs(
  slugs: string[],
  drivers: readonly PromoDriver[],
  referenceYear: number,
  today: Date,
  rng: () => number,
): PromoBoard[] {
  const bySlug = new Map(drivers.map((driver) => [driver.slug, driver]));

  return slugs.map((slug) => {
    const target = bySlug.get(slug);
    if (!target) throw new Error(`--drivers: unknown slug "${slug}"`);

    // The tier is DERIVED from the chosen driver, never assumed from position.
    // Overriding with three current-era drivers should print EASY three times
    // rather than mislabel two of them, because the label is a claim about the
    // driver and the operator can see it is wrong.
    const tier = promoTier(target.lastActiveYear, referenceYear);
    const pool = guessPoolFor(tier, drivers, referenceYear);
    // Same per-board draw planBoards makes, so overriding the answers does not
    // silently pin every board back to the minimum row count.
    const rows = MIN_GUESS_ROWS + Math.floor(rng() * (MAX_GUESS_ROWS - MIN_GUESS_ROWS + 1));

    return {
      tier,
      label: TIER_LABELS[tier],
      target,
      guesses: pickWrongGuesses(target, pool, today, rng, rows),
    };
  });
}

interface Slide {
  file: string;
  url: string;
}

function slidesFor(boards: PromoBoard[], baseUrl: string, flags: boolean): Slide[] {
  const boardSlides = boards.map((board, index) => {
    const params = new URLSearchParams({
      driver: board.target.slug,
      guesses: board.guesses.map((guess) => guess.slug).join(","),
      label: board.label,
      // Omitted entirely when off, rather than sent as flags=0: the route tests
      // for "1", so an absent param and an explicit off are the same thing, and
      // a shorter URL is easier to paste into a browser to preview a slide.
      ...(flags ? { flags: "1" } : {}),
    });
    return {
      file: `0${index + 2}-board-${board.tier}.png`,
      url: `${baseUrl}/promo/board?${params.toString()}`,
    };
  });

  return [
    { file: "01-teaser.png", url: `${baseUrl}/promo/teaser` },
    ...boardSlides,
    { file: "05-cta.png", url: `${baseUrl}/promo/cta` },
  ];
}

/** Returns anything the operator should see AFTER the file list, not buried above it. */
async function shoot(browser: Browser, slides: Slide[], outDir: string): Promise<string[]> {
  const warnings: string[] = [];

  const context = await browser.newContext({
    viewport: { width: PROMO_WIDTH, height: PROMO_HEIGHT },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    // The tiles carry `animate-tile-reveal` with a 70ms-per-column stagger, and
    // every one of them is `motion-reduce:animate-none`. Honouring the reduced-
    // motion signal is what makes the export DETERMINISTIC -- the alternative is
    // sleeping past the animation and hoping, which is a flaky screenshot on a
    // slow machine and a half-revealed board on an unlucky one.
    reducedMotion: "reduce",
  });

  const page = await context.newPage();

  for (const slide of slides) {
    // `load`, then wait on the two things that actually decide whether the
    // slide is finished. NOT `networkidle`: Next's dev server holds an HMR
    // socket open, so the network never goes idle and the wait burns its whole
    // 30s timeout — measured here, on the fourth slide of a five-slide run,
    // after three had succeeded. That flakiness is why Playwright discourages
    // networkidle generally; against `next dev` it is not a race but a
    // guaranteed failure that happens to be masked by whatever else is loading.
    //
    // The generous timeout is for dev-mode route compilation on a cold slide.
    await page.goto(slide.url, { waitUntil: "load", timeout: 60_000 });

    // Next's dev-tools indicator renders into a <nextjs-portal> custom element
    // and floats over the bottom-left corner — it was in the first run's exports
    // as a black circle on every slide. It is dev-only, so this is a no-op
    // against a production origin, but the normal way to generate these is
    // `npm run dev` and a promo image with the framework's debug button on it is
    // not shippable.
    //
    // Re-applied per navigation, because a page's injected styles do not survive
    // one. And hidden here rather than by setting `devIndicators: false` in
    // next.config.ts, which would take the indicator away from everyday
    // development for the sake of a screenshot script: this is a fact about the
    // camera, not about the app.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

    // Geist arrives as a webfont. Screenshot before it lands and the slide
    // renders in the fallback face, which is a subtly wrong image rather than an
    // obviously broken one — the kind that ships.
    await page.evaluate(() => document.fonts.ready);

    // The wordmark goes through next/image, so its request is still in flight at
    // `load` and the slide would otherwise export with a gap where the logo
    // belongs. `naturalWidth > 0` and not just `complete`, because a FAILED
    // image is also "complete" and would wait forever on the wrong condition.
    await page.waitForFunction(
      () => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
      undefined,
      { timeout: 30_000 },
    );

    const buffer = await page.screenshot({ type: "png" });
    await writeFile(path.join(outDir, slide.file), buffer);
    console.log(`  ${slide.file}`);

    warnings.push(...(await ctaUrlWarning(page)));
  }

  await context.close();
  return warnings;
}

/**
 * Flags a CTA slide advertising a localhost address.
 *
 * `SITE_URL` falls back to `http://localhost:3000` when NEXT_PUBLIC_SITE_URL is
 * unset, which is right for the app and wrong for a poster: the obvious way to
 * run this script is against `npm run dev`, and the first export of the CTA
 * slide read "localhost:3000" in 48px mono. Nothing about that looks like an
 * error until it is already posted.
 *
 * Read off the RENDERED page rather than from this process's env, because the
 * page is rendered by a different process — pointing PROMO_BASE_URL at a
 * deployed origin means the script's own `.env` says nothing about what the
 * slide will say.
 *
 * A warning rather than a throw: the four board slides are still perfectly good,
 * and failing the run would throw them away over one fixable slide.
 */
async function ctaUrlWarning(page: Page): Promise<string[]> {
  const declared = await page
    .locator("[data-promo-url]")
    .first()
    .getAttribute("data-promo-url")
    .catch(() => null);

  if (declared && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(declared)) {
    return [
      `The CTA slide advertises "${declared}".\n` +
        `  Set NEXT_PUBLIC_SITE_URL in .env and restart the server, then re-run.`,
    ];
  }
  return [];
}

async function main(): Promise<void> {
  const options = parseOptions();
  console.log(`Seed:   ${options.seed}`);
  console.log(`Base:   ${options.baseUrl}`);
  // Printed for the same reason the seed is: PowerShell eats a bare `--`, so a
  // flag can silently fail to arrive, and "did that run use flags?" should be
  // answerable from the log rather than by squinting at the nationality column.
  console.log(`Nation: ${options.flags ? "flags" : "words"}`);

  await assertServerUp(options.baseUrl);

  const drivers = await listPromoDrivers();
  if (drivers.length === 0) {
    throw new Error("No drivers with an f1db_id — has the roster been seeded? (npm run db:seed:commit)");
  }

  const today = new Date();
  const referenceYear = today.getUTCFullYear();
  const rng = createRng(options.seed);

  const boards = options.driverSlugs
    ? boardsFromSlugs(options.driverSlugs, drivers, referenceYear, today, rng)
    : planBoards(drivers, referenceYear, today, rng);

  const outDir = path.join(process.cwd(), "out", "promo", today.toISOString().slice(0, 10));
  await mkdir(outDir, { recursive: true });

  let browser: Browser | undefined;
  try {
    // `channel: "chromium"` runs the FULL browser in new-headless mode. Without
    // it Playwright launches `chromium_headless_shell`, which is a SEPARATE
    // download from `npx playwright install chromium` and fails with an
    // "Executable doesn't exist" that names a directory the install just
    // reported creating. The full build is also the more faithful renderer of
    // the two, which is the whole reason these images are screenshots.
    browser = await chromium.launch({ channel: "chromium" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not launch Chromium (${detail}).\nInstall it once:  npx playwright install chromium`);
  }

  let warnings: string[] = [];
  try {
    console.log(`\nWriting ${path.relative(process.cwd(), outDir)}:`);
    warnings = await shoot(browser, slidesFor(boards, options.baseUrl, options.flags), outDir);
  } finally {
    await browser.close();
  }

  // THE ANSWERS GO HERE AND NOWHERE ELSE. The board route never renders the
  // target -- it reads it only to colour tiles -- so this console output is the
  // only record of what the three puzzles are. Whoever posts the carousel needs
  // it to write the caption; the images must not carry it.
  console.log("\nAnswers (not rendered on any slide):");
  for (const board of boards) {
    console.log(
      `  ${board.label.padEnd(7)} ${board.target.fullName} (${board.target.slug})` +
        ` — shown: ${board.guesses.map((guess) => guess.fullName).join(", ")}`,
    );
  }
  console.log(`\nReproduce this exact carousel:  --seed=${options.seed}`);

  // Last, so it is the thing left on screen. A warning printed before the file
  // list scrolls away behind the part the operator was waiting for.
  for (const warning of warnings) {
    console.warn(`\nWARNING: ${warning}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\npromo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // The postgres client holds the process open otherwise, so a successful run
    // would hang at the end and read as a stuck script.
    await client.end();
  });
