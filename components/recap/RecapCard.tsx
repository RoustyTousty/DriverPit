import type { DailyRecap } from "@/lib/db/dailyRecap";
import { PALETTE } from "@/lib/game/palette";
import {
  barWidthPercent,
  fitTextSize,
  formatAverageGuesses,
  formatCount,
  formatPercent,
  formatRecapDate,
  type RecapImageFormat,
  SANS_ADVANCE,
} from "@/lib/recap/format";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/seo/site";

// The daily recap as a shareable image. Rendered ONLY by Satori
// (app/api/recap/[date]/image/route.tsx, and Pass 3's archive opengraph-image),
// never in a browser -- which is why it imports lib/seo/site.ts, a server-only
// module, and why every rule below is a Satori rule rather than a CSS one:
//
//   flexbox only, `display: flex` on anything with more than one child, no CSS
//   variables (hence PALETTE), no `gap` (margins instead), ttf fonts only, and
//   text wraps but never shrinks -- see fitTextSize.
//
// A layout that renders in Chrome is not evidence it renders here. Verify by
// producing a PNG, per docs/seo-roadmap.md's "Verifying an OG image".

/**
 * Below this many players the portrait card omits the distribution and the
 * most-guessed block rather than charting a handful of games.
 *
 * The threshold is not about statistics, it is about credibility: a bar chart
 * built from three players is a claim the data cannot support, and a recap
 * poster is the one artefact here whose whole value is that its numbers are
 * real. Exported because Pass 3's archive page and the social poster both have
 * to make the same call about the same day.
 */
export const MIN_RECAP_SAMPLE = 25;

// Bars are muted by default with exactly one highlight per group, which is what
// keeps a data-heavy card inside the site's orange discipline (CLAUDE.md's
// design system: accent is for one thing at a time, never a section fill).
const BAR_TRACK = PALETTE.surface2;
const BAR_FILL = "#3c4552";

// Tile padding, shared between the tile's own style and the box AnswerRow hands
// to fitTextSize — two numbers that disagree means text fitted to a box it is
// not actually laid out in.
const TILE_PAD_X = 8;
const TILE_PAD_BOTTOM = 8;

interface Dims {
  width: number;
  height: number;
  padX: number;
  padY: number;
  mark: number;
  wordmark: number;
  meta: number;
  caption: number;
  name: number;
  // The name's box is a FIXED height of one line, in every format. Two lines
  // would overflow the breakdown layout's footer, and a name block whose height
  // depends on the driver makes the whole card's vertical budget depend on who
  // won the day. The longest name in the daily pool ("Giancarlo Fisichella")
  // fits at full size; the five longest on the whole roster shrink instead of
  // wrapping, which is the trade this fixes.
  nameHeight: number;
  tileHeight: number;
  tileValue: number;
  tileLabel: number;
  badgeWidth: number;
  tileGap: number;
  statHeight: number;
  statValue: number;
  statLabel: number;
  block: number;
  footer: number;
}

const PORTRAIT: Dims = {
  width: 1080,
  height: 1350,
  padX: 64,
  padY: 56,
  mark: 44,
  wordmark: 42,
  meta: 26,
  caption: 22,
  name: 72,
  nameHeight: 88,
  tileHeight: 104,
  tileValue: 30,
  tileLabel: 16,
  badgeWidth: 116,
  tileGap: 12,
  statHeight: 132,
  statValue: 54,
  statLabel: 20,
  block: 20,
  footer: 24,
};

// Portrait with the breakdown withheld. Not the same numbers scaled up for the
// sake of it: with two blocks gone, PORTRAIT's type leaves roughly a third of a
// 1080x1350 frame blank, which reads as a failed render rather than as a
// deliberately quiet card. The answer becomes the whole poster instead.
const PORTRAIT_SOLO: Dims = {
  ...PORTRAIT,
  name: 92,
  nameHeight: 112,
  tileHeight: 136,
  tileValue: 36,
  tileLabel: 18,
  badgeWidth: 140,
  statHeight: 168,
  statValue: 68,
  statLabel: 23,
  block: 28,
};

const WIDE: Dims = {
  width: 1200,
  height: 630,
  padX: 56,
  padY: 44,
  mark: 34,
  wordmark: 34,
  meta: 22,
  caption: 18,
  name: 60,
  nameHeight: 74,
  tileHeight: 92,
  tileValue: 27,
  tileLabel: 14,
  badgeWidth: 104,
  tileGap: 10,
  statHeight: 120,
  statValue: 48,
  statLabel: 18,
  block: 18,
  footer: 21,
};

