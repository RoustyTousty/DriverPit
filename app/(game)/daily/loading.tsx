// Next.js wraps daily/page.tsx in a Suspense boundary keyed off this file,
// so switching to Daily shows this the instant navigation starts -- while
// the server fetches eligible drivers -- instead of the tab appearing to
// do nothing until the whole page arrives.
export default function DailyLoading() {
  return (
    <div className="mx-auto flex w-full flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">Daily</p>
      </header>
      <div className="py-12 text-center text-sm text-text-muted">Loading…</div>
    </div>
  );
}
