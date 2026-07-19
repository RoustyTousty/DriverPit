const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffMinutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (Math.abs(diffMinutes) < 1) return "just now";

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 1) return rtf.format(diffMinutes, "minute");

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 1) return rtf.format(diffHours, "hour");

  return rtf.format(diffDays, "day");
}
