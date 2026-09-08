// Pure logic for auto-detecting filterable fields and applying filters.
// No React. Easy to unit-test.

export type TimePeriod = "1m" | "2m" | "3m" | "6m" | "1y" | "all" | "custom";
export type TimeOfDay = "all" | "morning" | "afternoon" | "evening" | "custom";

export type FilterConfig = {
  timePeriod: TimePeriod;
  customStart?: string; // ISO date
  customEnd?: string;
  locations: string[]; // empty = all
  categories: string[];
  products: string[];
  priceMin?: number;
  priceMax?: number;
  daysOfWeek: number[]; // 0=Sun .. 6=Sat. Default = [0..6]
  timeOfDay: TimeOfDay;
  customStartHour?: number; // 0..23
  customEndHour?: number;
  focusUnderperformers: boolean;
};

export type DetectedFilters = {
  dateColumn?: string;
  timeColumn?: string;
  locationColumn?: string;
  locationValues: string[];
  categoryColumn?: string;
  categoryValues: string[];
  productColumn?: string;
  productValues: string[];
  priceColumn?: string;
  priceMin: number;
  priceMax: number;
  dataMinDate?: Date;
  dataMaxDate?: Date;
};

export const DEFAULT_FILTERS: FilterConfig = {
  timePeriod: "all",
  locations: [],
  categories: [],
  products: [],
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  timeOfDay: "all",
  focusUnderperformers: false,
};

const RX_DATE = /^(date|order_date|transaction_date|created|day|timestamp)$/i;
const RX_DATE_LOOSE = /(date|day)/i;
const RX_TIME = /^(time|order_time|transaction_time|hour|timestamp)$/i;
const RX_TIME_LOOSE = /(time|hour)/i;
const RX_LOCATION = /^(store|store_id|store_name|location|branch|outlet|shop|site)$/i;
const RX_LOCATION_LOOSE = /(store|location|branch|outlet)/i;
const RX_CATEGORY = /^(category|product_category|item_type|type|menu_category)$/i;
const RX_CATEGORY_LOOSE = /(category|menu_type)/i;
const RX_PRODUCT = /^(product|product_name|item|item_name|pizza_name|menu_item|sku_name)$/i;
const RX_PRODUCT_LOOSE = /(product_name|item_name|pizza_name|menu_item)/i;
const RX_PRICE = /^(price|unit_price|total_price|amount|revenue|total|line_total|sale_price)$/i;
const RX_PRICE_LOOSE = /(price|amount|revenue|total)/i;

function findCol(columns: string[], strict: RegExp, loose: RegExp): string | undefined {
  return columns.find((c) => strict.test(c)) ?? columns.find((c) => loose.test(c));
}

function uniqueStringValues(rows: Record<string, unknown>[], col: string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined || v === "") continue;
    set.add(String(v).trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function tryParseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v);
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t);
  return null;
}

function parseHour(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  // already a Date / parseable date with time?
  const d = tryParseDate(v);
  if (d) {
    const hh = d.getHours();
    // If parsing a bare date string like "2024-01-01" we'd get hh=0 which is
    // legitimate — but parseable hours like "8:30 AM" also work.
    if (typeof v === "string" && /[:apm]/i.test(v)) return hh;
    if (v instanceof Date) return hh;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const ampm = m[3]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23) return h;
  }
  return null;
}

