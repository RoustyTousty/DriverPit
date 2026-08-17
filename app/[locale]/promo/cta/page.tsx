import { setRequestLocale } from "next-intl/server";

import { PromoFrame } from "@/components/promo/PromoFrame";
import { SITE_URL } from "@/lib/seo/site";

/**
 * Slide 5 of the carousel — the ask, after the boards.
 *
 * IT ASKS FOR ONE THING. An earlier draft listed all three game modes with a
 * line of explanation each, which is a product tour on the slide whose only job
 * is to move somebody to the site. Nobody scrolling a feed is choosing between
 * modes; they are deciding whether to type an address. Every element that is not
 * the address competes with it.
 *
 * So the address is the largest thing here — larger than the headline, which is
 * deliberate and the opposite of the usual hierarchy. The headline is a caption
 * for the URL rather than the other way round.
 *
 * Same editable-literals rule as the teaser: see its header for why this copy
 * deliberately does not live in the message catalogues.
 *
 * The one value NOT hardcoded is the URL. `SITE_URL` (lib/seo/site.ts) is the
 * origin every canonical, the sitemap and the OG card already resolve from, so a
 * domain move updates the printed address with everything else. A typed domain
 * on a promo image is the one kind of typo that cannot be corrected after
 * posting.
 */

const HEADLINE = "New driver every day";
const FOOTNOTE = "Free · No account needed";

// Printed without the scheme — nobody types "https://" and it costs a third of
// the line's width.
function displayUrl(): string {
  return SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export default async function PromoCtaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PromoFrame>
      <div className="flex w-full flex-col items-center gap-8 text-center">
        <p className="font-mono text-3xl tracking-[0.3em] text-text-muted uppercase">
          {HEADLINE}
        </p>

        {/* The hero. `break-all` because a long domain must shrink the line
            rather than run off a fixed-width frame — there is no reflow to save
            it at 1080px, and an address clipped at the edge is worse than a
            small one. */}
        <p
          data-promo-url={SITE_URL}
          className="max-w-full text-7xl leading-tight font-bold break-all text-accent"
        >
          {displayUrl()}
        </p>

        <p className="text-2xl text-text-muted">{FOOTNOTE}</p>
      </div>
    </PromoFrame>
  );
}
