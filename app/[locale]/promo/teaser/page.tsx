import { setRequestLocale } from "next-intl/server";

import { PromoFrame } from "@/components/promo/PromoFrame";

/**
 * Slide 1 — the only slide whose job is to earn the swipe.
 *
 * IT TEASES, IT DOES NOT EXPLAIN. An earlier draft spent its middle on how the
 * game works (five clues, named one by one), which is information nobody has
 * asked for yet: a first slide is not read, it is judged, and a rules summary
 * is the shape of thing a thumb moves past. What survives is a question and a
 * promise of three specific things behind it — the reader has to swipe to find
 * out whether they would have got them.
 *
 * THE COPY BELOW IS MEANT TO BE EDITED. It is plain literals rather than
 * message-catalogue keys on purpose: `npm run i18n:translate` regenerates the
 * five non-English catalogues from messages/en.json, and a promo slide is a
 * hand-tuned piece of marketing copy for one campaign, not site text. Adding
 * these keys would put them in front of a translator on every run and would make
 * a one-off wording change a six-file diff.
 */

const HOOK = "Name the";
const HOOK_ACCENT = "F1 driver";
const CHALLENGE = "Three boards. Easy, medium, hard.";
const STAKE = "Most people miss the last one.";
const SWIPE = "Swipe";

/**
 * The swipe affordance.
 *
 * A right-pointing arrow because that is the direction of the gesture on every
 * surface this gets posted to, and a heavy one because it has to register in a
 * feed at thumbnail size. It is the second and last use of the accent on this
 * slide — the site's orange discipline still applies here, and an arrow is worth
 * an accent precisely because it is the one thing on the slide asking for an
 * action.
 */
function SwipeArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-16 w-16 text-accent"
      aria-hidden="true"
    >
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export default async function PromoTeaserPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PromoFrame>
      <div className="flex flex-col items-center gap-12 text-center">
        {/* A question, not a statement. The slide is asking the reader whether
            they can do something, which is the only reliable reason to swipe. */}
        <h1 className="text-8xl leading-[1.05] font-bold tracking-tight text-text">
          {HOOK}
          <br />
          <span className="text-accent">{HOOK_ACCENT}</span>
        </h1>

        <div className="flex flex-col gap-3">
          <p className="text-3xl leading-snug text-text">{CHALLENGE}</p>
          {/* The actual hook. A difficulty ladder is only interesting if the top
              of it is in doubt, so the slide says so outright. */}
          <p className="text-3xl leading-snug text-text-muted">{STAKE}</p>
        </div>

        {/* Bottom of the content block rather than pinned to the frame's right
            edge: PromoFrame centres the wordmark below, and an absolutely
            positioned arrow would collide with it at some copy lengths and not
            others — a layout that breaks depending on the words in it. */}
        <div className="mt-4 flex items-center gap-6">
          <span className="font-mono text-3xl font-bold tracking-[0.35em] text-accent uppercase">
            {SWIPE}
          </span>
          <SwipeArrow />
        </div>
      </div>
    </PromoFrame>
  );
}
