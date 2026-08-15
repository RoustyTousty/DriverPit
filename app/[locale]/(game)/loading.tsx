import { useTranslations } from "next-intl";

// Next.js wraps page.tsx (the daily game, at `/`) in a Suspense boundary keyed
// off this file, so switching to Daily shows this the instant navigation starts
// -- while the server fetches eligible drivers -- instead of the tab appearing
// to do nothing until the whole page arrives.
//
// It sits at the group root rather than in a `daily/` folder because the daily
// route IS the group root now. It cannot leak onto /infinite or /online: each of
// those has a loading.tsx of its own, nested inside this boundary, and React
// shows the nearest boundary to whatever suspended.
export default function DailyLoading() {
  const t = useTranslations("nav.modes");

  return (
    <div className="mx-auto flex w-full flex-col gap-4 px-4 py-6">
      <header>
        {/* A <p>, not an <h1> -- see infinite/loading.tsx. This skeleton streams
            in the initial shell and the real page contributes its own <h1>, so an
            <h1> here delivers two per page. Styling is identical. */}
        <p className="text-xl font-bold text-text sm:text-2xl">DriverPit</p>
        <p className="text-sm text-text-muted">{t("daily")}</p>
      </header>
      <div className="py-12 text-center text-sm text-text-muted">Loading…</div>
    </div>
  );
}
