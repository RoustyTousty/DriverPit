import Image from "next/image";

import { PROMO_HEIGHT, PROMO_WIDTH } from "@/lib/promo/frame";
import driverpitBanner from "@/public/driverpit-banner.png";

// The canvas size lives in lib/promo/frame.ts, shared with scripts/promo.ts —
// see that file for why it cannot live here (this module's PNG import is a
// bundler feature and cannot be loaded from Node).

/**
 * A fixed-size slide: difficulty label top-left, content centred, wordmark
 * bottom.
 *
 * `overflow-hidden` plus explicit pixel sizing rather than viewport units, so
 * the frame is the same size whether it is screenshotted, opened in a browser
 * at some other window size, or printed into a PDF. Anything that depends on
 * the viewport makes the output depend on how the script happened to be run.
 */
export function PromoFrame({
  label,
  children,
}: {
  // Rendered top-left. Omitted on the teaser and CTA slides, which have no
  // difficulty to state — the slot collapses rather than printing a placeholder.
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      // `bg-bg` is the page's own near-black, not a promo-specific colour: the
      // whole point of screenshotting real components is that the palette comes
      // from app/globals.css and moves when the design tokens move.
      className="relative flex flex-col overflow-hidden bg-bg"
      style={{ width: PROMO_WIDTH, height: PROMO_HEIGHT }}
    >
      <div className="flex items-start justify-between px-20 pt-20">
        {label ? (
          <span className="font-mono text-2xl font-bold tracking-[0.35em] text-accent uppercase">
            {label}
          </span>
        ) : (
          <span />
        )}
      </div>

      {/* min-h-0 so a tall child is clipped by the frame instead of stretching
          it past PROMO_HEIGHT — an overflowing slide silently changes the
          aspect ratio of the export. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-20">
        {children}
      </div>

      <div className="flex items-center justify-center pb-20">
        <Image
          src={driverpitBanner}
          alt="DriverPit"
          priority
          // Small on purpose. The brief asks for negative space and a quiet
          // wordmark; a large logo on a 1080x1350 canvas competes with the board
          // that is meant to be the subject.
          className="h-12 w-auto opacity-90"
        />
      </div>
    </div>
  );
}