function SectionTitle({ children, size }: { children: string; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: "Geist Mono",
        fontWeight: 700,
        fontSize: size,
        letterSpacing: 3,
        color: PALETTE.textMuted,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

// The winning row exactly as the board draws it: the driver-code badge on the
// left, then the five attribute tiles. Every tile is green because every tile
// on the answer's own row IS exact -- this is the row a solver saw, not a
// decoration. The badge reads horizontally rather than rotated -90deg like
// GuessGrid's, because that rotation exists to fit a 28px column and there is
// no such constraint at poster width.
function AnswerRow({ recap, dims }: { recap: DailyRecap; dims: Dims }) {
  const { target } = recap;
  // The tiles are flex-sized, so their box has to be derived rather than read:
  // fitTextSize needs a real width and height or it cannot tell a value that
  // wraps from one that clips. Five equal tiles share what is left of the
  // content width after the badge and the five gaps (four between tiles, one
  // after the badge).
  const tileInnerWidth =
    (dims.width - dims.padX * 2 - dims.badgeWidth - dims.tileGap * 5) / 5 - TILE_PAD_X * 2;
  const tilePadTop = Math.round(dims.tileHeight * 0.13);
  const tileInnerHeight = dims.tileHeight - tilePadTop - TILE_PAD_BOTTOM - dims.tileLabel;
  const tileBox = { width: tileInnerWidth, height: tileInnerHeight };

  const tiles: { label: string; value: string }[] = [
    { label: "NATION", value: target.nationality },
    { label: "TEAM", value: target.lastTeam ?? "—" },
    { label: "AGE", value: String(target.age) },
    { label: "DEBUT", value: String(target.debutYear) },
    { label: "WINS", value: String(target.careerWins) },
  ];

  return (
    <div style={{ display: "flex", width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: dims.badgeWidth,
          height: dims.tileHeight,
          marginRight: dims.tileGap,
          borderRadius: 12,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: PALETTE.border,
          backgroundColor: PALETTE.surface2,
          fontFamily: "Geist Mono",
          fontWeight: 700,
          fontSize: dims.tileValue,
          letterSpacing: 2,
          color: PALETTE.textMuted,
        }}
      >
        {target.driverCode ?? "—"}
      </div>
      {tiles.map((tile, index) => (
        <div
          key={tile.label}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flexGrow: 1,
            flexBasis: 0,
            height: dims.tileHeight,
            marginRight: index === tiles.length - 1 ? 0 : dims.tileGap,
            paddingTop: tilePadTop,
            paddingLeft: TILE_PAD_X,
            paddingRight: TILE_PAD_X,
            paddingBottom: TILE_PAD_BOTTOM,
            borderRadius: 12,
            backgroundColor: PALETTE.correct,
            overflow: "hidden",
          }}
        >
          {/* Pinned to the top of the tile rather than centred with the value:
              a two-line value ("United Kingdom") otherwise pushes its own
              label up, and the five labels stop sitting on one line. */}
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              fontFamily: "Geist Mono",
              fontWeight: 700,
              fontSize: dims.tileLabel,
              letterSpacing: 1.4,
              color: "#ffffff",
              opacity: 0.7,
            }}
          >
            {tile.label}
          </div>
          <div
            style={{
              display: "flex",
              flexGrow: 1,
              alignItems: "center",
              justifyContent: "center",
              // Backstop, not the fix: fitTextSize is what keeps the value
              // inside this box. Without it a value that overflows is centred,
              // so it grows UPWARDS over the label as well as down.
              overflow: "hidden",
              textAlign: "center",
              fontFamily: "Geist Mono",
              fontWeight: 700,
              fontSize: fitTextSize(tile.value, dims.tileValue, tileBox),
              lineHeight: 1.15,
              color: "#ffffff",
            }}
          >
            {tile.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatCell({
  value,
  label,
  dims,
  stacked,
  last,
}: {
  value: string;
  label: string;
  dims: Dims;
  stacked: boolean;
  last: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        flexGrow: 1,
        flexBasis: 0,
        height: stacked ? undefined : dims.statHeight,
        paddingLeft: 26,
        paddingRight: 26,
        marginRight: stacked || last ? 0 : dims.tileGap,
        marginBottom: stacked && !last ? dims.tileGap : 0,
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          fontFamily: "Geist Mono",
          fontWeight: 700,
          fontSize: dims.statValue,
          color: PALETTE.text,
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: dims.statLabel,
          letterSpacing: 1.2,
          color: PALETTE.textMuted,
          marginTop: 6,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function StatTrio({ recap, dims }: { recap: DailyRecap; dims: Dims }) {
  const cells = [
    { value: formatCount(recap.players), label: "PLAYERS" },
    { value: formatPercent(recap.solveRate), label: "SOLVE RATE" },
    { value: formatAverageGuesses(recap.averageGuesses), label: "AVG GUESSES" },
  ];
  return (
    <div style={{ display: "flex", width: "100%" }}>
      {cells.map((cell, index) => (
        <StatCell
          key={cell.label}
          value={cell.value}
          label={cell.label}
          dims={dims}
          stacked={false}
          last={index === cells.length - 1}
        />
      ))}
    </div>
  );
}

function BarRow({
  leading,
  leadingWidth,
  leadingMono,
  trailing,
  width,
  fill,
  height,
  fontSize,
  last,
}: {
  leading: string;
  leadingWidth: number;
  leadingMono: boolean;
  trailing: string;
  width: string;
  fill: string;
  height: number;
  fontSize: number;
  last: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height,
        marginBottom: last ? 0 : 8,
      }}
    >
      <div
        style={{
          display: "flex",
          width: leadingWidth,
          overflow: "hidden",
          fontFamily: leadingMono ? "Geist Mono" : "Geist",
          fontWeight: 700,
          fontSize,
          color: PALETTE.text,
        }}
      >
        {leading}
      </div>
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          flexBasis: 0,
          height: "100%",
          marginLeft: 14,
          marginRight: 14,
          borderRadius: 8,
          backgroundColor: BAR_TRACK,
        }}
      >
        <div style={{ display: "flex", width, height: "100%", borderRadius: 8, backgroundColor: fill }} />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          width: 92,
          fontFamily: "Geist Mono",
          fontWeight: 700,
          fontSize,
          color: PALETTE.textMuted,
        }}
      >
        {trailing}
      </div>
    </div>
  );
}

