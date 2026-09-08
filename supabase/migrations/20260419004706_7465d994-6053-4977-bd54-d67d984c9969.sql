
-- Updated-at helper (idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Clients
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their clients"
  ON public.clients FOR SELECT
  USING (auth.uid() = owner);

CREATE POLICY "Owners can create clients"
  ON public.clients FOR INSERT
  WITH CHECK (auth.uid() = owner);

CREATE POLICY "Owners can update their clients"
  ON public.clients FOR UPDATE
  USING (auth.uid() = owner);

CREATE POLICY "Owners can delete their clients"
  ON public.clients FOR DELETE
  USING (auth.uid() = owner);

CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_clients_owner ON public.clients(owner);

-- Analyses
CREATE TABLE public.analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  kpis JSONB NOT NULL DEFAULT '[]'::jsonb,
  trends JSONB NOT NULL DEFAULT '[]'::jsonb,
  anomalies JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  chart_specs JSONB NOT NULL DEFAULT '[]'::jsonb,
  parsed_sample JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their analyses"
  ON public.analyses FOR SELECT
  USING (auth.uid() = owner);

CREATE POLICY "Owners can create analyses"
  ON public.analyses FOR INSERT
  WITH CHECK (auth.uid() = owner);

CREATE POLICY "Owners can update their analyses"
  ON public.analyses FOR UPDATE
  USING (auth.uid() = owner);

CREATE POLICY "Owners can delete their analyses"
  ON public.analyses FOR DELETE
  USING (auth.uid() = owner);

CREATE INDEX idx_analyses_client ON public.analyses(client_id);
CREATE INDEX idx_analyses_owner ON public.analyses(owner);
