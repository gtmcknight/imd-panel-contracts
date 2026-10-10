/**
 * Relative time, computed on the server.
 *
 * Safe to render server-side because every page here is a server component: the client never
 * re-renders these, so there is no clock to disagree with and no hydration mismatch. Freshness
 * comes from the six-second refresh instead, which is also how often anything else on the page
 * changes.
 */
export function ago(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

/** Full timestamp for the tooltip: relative time is for scanning, absolute is for arguing. */
export function absolute(value: string | null | undefined): string {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

/** True when something changed inside the window a reader would consider "happening now". */
export function isFresh(value: string | null | undefined, withinMs = 90_000, now = Date.now()): boolean {
  if (!value) return false;
  const then = new Date(value).getTime();
  return !Number.isNaN(then) && now - then < withinMs;
}
