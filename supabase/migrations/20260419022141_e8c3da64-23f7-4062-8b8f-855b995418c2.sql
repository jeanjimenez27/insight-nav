-- Replace broad public SELECT with owner-only listing.
-- Public file URLs still work because buckets have public=true (served via CDN, bypassing RLS).
DROP POLICY IF EXISTS "Agency logos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Client logos are publicly readable" ON storage.objects;

CREATE POLICY "Owners can list their agency logos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'agency-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can list their client logos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'client-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );