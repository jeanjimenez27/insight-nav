import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { publicLogoUrl } from "@/lib/publicLogoUrl";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  FileSpreadsheet,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  Upload,
} from "lucide-react";
import type { Anomaly, Recommendation } from "@/lib/analysisTypes";

type ClientRow = {
  id: string;
  name: string;
  industry: string | null;
  accent_color: string;
  logo_path: string | null;
  created_at: string;
};

type RecentAnalysisRow = {
  id: string;
  file_name: string;
  row_count: number;
  created_at: string;
  client_id: string;
  anomalies: Anomaly[] | null;
  recommendations: Recommendation[] | null;
};

const RECENT_LIMIT = 30;
const ACTIVITY_SHOWN = 8;
const ATTENTION_SHOWN = 6;

export default async function Home() {
  const supabase = await createClient();

  const [clientsRes, recentRes, allAnalysisIdsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id,name,industry,accent_color,logo_path,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("analyses")
      .select("id,file_name,row_count,created_at,client_id,anomalies,recommendations")
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase.from("analyses").select("client_id"),
  ]);

  const clients: ClientRow[] = clientsRes.data ?? [];
  const recentAnalyses: RecentAnalysisRow[] = (recentRes.data ?? []) as unknown as RecentAnalysisRow[];
  const allClientIds = (allAnalysisIdsRes.data ?? []) as { client_id: string }[];

  const clientsById = new Map(clients.map((c) => [c.id, c]));

  // Per-client counts + last-analysis date, derived from the full (uncapped) id scan
  // plus the recent batch for dates (good enough — a client's most recent analysis
  // is virtually always inside the last 30 analyses across the whole account).
  const analysisCountByClient = new Map<string, number>();
  for (const row of allClientIds) {
    analysisCountByClient.set(row.client_id, (analysisCountByClient.get(row.client_id) ?? 0) + 1);
  }
  const lastAnalysisByClient = new Map<string, string>();
  for (const a of recentAnalyses) {
    if (!lastAnalysisByClient.has(a.client_id)) {
      lastAnalysisByClient.set(a.client_id, a.created_at);
    }
  }

  const totalClients = clients.length;
  const totalAnalyses = allClientIds.length;
  // eslint-disable-next-line react-hooks/purity -- Server Component executed fresh per request, not client-reconciled; a real-time cutoff here is intentional.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const analysesThisWeek = recentAnalyses.filter((a) => new Date(a.created_at) >= weekAgo).length;
  const clientsNeedingData = clients.filter((c) => !analysisCountByClient.has(c.id));

  type AttentionItem = {
    key: string;
    kind: "anomaly" | "recommendation";
    label: string;
    detail: string;
    clientId: string;
    analysisId: string;
    clientName: string;
  };
  const attentionItems: AttentionItem[] = [];
  for (const a of recentAnalyses) {
    const client = clientsById.get(a.client_id);
    if (!client) continue;
    for (const [i, anomaly] of (a.anomalies ?? []).entries()) {
      if (anomaly.severity === "high") {
        attentionItems.push({
          key: `${a.id}-anomaly-${i}`,
          kind: "anomaly",
          label: anomaly.label,
          detail: anomaly.explanation,
          clientId: a.client_id,
          analysisId: a.id,
          clientName: client.name,
        });
      }
    }
    for (const [i, rec] of (a.recommendations ?? []).entries()) {
      if (rec.priority === "high") {
        attentionItems.push({
          key: `${a.id}-rec-${i}`,
          kind: "recommendation",
          label: rec.title,
          detail: rec.detail,
          clientId: a.client_id,
          analysisId: a.id,
          clientName: client.name,
        });
      }
    }
  }

  const stats = [
    { label: "Clients", value: totalClients, icon: Users },
    { label: "Analyses", value: totalAnalyses, icon: FileSpreadsheet },
    { label: "This week", value: analysesThisWeek, icon: TrendingUp },
    { label: "Need data", value: clientsNeedingData.length, icon: Upload },
  ];

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto space-y-8">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Overview</div>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">Home</h1>
      </header>

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <s.icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold tracking-tight">{s.value}</div>
          </Card>
        ))}
      </div>

      {/* Needs attention */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Needs attention</h2>
        {attentionItems.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Nothing urgent — you&apos;re all caught up.
          </Card>
        ) : (
          <div className="space-y-1.5">
            {attentionItems.slice(0, ATTENTION_SHOWN).map((item) => (
              <Link
                key={item.key}
                href={`/clients/${item.clientId}/analyses/${item.analysisId}`}
                className="block"
              >
                <Card className="p-3 flex items-start gap-3 hover:bg-muted/50 transition-colors">
                  <div className="shrink-0 mt-0.5">
                    {item.kind === "anomaly" ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      {item.label}
                      <Badge variant="secondary" className="font-normal text-[10px] px-1.5 py-0">
                        {item.clientName}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug truncate">
                      {item.detail}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Clients */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Clients</h2>
        {clients.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            No clients yet. Use the sidebar to add your first one.
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clients.map((client) => {
              const count = analysisCountByClient.get(client.id) ?? 0;
              const lastDate = lastAnalysisByClient.get(client.id);
              const logoUrl = publicLogoUrl("client-logos", client.logo_path);
              return (
                <Link key={client.id} href={`/clients/${client.id}`} className="block">
                  <Card className="p-4 space-y-3 hover:bg-muted/50 transition-colors h-full">
                    <div className="flex items-center gap-3">
                      {logoUrl ? (
                        <div
                          className="h-9 w-9 rounded-md border bg-muted/30 grid place-items-center overflow-hidden shrink-0"
                          style={{ borderColor: client.accent_color }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain" />
                        </div>
                      ) : (
                        <span
                          className="h-3 w-3 rounded-full border shrink-0"
                          style={{ backgroundColor: client.accent_color }}
                          aria-label="Accent color"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{client.name}</div>
                        {client.industry && (
                          <Badge variant="secondary" className="font-normal text-[10px] mt-0.5">
                            {client.industry}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {count === 0 ? (
                      <div className="flex items-center gap-1.5 text-xs text-primary">
                        <Upload className="h-3.5 w-3.5" />
                        Upload your first file
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {count} {count === 1 ? "analysis" : "analyses"}
                        {lastDate && ` · last ${new Date(lastDate).toLocaleDateString()}`}
                      </div>
                    )}
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent activity */}
      {recentAnalyses.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Recent activity</h2>
          <div className="space-y-1.5">
            {recentAnalyses.slice(0, ACTIVITY_SHOWN).map((a) => {
              const client = clientsById.get(a.client_id);
              return (
                <Link key={a.id} href={`/clients/${a.client_id}/analyses/${a.id}`} className="block">
                  <Card className="p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors">
                    <div className="h-9 w-9 rounded-md bg-muted grid place-items-center shrink-0">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate flex items-center gap-2">
                        {a.file_name}
                        {client && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-normal shrink-0">
                            <span
                              className="h-2 w-2 rounded-full border"
                              style={{ backgroundColor: client.accent_color }}
                            />
                            {client.name}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.row_count.toLocaleString()} rows · {new Date(a.created_at).toLocaleString()}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
