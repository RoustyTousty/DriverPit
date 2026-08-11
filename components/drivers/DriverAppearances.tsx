
import { useTranslations } from "next-intl";
import type { DriverPage } from "@/lib/db/dailyRecap";
import { playedAppearances } from "@/lib/drivers/pageEligibility";
import { formatPercent, formatRecapDate } from "@/lib/recap/format";
import { Link } from "@/lib/i18n/navigation";

// The days this driver was the answer -- the only thing on the page that no
// other site has, and therefore the thing the page exists for.
//
// It renders the PLAYED appearances only, from the same helper the eligibility
// predicate counts, so the list and the reason the page exists cannot disagree.
// A day nobody finished is not hidden out of embarrassment: it supports no
// number in the row (the solve column would read "0 of 0") and it links to an
// archive page that is equally empty.
//
// Every row is a link into the archive. That cross-link is half of what this
// pass is for: it gives a crawler a path from a driver into fourteen dated
// pages, and the archive day page links back the other way.

export function DriverAppearances({ driver }: { driver: DriverPage }) {
  const t = useTranslations("driverPage.appearances");
  const played = playedAppearances(driver.appearances);
  if (played.length === 0) return null;

  const completed = played.reduce((total, day) => total + day.completed, 0);
  const solved = played.reduce((total, day) => total + day.solved, 0);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold tracking-tight text-text">
        {t("heading", { count: played.length })}
      </h2>

      <ul className="flex flex-col gap-2">
        {played.map((day) => (
          <li key={day.date}>
            <Link
              href={`/archive/${day.date}`}
              className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 transition hover:border-accent/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="w-14 shrink-0 font-mono text-sm tabular-nums text-text-muted">
                #{day.puzzleNumber}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                {formatRecapDate(day.date)}
              </span>
              {/* Counts, not a percentage. At these sample sizes "50%" is one
                  player out of two, and the raw pair is the same fact without
                  the false precision -- the rule the recap summary follows in
                  prose, applied to the row. */}
              <span className="shrink-0 text-right font-mono text-xs tabular-nums text-text-muted">
                {day.solved}/{day.completed} solved
                <span className="block">
                  {day.players} {day.players === 1 ? "player" : "players"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Only worth a line once there is more than one day to total up; on a
          single appearance it would restate the row directly above it. */}
      {played.length > 1 && (
        <p className="text-sm text-text-muted">
          Across those {played.length} days, {solved} of {completed} finished boards found them
          {completed > 0 && ` — ${formatPercent(solved / completed)}`}.
        </p>
      )}
    </section>
  );
}
