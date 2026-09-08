"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowLeft, ArrowDown, ArrowUp, Copy, Download, MessageSquare, Minus, RefreshCw, Sparkles, TriangleAlert,
} from "lucide-react";
import type { Analysis, Kpi, Recommendation, Sentiment, DataQuality } from "@/lib/analysisTypes";
import { buildChartData } from "@/lib/aggregate";
import { buildAnalyzePayload } from "@/lib/buildAggregations";
import ConsultantChatPanel from "@/components/ConsultantChatPanel";
import AnnotationsEditor from "@/components/AnnotationsEditor";
import type { ClientFull, Annotation } from "@/lib/clientTypes";
import { useAgencySettings, publicLogoUrl } from "@/hooks/useAgencySettings";
import {
  detectFilterableFields,
  hasAnyFilter,
  isDefaultConfig,
  summarizeFilters,
  type DetectedFilters,
  type FilterConfig,
} from "@/lib/analysisFilters";
import AnalysisFilterDialog from "@/components/AnalysisFilterDialog";

type Row = {
  id: string;
  client_id: string;
  file_name: string;
  row_count: number;
  created_at: string;
  kpis: Analysis["kpis"];
  trends: Analysis["trends"];
  anomalies: Analysis["anomalies"];
  recommendations: Analysis["recommendations"];
  chart_specs: Analysis["chart_specs"];
  summary: string;
  parsed_sample: Record<string, unknown>[];
  next_steps?: string[];
  data_quality?: DataQuality;
  selected_kpis?: string[];
  annotations?: Annotation[];
  filters?: FilterConfig;
};