export function detectFilterableFields(
  rows: Record<string, unknown>[],
  columns: string[],
): DetectedFilters {
  const dateColumn = findCol(columns, RX_DATE, RX_DATE_LOOSE);
  const timeColumn = findCol(columns, RX_TIME, RX_TIME_LOOSE);
  const locationColumn = findCol(columns, RX_LOCATION, RX_LOCATION_LOOSE);
  const categoryColumn = findCol(columns, RX_CATEGORY, RX_CATEGORY_LOOSE);
  const productColumn = findCol(columns, RX_PRODUCT, RX_PRODUCT_LOOSE);
  const priceColumn = findCol(columns, RX_PRICE, RX_PRICE_LOOSE);

  const locationValues = locationColumn ? uniqueStringValues(rows, locationColumn) : [];
  const categoryValues = categoryColumn ? uniqueStringValues(rows, categoryColumn) : [];
  const productValues = productColumn ? uniqueStringValues(rows, productColumn) : [];

  let priceMin = 0;
  let priceMax = 0;
  if (priceColumn) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      const n = Number(r[priceColumn]);
      if (Number.isFinite(n)) {
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      priceMin = Math.floor(lo * 100) / 100;
      priceMax = Math.ceil(hi * 100) / 100;
    }
  }

  let dataMinDate: Date | undefined;
  let dataMaxDate: Date | undefined;
  if (dateColumn) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      const d = tryParseDate(r[dateColumn]);
      if (d) {
        const t = d.getTime();
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    }
    if (lo !== Infinity && hi !== -Infinity) {
      dataMinDate = new Date(lo);
      dataMaxDate = new Date(hi);
    }
  }

  // Hide filters with ≤ 1 distinct value by clearing the column reference.
  return {
    dateColumn,
    timeColumn,
    locationColumn: locationValues.length > 1 ? locationColumn : undefined,
    locationValues: locationValues.length > 1 ? locationValues : [],
    categoryColumn: categoryValues.length > 1 ? categoryColumn : undefined,
    categoryValues: categoryValues.length > 1 ? categoryValues : [],
    productColumn: productValues.length > 1 ? productColumn : undefined,
    productValues: productValues.length > 1 ? productValues : [],
    priceColumn: priceMax > priceMin ? priceColumn : undefined,
    priceMin,
    priceMax,
    dataMinDate,
    dataMaxDate,
  };
}

export function hasAnyFilter(d: DetectedFilters): boolean {
  return Boolean(
    d.dateColumn ||
      d.timeColumn ||
      d.locationColumn ||
      d.categoryColumn ||
      d.productColumn ||
      d.priceColumn,
  );
}

function periodMonths(p: TimePeriod): number | null {
  switch (p) {
    case "1m": return 1;
    case "2m": return 2;
    case "3m": return 3;
    case "6m": return 6;
    case "1y": return 12;
    default: return null;
  }
}

function timeOfDayBounds(c: FilterConfig): { start: number; end: number } | null {
  switch (c.timeOfDay) {
    case "morning": return { start: 6, end: 12 };
    case "afternoon": return { start: 12, end: 17 };
    case "evening": return { start: 17, end: 22 };
    case "custom": {
      const s = c.customStartHour ?? 0;
      const e = c.customEndHour ?? 24;
      return { start: s, end: e };
    }
    default: return null;
  }
}

