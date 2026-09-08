-- 1. agency_settings table
CREATE TABLE public.agency_settings (
  owner uuid NOT NULL PRIMARY KEY,
  agency_name text NOT NULL DEFAULT '',
  consultant_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  logo_path text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their agency settings"
  ON public.agency_settings FOR SELECT
  USING (auth.uid() = owner);

CREATE POLICY "Owners can insert their agency settings"
  ON public.agency_settings FOR INSERT
  WITH CHECK (auth.uid() = owner);

CREATE POLICY "Owners can update their agency settings"
  ON public.agency_settings FOR UPDATE
  USING (auth.uid() = owner);

CREATE POLICY "Owners can delete their agency settings"
  ON public.agency_settings FOR DELETE
  USING (auth.uid() = owner);

CREATE TRIGGER agency_settings_updated_at
  BEFORE UPDATE ON public.agency_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Extend clients
ALTER TABLE public.clients
  ADD COLUMN accent_color text NOT NULL DEFAULT '#3B82F6',
  ADD COLUMN industry text,
  ADD COLUMN notes text NOT NULL DEFAULT '',
  ADD COLUMN logo_path text,
  ADD COLUMN benchmarks jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Extend analyses
ALTER TABLE public.analyses
  ADD COLUMN selected_kpis jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN annotations jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 4. Storage buckets
INSERT INTO storage.buckets (id, name, public)
VALUES ('agency-logos', 'agency-logos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('client-logos', 'client-logos', true)
ON CONFLICT (id) DO NOTHING;

-- agency-logos policies (folder = owner uuid)
CREATE POLICY "Agency logos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'agency-logos');

CREATE POLICY "Owners can upload their agency logo"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'agency-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can update their agency logo"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'agency-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can delete their agency logo"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'agency-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- client-logos policies (folder = owner uuid, then client_id subfolder)
CREATE POLICY "Client logos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'client-logos');

CREATE POLICY "Owners can upload their client logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'client-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can update their client logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'client-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can delete their client logos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'client-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );