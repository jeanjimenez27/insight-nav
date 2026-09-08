"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { INDUSTRIES, type Benchmark, type ClientFull } from "@/lib/clientTypes";
import { publicLogoUrl } from "@/hooks/useAgencySettings";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ClientFull | null;
  onSaved?: (client: ClientFull) => void;
};

const INDUSTRY_NONE = "__none__";

export default function ClientFormDialog({ open, onOpenChange, client, onSaved }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [accentColor, setAccentColor] = useState("#3B82F6");
  const [industry, setIndustry] = useState<string>(INDUSTRY_NONE);
  const [notes, setNotes] = useState("");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (client) {
      setName(client.name);
      setAccentColor(client.accent_color || "#3B82F6");
      setIndustry(client.industry || INDUSTRY_NONE);
      setNotes(client.notes || "");
      setLogoPath(client.logo_path);
      setBenchmarks(Array.isArray(client.benchmarks) ? client.benchmarks : []);
    } else {
      setName("");
      setAccentColor("#3B82F6");
      setIndustry(INDUSTRY_NONE);
      setNotes("");
      setLogoPath(null);
      setBenchmarks([]);
    }
  }, [open, client]);

  async function uploadLogo(file: File, clientId: string) {
    if (!user) return null;
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${user.id}/${clientId}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("client-logos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    return path;
  }

  async function handleLogoFile(file: File) {
    if (!user) return;
    setUploading(true);
    try {
      // For new clients we don't have an id yet — store under a temporary path, will move on save
      const placeholderId = client?.id || `pending-${Date.now()}`;
      const path = await uploadLogo(file, placeholderId);
      if (logoPath) {
        await supabase.storage.from("client-logos").remove([logoPath]);
      }
      setLogoPath(path);
    } catch (e) {
      toast({
        title: "Logo upload failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    if (logoPath) {
      await supabase.storage.from("client-logos").remove([logoPath]);
    }
    setLogoPath(null);
  }

  function updateBenchmark(i: number, patch: Partial<Benchmark>) {
    setBenchmarks((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function addBenchmark() {
    setBenchmarks((bs) => [...bs, { label: "", value: "", unit: "" }]);
  }
  function removeBenchmark(i: number) {
    setBenchmarks((bs) => bs.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !name.trim()) return;
    setSaving(true);
    try {
      const cleanBenchmarks = benchmarks
        .map((b) => ({ label: b.label.trim(), value: b.value.trim(), unit: b.unit.trim() }))
        .filter((b) => b.label && b.value);

      const payload = {
        name: name.trim(),
        accent_color: accentColor,
        industry: industry === INDUSTRY_NONE ? null : industry,
        notes: notes.trim(),
        logo_path: logoPath,
        benchmarks: cleanBenchmarks as never,
      };

      let saved: ClientFull;
      if (client) {
        const { data, error } = await supabase
          .from("clients")
          .update(payload)
          .eq("id", client.id)
          .select("*")
          .single();
        if (error) throw error;
        saved = data as unknown as ClientFull;
      } else {
        const { data, error } = await supabase
          .from("clients")
          .insert({ ...payload, owner: user.id })
          .select("*")
          .single();
        if (error) throw error;
        saved = data as unknown as ClientFull;
      }

      toast({ title: client ? "Client updated" : "Client created" });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const logoUrl = publicLogoUrl("client-logos", logoPath);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
          <DialogDescription>
            Personalize how reports look and the context the AI uses for this client.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cf-name">Client name</Label>
            <Input
              id="cf-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cf-industry">Industry</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger id="cf-industry">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INDUSTRY_NONE}>Not specified</SelectItem>
                  {INDUSTRIES.map((ind) => (
                    <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf-color">Accent color</Label>
              <div className="flex gap-2">
                <input
                  id="cf-color"
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-10 w-12 rounded border cursor-pointer bg-transparent"
                />
                <Input
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  placeholder="#3B82F6"
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Client logo</Label>
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 rounded-md border bg-muted/40 grid place-items-center overflow-hidden shrink-0">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Client logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <Upload className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {logoUrl ? "Replace" : "Upload"}
              </Button>
              {logoUrl && (
                <Button type="button" variant="ghost" size="sm" onClick={removeLogo}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-notes">Client notes</Label>
            <Textarea
              id="cf-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Goals, pain points, focus areas. The AI will use this context."
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Custom benchmarks</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addBenchmark}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {benchmarks.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Targets to compare against (e.g. Revenue, $50,000).
              </p>
            )}
            <div className="space-y-2">
              {benchmarks.map((b, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_80px_auto] gap-2 items-center">
                  <Input
                    value={b.label}
                    onChange={(e) => updateBenchmark(i, { label: e.target.value })}
                    placeholder="Label (e.g. Target Revenue)"
                    className="text-xs"
                  />
                  <Input
                    value={b.value}
                    onChange={(e) => updateBenchmark(i, { value: e.target.value })}
                    placeholder="Value"
                    className="text-xs"
                  />
                  <Input
                    value={b.unit}
                    onChange={(e) => updateBenchmark(i, { unit: e.target.value })}
                    placeholder="Unit"
                    className="text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeBenchmark(i)}
                    className="h-8 w-8"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {client ? "Save changes" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
