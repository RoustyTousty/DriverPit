// Same purpose as daily/loading.tsx and infinite/loading.tsx -- instant
// fallback while online/page.tsx fetches the eligible-driver pool for the
// matchmaking lobby's guess input.
//
// Deliberately NOT the blurred overlay treatment DuelRoot's own loading state
// uses: this fires before any of the mode-select UI exists to put behind a
// blur, so there'd be nothing to veil. It stays the plain text fallback, and
// the overlay takes over once there's real content to sit under it.
export default function OnlineLoading() {
  return (
    // Header kept identical to DuelLanding's, down to the padding, so the
    // real screen replaces this without the title moving.
    <div className="flex flex-col gap-3 px-4 py-5">
      <h1 className="text-lg font-bold text-text">Play online</h1>
      <div className="py-12 text-center text-sm text-text-muted">Loading…</div>
    </div>
  );
}
