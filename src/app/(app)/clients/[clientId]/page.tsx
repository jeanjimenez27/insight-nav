"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { parseFile } from "@/lib/parseFile";
import { buildAnalyzePayload } from "@/lib/buildAggregations";
import {
  mergeParsedFiles,
  describeMerge,
  type ParsedFile,
  type JoinStep,
} from "@/lib/mergeFiles";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, FileSpreadsheet, Loader2, ChevronRight, CheckCircle2, AlertCircle, RotateCw, Pencil, Trash2, Link2, Sparkles } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Analysis } from "@/lib/analysisTypes";
import type { ClientFull } from "@/lib/clientTypes";
import { publicLogoUrl } from "@/hooks/useAgencySettings";
import ClientFormDialog from "@/components/ClientFormDialog";
import KpiSelectionDialog from "@/components/KpiSelectionDialog";
import AnalysisFilterDialog from "@/components/AnalysisFilterDialog";
import {
  detectFilterableFields,
  hasAnyFilter,
  isDefaultConfig,
  summarizeFilters,
  type DetectedFilters,
  type FilterConfig,
} from "@/lib/analysisFilters";

type AnalysisRow = { id: string; file_name: string; row_count: number; created_at: string };
type QueueStatus = "pending" | "parsing" | "analyzing" | "saving" | "done" | "error";
type QueueItem = {
  id: string;
  file: File;
  displayName?: string;
  status: QueueStatus;
  message?: string;
  analysisId?: string;
  rows?: Record<string, unknown>[];
  joinNote?: string;
  filterConfig?: FilterConfig;
  filterSummary?: string;
};
type JoinSummary = { displayName: string; joinPlan: JoinStep[]; orphans: string[] };
type UnmergeableState = {
  parsed: ParsedFile[];
  fileByName: Map<string, File>;
  selected: Set<string>;
};

const STAGE_LABEL: Record<QueueStatus, string> = {
  pending: "Waiting…",
  parsing: "Parsing file…",
  analyzing: "Analyzing with AI…",
  saving: "Saving…",
  done: "Done",
  error: "Failed",
};

