// Deliberately NOT an `XTeaser` and deliberately without an app/(info)/
// counterpart: every other block in MarketingSections is a compact summary of a
// full page it links to, and there is no "Support" page to write -- the whole
// ask is a few lines and one link, so a "See more →" would lead somewhere with
// less on it than the teaser. Named Callout rather than Teaser so that
// difference shows at the import.
//
// Built out of the marketing column's existing card idiom rather than a shape
// of its own: `bg-surface-2 p-4` with a hairline border, an `accent-weak` icon
// well holding an `accent` stroke glyph, a `text-sm font-bold` lead and a
// `text-xs text-text-muted` line under it -- which is GameModesTeaser's card,
// exactly. A donation ask is the block most likely to end up looking like an
// advert bolted onto someone else's site, and the cheapest defence is for it to
// be made of the same parts as the four sections above it.
//
// Orange discipline holds at two uses, both of which mean something: the icon
// (matching every mode icon on the page) and the button (the only action in the
// block). No accent fill, no tinted card.
//
// The button carries no caption naming its destination and no ↗ glyph. Both
// were tried; both are the kind of annotation that reads as hedging on an ask
// that works better stated plainly, and the block already says what it is three
// times over before anyone reaches the button.
const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/ecozo";

function CoffeeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M4 8h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z" />
      <path d="M16 9.5h1.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M7.5 2.5V5M12 2.5V5" />
    </svg>
  );
}

export function SupportCallout() {
  return (
    <section id="support" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">Support me</h2>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:gap-4">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-weak text-accent"
          aria-hidden="true"
        >
          <CoffeeIcon />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-text">DriverPit is free, and stays free</p>
          <p className="mt-1 text-xs text-text-muted">
            It&rsquo;s built and run by one person in their spare time — hosting, the domain and the hours all come
            out of the same pocket. A coffee helps keep it going; nothing in the game changes either way.
          </p>
        </div>

        <a
          href={BUY_ME_A_COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:self-auto"
        >
          Buy me a coffee
        </a>
      </div>
    </section>
  );
}
