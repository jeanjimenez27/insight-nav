export type Sentiment = "positive" | "neutral" | "concern";

export type Kpi = {
  name: string;
  value: string;
  unit: string;
  delta: string;
  context: string;
  sentiment?: Sentiment;
};

export type Trend = {
  metric: string;
  direction: "up" | "down" | "flat";
  magnitude: string;
  explanation: string;
};

export type Anomaly = {
  label: string;
  severity: "low" | "medium" | "high";
  explanation: string;
};

export type Recommendation = {
  title: string;
  detail: string;
  priority: "low" | "medium" | "high";
  impact_score?: number;
};

export type ChartSpec = {
  title: string;
  type: "bar" | "line";
  x_field: string;
  y_field: string;
  aggregation: "sum" | "avg" | "count" | "none" | "hourly" | "daily" | "monthly";
  rationale: string;
};

export type DataQuality = {
  date_range: string;
  rows_analyzed: number;
  limitations: string;
};

export type Analysis = {
  kpis: Kpi[];
  trends: Trend[];
  anomalies: Anomaly[];
  recommendations: Recommendation[];
  summary: string;
  chart_specs: ChartSpec[];
  next_steps?: string[];
  data_quality?: DataQuality;
};