function Distribution({ recap, dims }: { recap: DailyRecap; dims: Dims }) {
  const max = Math.max(...recap.distribution);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <SectionTitle size={dims.caption}>SOLVED IN</SectionTitle>
      {recap.distribution.map((count, index) => (
        <BarRow
          key={index}
          leading={String(index + 1)}
          leadingWidth={26}
          leadingMono
          trailing={formatCount(count)}
          width={barWidthPercent(count, max)}
          // One highlight per group: the bucket most players landed in. Ties
          // light up together, which is the honest reading of a tie.
          fill={count > 0 && count === max ? PALETTE.accent : BAR_FILL}
          height={32}
          fontSize={dims.statLabel + 4}
          last={index === recap.distribution.length - 1}
        />
      ))}
    </div>
  );
}

function TopGuesses({ recap, dims }: { recap: DailyRecap; dims: Dims }) {
  const max = Math.max(...recap.topGuesses.map((guess) => guess.count));
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <SectionTitle size={dims.caption}>MOST GUESSED</SectionTitle>
      {recap.topGuesses.map((guess, index) => (
        <BarRow
          key={guess.driverId}
          leading={guess.fullName}
          leadingWidth={300}
          leadingMono={false}
          trailing={formatPercent(guess.share)}
          width={barWidthPercent(guess.count, max)}
          // The answer's own bar is green for the same reason the tiles above
          // it are: on this board green means "this is the driver". Everyone
          // who solved the day guessed them, so it is usually the longest bar,
          // and saying so is more interesting than hiding it.
          fill={guess.driverId === recap.target.id ? PALETTE.correct : BAR_FILL}
          height={36}
          fontSize={dims.statLabel + 4}
          last={index === recap.topGuesses.length - 1}
        />
      ))}
    </div>
  );
}