export default function AnalysisPage() {
  const { clientId, analysisId } = useParams<{ clientId: string; analysisId: string }>();
  const { toast } = useToast();
  const [row, setRow] = useState<Row | null>(null);
  const [client, setClient] = useState<ClientFull | null>(null);
  const [exporting, setExporting] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunFilterOpen, setRerunFilterOpen] = useState(false);
  const [rerunDetected, setRerunDetected] = useState<DetectedFilters | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [savingAnnotations, setSavingAnnotations] = useState(false);
  const reportRef = useRef<HTMLDivElement | null>(null);
  const { settings: agency, logoUrl: agencyLogoUrl } = useAgencySettings();

  const clientName = client?.name ?? "";
  const accent = client?.accent_color || "hsl(var(--primary))";
  const clientLogoUrl = publicLogoUrl("client-logos", client?.logo_path);

  useEffect(() => {
    if (!analysisId || !clientId) return;
    (async () => {
      const [{ data: a }, { data: c }] = await Promise.all([
        supabase.from("analyses").select("*").eq("id", analysisId).maybeSingle(),
        supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
      ]);
      const aRow = a as unknown as Row;
      setRow(aRow);
      setClient((c as unknown as ClientFull) ?? null);
      setAnnotations(Array.isArray(aRow?.annotations) ? aRow.annotations : []);
    })();
  }, [analysisId, clientId]);

  // Persist annotations with light debounce
  useEffect(() => {
    if (!row) return;
    const initial = Array.isArray(row.annotations) ? row.annotations : [];
    if (JSON.stringify(initial) === JSON.stringify(annotations)) return;
    const t = setTimeout(async () => {
      setSavingAnnotations(true);
      await supabase
        .from("analyses")
        .update({ annotations: annotations as unknown as never })
        .eq("id", row.id);
      setSavingAnnotations(false);
    }, 600);
    return () => clearTimeout(t);
  }, [annotations, row]);

  const charts = useMemo(() => {
    if (!row) return [];
    const out: { spec: Analysis["chart_specs"][number]; data: { x: string; y: number }[] }[] = [];
    for (const spec of row.chart_specs) {
      const data = buildChartData(row.parsed_sample, spec);
      const isTimeSeries =
        spec.aggregation === "daily" ||
        spec.aggregation === "monthly" ||
        /date|day|month|week/i.test(spec.x_field);
      if (isTimeSeries && data.length <= 1) {
        const replacement = buildTopProductsChart(row.parsed_sample);
        if (replacement) {
          out.push(replacement);
        }
        // If no replacement found, skip the single-point chart entirely.
        continue;
      }
      // If a "Top Products" / best-sellers chart is showing numeric IDs on the x-axis,
      // try to swap to a name column. Hide entirely if no name column exists.
      if (looksLikeProductChart(spec) && xAxisLooksNumeric(data)) {
        const replacement = buildTopProductsChart(row.parsed_sample, { requireName: true });
        if (replacement) out.push(replacement);
        continue;
      }
      out.push({ spec, data });
    }
    return out;
  }, [row]);

  // Pull next_steps / data_quality off the row if the AI returned them. They live as top-level
  // columns only when the schema includes them; otherwise check parsed JSONB blobs.
  const rawNextSteps: string[] | undefined = (row as unknown as { next_steps?: string[] })?.next_steps;
  const dataQuality: DataQuality | undefined = (row as unknown as { data_quality?: DataQuality })?.data_quality;

  // Backfill next_steps from top-impact recommendations when the AI didn't return any.
  const nextSteps: string[] = useMemo(() => {
    if (rawNextSteps && rawNextSteps.length > 0) return rawNextSteps;
    if (!row?.recommendations?.length) return [];
    const sorted = [...row.recommendations].sort(
      (a, b) => resolveImpact(b) - resolveImpact(a),
    );
    return sorted.slice(0, 3).map((r) => toImperative(r.title));
  }, [rawNextSteps, row]);

  // Detect analysis date range from the parsed sample, prefer AI-provided range.
  const periodLabel: string | null = useMemo(() => {
    if (dataQuality?.date_range && dataQuality.date_range.trim()) return dataQuality.date_range.trim();
    if (!row?.parsed_sample?.length) return null;
    return detectDateRange(row.parsed_sample);
  }, [dataQuality, row]);

  // Build a human-readable summary of the filter config persisted with this analysis.
  const filterSummary: string | null = useMemo(() => {
    const config = (row as unknown as { filters?: FilterConfig })?.filters;
    if (!config || isDefaultConfig(config) || !row?.parsed_sample?.length) return null;
    const columns = Object.keys(row.parsed_sample[0]);
    const detected = detectFilterableFields(row.parsed_sample, columns);
    const s = summarizeFilters(config, detected);
    return s || null;
  }, [row]);

  const chatContext = useMemo(() => {
    if (!row) return {};
    return {
      clientName,
      fileName: row.file_name,
      rowCount: row.row_count,
      analysisPeriod: periodLabel,
      industry: client?.industry,
      clientNotes: client?.notes,
      benchmarks: client?.benchmarks,
      selectedKpis: row.selected_kpis,
      kpis: row.kpis,
      trends: row.trends,
      anomalies: row.anomalies,
      recommendations: row.recommendations,
      summary: row.summary,
      dataQuality,
      chartSpecs: row.chart_specs,
    };
  }, [row, clientName, periodLabel, dataQuality, client]);

  if (!row) return <div className="p-10 text-muted-foreground">Loading analysis…</div>;

  function copySummary() {
    navigator.clipboard.writeText(row!.summary);
    toast({ title: "Summary copied" });
  }

  function openRerunFilters() {
    if (!row) return;
    if (!row.parsed_sample?.length) {
      // No data sample to filter on — fall back to direct re-run with no filters.
      void executeRerun(row.parsed_sample ?? [], null, null);
      return;
    }
    const columns = Object.keys(row.parsed_sample[0]);
    const detected = detectFilterableFields(row.parsed_sample, columns);
    // Override sample-derived date bounds with the TRUE full-dataset bounds we
    // persisted at the original analysis time, so the dialog and warnings reflect
    // the real data range (not just the 500-row sample).
    const persisted = row.filters as (FilterConfig & { dataMinDate?: string; dataMaxDate?: string }) | undefined;
    if (persisted?.dataMinDate) {
      const d = new Date(persisted.dataMinDate);
      if (!isNaN(d.getTime())) detected.dataMinDate = d;
    }
    if (persisted?.dataMaxDate) {
      const d = new Date(persisted.dataMaxDate);
      if (!isNaN(d.getTime())) detected.dataMaxDate = d;
    }
    if (!hasAnyFilter(detected)) {
      void executeRerun(row.parsed_sample, null, null);
      return;
    }
    setRerunDetected(detected);
    setRerunFilterOpen(true);
  }

  async function executeRerun(
    filteredRows: Record<string, unknown>[],
    filterConfig: FilterConfig | null,
    filterSummary: string | null,
  ) {
    if (!row) return;
    setRerunning(true);
    try {
      const res = await fetch("/api/analyze-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildAnalyzePayload(filteredRows),
          fileName: row.file_name,
          clientName,
          industry: client?.industry,
          clientNotes: client?.notes,
          benchmarks: client?.benchmarks,
          selectedKpis: row.selected_kpis ?? [],
          filters: filterConfig,
          filterSummary,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error ?? "Re-run failed");
      const analysis = (data as { analysis?: Analysis })?.analysis;
      if (!analysis) throw new Error("No analysis returned");

      const updatePayload: Record<string, unknown> = {
        kpis: analysis.kpis,
        trends: analysis.trends,
        anomalies: analysis.anomalies,
        recommendations: analysis.recommendations,
        chart_specs: analysis.chart_specs,
        summary: analysis.summary,
        next_steps: analysis.next_steps ?? [],
        data_quality: analysis.data_quality ?? {},
        row_count: filteredRows.length,
        parsed_sample: filteredRows.slice(0, 500),
      };
      if (filterConfig) {
        // Carry the previously-persisted true full-dataset date bounds forward so
        // future re-runs continue to show the correct range.
        const prev = row.filters as (FilterConfig & { dataMinDate?: string; dataMaxDate?: string }) | undefined;
        updatePayload.filters = {
          ...filterConfig,
          dataMinDate: prev?.dataMinDate,
          dataMaxDate: prev?.dataMaxDate,
        };
      }

      const { error: updateError } = await supabase
        .from("analyses")
        .update(updatePayload as never)
        .eq("id", row.id);
      if (updateError) throw updateError;

      setRow({
        ...row,
        kpis: analysis.kpis,
        trends: analysis.trends,
        anomalies: analysis.anomalies,
        recommendations: analysis.recommendations,
        chart_specs: analysis.chart_specs,
        summary: analysis.summary,
        next_steps: analysis.next_steps,
        data_quality: analysis.data_quality,
        row_count: filteredRows.length,
        parsed_sample: filteredRows.slice(0, 500),
        filters: filterConfig ?? row.filters,
      });
      toast({ title: "Analysis refreshed" });
    } catch (e) {
      toast({
        title: "Re-run failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRerunning(false);
    }
  }


  async function exportPdf() {
    if (!reportRef.current) return;
    setExporting(true);
    reportRef.current.classList.add("exporting-pdf");
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);

      const pdf = new jsPDF("p", "pt", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      // Generous page chrome — guarantees title and footer never clip.
      const MARGIN_X = 40;
      const MARGIN_TOP = 40;
      const MARGIN_BOTTOM = 50; // space reserved for "Prepared by" + "Page X of Y"
      const BLOCK_GAP = 16;     // vertical gap between blocks in pt
      const usableW = pageW - MARGIN_X * 2;
      const usableH = pageH - MARGIN_TOP - MARGIN_BOTTOM;

      // Treat every direct child of the report container as an atomic block.
      // The Next-30-days <ol> sits inside its <section>, so it's never split.
      const blocks = Array.from(reportRef.current.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el.offsetHeight > 0,
      );
      if (blocks.length === 0) throw new Error("Nothing to export.");

      // Render each block to its own canvas at high DPI, then convert to PDF points.
      const rendered: { img: string; wPt: number; hPt: number }[] = [];
      const PX_TO_PT = 0.75; // 96 dpi → 72 dpi
      for (const el of blocks) {
        const c = await html2canvas(el, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
        });
        // The canvas's pixel width corresponds to el.offsetWidth CSS px (× scale).
        const cssW = c.width / 2;
        const cssH = c.height / 2;
        rendered.push({
          img: c.toDataURL("image/png"),
          wPt: cssW * PX_TO_PT,
          hPt: cssH * PX_TO_PT,
        });
      }

      // Fit blocks to page width — they all share the same DOM width so one ratio.
      const baseW = rendered[0].wPt;
      const widthScale = usableW / baseW;
      const sized = rendered.map((b) => ({
        img: b.img,
        w: b.wPt * widthScale,
        h: b.hPt * widthScale,
      }));

      // Greedy page packing without splitting blocks. Returns array of pages
      // (each page = list of block indices).
      function pack(items: { h: number }[]): number[][] {
        const pages: number[][] = [[]];
        let used = 0;
        for (let i = 0; i < items.length; i++) {
          const h = items[i].h;
          const need = pages[pages.length - 1].length === 0 ? h : used + BLOCK_GAP + h;
          if (need > usableH && pages[pages.length - 1].length > 0) {
            pages.push([i]);
            used = h;
          } else {
            pages[pages.length - 1].push(i);
            used = need;
          }
        }
        return pages;
      }

      let pages = pack(sized);

      // Hard cap of 2 pages: if we overflow, shrink everything uniformly until it fits.
      // We only shrink when the natural layout already produced 3+ pages.
      if (pages.length > 2) {
        // Binary-search a scale factor in (0.5, 1) that makes pack() return ≤ 2 pages.
        let lo = 0.5;
        let hi = 1;
        let best = lo;
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) / 2;
          const trial = sized.map((b) => ({ ...b, w: b.w * mid, h: b.h * mid }));
          const p = pack(trial);
          if (p.length <= 2) {
            best = mid;
            lo = mid; // try larger
          } else {
            hi = mid;
          }
        }
        for (const b of sized) {
          b.w *= best;
          b.h *= best;
        }
        pages = pack(sized);
      }

      // Two-way rebalance for 2-page reports so neither page has a big blank.
      // Step 1: pull blocks from page 2 → page 1 while they still fit (avoids
      // premature breaks like "charts on p1, trends starting p2").
      // Step 2: if page 2 is still very sparse, push the tail of page 1 → page 2.
      if (pages.length === 2) {
        const totalH = (page: number[]) =>
          page.reduce((acc, idx, i) => acc + sized[idx].h + (i > 0 ? BLOCK_GAP : 0), 0);

        // Step 1 — greedily fill page 1 with as many leading page-2 blocks as fit.
        while (pages[1].length > 0) {
          const next = pages[1][0];
          const candidate = totalH(pages[0]) + BLOCK_GAP + sized[next].h;
          if (candidate <= usableH) {
            pages[0].push(next);
            pages[1].shift();
          } else break;
        }

        // Step 2 — if page 2 ended up empty, drop it.
        if (pages[1].length === 0) {
          pages.pop();
        } else if (pages[0].length > 1) {
          // Page 2 is non-empty but might be sparse. Only shift backward if
          // page 2 is severely under-filled AND page 1 is over half-full.
          let p1 = totalH(pages[0]);
          let p2 = totalH(pages[1]);
          while (
            pages[0].length > 1 &&
            p2 / usableH < 0.35 &&
            p1 - sized[pages[0][pages[0].length - 1]].h - BLOCK_GAP > usableH * 0.55
          ) {
            const moved = pages[0].pop()!;
            pages[1] = [moved, ...pages[1]];
            const newP2 = totalH(pages[1]);
            if (newP2 > usableH) {
              pages[1].shift();
              pages[0].push(moved);
              break;
            }
            p1 = totalH(pages[0]);
            p2 = newP2;
          }
        }
      }

      const totalPages = pages.length;
      pages.forEach((page, pageIdx) => {
        if (pageIdx > 0) pdf.addPage();
        let y = MARGIN_TOP;
        page.forEach((blockIdx, i) => {
          const b = sized[blockIdx];
          if (i > 0) y += BLOCK_GAP;
          // Center horizontally if block is narrower than usable width
          const x = MARGIN_X + (usableW - b.w) / 2;
          pdf.addImage(b.img, "PNG", x, y, b.w, b.h);
          y += b.h;
        });
        // Page number footer — sits 20pt above the page edge, inside the bottom margin.
        pdf.setFontSize(8);
        pdf.setTextColor(140);
        const label = `Page ${pageIdx + 1} of ${totalPages}`;
        pdf.text(label, pageW / 2, pageH - 20, { align: "center" });
      });

      const safe = clientName.replace(/[^a-z0-9]+/gi, "_") || "client";
      pdf.save(`${safe}_analysis_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      reportRef.current?.classList.remove("exporting-pdf");
      setExporting(false);
    }
  }

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/clients/${clientId}`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to {clientName || "client"}
        </Link>
        <div className="flex items-center gap-2">
          {savingAnnotations && (
            <span className="text-[11px] text-muted-foreground">Saving notes…</span>
          )}
          <Button variant="outline" size="sm" onClick={copySummary}>
            <Copy className="h-4 w-4" /> Copy summary
          </Button>
          <Button variant="outline" size="sm" onClick={openRerunFilters} disabled={rerunning}>
            <RefreshCw className={`h-4 w-4 ${rerunning ? "animate-spin" : ""}`} /> {rerunning ? "Re-running…" : "Re-run analysis"}
          </Button>
          <Button size="sm" onClick={exportPdf} disabled={exporting}>
            <Download className="h-4 w-4" /> {exporting ? "Exporting…" : "Export PDF"}
          </Button>
        </div>
      </div>

      <div ref={reportRef} className="bg-background space-y-6 p-2">
        <header className="border-b pb-3" style={{ borderBottomColor: accent }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {agencyLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={agencyLogoUrl} alt="Agency logo" crossOrigin="anonymous" className="h-12 w-12 object-contain shrink-0" />
              ) : null}
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {agency?.agency_name ? `${agency.agency_name} — Business analysis` : "Business analysis"}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight truncate">
                  {agency?.agency_name ? `Analysis for ${clientName}` : clientName}
                </h1>
                <div className="text-xs text-muted-foreground">
                  {row.file_name} · {row.row_count.toLocaleString()} rows · {new Date(row.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
                </div>
              </div>
            </div>
            {clientLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clientLogoUrl} alt={`${clientName} logo`} crossOrigin="anonymous" className="h-12 w-12 object-contain shrink-0" />
            )}
          </div>
        </header>

        {/* General-section annotations sit at the top of the report */}
        <AnnotationsEditor section="general" annotations={annotations} onChange={setAnnotations} />

        {/* KPIs — single horizontal row */}
        <section>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h2 className="text-xs font-medium text-muted-foreground">Key indicators</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {periodLabel && (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Analysis Period: {periodLabel}
                </Badge>
              )}
              {filterSummary && (
                <Badge variant="outline" className="text-[10px] font-normal border-primary/40 text-primary">
                  Filters: {filterSummary}
                </Badge>
              )}
            </div>
          </div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
          >
            {row.kpis.map((k, i) => {
              const sentiment = resolveSentiment(k);
              return (
                <Card
                  key={i}
                  className="p-3 space-y-1 border-l-4"
                  style={{ borderLeftColor: sentiment === "concern" ? sentimentColor(sentiment) : accent }}
                >
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide leading-tight">{k.name}</div>
                  <div className="text-lg font-bold tracking-tight leading-tight">{k.value}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">{k.unit}</div>
                  {hasMeaningfulDelta(k.delta) && (
                    <div className={`text-[10px] font-medium ${deltaClass(k.delta)}`}>{k.delta}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground pt-0.5 leading-snug">{k.context}</div>
                </Card>
              );
            })}
          </div>
          <AnnotationsEditor section="kpis" annotations={annotations} onChange={setAnnotations} className="mt-2" />
        </section>

        {/* Benchmarks: targets vs actuals (if user set custom benchmarks) */}
        {Array.isArray(client?.benchmarks) && client.benchmarks.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-muted-foreground mb-2">Targets</h2>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Metric</th>
                    <th className="text-left font-medium px-3 py-2">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {client.benchmarks.map((b, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-3 py-2">{b.label}</td>
                      <td className="px-3 py-2 font-medium">{b.value}{b.unit ? ` ${b.unit}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        )}

        {/* Data quality note (date range now shown as badge above) */}
        {dataQuality && dataQuality.limitations && (
          <p className="text-[10px] italic text-muted-foreground border-t pt-2">
            Rows analyzed: {(dataQuality.rows_analyzed ?? row.row_count).toLocaleString()} · {dataQuality.limitations}
          </p>
        )}

        {/* Charts */}
        {charts.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">Visualizations</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {charts.map(({ spec, data }, i) => {
                // Cap visible x-axis labels so long series (e.g. 50 daily points)
                // don't render every tick and collapse into an unreadable smear.
                const MAX_LABELS = 10;
                const tickInterval = data.length > MAX_LABELS ? Math.ceil(data.length / MAX_LABELS) - 1 : 0;
                return (
                <Card key={i} className="p-3">
                  <div className="mb-1">
                    <div className="font-medium text-sm">{spec.title}</div>
                    <div className="text-[10px] text-muted-foreground">{spec.rationale}</div>
                  </div>
                  <div className="h-52 w-full">
                    {data.length === 0 ? (
                      <div className="h-full grid place-items-center text-xs text-muted-foreground">
                        Not enough data to render this chart.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        {spec.type === "bar" ? (
                          <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 28 }}>
                            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                            <XAxis dataKey="x" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} angle={-45} textAnchor="end" interval={tickInterval} height={50} stroke="hsl(var(--muted-foreground))" />
                            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" />
                            <Tooltip
                              contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11, color: "hsl(var(--foreground))" }}
                              labelStyle={{ color: "hsl(var(--foreground))" }}
                              itemStyle={{ color: "hsl(var(--foreground))" }}
                            />
                            <Bar dataKey="y" fill={accent} radius={[4, 4, 0, 0]} name={spec.y_field} />
                          </BarChart>
                        ) : (
                          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 28 }}>
                            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                            <XAxis dataKey="x" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} angle={-45} textAnchor="end" interval={tickInterval} height={50} stroke="hsl(var(--muted-foreground))" />
                            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" />
                            <Tooltip
                              contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11, color: "hsl(var(--foreground))" }}
                              labelStyle={{ color: "hsl(var(--foreground))" }}
                              itemStyle={{ color: "hsl(var(--foreground))" }}
                            />
                            <Line type="monotone" dataKey="y" stroke={accent} strokeWidth={2} dot={false} name={spec.y_field} />
                          </LineChart>
                        )}
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Trends */}
        {row.trends.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-muted-foreground mb-2">Trends</h2>
            <div className="space-y-1.5">
              {row.trends.map((t, i) => (
                <Card key={i} className="p-2.5 flex items-start gap-2">
                  <TrendIcon dir={t.direction} />
                  <div className="flex-1">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {t.metric}
                      <Badge variant="secondary" className="font-normal text-[10px] px-1.5 py-0">{t.magnitude}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{t.explanation}</div>
                  </div>
                </Card>
              ))}
            </div>
            <AnnotationsEditor section="trends" annotations={annotations} onChange={setAnnotations} className="mt-2" />
          </section>
        )}

        {/* Anomalies */}
        {row.anomalies.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-muted-foreground mb-2">Anomalies</h2>
            <div className="space-y-1.5">
              {row.anomalies.map((a, i) => (
                <Card key={i} className="p-2.5 flex items-start gap-2">
                  <TriangleAlert className={`h-4 w-4 mt-0.5 ${
                    a.severity === "high" ? "text-destructive" : a.severity === "medium" ? "text-[hsl(var(--warning))]" : "text-muted-foreground"
                  }`} />
                  <div className="flex-1">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {a.label}
                      <Badge variant={a.severity === "high" ? "destructive" : "secondary"} className="font-normal capitalize text-[10px] px-1.5 py-0">{a.severity}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{a.explanation}</div>
                  </div>
                </Card>
              ))}
            </div>
            <AnnotationsEditor section="anomalies" annotations={annotations} onChange={setAnnotations} className="mt-2" />
          </section>
        )}
        {row.recommendations.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-muted-foreground mb-2">Recommendations</h2>
            <div className="space-y-1.5">
              {row.recommendations.map((r, i) => (
                <Card key={i} className="p-2.5 flex items-start gap-2">
                  <div className="h-6 w-6 rounded-md bg-primary/10 text-primary grid place-items-center shrink-0">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                      {r.title}
                      <Badge variant="outline" className="font-normal capitalize text-[10px] px-1.5 py-0">{r.priority} priority</Badge>
                      <Badge variant="secondary" className="font-normal text-[10px] px-1.5 py-0">Impact {resolveImpact(r)}/10</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{r.detail}</div>
                  </div>
                </Card>
              ))}
            </div>
            <AnnotationsEditor section="recommendations" annotations={annotations} onChange={setAnnotations} className="mt-2" />
          </section>
        )}

        {/* Summary */}
        <section>
          <h2 className="text-xs font-medium text-muted-foreground mb-2">Client summary</h2>
          <Card className="p-3">
            <p className="text-xs leading-snug whitespace-pre-line">{row.summary}</p>
          </Card>
          <AnnotationsEditor section="summary" annotations={annotations} onChange={setAnnotations} className="mt-2" />
        </section>

        {/* Next Steps */}
        {nextSteps.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-muted-foreground mb-2">Next 30 days</h2>
            <Card className="p-3">
              <ol className="space-y-1.5 text-xs leading-snug">
                {nextSteps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold grid place-items-center shrink-0">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </section>
        )}

        {/* Prepared-by footer (printed in PDF) */}
        {(agency?.consultant_name || agency?.agency_name || agency?.contact_email) && (
          <footer className="pt-4 mt-4 border-t text-[10px] text-muted-foreground flex items-center justify-between gap-2">
            <span>
              Prepared by{" "}
              {agency.consultant_name && <span className="font-medium text-foreground">{agency.consultant_name}</span>}
              {agency.consultant_name && agency.agency_name && ", "}
              {agency.agency_name && <span className="text-foreground">{agency.agency_name}</span>}
              {agency.contact_email && (
                <>
                  {" · "}
                  <span>{agency.contact_email}</span>
                </>
              )}
            </span>
            <span>{new Date(row.created_at).toLocaleDateString()}</span>
          </footer>
        )}
      </div>

      {/* Floating consultant toggle */}
      <button
        onClick={() => setChatOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-30 h-12 px-4 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 transition-opacity flex items-center gap-2 text-sm font-medium"
        aria-label="Open AI consultant"
      >
        <MessageSquare className="h-4 w-4" />
        Ask AI consultant
      </button>

      <ConsultantChatPanel open={chatOpen} onClose={() => setChatOpen(false)} context={chatContext} />

      {rerunDetected && row.parsed_sample?.length > 0 && (
        <AnalysisFilterDialog
          open={rerunFilterOpen}
          onOpenChange={setRerunFilterOpen}
          rows={row.parsed_sample}
          detected={rerunDetected}
          initialConfig={row.filters ?? null}
          confirmLabel="Re-run Analysis"
          onConfirm={(config, filteredRows) => {
            const summary = summarizeFilters(config, rerunDetected) || null;
            setRerunFilterOpen(false);
            void executeRerun(filteredRows, config, summary);
          }}
          onCancel={() => setRerunFilterOpen(false)}
        />
      )}
    </div>
  );
}

function detectDateRange(rows: Record<string, unknown>[]): string | null {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0] ?? {});
  const dateKey = keys.find((k) => /date|day|timestamp|created|order_date/i.test(k));
  if (!dateKey) return null;
  const dates: Date[] = [];
  for (const r of rows) {
    const raw = r[dateKey];
    if (raw === null || raw === undefined || raw === "") continue;
    const d = new Date(raw as string | number | Date);
    if (!isNaN(d.getTime())) dates.push(d);
  }
  if (!dates.length) return null;
  let min = dates[0], max = dates[0];
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const sameDay = min.toDateString() === max.toDateString();
  const sameMonth = min.getFullYear() === max.getFullYear() && min.getMonth() === max.getMonth();
  const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const fmtMonth = (d: Date) => d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
  if (sameDay) return fmtDay(min);
  if (sameMonth) return fmtMonth(min);
  const spanDays = (max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24);
  if (spanDays < 60) return `${fmtDay(min)} — ${fmtDay(max)}`;
  return `${fmtMonth(min)} — ${fmtMonth(max)}`;
}

function buildTopProductsChart(
  rows: Record<string, unknown>[],
  opts: { requireName?: boolean } = {},
): { spec: import("@/lib/analysisTypes").ChartSpec; data: { x: string; y: number }[] } | null {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0] ?? {});
  // Prefer descriptive name columns over IDs. Reject anything that looks like an ID column.
  const isIdLike = (k: string) => /(^|_)id$|_id_|\bid\b/i.test(k);
  const nameKey =
    keys.find((k) => !isIdLike(k) && /product_name|item_name|sku_name|^name$/i.test(k)) ??
    keys.find((k) => !isIdLike(k) && /product|item|sku|category/i.test(k)) ??
    keys.find((k) => !isIdLike(k) && /name/i.test(k));
  const productKey = nameKey ?? (opts.requireName ? null : keys.find((k) => /product|item|sku|category|name/i.test(k)));
  if (!productKey) return null;

  // Sanity-check: the chosen column should have mostly non-numeric values.
  const sampleVals = rows.slice(0, 30).map((r) => r[productKey]).filter((v) => v !== null && v !== undefined && v !== "");
  const numericRatio = sampleVals.filter((v) => !isNaN(Number(v))).length / Math.max(sampleVals.length, 1);
  if (numericRatio > 0.7) return null; // chosen column is still mostly numbers — give up

  const qtyKey = keys.find((k) => /qty|quantity|units|sold|count/i.test(k));
  const revenueKey = keys.find((k) => /revenue|sales|amount|total|price/i.test(k));
  const valueKey = qtyKey ?? revenueKey ?? null;

  const totals = new Map<string, number>();
  for (const r of rows) {
    const name = r[productKey];
    if (name === null || name === undefined || name === "") continue;
    const label = String(name).trim();
    if (!label) continue;
    let val = 1;
    if (valueKey) {
      const raw = r[valueKey];
      const n = typeof raw === "number" ? raw : Number(raw);
      val = Number.isFinite(n) ? n : 0;
    }
    totals.set(label, (totals.get(label) ?? 0) + val);
  }
  if (totals.size === 0) return null;

  const data = [...totals.entries()]
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => b.y - a.y)
    .slice(0, 5);

  const yField = valueKey ?? "count";
  const yLabel = qtyKey ? "units sold" : revenueKey ? "revenue" : "transactions";
  return {
    spec: {
      title: "Top 5 Best Selling Products",
      type: "bar",
      x_field: productKey,
      y_field: yField,
      aggregation: "sum",
      rationale: `Best sellers by ${yLabel}.`,
    },
    data,
  };
}

function looksLikeProductChart(spec: { title?: string; x_field?: string }): boolean {
  return /top|best.?sell|product|item|sku/i.test(`${spec.title ?? ""} ${spec.x_field ?? ""}`);
}

function xAxisLooksNumeric(data: { x: string }[]): boolean {
  if (!data.length) return false;
  const numeric = data.filter((d) => !isNaN(Number(d.x))).length;
  return numeric / data.length > 0.7;
}

function toImperative(title: string): string {
  const t = (title || "").trim();
  if (!t) return "Review the top recommendation.";
  // If it doesn't already look imperative, prefix with an action verb.
  if (/^(audit|launch|create|review|increase|decrease|reduce|improve|optimize|build|ship|test|set|add|remove|hire|train|update|expand|focus|prioritize|investigate|monitor|switch|negotiate|cut|raise)\b/i.test(t)) {
    return t.endsWith(".") ? t : `${t}.`;
  }
  return `${t}${t.endsWith(".") ? "" : "."}`;
}

function TrendIcon({ dir }: { dir: "up" | "down" | "flat" }) {
  if (dir === "up") return <ArrowUp className="h-4 w-4 mt-0.5 text-[hsl(var(--success))]" />;
  if (dir === "down") return <ArrowDown className="h-4 w-4 mt-0.5 text-destructive" />;
  return <Minus className="h-4 w-4 mt-0.5 text-muted-foreground" />;
}

function deltaClass(delta: string) {
  if (!delta) return "text-muted-foreground";
  if (delta.trim().startsWith("+")) return "text-[hsl(var(--success))]";
  if (delta.trim().startsWith("-")) return "text-destructive";
  return "text-muted-foreground";
}

function hasMeaningfulDelta(delta: string | undefined): boolean {
  if (!delta) return false;
  const t = delta.trim();
  if (!t) return false;
  return !/^(n\/?a|na|none|unknown|tbd|null)$/i.test(t);
}

function resolveSentiment(k: Kpi): Sentiment {
  if (k.sentiment === "positive" || k.sentiment === "neutral" || k.sentiment === "concern") {
    return k.sentiment;
  }
  const d = (k.delta || "").trim();
  if (d.startsWith("+")) return "positive";
  if (d.startsWith("-")) return "concern";
  return "neutral";
}

function sentimentColor(s: Sentiment): string {
  if (s === "positive") return "hsl(var(--primary))";
  if (s === "concern") return "hsl(var(--destructive))";
  return "hsl(var(--warning))";
}

function resolveImpact(r: Recommendation): number {
  if (typeof r.impact_score === "number" && r.impact_score >= 1 && r.impact_score <= 10) {
    return Math.round(r.impact_score);
  }
  return r.priority === "high" ? 8 : r.priority === "medium" ? 5 : 3;
}
