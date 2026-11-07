/** ISO-8601 week helpers. Weeks are the canonical trend bucket ("YYYY-Www"). */

export function isoWeekOf(dateIso: string): string {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day); // Thursday of this week
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday (UTC) of an ISO week. */
export function mondayOf(week: string): Date {
  const [ys, ws] = week.split("-W");
  const year = Number(ys);
  const w = Number(ws);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (w - 1) * 7);
  return monday;
}

export function nextWeek(week: string): string {
  const m = mondayOf(week);
  m.setUTCDate(m.getUTCDate() + 7);
  return isoWeekOf(m.toISOString());
}

/** Inclusive list of ISO weeks from `from` to `to`. Lexical order works for YYYY-Www. */
export function weeksBetween(from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  let w = from;
  for (let guard = 0; guard < 600 && w <= to; guard++) {
    out.push(w);
    w = nextWeek(w);
  }
  return out;
}

export function shortWeek(week: string): string {
  return `W${week.split("-W")[1]}`;
}

export function weekMonthLabel(week: string): string {
  return mondayOf(week).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
