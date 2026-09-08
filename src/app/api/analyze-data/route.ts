import { NextResponse } from "next/server";
import { buildAggregations, AGG_THRESHOLD, type Aggregations } from "@/lib/buildAggregations";

// AI-backed business analysis, powered by Anthropic Claude directly
// (ported from the old Lovable AI Gateway edge function).

const MODEL = "claude-sonnet-4-5";

const SYSTEM_PROMPT = `You are a senior business analyst reviewing data for a small business client.
Your job: identify what matters most, explain it in plain English (no jargon, no MBA-speak),
and produce concrete recommendations a small business owner can act on this week.

You will receive: column names, inferred column types, total row count, and a sample of rows.
Reason carefully about what the data represents (sales, traffic, expenses, ops, etc.) and
infer time periods from any date-like columns.

CRITICAL RULES:
1. NEVER return "n/a", "N/A", "unknown", "tbd", or empty strings for any field. If period-over-period
   comparison isn't possible, the kpi.delta field MUST contain a meaningful derived stat such as
   "avg $X per store", "32% of total", "vs $Y benchmark", or "highest of N categories". Always
   substitute a useful comparison rather than admitting absence.
2. Each KPI MUST include a sentiment: "positive" (good news), "neutral" (informational), or
   "concern" (warning sign). Use this to color-code the dashboard.
3. Each recommendation MUST include an impact_score from 1 (minor) to 10 (transformative) and a
   detail of 2-3 full sentences with specific numbers from the data.
4. The summary MUST be a full paragraph of 5-8 sentences, citing concrete numbers from the data
   (not vague statements). It is the headline a business owner will read first.
5. next_steps MUST contain exactly 3 short, action-oriented items the owner should do in the next
   30 days. Each is a single sentence, imperative tense (e.g. "Audit pricing on the 5 lowest-margin SKUs.").
6. data_quality MUST report the inferred date_range of the data (e.g. "Mar 1 – Apr 18, 2024" or
   "no date column found"), the rows_analyzed count, and any limitations you encountered (missing
   columns, sparse data, suspected outliers, sampling, etc.). Never leave limitations blank — write
   "No notable limitations." if truly clean. If a "Data preparation note" is provided in the user
   message (e.g. multiple files were stacked or relationally joined), you MUST surface that
   information — including which files were combined and on which columns — inside
   data_quality.limitations.
7. For chart_specs:
   - When the x-axis is a timestamp/time-of-day column, set aggregation to "hourly" so the
     frontend buckets values into hour-of-day labels (8am, 9am, ...).
   - CRITICAL: If x_field is 'transaction_time', 'time', 'hour', or ANY time-of-day field,
     aggregation MUST be "hourly" — NEVER "sum", "avg", or "count".
   - When the x-axis is a date and the data spans multiple months, prefer "monthly".
   - When the x-axis is a date and the data spans days/weeks, prefer "daily".
   - Use "sum"/"avg"/"count" only for non-time categorical x-axes.
   - For "Top Products" / "Best Sellers" charts, x_field MUST be a human-readable name column
     (e.g. 'product_name', 'item', 'category') — NEVER a numeric ID column like 'product_id'.
     If only an ID column exists, do NOT propose this chart.
8. Trends MUST be substantive and actionable. Do NOT include trivial or zero-variance metrics
   (e.g. "Basket Size Stability" with 0% change, "consistent X", or anything where direction is
   "flat" with no meaningful magnitude). Every trend must show a real change worth discussing.
   If you can't find 2-3 genuine trends, return fewer — an empty list is better than filler.
9. Anomalies MUST be genuine business concerns, not normal system behavior. Specifically EXCLUDE:
   - Multiple line items at the same timestamp (normal POS / multi-item receipts)
   - Identical transaction times across rows (normal for batch imports or multi-item sales)
   - Duplicate IDs that are expected (e.g. same order_id across line items)
   - Any "anomaly" that has a benign operational explanation
   Only flag things like: revenue spikes/dips outside ±2σ, suspicious refund patterns, products
   with abnormal margins, hours with zero activity inside open hours, etc. Empty list is fine.

Always return your output by calling the report_analysis tool. Do not return prose outside the tool call.`;

