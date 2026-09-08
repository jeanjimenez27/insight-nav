"use client"

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AgencySettings = {
  owner: string;
  agency_name: string;
  consultant_name: string;
  contact_email: string;
  logo_path: string | null;
};

export function publicLogoUrl(bucket: "agency-logos" | "client-logos", path: string | null | undefined): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export function useAgencySettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AgencySettings | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setSettings(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("agency_settings")
      .select("*")
      .eq("owner", user.id)
      .maybeSingle();
    setSettings((data as AgencySettings | null) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return { settings, loading, reload: load, logoUrl: publicLogoUrl("agency-logos", settings?.logo_path) };
}