// What stands in for the two withheld blocks. A day with a handful of players
// has nothing further to say about itself that is TRUE, so the space goes to
// the one thing that is: what the game is.
//
// Deliberately unboxed. The first cut gave it the stat cells' surface panel and
// hairline border, which turned the bottom third of the poster into a large
// empty container with a sentence in it -- the exact "hole in the layout" read
// that AdSlotGate collapses its slot to avoid. Without the chrome the same
// space is generous whitespace with a closing line, which is what a quiet day
// should look like.
function PlayCallout({ dims }: { dims: Dims }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flexGrow: 1,
        width: "100%",
        paddingLeft: 40,
        paddingRight: 40,
      }}
    >
      <div
        style={{
          width: dims.mark,
          height: dims.mark,
          borderRadius: Math.round(dims.mark / 4),
          backgroundColor: PALETTE.accent,
          marginBottom: 28,
        }}
      />
      <div style={{ display: "flex", fontSize: 48, fontWeight: 700, textAlign: "center", lineHeight: 1.15 }}>
        A new driver every day
      </div>
      <div
        style={{
          display: "flex",
          fontSize: dims.statLabel + 5,
          color: PALETTE.textMuted,
          textAlign: "center",
          marginTop: 16,
        }}
      >
        Six guesses, five clues, one Formula 1 driver.
      </div>
    </div>
  );
}

export function RecapCard({ recap, format }: { recap: DailyRecap; format: RecapImageFormat }) {
  // The wide card is a link preview, seen at a few hundred pixels in a feed, so
  // it carries the answer and the three headline numbers and stops there. The
  // portrait card is the poster -- a 1080x1350 image someone actually opens --
  // and is the only one where a six-bar chart is legible enough to be worth the
  // space. The sample guard therefore only ever applies to portrait.
  const showBreakdown = format === "portrait" && recap.players >= MIN_RECAP_SAMPLE;
  const dims = format === "wide" ? WIDE : showBreakdown ? PORTRAIT : PORTRAIT_SOLO;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        paddingTop: dims.padY,
        paddingBottom: dims.padY,
        paddingLeft: dims.padX,
        paddingRight: dims.padX,
        backgroundColor: PALETTE.bg,
        fontFamily: "Geist",
        color: PALETTE.text,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, width: "100%" }}>
        {/* Header: the wordmark, and which day this is. The puzzle NUMBER is
            safe to print -- it says which day, never who the driver is. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            marginBottom: dims.block * 2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: dims.mark,
                height: dims.mark,
                borderRadius: Math.round(dims.mark / 4),
                backgroundColor: PALETTE.accent,
                marginRight: 18,
              }}
            />
            <div style={{ display: "flex", fontSize: dims.wordmark, fontWeight: 700, letterSpacing: -0.5 }}>
              {SITE_NAME}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div
              style={{
                display: "flex",
                fontFamily: "Geist Mono",
                fontWeight: 700,
                fontSize: dims.meta + 4,
                color: PALETTE.accent,
              }}
            >
              {`PUZZLE #${recap.puzzleNumber}`}
            </div>
            <div style={{ display: "flex", fontSize: dims.meta, color: PALETTE.textMuted, marginTop: 4 }}>
              {formatRecapDate(recap.date)}
            </div>
          </div>
        </div>

        <SectionTitle size={dims.caption}>THE ANSWER</SectionTitle>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: dims.nameHeight,
            overflow: "hidden",
            fontSize: fitTextSize(
              recap.target.fullName,
              dims.name,
              { width: dims.width - dims.padX * 2, height: dims.nameHeight },
              SANS_ADVANCE,
            ),
            fontWeight: 700,
            letterSpacing: -1.5,
            lineHeight: 1.1,
            marginBottom: dims.block,
          }}
        >
          {recap.target.fullName}
        </div>
        <AnswerRow recap={recap} dims={dims} />

        <div style={{ display: "flex", width: "100%", marginTop: dims.block * 2 }}>
          <StatTrio recap={recap} dims={dims} />
        </div>

        {showBreakdown ? (
          <div style={{ display: "flex", width: "100%", marginTop: dims.block * 2 }}>
            <Distribution recap={recap} dims={dims} />
          </div>
        ) : null}

        {showBreakdown && recap.topGuesses.length > 0 ? (
          <div style={{ display: "flex", width: "100%", marginTop: dims.block * 2 }}>
            <TopGuesses recap={recap} dims={dims} />
          </div>
        ) : null}

        {format === "portrait" && !showBreakdown ? <PlayCallout dims={dims} /> : null}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          fontSize: dims.footer,
          color: PALETTE.textMuted,
        }}
      >
        <div style={{ display: "flex" }}>{SITE_TAGLINE}</div>
        <div style={{ display: "flex", fontWeight: 700, color: PALETTE.text }}>
          {SITE_URL.replace(/^https?:\/\//, "")}
        </div>
      </div>
    </div>
  );
}
