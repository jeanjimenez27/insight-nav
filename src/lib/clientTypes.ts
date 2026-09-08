export const INDUSTRIES = [
  "Restaurant",
  "Retail",
  "Fitness",
  "Coffee Shop",
  "E-commerce",
  "Healthcare",
  "Real Estate",
  "Other",
] as const;

export type Industry = (typeof INDUSTRIES)[number];

export type Benchmark = {
  label: string;
  value: string;
  unit: string;
};

export type ClientFull = {
  id: string;
  name: string;
  accent_color: string;
  industry: string | null;
  notes: string;
  logo_path: string | null;
  benchmarks: Benchmark[];
};

export type Annotation = {
  id: string;
  section: "kpis" | "trends" | "anomalies" | "recommendations" | "general" | "summary";
  text: string;
  created_at: string;
};