export default function ClientPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [client, setClient] = useState<ClientFull | null>(null);
  const [history, setHistory] = useState<AnalysisRow[]>([]);
  const [drag, setDrag] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // KPI selection step
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingRows, setPendingRows] = useState<Record<string, unknown>[] | null>(null);
  const [pendingDisplayName, setPendingDisplayName] = useState<string | null>(null);
  const [pendingColumns, setPendingColumns] = useState<string[]>([]);
  const [pendingJoinNote, setPendingJoinNote] = useState<string | null>(null);
  const [kpiOpen, setKpiOpen] = useState(false);
  const [joinSummary, setJoinSummary] = useState<JoinSummary | null>(null);
  const [unmergeable, setUnmergeable] = useState<UnmergeableState | null>(null);

  // Filter step (sits between merge and KPI selection)
  const [filterOpen, setFilterOpen] = useState(false);
  const [pendingDetected, setPendingDetected] = useState<DetectedFilters | null>(null);
  const [pendingFilterConfig, setPendingFilterConfig] = useState<FilterConfig | null>(null);
  const [pendingFilterSummary, setPendingFilterSummary] = useState<string | null>(null);
  const [unfilteredRows, setUnfilteredRows] = useState<Record<string, unknown>[] | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  async function loadClient(cId: string) {
    const { data } = await supabase.from("clients").select("*").eq("id", cId).maybeSingle();
    setClient((data as unknown as ClientFull) ?? null);
  }

  async function loadHistory(cId: string) {
    const { data } = await supabase
      .from("analyses")
      .select("id,file_name,row_count,created_at")
      .eq("client_id", cId)
      .order("created_at", { ascending: false });
    setHistory(data ?? []);
  }

  useEffect(() => {
    if (!clientId) return;
    loadClient(clientId);
    loadHistory(clientId);
  }, [clientId]);

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  const processItem = useCallback(
    async (item: QueueItem, currentClient: ClientFull, selectedKpis: string[]): Promise<{ ok: boolean; analysisId?: string }> => {
      try {
        let rows = item.rows;
        if (!rows) {
          updateItem(item.id, { status: "parsing", message: undefined });
          rows = await parseFile(item.file);
        }
        if (!rows.length) throw new Error("No rows found in file.");

        updateItem(item.id, { status: "analyzing", rows });
        const res = await fetch("/api/analyze-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...buildAnalyzePayload(rows),
            fileName: item.displayName ?? item.file.name,
            clientName: currentClient.name,
            industry: currentClient.industry,
            clientNotes: currentClient.notes,
            benchmarks: currentClient.benchmarks,
            selectedKpis,
            joinNote: item.joinNote,
            filters: item.filterConfig ?? null,
            filterSummary: item.filterSummary ?? null,
          }),
        });
        const data = await res.json();
        if (!res.ok || data?.error) throw new Error(data?.error ?? "Analysis failed");
        const analysis = data.analysis as Analysis;

        updateItem(item.id, { status: "saving" });
        const insertPayload = {
          owner: user!.id,
          client_id: currentClient.id,
          file_name: item.displayName ?? item.file.name,
          row_count: rows.length,
          kpis: analysis.kpis as unknown as never,
          trends: analysis.trends as unknown as never,
          anomalies: analysis.anomalies as unknown as never,
          recommendations: analysis.recommendations as unknown as never,
          chart_specs: analysis.chart_specs as unknown as never,
          summary: analysis.summary,
          parsed_sample: rows.slice(0, 500) as unknown as never,
          next_steps: (analysis.next_steps ?? []) as unknown as never,
          data_quality: (analysis.data_quality ?? {}) as unknown as never,
          selected_kpis: selectedKpis as unknown as never,
          annotations: [] as unknown as never,
          filters: (item.filterConfig ?? {}) as unknown as never,
        };
        const { data: inserted, error: insErr } = await supabase
          .from("analyses")
          .insert(insertPayload)
          .select("id")
          .single();
        if (insErr) throw insErr;

        updateItem(item.id, { status: "done", analysisId: inserted.id });
        return { ok: true, analysisId: inserted.id };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Analysis failed";
        updateItem(item.id, { status: "error", message: msg });
        return { ok: false };
      }
    },
    [user],
  );

  const runQueue = useCallback(
    async (items: QueueItem[], selectedKpis: string[]) => {
      if (!client || !user || items.length === 0) return;
      setProcessing(true);
      const succeeded: string[] = [];
      for (const item of items) {
        const res = await processItem(item, client, selectedKpis);
        if (res.ok && res.analysisId) succeeded.push(res.analysisId);
      }
      setProcessing(false);
      await loadHistory(client.id);

      if (succeeded.length === 0) {
        toast({ title: "No analyses completed", variant: "destructive" });
      } else if (succeeded.length === 1 && items.length === 1) {
        toast({ title: "Analysis ready" });
        router.push(`/clients/${client.id}/analyses/${succeeded[0]}`);
      } else {
        toast({ title: `${succeeded.length} of ${items.length} analyses ready` });
      }
    },
    [client, user, processItem, router, toast],
  );

  // After merge: detect filterable fields. If any apply → open filter dialog,
  // otherwise skip straight to KPI selection (current behavior).
  const openFilterOrKpi = useCallback(
    (
      rows: Record<string, unknown>[],
      columns: string[],
      files: File[],
      displayName: string | null,
      joinNote: string | null,
    ) => {
      const detected = detectFilterableFields(rows, columns);

      setPendingFiles(files);
      setPendingDisplayName(displayName);
      setPendingColumns(columns);
      setPendingJoinNote(joinNote);
      setUnfilteredRows(rows);

      if (hasAnyFilter(detected)) {
        setPendingDetected(detected);
        setPendingRows(rows); // initial; will be overwritten with filtered set
        setPendingFilterConfig(null);
        setPendingFilterSummary(null);
        setFilterOpen(true);
      } else {
        setPendingDetected(null);
        setPendingRows(rows);
        setPendingFilterConfig(null);
        setPendingFilterSummary(null);
        setKpiOpen(true);
      }
    },
    [],
  );

  // Take an array of already-parsed files and route to the right outcome.
  const applyMergeResult = useCallback(
    (parsedFiles: ParsedFile[], fileByName: Map<string, File>) => {
      const result = mergeParsedFiles(parsedFiles);
      setJoinSummary(null);
      setUnmergeable(null);

      if (result.kind === "unmergeable") {
        setUnmergeable({
          parsed: result.files.map((f) => {
            const orig = parsedFiles.find((p) => p.name === f.name);
            return { name: f.name, columns: f.columns, rows: orig?.rows ?? [] };
          }),
          fileByName,
          selected: new Set(result.files.map((f) => f.name)),
        });
        toast({
          title: "Files have different structures",
          description:
            "These files share no common ID columns and cannot be merged — pick which ones to include.",
          variant: "destructive",
        });
        return;
      }

      if (result.kind === "single") {
        const file = fileByName.get(result.displayName);
        if (!file) return;
        openFilterOrKpi(result.rows, result.columns, [file], null, null);
        return;
      }

      // stacked or joined → one combined queue item
      const sourceNames = result.sources;
      const files = sourceNames
        .map((n) => fileByName.get(n))
        .filter((f): f is File => !!f);
      const note = describeMerge(result);

      if (result.kind === "joined") {
        setJoinSummary({
          displayName: result.displayName,
          joinPlan: result.joinPlan,
          orphans: result.orphans,
        });
      }

      openFilterOrKpi(result.rows, result.columns, files, result.displayName, note);
    },
    [toast, openFilterOrKpi],
  );

  // Step 1: user dropped/selected files. Parse all up-front, then merge/join/route.
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (!files.length || !client || !user) return;
      setJoinSummary(null);
      setUnmergeable(null);

      let parsed: { file: File; rows: Record<string, unknown>[] }[];
      try {
        parsed = await Promise.all(
          files.map(async (file) => ({ file, rows: await parseFile(file) })),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to parse files";
        toast({ title: "Could not read files", description: msg, variant: "destructive" });
        return;
      }

      const nonEmpty = parsed.filter((p) => p.rows.length > 0);
      if (!nonEmpty.length) {
        toast({ title: "No rows found in the selected files", variant: "destructive" });
        return;
      }

      const fileByName = new Map<string, File>(nonEmpty.map((p) => [p.file.name, p.file]));
      const parsedFiles: ParsedFile[] = nonEmpty.map((p) => ({
        name: p.file.name,
        rows: p.rows,
        columns: Object.keys(p.rows[0]),
      }));

      applyMergeResult(parsedFiles, fileByName);
    },
    [client, user, toast, applyMergeResult],
  );

  // User picked a subset from the unmergeable card. Re-run merge on that subset.
  const proceedWithSelectedSubset = useCallback(() => {
    if (!unmergeable) return;
    const picked = unmergeable.parsed.filter((p) => unmergeable.selected.has(p.name));
    if (picked.length === 0) {
      toast({ title: "Pick at least one file", variant: "destructive" });
      return;
    }
    applyMergeResult(picked, unmergeable.fileByName);
  }, [unmergeable, applyMergeResult, toast]);

  // Step 2: user confirmed KPI selection — build the queue and run.
  const startQueueWithKpis = useCallback(
    (selectedKpis: string[]) => {
      if (!pendingFiles.length || !client) return;
      const fc = pendingFilterConfig ?? undefined;
      const fs = pendingFilterSummary ?? undefined;
      const items: QueueItem[] = pendingDisplayName && pendingRows
        ? [{
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file: pendingFiles[0],
            displayName: pendingDisplayName,
            rows: pendingRows,
            joinNote: pendingJoinNote ?? undefined,
            filterConfig: fc,
            filterSummary: fs,
            status: "pending",
          }]
        : pendingFiles.map((file, idx) => ({
            id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
            file,
            rows: idx === 0 && pendingRows ? pendingRows : undefined,
            filterConfig: idx === 0 ? fc : undefined,
            filterSummary: idx === 0 ? fs : undefined,
            status: "pending",
          }));
      setQueue(items);
      setPendingFiles([]);
      setPendingRows(null);
      setPendingDisplayName(null);
      setPendingColumns([]);
      setPendingJoinNote(null);
      setPendingDetected(null);
      setPendingFilterConfig(null);
      setPendingFilterSummary(null);
      setUnfilteredRows(null);
      runQueue(items, selectedKpis);
    },
    [pendingFiles, pendingRows, pendingDisplayName, pendingJoinNote, pendingFilterConfig, pendingFilterSummary, client, runQueue],
  );


  async function retryItem(id: string) {
    if (!client) return;
    const item = queue.find((q) => q.id === id);
    if (!item || processing) return;
    setProcessing(true);
    // Re-use the prior selection by passing whatever the analysis uses; default to none
    await processItem(item, client, []);
    setProcessing(false);
    await loadHistory(client.id);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (processing) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) handleFilesSelected(files);
  }

  if (!client) {
    return <div className="p-10 text-muted-foreground">Loading client…</div>;
  }

  const showQueue = queue.length > 0;
  const clientLogoUrl = publicLogoUrl("client-logos", client.logo_path);

  return (
    <div className="px-8 py-8 max-w-5xl mx-auto space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {clientLogoUrl && (
            <div
              className="h-14 w-14 rounded-md border bg-muted/30 grid place-items-center overflow-hidden shrink-0"
              style={{ borderColor: client.accent_color }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={clientLogoUrl} alt={`${client.name} logo`} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Client</div>
            <h1 className="text-3xl font-semibold tracking-tight mt-1 flex items-center gap-3">
              {client.name}
              <span
                className="h-3 w-3 rounded-full border"
                style={{ backgroundColor: client.accent_color }}
                aria-label="Accent color"
              />
            </h1>
            <div className="flex gap-2 mt-2">
              {client.industry && (
                <Badge variant="secondary" className="font-normal">{client.industry}</Badge>
              )}
              {Array.isArray(client.benchmarks) && client.benchmarks.length > 0 && (
                <Badge variant="outline" className="font-normal">
                  {client.benchmarks.length} benchmark{client.benchmarks.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5" /> Edit client
        </Button>
      </header>

      {client.notes && (
        <Card className="p-3 text-xs text-muted-foreground bg-muted/30">
          <div className="font-medium text-foreground mb-1">Notes</div>
          <p className="whitespace-pre-wrap leading-snug">{client.notes}</p>
        </Card>
      )}

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Upload data</h2>
        {joinSummary && (
          <Card className="p-4 mb-3 border-primary/40 bg-primary/5">
            <div className="flex items-start gap-3">
              <Link2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="text-sm font-medium">Files joined for this analysis</div>
                <div className="text-xs text-muted-foreground truncate">{joinSummary.displayName}</div>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {joinSummary.joinPlan.map((s, i) => (
                    <li key={i} className="truncate">
                      <span className="text-foreground">{s.right}</span> joined on{" "}
                      <code className="px-1 rounded bg-muted">{s.on}</code>
                      {s.note ? <span className="text-amber-600 dark:text-amber-400"> · {s.note}</span> : null}
                    </li>
                  ))}
                  {joinSummary.orphans.length > 0 && (
                    <li className="text-amber-600 dark:text-amber-400">
                      Excluded (no shared ID): {joinSummary.orphans.join(", ")}
                    </li>
                  )}
                </ul>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setJoinSummary(null)}
                className="h-7"
              >
                Dismiss
              </Button>
            </div>
          </Card>
        )}
        {unmergeable && (
          <Card className="p-4 mb-3 border-destructive/50 bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-3">
                <div className="text-sm font-medium text-destructive">
                  These files cannot be merged or joined — pick which ones to analyze.
                </div>
                <div className="space-y-1.5">
                  {unmergeable.parsed.map((p) => {
                    const checked = unmergeable.selected.has(p.name);
                    return (
                      <label
                        key={p.name}
                        className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded hover:bg-background/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setUnmergeable((u) => {
                              if (!u) return u;
                              const next = new Set(u.selected);
                              if (v) next.add(p.name);
                              else next.delete(p.name);
                              return { ...u, selected: next };
                            });
                          }}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground truncate">{p.name}</div>
                          <div className="text-muted-foreground truncate">
                            {p.columns.length} columns · {p.rows.length.toLocaleString()} rows
                          </div>
                          <div className="text-muted-foreground/80 text-[11px] truncate mt-0.5">
                            {p.columns.slice(0, 6).join(", ")}
                            {p.columns.length > 6 ? `, +${p.columns.length - 6} more` : ""}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={proceedWithSelectedSubset}
                    className="gap-1.5"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Analyze selected
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setUnmergeable(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}
        <div
          onDragOver={(e) => { e.preventDefault(); if (!processing) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => !processing && inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"
          } ${processing ? "pointer-events-none opacity-90" : "cursor-pointer"}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) handleFilesSelected(files);
              e.target.value = "";
            }}
          />
          {showQueue ? (
            <div className="text-left space-y-2">
              <div className="flex items-center justify-between mb-3">
                <div className="font-medium text-sm">
                  Processing {queue.filter((q) => q.status === "done").length} / {queue.length}
                </div>
                {!processing && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setQueue([]);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/40 border border-border/60"
                  >
                    <div className="shrink-0">
                      {item.status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : item.status === "error" ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : item.status === "pending" ? (
                        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.file.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {item.status === "error" ? item.message ?? STAGE_LABEL.error : STAGE_LABEL[item.status]}
                      </div>
                    </div>
                    {item.status === "error" && !processing && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          retryItem(item.id);
                        }}
                        className="h-7 gap-1"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                    {item.status === "done" && item.analysisId && (
                      <Link
                        href={`/clients/${client.id}/analyses/${item.analysisId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-primary hover:underline shrink-0"
                      >
                        Open
                      </Link>
                    )}
                  </div>
                ))}
              </div>
              {!processing && (
                <div className="text-xs text-muted-foreground pt-2">
                  Click anywhere to add more files.
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-12 w-12 rounded-md bg-muted grid place-items-center">
                <Upload className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="font-medium">Drop CSV or Excel files</div>
              <div className="text-sm text-muted-foreground">
                or click to choose. Multiple files supported — processed one at a time.
              </div>
              <Button variant="outline" size="sm" className="mt-2">Browse files</Button>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Past analyses</h2>
        {history.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No analyses yet.</Card>
        ) : (
          <div className="space-y-2">
            {history.map((a) => (
              <Card key={a.id} className="p-4 flex items-center gap-3 hover:bg-muted/50 transition-colors group">
                <Link
                  href={`/clients/${client.id}/analyses/${a.id}`}
                  className="flex items-center gap-3 flex-1 min-w-0"
                >
                  <div className="h-9 w-9 rounded-md bg-muted grid place-items-center shrink-0">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.file_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.row_count.toLocaleString()} rows · {new Date(a.created_at).toLocaleString()}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteId(a.id);
                  }}
                  aria-label="Delete analysis"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this analysis?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the analysis and its annotations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteId || !client) return;
                setDeleting(true);
                const { error } = await supabase.from("analyses").delete().eq("id", deleteId);
                setDeleting(false);
                if (error) {
                  toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
                  return;
                }
                setDeleteId(null);
                toast({ title: "Analysis deleted" });
                await loadHistory(client.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ClientFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        client={client}
        onSaved={(c) => setClient(c)}
      />

      {pendingDetected && unfilteredRows && (
        <AnalysisFilterDialog
          open={filterOpen}
          onOpenChange={setFilterOpen}
          rows={unfilteredRows}
          detected={pendingDetected}
          onConfirm={(config, filteredRows) => {
            const summary = isDefaultConfig(config) ? "" : summarizeFilters(config, pendingDetected);
            // Persist the TRUE full-dataset date bounds onto the filter config so
            // future re-runs (which only have the saved 500-row sample) can still
            // show the correct date range in the dialog.
            const enriched: FilterConfig & { dataMinDate?: string; dataMaxDate?: string } = {
              ...config,
              dataMinDate: pendingDetected.dataMinDate?.toISOString(),
              dataMaxDate: pendingDetected.dataMaxDate?.toISOString(),
            };
            setPendingFilterConfig(enriched);
            setPendingFilterSummary(summary || null);
            setPendingRows(filteredRows);
            setKpiOpen(true);
          }}
          onCancel={() => {
            setPendingFiles([]);
            setPendingRows(null);
            setPendingDisplayName(null);
            setPendingColumns([]);
            setPendingJoinNote(null);
            setPendingDetected(null);
            setPendingFilterConfig(null);
            setPendingFilterSummary(null);
            setUnfilteredRows(null);
          }}
        />
      )}

      <KpiSelectionDialog
        open={kpiOpen}
        onOpenChange={setKpiOpen}
        fileNames={pendingFiles.map((f) => f.name)}
        detectedColumns={pendingColumns}
        benchmarks={client.benchmarks ?? []}
        onConfirm={startQueueWithKpis}
        onCancel={() => {
          setPendingFiles([]);
          setPendingRows(null);
          setPendingDisplayName(null);
          setPendingColumns([]);
          setPendingJoinNote(null);
          setPendingDetected(null);
          setPendingFilterConfig(null);
          setPendingFilterSummary(null);
          setUnfilteredRows(null);
        }}
      />
    </div>
  );
}