const TOOL = {
  name: "report_analysis",
  description: "Return a structured business analysis report.",
  input_schema: {
    type: "object" as const,
    properties: {
      kpis: {
        type: "array",
        description: "Top 5 KPIs identified from the data.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "string", description: "Formatted value, e.g. '$12,400' or '1,203'." },
            unit: { type: "string", description: "e.g. 'USD', 'orders', '%'." },
            delta: {
              type: "string",
              description:
                "Change vs prior period OR a meaningful derived stat. NEVER 'n/a' or empty. e.g. '+12.4%', 'avg $410/store', '32% of total'.",
            },
            context: { type: "string", description: "One-sentence plain-English context." },
            sentiment: {
              type: "string",
              enum: ["positive", "neutral", "concern"],
              description: "How the dashboard should color-code this KPI.",
            },
          },
          required: ["name", "value", "unit", "delta", "context", "sentiment"],
          additionalProperties: false,
        },
      },
      trends: {
        type: "array",
        description: "Period-over-period trends for key metrics.",
        items: {
          type: "object",
          properties: {
            metric: { type: "string" },
            direction: { type: "string", enum: ["up", "down", "flat"] },
            magnitude: { type: "string", description: "e.g. '+8%', '-12%', 'flat'." },
            explanation: { type: "string" },
          },
          required: ["metric", "direction", "magnitude", "explanation"],
          additionalProperties: false,
        },
      },
      anomalies: {
        type: "array",
        description: "Outliers or unusual patterns worth flagging.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high"] },
            explanation: { type: "string" },
          },
          required: ["label", "severity", "explanation"],
          additionalProperties: false,
        },
      },
      recommendations: {
        type: "array",
        description: "3-5 plain-English actionable recommendations.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            detail: {
              type: "string",
              description: "2-3 sentences with specific numbers from the data.",
            },
            priority: { type: "string", enum: ["low", "medium", "high"] },
            impact_score: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              description: "Estimated business impact, 1 (minor) to 10 (transformative).",
            },
          },
          required: ["title", "detail", "priority", "impact_score"],
          additionalProperties: false,
        },
      },
      summary: {
        type: "string",
        description:
          "Full paragraph (5-8 sentences) with concrete numbers from the data, suitable for a client report.",
      },
      next_steps: {
        type: "array",
        description: "Exactly 3 imperative action items for the next 30 days.",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
      },
      data_quality: {
        type: "object",
        description: "Notes about the data analyzed.",
        properties: {
          date_range: {
            type: "string",
            description: "Inferred date range, e.g. 'Mar 1 – Apr 18, 2024' or 'no date column found'.",
          },
          rows_analyzed: { type: "integer" },
          limitations: {
            type: "string",
            description: "Any caveats. Never empty — use 'No notable limitations.' if clean.",
          },
        },
        required: ["date_range", "rows_analyzed", "limitations"],
        additionalProperties: false,
      },
      chart_specs: {
        type: "array",
        description: "1-3 chart specs the dashboard should render with Recharts.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            type: { type: "string", enum: ["bar", "line"] },
            x_field: { type: "string", description: "Column name to use on the X axis." },
            y_field: { type: "string", description: "Column name to use on the Y axis." },
            aggregation: {
              type: "string",
              enum: ["sum", "avg", "count", "none", "hourly", "daily", "monthly"],
              description:
                "How to aggregate y by x. Use 'hourly' for time-of-day, 'daily'/'monthly' for date series.",
            },
            rationale: { type: "string", description: "Why this chart matters." },
          },
          required: ["title", "type", "x_field", "y_field", "aggregation", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "kpis",
      "trends",
      "anomalies",
      "recommendations",
      "summary",
      "chart_specs",
      "next_steps",
      "data_quality",
    ],
    additionalProperties: false,
  },
};

function inferType(values: unknown[]): string {
  let nums = 0;
  let dates = 0;
  let strings = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v.trim() !== "")) {
      nums++;
    } else if (typeof v === "string" && !isNaN(Date.parse(v))) {
      dates++;
    } else {
      strings++;
    }
  }
  if (nums > strings && nums > dates) return "number";
  if (dates > strings) return "date";
  return "string";
}

// Replace any "n/a"-like value in delta/context/limitations with a fallback so the UI never shows it.
function scrubNa(s: unknown, fallback: string): string {
  const v = typeof s === "string" ? s.trim() : "";
  if (!v) return fallback;
  if (/^(n\/?a|na|none|unknown|tbd|null)$/i.test(v)) return fallback;
  return v;
}

