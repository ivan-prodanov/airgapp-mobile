// Pure recents model + day-grouping for the Navigate list. NO React Native / expo imports (node-testable).
// The store (recentsStore.ts) supplies RecentEntry[] newest-first; this groups them for display.
import type { Place } from './place';

export interface RecentEntry {
  place: Place;
  savedAt: number; // epoch ms
}

export interface RecentGroup {
  title: string; // "Today" | "Yesterday" | "2 Jul"
  items: Place[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

function startOfLocalDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Group newest-first entries into Today / Yesterday / "D Mon" buckets, preserving input order. Groups appear
// in first-seen order (so, given newest-first input, most-recent day first).
export function groupRecentsByDay(entries: RecentEntry[], now: number): RecentGroup[] {
  const today = startOfLocalDay(now);
  const order: string[] = [];
  const byTitle = new Map<string, Place[]>();
  for (const e of entries) {
    const day = startOfLocalDay(e.savedAt);
    let title: string;
    if (day === today) title = 'Today';
    else if (day === today - DAY_MS) title = 'Yesterday';
    else {
      const d = new Date(e.savedAt);
      title = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    }
    if (!byTitle.has(title)) {
      byTitle.set(title, []);
      order.push(title);
    }
    byTitle.get(title)!.push(e.place);
  }
  return order.map((title) => ({ title, items: byTitle.get(title)! }));
}
