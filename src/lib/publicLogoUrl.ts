import { supabase } from "@/lib/supabase/client";

// Plain module (no "use client") so it can be called from Server Components
// too — building a public storage URL is a synchronous, network-free call,
// safe to run on either side.
export function publicLogoUrl(
  bucket: "agency-logos" | "client-logos",
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