function sanitizeAnalysis(a: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(a.kpis)) {
    a.kpis = (a.kpis as Record<string, unknown>[]).map((k) => ({
      ...k,
      delta: scrubNa(k.delta, "no prior period available"),
      context: scrubNa(k.context, "Headline figure from the dataset."),
      sentiment: ["positive", "neutral", "concern"].includes(String(k.sentiment))
        ? k.sentiment
        : "neutral",
    }));
  }
  if (Array.isArray(a.recommendations)) {
    a.recommendations = (a.recommendations as Record<string, unknown>[]).map((r) => {
      const score = Number(r.impact_score);
      const fallback = r.priority === "high" ? 8 : r.priority === "medium" ? 5 : 3;
      return {
        ...r,
        impact_score: Number.isFinite(score) && score >= 1 && score <= 10 ? Math.round(score) : fallback,
      };
    });
  }
  if (a.data_quality && typeof a.data_quality === "object") {
    const dq = a.data_quality as Record<string, unknown>;
    a.data_quality = {
      date_range: scrubNa(dq.date_range, "no date column found"),
      rows_analyzed: Number(dq.rows_analyzed) || 0,
      limitations: scrubNa(dq.limitations, "No notable limitations."),
    };
  }
  return a;
}

export async function POST(req: Request) {
  try {
    const {
      rows,
      aggregations: clientAggregations,
      sample: clientSample,
      totalRows: clientTotalRows,
      fileName,
      clientName,
      industry,
      clientNotes,
      benchmarks,
      selectedKpis,
      joinNote,
      filters,
      filterSummary,
    } = await req.json();

    // Two supported request shapes:
    //  - `{ rows }` — raw rows, for datasets small enough to safely JSON.stringify.
    //  - `{ aggregations, sample, totalRows }` — the uploader pre-aggregates large
    //    datasets client-side before sending, so the full row set never has to be
    //    serialized into one request body (which can throw "Invalid string length"
    //    in the browser for very large files).
    const hasRawRows = Array.isArray(rows) && rows.length > 0;
    const hasPrecomputed = !!clientAggregations && Array.isArray(clientSample) && clientSample.length > 0;

    if (!hasRawRows && !hasPrecomputed) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const totalRowCount: number = hasPrecomputed ? clientTotalRows : rows.length;

    // For datasets >= 5,000 rows, use pre-aggregated summaries instead of a
    // sample. This guarantees KPI numbers reflect the true totals across every
    // row. Prefer aggregations the client already computed; fall back to
    // computing them here for callers that still send raw rows.
    const useAggregations = hasPrecomputed || rows.length >= AGG_THRESHOLD;
    const sample: Record<string, unknown>[] = hasPrecomputed
      ? clientSample
      : useAggregations
        ? rows.slice(0, 20)
        : rows.slice(0, 100);

    // Build column metadata from whatever raw rows we have on hand.
    const columns = Object.keys(sample[0] ?? {});
    const columnMeta = columns.map((c) => ({
      name: c,
      type: inferType(sample.map((r: Record<string, unknown>) => r[c])),
    }));

    const aggregations: Aggregations | null = hasPrecomputed
      ? clientAggregations
      : useAggregations
        ? buildAggregations(rows, columns)
        : null;

    const industryGuide: Record<string, string> = {
      Restaurant: "Use restaurant terminology: covers, table turns, average check, food cost %, labor %, peak service hours, daypart performance.",
      Retail: "Use retail terminology: inventory turnover, gross margin %, units per transaction, conversion rate, sell-through, GMROI.",
      Fitness: "Use fitness terminology: member retention, class attendance, churn, lifetime value, peak class hours, ancillary revenue.",
      "Coffee Shop": "Use coffee shop terminology: morning rush throughput, average ticket, attachment rate (food + drink), repeat visit cadence, daypart mix.",
      "E-commerce": "Use e-commerce terminology: conversion rate, AOV, cart abandonment, repeat purchase rate, CAC, return rate, channel mix.",
      Healthcare: "Use healthcare terminology: patient volume, no-show rate, average revenue per visit, payer mix, appointment fill rate.",
      "Real Estate": "Use real estate terminology: days on market, list-to-sale ratio, pipeline value, lead-to-close rate, average commission, inventory turn.",
    };

    const contextLines: string[] = [];
    if (industry) {
      contextLines.push(`Client industry: ${industry}.`);
      if (industryGuide[industry]) contextLines.push(industryGuide[industry]);
      else contextLines.push("Tailor benchmarks, terminology, and recommendations to this industry.");
    }
    if (typeof clientNotes === "string" && clientNotes.trim()) {
      contextLines.push(`Client context, goals and pain points: ${clientNotes.trim()}`);
    }
    if (Array.isArray(benchmarks) && benchmarks.length > 0) {
      const lines = benchmarks
        .filter((b: { label?: string; value?: string; unit?: string }) => b?.label && b?.value)
        .map((b: { label: string; value: string; unit?: string }) => `  - ${b.label}: ${b.value}${b.unit ? ` ${b.unit}` : ""}`);
      if (lines.length) {
        contextLines.push(`Client targets to compare actuals against (USE THESE — do not invent generic industry averages):\n${lines.join("\n")}`);
      }
    }
    if (Array.isArray(selectedKpis) && selectedKpis.length > 0) {
      contextLines.push(`Prioritize these KPI categories if present in the data: ${selectedKpis.join(", ")}.`);
    }
    if (typeof joinNote === "string" && joinNote.trim()) {
      contextLines.push(
        `Data preparation note: ${joinNote.trim()} You MUST mention which files were combined and on which columns inside data_quality.limitations.`,
      );
    }
    if (typeof filterSummary === "string" && filterSummary.trim()) {
      contextLines.push(
        `Active filters: ${filterSummary.trim()}. The dataset has been pre-filtered — tailor every insight to this subset (do not generalise to the unfiltered data) and mention the active filter context inside data_quality.limitations.`,
      );
    } else if (filters && typeof filters === "object" && Object.keys(filters).length > 0) {
      contextLines.push(
        `Filter configuration: ${JSON.stringify(filters)}. The dataset reflects these filters; tailor insights accordingly.`,
      );
    }
    const contextBlock = contextLines.length ? `\n\n--- CLIENT CONTEXT ---\n${contextLines.join("\n")}\n--- END CONTEXT ---\n` : "";

    const dataBlock = useAggregations && aggregations
      ? `Dataset is large (${totalRowCount.toLocaleString()} rows). Instead of raw rows, here are PRE-COMPUTED aggregations across the FULL dataset.
Use these totals VERBATIM for any KPI numbers — they reflect the entire dataset, not a sample.

Aggregations (JSON):
${JSON.stringify(aggregations, null, 2)}

A small preview of raw rows (${sample.length}, for column-shape reference only — do NOT use for KPI totals):
${JSON.stringify(sample, null, 2)}`
      : `Sample rows (${sample.length} of ${totalRowCount}, JSON):
${JSON.stringify(sample, null, 2)}`;

    const userMessage = `Client: ${clientName || "Unknown"}
File: ${fileName || "unknown"}
Total rows: ${totalRowCount}
Columns (name, inferred type):
${columnMeta.map((c) => `- ${c.name} (${c.type})`).join("\n")}
${contextBlock}
${dataBlock}

Analyze this dataset and call report_analysis with your findings.
For chart_specs, x_field and y_field MUST be column names that exist above.
Remember: NEVER use "n/a" — always derive a meaningful comparison.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        tools: [TOOL],
        tool_choice: { type: "tool", name: "report_analysis" },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        return NextResponse.json({ error: "Rate limit exceeded. Please retry in a moment." }, { status: 429 });
      }
      if (resp.status === 402 || resp.status === 400) {
        const t = await resp.text();
        if (/credit|billing/i.test(t)) {
          return NextResponse.json(
            { error: "AI credits exhausted. Check your Anthropic account's billing/usage." },
            { status: 402 },
          );
        }
        console.error("Anthropic API error:", resp.status, t);
        return NextResponse.json({ error: "AI gateway error" }, { status: 500 });
      }
      const t = await resp.text();
      console.error("Anthropic API error:", resp.status, t);
      return NextResponse.json({ error: "AI gateway error" }, { status: 500 });
    }

    const data = await resp.json();
    const toolUse = Array.isArray(data?.content)
      ? data.content.find((c: { type: string }) => c.type === "tool_use")
      : undefined;
    if (!toolUse?.input) {
      console.error("No tool call in response:", JSON.stringify(data).slice(0, 500));
      return NextResponse.json({ error: "AI did not return structured analysis" }, { status: 500 });
    }

    const analysis = sanitizeAnalysis(toolUse.input as Record<string, unknown>);

    return NextResponse.json({ analysis }, { status: 200 });
  } catch (e) {
    console.error("analyze-data error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
