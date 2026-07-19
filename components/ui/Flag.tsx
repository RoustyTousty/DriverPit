import { countryCode } from "@/lib/game/flags";

// Real flag icon (flag-icons' SVG sprite via CSS classes, imported globally
// in app/globals.css) -- not emoji. Regional-indicator flag emoji render as
// two bare letters on most Windows builds (Segoe UI Emoji has no flag
// glyphs), so emoji were a dead end for a cross-platform "show flags"
// setting. Renders nothing (not a broken-image box) for an unmapped
// nationality.
export function Flag({ nationality, className = "" }: { nationality: string; className?: string }) {
  const code = countryCode(nationality);
  if (!code) return null;

  return <span className={`fi fi-${code} ${className}`} role="img" aria-label={`${nationality} flag`} />;
}
