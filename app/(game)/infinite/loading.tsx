// Same purpose as daily/loading.tsx -- instant fallback the moment the
// Infinite tab is clicked, instead of a blank pause while the server
// fetches the roster (and then, on mount, picks the round's driver).
export default function InfiniteLoading() {
  return (
    <div className="mx-auto flex w-full flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">Infinite mode</p>
      </header>
      <div className="py-12 text-center text-sm text-text-muted">Loading…</div>
    </div>
  );
}