export function applyFilters(
  rows: Record<string, unknown>[],
  config: FilterConfig,
  detected: DetectedFilters,
): { rows: Record<string, unknown>[]; warning?: string } {
  let result = rows;
  let warning: string | undefined;

  // 1. Time period
  if (detected.dateColumn && detected.dataMaxDate) {
    let cutoffStart: Date | null = null;
    let cutoffEnd: Date | null = null;
    if (config.timePeriod === "custom" && (config.customStart || config.customEnd)) {
      if (config.customStart) cutoffStart = new Date(config.customStart);
      if (config.customEnd) {
        cutoffEnd = new Date(config.customEnd);
        cutoffEnd.setHours(23, 59, 59, 999);
      }
    } else {
      const months = periodMonths(config.timePeriod);
      if (months !== null) {
        const max = detected.dataMaxDate;
        const start = new Date(max);
        start.setMonth(start.getMonth() - months);
        // Compare requested window against TRUE data span (not sample span).
        const dataMinMs = detected.dataMinDate?.getTime() ?? max.getTime();
        const dataSpanDays = Math.max(0, Math.round((max.getTime() - dataMinMs) / (24 * 3600 * 1000)));
        if (start.getTime() <= dataMinMs) {
          // Requested window covers (or exceeds) full data — only warn if data is genuinely shorter.
          const requestedDays = months * 30;
          if (dataSpanDays > 0 && requestedDays > dataSpanDays + 7) {
            warning = `Your data only covers ${dataSpanDays} day${dataSpanDays === 1 ? "" : "s"} — showing full available range instead.`;
          }
          cutoffStart = null;
          cutoffEnd = null;
        } else {
          cutoffStart = start;
          cutoffEnd = max;
        }
      }
    }
    if (cutoffStart || cutoffEnd) {
      const col = detected.dateColumn;
      result = result.filter((r) => {
        const d = tryParseDate(r[col]);
        if (!d) return false;
        if (cutoffStart && d < cutoffStart) return false;
        if (cutoffEnd && d > cutoffEnd) return false;
        return true;
      });
    }
  }

  // 2. Location
  if (detected.locationColumn && config.locations.length > 0) {
    const set = new Set(config.locations);
    const col = detected.locationColumn;
    result = result.filter((r) => set.has(String(r[col] ?? "").trim()));
  }

  // 3. Category
  if (detected.categoryColumn && config.categories.length > 0) {
    const set = new Set(config.categories);
    const col = detected.categoryColumn;
    result = result.filter((r) => set.has(String(r[col] ?? "").trim()));
  }

  // 4. Product
  if (detected.productColumn && config.products.length > 0) {
    const set = new Set(config.products);
    const col = detected.productColumn;
    result = result.filter((r) => set.has(String(r[col] ?? "").trim()));
  }

  // 5. Price range
  if (detected.priceColumn && (config.priceMin !== undefined || config.priceMax !== undefined)) {
    const col = detected.priceColumn;
    const lo = config.priceMin ?? -Infinity;
    const hi = config.priceMax ?? Infinity;
    if (lo !== detected.priceMin || hi !== detected.priceMax) {
      result = result.filter((r) => {
        const n = Number(r[col]);
        if (!Number.isFinite(n)) return false;
        return n >= lo && n <= hi;
      });
    }
  }

  // 6. Day of week
  if (detected.dateColumn && config.daysOfWeek.length < 7) {
    const set = new Set(config.daysOfWeek);
    const col = detected.dateColumn;
    result = result.filter((r) => {
      const d = tryParseDate(r[col]);
      if (!d) return false;
      return set.has(d.getDay());
    });
  }

  // 7. Time of day
  const tod = timeOfDayBounds(config);
  if (tod && (detected.timeColumn || detected.dateColumn)) {
    const col = detected.timeColumn ?? detected.dateColumn!;
    result = result.filter((r) => {
      const h = parseHour(r[col]);
      if (h === null) return false;
      return h >= tod.start && h < tod.end;
    });
  }

  // 8. Underperformers — bottom-half of products (or categories) by revenue/count
  if (config.focusUnderperformers) {
    const groupCol = detected.productColumn ?? detected.categoryColumn;
    if (groupCol) {
      const totals = new Map<string, number>();
      for (const r of result) {
        const k = String(r[groupCol] ?? "").trim();
        if (!k) continue;
        const v = detected.priceColumn ? Number(r[detected.priceColumn]) || 0 : 1;
        totals.set(k, (totals.get(k) ?? 0) + v);
      }
      if (totals.size > 1) {
        const mean = [...totals.values()].reduce((a, b) => a + b, 0) / totals.size;
        const weak = new Set([...totals.entries()].filter(([, v]) => v < mean).map(([k]) => k));
        result = result.filter((r) => weak.has(String(r[groupCol] ?? "").trim()));
      }
    }
  }

  return { rows: result, warning };
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMonthYear(d: Date): string {
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

export function summarizeFilters(rawConfig: FilterConfig, detected: DetectedFilters): string {
  const config: FilterConfig = {
    timePeriod: rawConfig?.timePeriod ?? "all",
    customStart: rawConfig?.customStart,
    customEnd: rawConfig?.customEnd,
    locations: rawConfig?.locations ?? [],
    categories: rawConfig?.categories ?? [],
    products: rawConfig?.products ?? [],
    priceMin: rawConfig?.priceMin,
    priceMax: rawConfig?.priceMax,
    daysOfWeek: rawConfig?.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
    timeOfDay: rawConfig?.timeOfDay ?? "all",
    customStartHour: rawConfig?.customStartHour,
    customEndHour: rawConfig?.customEndHour,
    focusUnderperformers: rawConfig?.focusUnderperformers ?? false,
  };
  const safeDetected = {
    ...detected,
    locationValues: detected?.locationValues ?? [],
    categoryValues: detected?.categoryValues ?? [],
    productValues: detected?.productValues ?? [],
  };
  const parts: string[] = [];

  // Time period
  if (safeDetected.dateColumn && safeDetected.dataMaxDate) {
    if (config.timePeriod === "custom" && (config.customStart || config.customEnd)) {
      const s = config.customStart ? new Date(config.customStart) : detected.dataMinDate;
      const e = config.customEnd ? new Date(config.customEnd) : detected.dataMaxDate;
      if (s && e) parts.push(`${formatMonthYear(s)} — ${formatMonthYear(e)}`);
    } else {
      const months = periodMonths(config.timePeriod);
      if (months !== null) {
        const e = safeDetected.dataMaxDate;
        const s = new Date(e);
        s.setMonth(s.getMonth() - months);
        parts.push(`${formatMonthYear(s)} — ${formatMonthYear(e)}`);
      }
    }
  }

  if (config.locations.length > 0 && config.locations.length < safeDetected.locationValues.length) {
    parts.push(config.locations.length <= 2 ? config.locations.join(", ") : `${config.locations.length} locations`);
  }
  if (config.categories.length > 0 && config.categories.length < safeDetected.categoryValues.length) {
    parts.push(config.categories.length <= 2 ? config.categories.join(", ") : `${config.categories.length} categories`);
  }
  if (config.products.length > 0 && config.products.length < safeDetected.productValues.length) {
    parts.push(config.products.length <= 2 ? config.products.join(", ") : `${config.products.length} products`);
  }
  if (
    detected.priceColumn &&
    (config.priceMin !== undefined && config.priceMin > detected.priceMin) ||
    (config.priceMax !== undefined && config.priceMax < detected.priceMax)
  ) {
    parts.push(`$${config.priceMin ?? detected.priceMin}–$${config.priceMax ?? detected.priceMax}`);
  }
  if (config.daysOfWeek.length < 7) {
    const weekdays = [1, 2, 3, 4, 5];
    const weekend = [0, 6];
    const sorted = [...config.daysOfWeek].sort();
    if (sorted.length === 5 && weekdays.every((d) => sorted.includes(d))) parts.push("Weekdays");
    else if (sorted.length === 2 && weekend.every((d) => sorted.includes(d))) parts.push("Weekends");
    else parts.push(sorted.map((d) => DAY_LABELS[d]).join(", "));
  }
  if (config.timeOfDay !== "all") {
    parts.push(config.timeOfDay.charAt(0).toUpperCase() + config.timeOfDay.slice(1));
  }
  if (config.focusUnderperformers) parts.push("Underperformers");

  return parts.join(" · ");
}

export function isDefaultConfig(config: FilterConfig): boolean {
  if (!config) return true;
  return (
    (config.timePeriod ?? "all") === "all" &&
    (config.locations?.length ?? 0) === 0 &&
    (config.categories?.length ?? 0) === 0 &&
    (config.products?.length ?? 0) === 0 &&
    config.priceMin === undefined &&
    config.priceMax === undefined &&
    (config.daysOfWeek?.length ?? 7) === 7 &&
    (config.timeOfDay ?? "all") === "all" &&
    !config.focusUnderperformers
  );
}
