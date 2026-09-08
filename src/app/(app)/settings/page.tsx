"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Upload, Trash2 } from "lucide-react";
import { publicLogoUrl } from "@/hooks/useAgencySettings";

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [agencyName, setAgencyName] = useState("");
  const [consultantName, setConsultantName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("agency_settings")
        .select("*")
        .eq("owner", user.id)
        .maybeSingle();
      if (data) {
        setAgencyName(data.agency_name ?? "");
        setConsultantName(data.consultant_name ?? "");
        setContactEmail(data.contact_email ?? "");
        setLogoPath(data.logo_path ?? null);
      }
      setLoading(false);
    })();
  }, [user]);

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("agency_settings")
      .upsert(
        {
          owner: user.id,
          agency_name: agencyName.trim(),
          consultant_name: consultantName.trim(),
          contact_email: contactEmail.trim(),
          logo_path: logoPath,
        },
        { onConflict: "owner" },
      );
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Settings saved" });
  }

  async function uploadLogo(file: File) {
    if (!user) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${user.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("agency-logos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      // Best-effort cleanup of previous logo
      if (logoPath && logoPath !== path) {
        await supabase.storage.from("agency-logos").remove([logoPath]);
      }
      setLogoPath(path);

      // Persist immediately
      await supabase.from("agency_settings").upsert(
        {
          owner: user.id,
          agency_name: agencyName.trim(),
          consultant_name: consultantName.trim(),
          contact_email: contactEmail.trim(),
          logo_path: path,
        },
        { onConflict: "owner" },
      );

      toast({ title: "Logo uploaded" });
    } catch (e) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    if (!user || !logoPath) return;
    await supabase.storage.from("agency-logos").remove([logoPath]);
    setLogoPath(null);
    await supabase.from("agency_settings").upsert(
      {
        owner: user.id,
        agency_name: agencyName.trim(),
        consultant_name: consultantName.trim(),
        contact_email: contactEmail.trim(),
        logo_path: null,
      },
      { onConflict: "owner" },
    );
    toast({ title: "Logo removed" });
  }

  const logoUrl = publicLogoUrl("agency-logos", logoPath);

  if (loading) {
    return <div className="p-10 text-muted-foreground">Loading settings…</div>;
  }

  return (
    <div className="px-8 py-8 max-w-2xl mx-auto space-y-6">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Workspace</div>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">Agency settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          These details appear on every PDF report you export.
        </p>
      </header>

      <Card className="p-5 space-y-5">
        <div className="space-y-2">
          <Label>Agency logo</Label>
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-md border bg-muted/40 grid place-items-center overflow-hidden">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Agency logo" className="max-h-full max-w-full object-contain" />
              ) : (
                <Upload className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadLogo(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {logoUrl ? "Replace" : "Upload"}
              </Button>
              {logoUrl && (
                <Button variant="ghost" size="sm" onClick={removeLogo}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="agency-name">Agency name</Label>
            <Input
              id="agency-name"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              placeholder="e.g. Northstar Consulting"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="consultant-name">Your name</Label>
            <Input
              id="consultant-name"
              value={consultantName}
              onChange={(e) => setConsultantName(e.target.value)}
              placeholder="e.g. Alex Morgan"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-email">Contact email</Label>
            <Input
              id="contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="alex@northstar.co"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save settings
          </Button>
        </div>
      </Card>
    </div>
  );
}
