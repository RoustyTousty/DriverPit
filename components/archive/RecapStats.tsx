import { useTranslations } from "next-intl";
import type { DailyRecap } from "@/lib/db/dailyRecap";
import { MIN_RECAP_SAMPLE } from "@/components/recap/RecapCard";
import { barWidthPercent, formatAverageGuesses, formatCount, formatPercent } from "@/lib/recap/format";

// The day's numbers, as the page renders them.
//
// DELIBERATELY NOT gated on MIN_RECAP_SAMPLE the way the poster is. The card's
// guard exists because a bar chart built from three players is a claim the data
// cannot support once it is out in the world as an image with no context. A
// page is the context: the raw counts sit beside every bar, the sample line
// below says how big the sample was, and hiding the only substance a quiet
// day has would leave an indexable page with nothing on it -- which is the
// thin content this whole pass exists to avoid.

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <span className="font-mono text-2xl leading-none font-bold tabular-nums text-text">{value}</span>
      <span className="text-xs tracking-wide text-text-muted uppercase">{label}</span>
    </div>
  );
}

// One highlight per group and never more: a chart where every bar is accent is
// the "more than ~10% of a screen is orange" failure the design system names.
function Bar({ width, fill = "bg-border" }: { width: string; fill?: string }) {
  return (
    <div className="h-full flex-1 overflow-hidden rounded bg-surface-2">
      <div className={`h-full rounded ${fill}`} style={{ width }} />
    </div>
  );
}

function Distribution({ recap }: { recap: DailyRecap }) {
  const t = useTranslations("archive.stats");
  const max = Math.max(...recap.distribution);
  if (max === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{t("solvedIn")}</h2>
      <ul className="flex flex-col gap-2">
        {recap.distribution.map((count, index) => (
          <li key={index} className="flex h-7 items-center gap-3">
            <span className="w-4 shrink-0 font-mono text-sm font-bold tabular-nums text-text">
              {index + 1}
            </span>
            {/* The bar is decoration; the count beside it is the value, so the
                row is readable with no colour and no width. */}
            <Bar width={barWidthPercent(count, max)} fill={count === max ? "bg-accent" : undefined} />
            <span className="w-10 shrink-0 text-right font-mono text-sm tabular-nums text-text-muted">
              {count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopGuesses({ recap }: { recap: DailyRecap }) {
  const t = useTranslations("archive.stats");
  if (recap.topGuesses.length === 0) return null;
  const max = Math.max(...recap.topGuesses.map((guess) => guess.count));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{t("mostGuessed")}</h2>
      <ul className="flex flex-col gap-2">
        {recap.topGuesses.map((guess) => (
          <li key={guess.driverId} className="flex h-7 items-center gap-3">
            <span className="w-32 shrink-0 truncate text-sm font-semibold text-text sm:w-44">
              {guess.fullName}
            </span>
            {/* Green on the answer's own bar, for the same reason the tiles
                above are green: on this board green means "this is the driver". */}
            <Bar
              width={barWidthPercent(guess.count, max)}
              fill={guess.driverId === recap.target.id ? "bg-correct" : undefined}
            />
            <span className="w-10 shrink-0 text-right font-mono text-sm tabular-nums text-text-muted">
              {formatPercent(guess.share)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RecapStats({ recap }: { recap: DailyRecap }) {
  const t = useTranslations("archive.stats");
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 sm:flex-row">
        <StatCell value={formatCount(recap.players)} label={t("players")} />
        <StatCell value={formatPercent(recap.solveRate)} label={t("solveRate")} />
        <StatCell value={formatAverageGuesses(recap.averageGuesses)} label={t("avgGuesses")} />
      </div>

      <Distribution recap={recap} />
      <TopGuesses recap={recap} />

      {recap.players > 0 && recap.players < MIN_RECAP_SAMPLE && (
        <p className="text-xs text-text-muted">{t("smallSample", { count: recap.players })}</p>
      )}
    </div>
  );
}
