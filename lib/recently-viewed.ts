/**
 * Tracks which clients this browser has looked at recently.
 *
 * Stored in localStorage rather than the database. There are no per-user tables
 * and no row-level security anywhere in this schema — every signed-in user sees
 * every client — so a `recently_viewed` table would mean introducing user
 * scoping for this one feature. The trade-off is that the list does not follow
 * you between machines.
 *
 * Everything here is behind this module so swapping to a table later is a
 * contained change: the callers only know `recordClientView` and
 * `readRecentClients`.
 *
 * Browser-only. `localStorage` does not exist during server rendering, so these
 * must be called from an effect, never during render.
 */

const STORAGE_KEY = 'sse.recentClients.v1';

/** Enough to be useful on a home page without crowding out the full list. */
const MAX_ENTRIES = 5;

export interface RecentClient {
  /** Stringified so UUID and numeric ids compare consistently. */
  id: string;
  /**
   * The name as it was when viewed — a fallback only.
   *
   * Callers should prefer the current name from the clients list and use this
   * when the client is not in that list. Names change; a cached one goes stale.
   */
  name: string;
  /** Epoch ms. */
  viewedAt: number;
}

function isRecentClient(value: unknown): value is RecentClient {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.viewedAt === 'number'
  );
}

/**
 * Reads the list, newest first.
 *
 * Returns [] rather than throwing on anything unexpected. This is a
 * convenience feature reading data a user can edit in devtools — corrupt or
 * hand-mangled storage should quietly reset, not break the home page.
 */
export function readRecentClients(): RecentClient[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(isRecentClient)
      .sort((a, b) => b.viewedAt - a.viewedAt)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Records a view, moving the client to the front.
 *
 * Safe to call on every mount of a client page — re-viewing an existing entry
 * updates its timestamp rather than adding a duplicate.
 */
export function recordClientView(id: string | number, name: string): void {
  if (typeof window === 'undefined') return;

  const key = String(id);
  if (!key) return;

  try {
    const existing = readRecentClients().filter((entry) => entry.id !== key);
    const next = [{ id: key, name, viewedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing and full quotas both throw on setItem. Losing the
    // history is not worth interrupting the page the user actually wanted.
  }
}
