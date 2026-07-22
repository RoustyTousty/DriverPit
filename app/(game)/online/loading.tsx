// Same purpose as daily/loading.tsx and infinite/loading.tsx -- instant
// fallback while online/page.tsx fetches the eligible-driver pool for the
// matchmaking lobby's guess input.
export default function OnlineLoading() {
  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">Online</p>
      </header>
      <div className="py-12 text-center text-sm text-text-muted">Loading…</div>
    </div>
  );
}
