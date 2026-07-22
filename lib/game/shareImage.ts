import type { ExactFeedback, GuessResult, OrderedFeedback, TeamFeedback } from "./compare";

type Feedback = ExactFeedback | OrderedFeedback | TeamFeedback;

// Mirrors components/game/GuessGrid.tsx's Tile exactly (base green/grey +
// an orange overlay scaled by closeness) so the shared image is a faithful
// echo of the real board, not a simplified re-interpretation of it. Colors
// and closeness range straight from CLAUDE.md's design system section.
const COLORS = {
  bg: "#0b0d10",
  border: "#262c35",
  text: "#e7eaee",
  textMuted: "#8a929e",
  accent: "#ff6a00",
  correct: "#2e7d46",
  miss: "#2a2f37",
};
const HISTORICAL_OPACITY = 0.35;
const MIN_ORANGE_OPACITY = 0.12;
const MAX_ORANGE_OPACITY = 0.68;

function tileFill(feedback: Feedback, closeness: number | undefined): { base: string; orangeOpacity: number } {
  const isCorrect = feedback === "exact" || feedback === "correct";
  const isHistorical = feedback === "historical";
  const isOrdered = feedback === "higher" || feedback === "lower";
  const orangeOpacity = isHistorical
    ? HISTORICAL_OPACITY
    : isOrdered
      ? MIN_ORANGE_OPACITY + (closeness ?? 0) * (MAX_ORANGE_OPACITY - MIN_ORANGE_OPACITY)
      : 0;
  return { base: isCorrect ? COLORS.correct : COLORS.miss, orangeOpacity };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

export interface ShareImageOptions {
  puzzleNumber: number;
  results: GuessResult[];
  won: boolean;
  maxGuesses: number;
}

const TILE = 44;
const GAP = 8;
const COLS = 5;
const WIDTH = 560;
// public/driverpit-banner.png is 720x240 (3:1) -- kept at that ratio here so
// it's never stretched.
const BANNER_SRC = "/driverpit-banner.png";
const BANNER_WIDTH = 200;
const BANNER_HEIGHT = (BANNER_WIDTH * 240) / 720;
const BANNER_TOP = 16;
const HEADER_HEIGHT = 165;
const FOOTER_HEIGHT = 60;
const PIXEL_SCALE = 2; // crisp on retina without a huge file
const EMPTY_DASH = [4, 3];

// Never renders the target driver or any attribute values -- colors only,
// same "closeness echo, not a replay" convention as buildShareText's emoji
// grid (lib/game/emojiGrid.ts).
export async function renderResultImage({ puzzleNumber, results, won, maxGuesses }: ShareImageOptions): Promise<Blob> {
  const banner = await loadImage(BANNER_SRC);

  // Always render `maxGuesses` rows -- win in 2 or 6, the card is the same
  // height, padded with the board's own dashed empty-slot style so a shared
  // image never gives away the guess count via its scale.
  const rowHeight = TILE + GAP;
  const gridHeight = maxGuesses * TILE + Math.max(0, maxGuesses - 1) * GAP;
  const height = HEADER_HEIGHT + gridHeight + FOOTER_HEIGHT;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * PIXEL_SCALE;
  canvas.height = height * PIXEL_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.scale(PIXEL_SCALE, PIXEL_SCALE);

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, WIDTH - 1, height - 1, 16);
  ctx.stroke();

  ctx.drawImage(banner, (WIDTH - BANNER_WIDTH) / 2, BANNER_TOP, BANNER_WIDTH, BANNER_HEIGHT);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.font = "500 15px Arial, sans-serif";
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText(`Daily #${puzzleNumber}`, WIDTH / 2, BANNER_TOP + BANNER_HEIGHT + 24);

  const score = won ? `${results.length}/${maxGuesses}` : `X/${maxGuesses}`;
  ctx.font = "700 22px Arial, sans-serif";
  ctx.fillStyle = won ? COLORS.accent : COLORS.text;
  ctx.fillText(score, WIDTH / 2, BANNER_TOP + BANNER_HEIGHT + 58);
  ctx.textAlign = "left";

  const gridWidth = COLS * TILE + (COLS - 1) * GAP;
  const gridX = (WIDTH - gridWidth) / 2;
  let y = HEADER_HEIGHT;
  for (let row = 0; row < maxGuesses; row++) {
    const result = results[row];
    if (result) {
      const columns: { feedback: Feedback; closeness?: number }[] = [
        { feedback: result.nationality },
        { feedback: result.team },
        { feedback: result.age, closeness: result.ageCloseness },
        { feedback: result.debutYear, closeness: result.debutYearCloseness },
        { feedback: result.careerWins, closeness: result.careerWinsCloseness },
      ];
      columns.forEach((column, index) => {
        const x = gridX + index * (TILE + GAP);
        const { base, orangeOpacity } = tileFill(column.feedback, column.closeness);
        ctx.fillStyle = base;
        roundRect(ctx, x, y, TILE, TILE, 8);
        ctx.fill();
        if (orangeOpacity > 0) {
          ctx.save();
          ctx.globalAlpha = orangeOpacity;
          ctx.fillStyle = COLORS.accent;
          roundRect(ctx, x, y, TILE, TILE, 8);
          ctx.fill();
          ctx.restore();
        }
      });
    } else {
      for (let col = 0; col < COLS; col++) {
        const x = gridX + col * (TILE + GAP);
        ctx.save();
        ctx.setLineDash(EMPTY_DASH);
        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 8);
        ctx.stroke();
        ctx.restore();
      }
    }
    y += rowHeight;
  }

  ctx.textAlign = "center";
  ctx.font = "500 12px Arial, sans-serif";
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText("Guess the F1 driver — DriverPit", WIDTH / 2, height - 20);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to render result image"));
    }, "image/png");
  });
}
