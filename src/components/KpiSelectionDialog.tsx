"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Benchmark } from "@/lib/clientTypes";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileNames: string[];
  detectedColumns: string[];
  benchmarks: Benchmark[];
  onConfirm: (selectedKpis: string[]) => void;
  onCancel: () => void;
};

const BASE_CATEGORIES: { id: string; label: string; matches: RegExp }[] = [
  { id: "Revenue", label: "Revenue / Sales", matches: /revenue|sales|amount|total|price|gross/i },
  { id: "Average ticket", label: "Average ticket / order value", matches: /ticket|order|amount|price|total/i },
  { id: "Customer counts", label: "Customer counts / traffic", matches: /customer|guest|visit|cover|footfall|traffic/i },
  { id: "Attachment rate", label: "Attachment / cross-sell rate", matches: /attach|addon|upsell|combo|side/i },
  { id: "Time-of-day patterns", label: "Time-of-day patterns", matches: /time|hour|timestamp/i },
  { id: "Day-of-week patterns", label: "Day-of-week patterns", matches: /date|day|weekday/i },
  { id: "Product mix", label: "Product / category mix", matches: /product|item|sku|category|menu/i },
  { id: "Quantity / units", label: "Quantity / units sold", matches: /qty|quantity|units|count/i },
  { id: "Refunds / returns", label: "Refunds / returns", matches: /refund|return|void|cancel/i },
  { id: "Margin / cost", label: "Margin / cost", matches: /cost|margin|profit|cogs/i },
  { id: "Discounts", label: "Discounts / promotions", matches: /discount|promo|coupon/i },
];

export default function KpiSelectionDialog({
  open, onOpenChange, fileNames, detectedColumns, benchmarks, onConfirm, onCancel,
}: Props) {
  const colJoin = detectedColumns.join(" ");
  const detected = BASE_CATEGORIES.filter((c) => c.matches.test(colJoin));
  const fallback = detected.length === 0 ? BASE_CATEGORIES.slice(0, 5) : detected;
  const benchmarkLabels = benchmarks.map((b) => b.label).filter(Boolean);

  const allOptions = [
    ...fallback.map((c) => c.id),
    ...benchmarkLabels.filter((l) => !fallback.some((c) => c.id === l)),
  ];

  const [selected, setSelected] = useState<Set<string>>(new Set(allOptions));

  useEffect(() => {
    if (open) {
      setSelected(new Set(allOptions));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detectedColumns.join("|"), benchmarks.length]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Prioritize KPIs for this analysis</DialogTitle>
          <DialogDescription>
            Detected from {fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`}. Pick which categories matter most — the AI will focus on these.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto py-1">
          {fallback.map((c) => (
            <label key={c.id} className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer">
              <Checkbox
                checked={selected.has(c.id)}
                onCheckedChange={() => toggle(c.id)}
                className="mt-0.5"
              />
              <span className="text-sm">{c.label}</span>
            </label>
          ))}
          {benchmarkLabels.length > 0 && (
            <>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground pt-3 pb-1 px-2">
                Your custom benchmarks
              </div>
              {benchmarkLabels.map((l) => (
                <label key={l} className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer">
                  <Checkbox
                    checked={selected.has(l)}
                    onCheckedChange={() => toggle(l)}
                    className="mt-0.5"
                  />
                  <span className="text-sm">{l}</span>
                </label>
              ))}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { onCancel(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button onClick={() => { onConfirm([...selected]); onOpenChange(false); }}>
            Run analysis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
