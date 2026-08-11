import { useTranslations } from "next-intl";

// Same purpose as daily/loading.tsx and infinite/loading.tsx -- instant
// fallback while online/page.tsx fetches the eligible-driver pool for the
// matchmaking lobby's guess input.
//
// Deliberately NOT the blurred overlay treatment DuelRoot's own loading state
// uses: this fires before any of the mode-select UI exists to put behind a
// blur, so there'd be nothing to veil. It stays the plain text fallback, and
// the overlay takes over once there's real content to sit under it.
export default function OnlineLoading() {
  const modes = useTranslations("nav.modes");
  const ui = useTranslations("ui");

  return (
    // Header kept identical to DuelLanding's, down to the padding, so the
    // real screen replaces this without the title moving.
    <div className="flex flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">{modes("online")}</p>
      </header>
      <div className="py-12 text-center text-sm text-text-muted">{ui("loading")}</div>
    </div>
  );
}
