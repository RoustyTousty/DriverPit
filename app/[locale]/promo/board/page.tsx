import { setRequestLocale } from "next-intl/server";

import { GuessGrid, type Guess } from "@/components/game/GuessGrid";
import { PromoFrame } from "@/components/promo/PromoFrame";
import { listPromoDrivers } from "@/lib/db/promoDrivers";
import { compare } from "@/lib/game/compare";
import { MAX_GUESSES } from "@/lib/game/constants";
import { BOARD_SCALE, BOARD_WIDTH } from "@/lib/promo/frame";
import { toComparable, toDriverSummary, type PromoDriver } from "@/lib/promo/select";

/**
 * One board slide: three filled guess rows over three empty answer slots.
 *
 * THE BOARD IS THE REAL COMPONENT. `GuessGrid` is the same export daily,
 * infinite and duel all render, fed the same `Guess[]` shape the guess RPCs
 * return, coloured by the same `compare()` the game scores with. That is the
 * whole premise of generating these by screenshot rather than in a design tool:
 * a tile that changes in the game changes here, in the next run, with nobody
 * remembering this route exists.
 *
 * The empty answer rows are free — `GuessGrid` renders `maxGuesses - guesses.length`
 * dashed placeholders itself, so passing three guesses against MAX_GUESSES gives
 * exactly the unfinished board the carousel is selling. There is no promo-only
 * copy of that geometry, and there must not be one.
 *
 * Query params:
 *   driver  — f1db slug of the ANSWER. Used only to compute tile colours. Never
 *             rendered: see the note on `target` below.
 *   guesses — comma-separated f1db slugs, rendered top to bottom in order.
 *   label   — the difficulty word printed top-left ("EASY").
 *   flags   — "1" to draw nationality as a flag glyph instead of the country
 *             name. Off by default: a promo image has to explain itself to
 *             someone who has never seen the game, and the country name does
 *             that where a 24px flag does not.
 */

// searchParams already makes this dynamic; stating it is documentation for the
// next person, since a cached promo board would serve one run's drivers forever.
export const dynamic = "force-dynamic";

function slugList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
}

// A slide that says what is wrong, rather than a blank frame. The script
// screenshots whatever this route returns, so a silent failure ships a
// beautiful empty rectangle to whoever is posting the carousel.
function PromoError({ message }: { message: string }) {
  return (
    <PromoFrame label="ERROR">
      <p className="max-w-2xl text-center font-mono text-2xl leading-relaxed text-text">{message}</p>
    </PromoFrame>
  );
}

export default async function PromoBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const query = await searchParams;
  const first = (key: string): string | undefined => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const targetSlug = first("driver");
  const guessSlugs = slugList(first("guesses"));
  const label = first("label");
  const showFlags = first("flags") === "1";

  if (!targetSlug) {
    return <PromoError message="Missing ?driver= — the answer slug is required to colour the tiles." />;
  }

  const drivers = await listPromoDrivers();
  const bySlug = new Map<string, PromoDriver>(drivers.map((driver) => [driver.slug, driver]));

  const target = bySlug.get(targetSlug);
  if (!target) {
    return <PromoError message={`Unknown driver slug "${targetSlug}".`} />;
  }

  const missing = guessSlugs.filter((slug) => !bySlug.has(slug));
  if (missing.length > 0) {
    return <PromoError message={`Unknown guess slug${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`} />;
  }

  // One clock for every row on the slide. `compare()` takes `today` because age
  // is derived rather than stored, and calling `new Date()` per row would let a
  // board straddle midnight and print two different ages for the same driver.
  const today = new Date();
  const comparableTarget = toComparable(target);

  const guesses: Guess[] = guessSlugs.map((slug) => {
    const driver = bySlug.get(slug) as PromoDriver;
    return {
      guessedDriver: toDriverSummary(driver, today),
      result: compare(toComparable(driver), comparableTarget, today),
    };
  });

  return (
    <PromoFrame label={label}>
      {/*
        Rendered at the live game window's width and scaled up as a whole — see
        lib/promo/frame.ts for why scaling rather than widening is what keeps
        this pixel-identical to the game.

        `transform` leaves the layout box at BOARD_WIDTH, so the flex parent
        centres the unscaled box and the scaled render stays centred on the same
        point.
      */}
      <div style={{ width: BOARD_WIDTH, transform: `scale(${BOARD_SCALE})` }}>
        <GuessGrid guesses={guesses} maxGuesses={MAX_GUESSES} showFlags={showFlags} />
      </div>

      {/*
        The ANSWER IS NEVER RENDERED. `target` exists to colour tiles and for
        nothing else — no name, no code, no aria-label, no data attribute. The
        script prints it to the operator's console instead (scripts/promo.ts), so
        the person posting the carousel knows the answers and the image does not
        carry them. Anything added below must not read `target`.
      */}
    </PromoFrame>
  );
}
