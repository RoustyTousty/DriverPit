/**
 * The promo slide's canvas size, in CSS pixels.
 *
 * 4:5 is the tallest aspect Instagram and most feed surfaces render without
 * cropping, so it is the most screen a single image can occupy.
 *
 * THESE LIVE IN A PLAIN MODULE, not on components/promo/PromoFrame.tsx, because
 * scripts/promo.ts sets the Playwright viewport from them and that script runs
 * under tsx rather than under Next. PromoFrame imports the wordmark PNG, and a
 * static image import is a bundler feature — importing the component from Node
 * fails with `SyntaxError: Invalid or unexpected token` on the PNG's first byte.
 * (Measured; it is how this file came to exist.)
 *
 * The frame and the viewport MUST agree. A viewport narrower than the frame
 * exports with a scrollbar in the shot; a wider one leaves a band of page
 * background down one side. Both read as a broken export rather than a design
 * choice, which is why there is one definition and two importers.
 */
export const PROMO_WIDTH = 1080;
export const PROMO_HEIGHT = 1350;

/**
 * The board slide renders `GuessGrid` at the live game window's own width —
 * `max-w-160` (640px) in app/[locale]/(game)/layout.tsx — and scales the whole
 * thing up to fill the frame.
 *
 * Scaling rather than widening is what keeps the board pixel-identical to the
 * game: every internal proportion, breakpoint and border width stays the one a
 * player sees at 640px. Widening the container to fill the frame would change
 * the tiles' flex-1 widths, which is a different picture from the one the game
 * renders.
 */
export const BOARD_WIDTH = 640;
export const BOARD_SCALE = 1.4;
