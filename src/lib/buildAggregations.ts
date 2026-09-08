// Framework-agnostic dataset summarizer — pure TS, safe to run client-side or
// server-side. Used to pre-compute totals/breakdowns for large datasets so
// callers never need to serialize/transmit every raw row (see analyze-data
// route and the upload/re-run flows that call it).

const RX = {
  date: /^(date|order_date|transaction_date|created|day|timestamp)$/i,
  dateLoose: /(date|day|timestamp)/i,
  time: /^(time|order_time|transaction_time|hour|timestamp)$/i,
  timeLoose: /(time|hour)/i,
  category: /^(category|product_category|item_type|type|menu_category)$/i,
  categoryLoose: /(category|menu_type)/i,
  product: /^(product|product_name|item|item_name|pizza_name|menu_item|sku_name)$/i,
  productLoose: /(product_name|item_name|pizza_name|menu_item)/i,
  price: /^(price|unit_price|total_price|amount|revenue|total|line_total|sale_price)$/i,
  priceLoose: /(price|amount|revenue|total)/i,
  qty: /^(qty|quantity|units|count)$/i,
};

function pick(cols: string[], strict: RegExp, loose: RegExp): string | undefined {
  return cols.find((c) => strict.test(c)) ?? cols.find((c) => loose.test(c));
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseHourLocal(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const ampm = m[3]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23) return h;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getHours();
  return null;
}

function topN<T>(map: Map<string, T>, n: number, score: (v: T) => number): [string, T][] {
  return [...map.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, n);
}

type GroupAgg = { revenue: number; volume: number };

export function buildAggregations(rows: Record<string, unknown>[], cols: string[]) {
  const dateCol = pick(cols, RX.date, RX.dateLoose);
  const timeCol = pick(cols, RX.time, RX.timeLoose);
  const categoryCol = pick(cols, RX.category, RX.categoryLoose);
  const productCol = pick(cols, RX.product, RX.productLoose);
  const priceCol = pick(cols, RX.price, RX.priceLoose);
  const qtyCol = cols.find((c) => RX.qty.test(c));

  const revOf = (r: Record<string, unknown>) => {
    if (priceCol) {
      const p = num(r[priceCol]);
      const q = qtyCol ? num(r[qtyCol]) : 1;
      return p * (q || 1);
    }
    return 0;
  };
  const volOf = (r: Record<string, unknown>) => (qtyCol ? num(r[qtyCol]) || 1 : 1);

  const byDay = new Map<string, GroupAgg>();
  const byMonth = new Map<string, GroupAgg>();
  const byCategory = new Map<string, GroupAgg>();
  const byProduct = new Map<string, GroupAgg>();
  const byHour = new Map<number, number>();
  const byDow = new Map<number, number>();

  let totalRevenue = 0;
  let totalVolume = 0;
  let dateMin: Date | null = null;
  let dateMax: Date | null = null;

  for (const r of rows) {
    const rev = revOf(r);
    const vol = volOf(r);
    totalRevenue += rev;
    totalVolume += vol;

    if (dateCol) {
      const d = new Date(String(r[dateCol]));
      if (!isNaN(d.getTime())) {
        if (!dateMin || d < dateMin) dateMin = d;
        if (!dateMax || d > dateMax) dateMax = d;
        const dayKey = d.toISOString().slice(0, 10);
        const monthKey = d.toISOString().slice(0, 7);
        const dg = byDay.get(dayKey) ?? { revenue: 0, volume: 0 };
        dg.revenue += rev; dg.volume += vol; byDay.set(dayKey, dg);
        const mg = byMonth.get(monthKey) ?? { revenue: 0, volume: 0 };
        mg.revenue += rev; mg.volume += vol; byMonth.set(monthKey, mg);
        const dow = d.getDay();
        byDow.set(dow, (byDow.get(dow) ?? 0) + 1);
      }
    }
    const hourSrc = timeCol ? r[timeCol] : dateCol ? r[dateCol] : undefined;
    const h = parseHourLocal(hourSrc);
    if (h !== null) byHour.set(h, (byHour.get(h) ?? 0) + 1);

    if (categoryCol) {
      const k = String(r[categoryCol] ?? "").trim();
      if (k) {
        const g = byCategory.get(k) ?? { revenue: 0, volume: 0 };
        g.revenue += rev; g.volume += vol; byCategory.set(k, g);
      }
    }
    if (productCol) {
      const k = String(r[productCol] ?? "").trim();
      if (k) {
        const g = byProduct.get(k) ?? { revenue: 0, volume: 0 };
        g.revenue += rev; g.volume += vol; byProduct.set(k, g);
      }
    }
  }

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayOfWeek = [...byDow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([d, c]) => ({ day: dayLabels[d], transactions: c }));
  const hourly = [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, c]) => ({ hour: h, transactions: c }));

  // Daily series can be huge — cap to most recent 90 days but keep monthly always.
  const dailySorted = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const daily = dailySorted.slice(-90).map(([date, g]) => ({
    date, revenue: Math.round(g.revenue * 100) / 100, transactions: g.volume,
  }));
  const monthly = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, g]) => ({
    month, revenue: Math.round(g.revenue * 100) / 100, transactions: g.volume,
  }));

  const categories = topN(byCategory, 50, (g) => g.revenue || g.volume).map(([name, g]) => ({
    name,
    revenue: Math.round(g.revenue * 100) / 100,
    volume: g.volume,
    avg_ticket: g.volume ? Math.round((g.revenue / g.volume) * 100) / 100 : 0,
  }));
  const topProducts = topN(byProduct, 20, (g) => g.revenue || g.volume).map(([name, g]) => ({
    name,
    revenue: Math.round(g.revenue * 100) / 100,
    volume: g.volume,
    avg_ticket: g.volume ? Math.round((g.revenue / g.volume) * 100) / 100 : 0,
  }));

  return {
    totals: {
      total_rows: rows.length,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      total_volume: totalVolume,
      avg_ticket: totalVolume ? Math.round((totalRevenue / totalVolume) * 100) / 100 : 0,
      date_range: dateMin && dateMax
        ? `${dateMin.toISOString().slice(0, 10)} to ${dateMax.toISOString().slice(0, 10)}`
        : "no date column found",
    },
    daily,
    monthly,
    categories,
    top_products: topProducts,
    hour_of_day: hourly,
    day_of_week: dayOfWeek,
    detected_columns: { dateCol, timeCol, categoryCol, productCol, priceCol, qtyCol },
  };
}

export type Aggregations = ReturnType<typeof buildAggregations>;

export const AGG_THRESHOLD = 5000;

// Shapes the payload sent to /api/analyze-data. For datasets at or above
// AGG_THRESHOLD, pre-aggregates client-side and sends only the (small) summary
// + a short sample — never the full row set — so JSON.stringify-ing the
// request body can't blow past the browser's max string length on large files.
export function buildAnalyzePayload(rows: Record<string, unknown>[]) {
  if (rows.length < AGG_THRESHOLD) {
    return { rows };
  }
  const columns = Object.keys(rows[0] ?? {});
  return {
    aggregations: buildAggregations(rows, columns),
    sample: rows.slice(0, 20),
    totalRows: rows.length,
  };
}
