// Same purpose as daily/loading.tsx and infinite/loading.tsx -- instant
// fallback while duel/page.tsx fetches the eligible-driver pool for the
// matchmaking lobby's guess input.
export default function DuelLoading() {
  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      <div className="py-12 text-center text-sm text-text-muted">Loading…</div>
    </div>
  );
}
