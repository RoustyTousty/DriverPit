import { useTranslations } from "next-intl";

// Same purpose as daily/loading.tsx -- instant fallback the moment the
// Infinite tab is clicked, instead of a blank pause while the server
// fetches the roster (and then, on mount, picks the round's driver).
export default function InfiniteLoading() {
  const t = useTranslations("nav.modes");

  return (
    <div className="mx-auto flex w-full flex-col gap-4 px-4 py-6">
      <header>
        {/* A <p>, not an <h1>, and it must stay one. This skeleton streams as
            part of the initial shell and the real page's own <h1> arrives
            after it, so an <h1> here puts TWO of them in the delivered HTML --
            which is what Bing's SEO report flagged on all three game routes.
            Styling is identical, so nothing moves visually. */}
        <p className="text-xl font-bold text-text sm:text-2xl">DriverPit</p>
        <p className="text-sm text-text-muted">{t("infinite")}</p>
      </header>
      <div className="py-12 text-center text-sm text-text-muted">Loading…</div>
    </div>
  );
}
