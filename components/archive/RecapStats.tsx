import { useTranslations } from "next-intl";

import { MIN_RECAP_SAMPLE } from "@/components/recap/RecapCard";
import type { DailyRecap } from "@/lib/db/dailyRecap";
import {
  barWidthPercent,
  formatAverageGuesses,
  formatCount,
  formatPercent,
} from "@/lib/recap/format";

// The day's numbers, as the page renders them.
//
// DELIBERATELY NOT gated on MIN_RECAP_SAMPLE the way the poster is. The card's
// guard exists because a bar chart built from three players is a claim the data
// cannot support once it is out in the world as an image with no context. A
// page is the context: the raw counts sit beside every bar, the sample line
// below says how big the sample was, and hiding the only substance a quiet
// day has would leave an indexable page with nothing on it -- which is the
// thin content this whole pass exists to avoid.

// One card split by hairlines rather than three separate boxes. Three bordered
// cards in a row read as three unrelated facts; the three numbers here are one
// reading of one day, and a divided panel says so. Separators are 1px --border,
// which is the site's own rule for what a divider is.
function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-4 text-center">
      <span className="font-mono text-2xl leading-none font-bold tabular-nums text-text">
        {value}
      </span>
      <span className="text-[10px] tracking-wide text-text-muted uppercase sm:text-xs">
        {label}
      </span>
    </div>
  );
}

// A slim track rather than a full-height block. The bar is an at-a-glance
// comparison between rows, not a value in itself -- the number beside it is the
// value -- so it is sized like an annotation.
//
// One highlight per group and never more: a chart where every bar is accent is
// the "more than ~10% of a screen is orange" failure the design system names.
function Bar({ width, fill = "bg-text-muted/45" }: { width: string; fill?: string }) {
  return (
    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full rounded-full ${fill}`} style={{ width }} />
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Distribution({ recap }: { recap: DailyRecap }) {
  const t = useTranslations("archive.stats");
  const max = Math.max(...recap.distribution);
  if (max === 0) return null;

  return (
    <ChartCard title={t("solvedIn")}>
      <ul className="flex flex-col gap-2.5">
        {recap.distribution.map((count, index) => (
          <li key={index} className="flex items-center gap-3">
            <span className="w-4 shrink-0 font-mono text-sm font-bold tabular-nums text-text">
              {index + 1}
            </span>
            {/* The bar is decoration; the count beside it is the value, so the
                row is readable with no colour and no width. */}
            <Bar width={barWidthPercent(count, max)} fill={count === max ? "bg-accent" : undefined} />
            <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums text-text-muted">
              {count}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

function TopGuesses({ recap }: { recap: DailyRecap }) {
  const t = useTranslations("archive.stats");
  if (recap.topGuesses.length === 0) return null;
  const max = Math.max(...recap.topGuesses.map((guess) => guess.count));

  return (
    <ChartCard title={t("mostGuessed")}>
      <ul className="flex flex-col gap-2.5">
        {recap.topGuesses.map((guess) => (
          <li key={guess.driverId} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-sm font-semibold text-text sm:w-44">
              {guess.fullName}
            </span>
            {/* Green on the answer's own bar, for the same reason the tiles
                above are green: on this board green means "this is the driver". */}
            <Bar
              width={barWidthPercent(guess.count, max)}
              fill={guess.driverId === recap.target.id ? "bg-correct" : undefined}
            />
            <span className="w-9 shrink-0 text-right font-mono text-sm tabular-nums text-text-muted">
              {formatPercent(guess.share)}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

export function RecapStats({ recap }: { recap: DailyRecap }) {
  const t = useTranslations("archive.stats");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-surface">
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
