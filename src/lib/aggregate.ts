import type { ChartSpec } from "./analysisTypes";

export type ChartPoint = { x: string; y: number };

const HOUR_ORDER = Array.from({ length: 24 }, (_, h) => hourLabel(h));

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

function parseHour(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  // Try ISO/date parse first
  const d = new Date(s);
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) return d.getHours();
  // Try "HH:MM" or "HH:MM:SS" or "H:MM AM/PM"
  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const mer = ampm[3]?.toLowerCase();
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    if (h >= 0 && h < 24) return h;
  }
  // Fallback: try Date.parse with today's date
  const d2 = new Date(`1970-01-01T${s}`);
  if (!isNaN(d2.getTime())) return d2.getHours();
  return null;
}

function parseDayKey(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseMonthKey(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 7);
}

function looksLikeTimeField(name: string, rows: Record<string, unknown>[]): boolean {
  if (!/time|hour/i.test(name)) return false;
  // Confirm at least one value parses as a time-of-day
  for (const r of rows.slice(0, 20)) {
    if (parseHour(r[name]) !== null) return true;
  }
  return false;
}

export function buildChartData(
  rows: Record<string, unknown>[],
  spec: ChartSpec,
): ChartPoint[] {
  const { x_field, y_field } = spec;
  let { aggregation } = spec;
  if (!rows.length || !x_field) return [];

  // Safety net: force hourly bucketing for time-of-day fields, regardless of saved aggregation.
  if (aggregation !== "hourly" && looksLikeTimeField(x_field, rows)) {
    aggregation = "hourly";
  }

  const groups = new Map<string, { sum: number; count: number; sortKey: number | string }>();

  for (const row of rows) {
    const xv = row[x_field];
    if (xv === null || xv === undefined || xv === "") continue;

    let key: string | null = null;
    let sortKey: number | string = String(xv);

    if (aggregation === "hourly") {
      const h = parseHour(xv);
      if (h === null) continue;
      key = hourLabel(h);
      sortKey = h;
    } else if (aggregation === "daily") {
      const k = parseDayKey(xv);
      if (!k) continue;
      key = k;
      sortKey = k;
    } else if (aggregation === "monthly") {
      const k = parseMonthKey(xv);
      if (!k) continue;
      key = k;
      sortKey = k;
    } else {
      key = String(xv);
    }

    const g = groups.get(key) ?? { sum: 0, count: 0, sortKey };
    if (aggregation === "hourly" || aggregation === "daily" || aggregation === "monthly") {
      // Time-bucket charts always count transactions per period, never sum y_field
      g.count += 1;
    } else if (aggregation === "count") {
      g.count += 1;
    } else {
      const yv = row[y_field];
      const yn = typeof yv === "number" ? yv : Number(yv);
      if (Number.isFinite(yn)) {
        g.sum += yn;
        g.count += 1;
      }
    }
    groups.set(key, g);
  }

  const data: (ChartPoint & { sortKey: number | string })[] = [];
  for (const [x, { sum, count, sortKey }] of groups) {
    let y = 0;
    if (aggregation === "hourly" || aggregation === "daily" || aggregation === "monthly") {
      y = count;
    } else if (aggregation === "count") y = count;
    else if (aggregation === "avg") y = count ? sum / count : 0;
    else y = sum; // sum or none
    data.push({ x, y, sortKey });
  }

  if (aggregation === "hourly") {
    data.sort((a, b) => (a.sortKey as number) - (b.sortKey as number));
  } else if (aggregation === "daily" || aggregation === "monthly") {
    data.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
  } else {
    data.sort((a, b) => {
      const an = Number(a.x);
      const bn = Number(b.x);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      const ad = Date.parse(a.x);
      const bd = Date.parse(b.x);
      if (!isNaN(ad) && !isNaN(bd)) return ad - bd;
      return a.x.localeCompare(b.x);
    });
  }

  const stripped = data.map(({ x, y }) => ({ x, y }));
  return stripped.length > 50 ? stripped.slice(-50) : stripped;
}

export { HOUR_ORDER };
