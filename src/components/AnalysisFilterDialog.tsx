"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Search, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  applyFilters,
  DEFAULT_FILTERS,
  type DetectedFilters,
  type FilterConfig,
  type TimePeriod,
  type TimeOfDay,
} from "@/lib/analysisFilters";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Record<string, unknown>[];
  detected: DetectedFilters;
  initialConfig?: FilterConfig | null;
  confirmLabel?: string;
  onConfirm: (config: FilterConfig, filteredRows: Record<string, unknown>[]) => void;
  onCancel: () => void;
};

const DAYS = [
  { idx: 1, label: "Mon", weekend: false },
  { idx: 2, label: "Tue", weekend: false },
  { idx: 3, label: "Wed", weekend: false },
  { idx: 4, label: "Thu", weekend: false },
  { idx: 5, label: "Fri", weekend: false },
  { idx: 6, label: "Sat", weekend: true },
  { idx: 0, label: "Sun", weekend: true },
];

const TIME_PERIODS: { id: TimePeriod; label: string }[] = [
  { id: "1m", label: "1M" },
  { id: "2m", label: "2M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
  { id: "custom", label: "Custom" },
];

const TIME_OF_DAY: { id: TimeOfDay; label: string }[] = [
  { id: "all", label: "All Day" },
  { id: "morning", label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
  { id: "custom", label: "Custom" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
      {children}
    </div>
  );
}

function MultiCheckList({
  values,
  selected,
  onChange,
}: {
  values: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const allSelected = selected.length === 0 || selected.length === values.length;
  const visible = showAll ? values : values.slice(0, 5);

  function toggle(v: string) {
    const set = new Set(selected.length === 0 ? values : selected);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    const next = [...set];
    onChange(next.length === values.length ? [] : next);
  }

  function toggleAll() {
    if (allSelected) onChange(values); // explicitly select-none → impossible, so leave all
    else onChange([]);
  }

  const isChecked = (v: string) => selected.length === 0 || selected.includes(v);

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs font-medium cursor-pointer py-1">
        <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
        Select All
      </label>
      <div className="border-t" />
      {visible.map((v) => (
        <label key={v} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
          <Checkbox checked={isChecked(v)} onCheckedChange={() => toggle(v)} />
          <span className="truncate">{v}</span>
        </label>
      ))}
      {values.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="text-xs text-primary hover:underline mt-1"
        >
          {showAll ? "Show less" : `Show ${values.length - 5} more`}
        </button>
      )}
    </div>
  );
}

function ProductSearch({
  values,
  selected,
  onChange,
}: {
  values: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => values.filter((v) => v.toLowerCase().includes(query.toLowerCase())).slice(0, 50),
    [values, query],
  );
  const allSelected = selected.length === 0;

  function toggle(v: string) {
    const set = new Set(selected);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChange([...set]);
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start font-normal" type="button">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs">
              {allSelected ? "All Products" : `${selected.length} product${selected.length === 1 ? "" : "s"} selected`}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px] p-0" align="start">
          <div className="p-2 border-b">
            <Input
              placeholder="Search products..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            <button
              type="button"
              className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2"
              onClick={() => onChange([])}
            >
              <Checkbox checked={allSelected} />
              <span className="font-medium">All Products</span>
            </button>
            {filtered.map((v) => (
              <button
                type="button"
                key={v}
                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2"
                onClick={() => toggle(v)}
              >
                <Checkbox checked={selected.includes(v)} />
                <span className="truncate">{v}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">No matches</div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.slice(0, 4).map((v) => (
            <Badge key={v} variant="secondary" className="text-[10px] gap-1 font-normal">
              {v}
              <button onClick={() => toggle(v)} type="button">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {selected.length > 4 && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              +{selected.length - 4} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function DatePickerInline({
  value,
  onChange,
  placeholder,
}: {
  value?: string;
  onChange: (iso: string | undefined) => void;
  placeholder: string;
}) {
  const date = value ? new Date(value) : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 text-xs font-normal justify-start",
            !date && "text-muted-foreground",
          )}
          type="button"
        >
          <CalendarIcon className="h-3 w-3" />
          {date ? format(date, "MMM d, yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => onChange(d ? d.toISOString() : undefined)}
          autoFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

export default function AnalysisFilterDialog({
  open,
  onOpenChange,
  rows,
  detected,
  initialConfig,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const buildInitial = (): FilterConfig => {
    const base: FilterConfig = {
      ...DEFAULT_FILTERS,
      priceMin: detected.priceColumn ? detected.priceMin : undefined,
      priceMax: detected.priceColumn ? detected.priceMax : undefined,
    };
    if (!initialConfig) return base;
    return {
      timePeriod: initialConfig.timePeriod ?? base.timePeriod,
      customStart: initialConfig.customStart,
      customEnd: initialConfig.customEnd,
      locations: initialConfig.locations ?? [],
      categories: initialConfig.categories ?? [],
      products: initialConfig.products ?? [],
      priceMin: initialConfig.priceMin ?? base.priceMin,
      priceMax: initialConfig.priceMax ?? base.priceMax,
      daysOfWeek: initialConfig.daysOfWeek ?? base.daysOfWeek,
      timeOfDay: initialConfig.timeOfDay ?? base.timeOfDay,
      customStartHour: initialConfig.customStartHour,
      customEndHour: initialConfig.customEndHour,
      focusUnderperformers: initialConfig.focusUnderperformers ?? false,
    };
  };

  const [config, setConfig] = useState<FilterConfig>(buildInitial);

  // Reset on open
  useEffect(() => {
    if (open) {
      setConfig(buildInitial());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detected, initialConfig]);

  const { rows: filteredRows, warning } = useMemo(
    () => applyFilters(rows, config, detected),
    [rows, config, detected],
  );

  function update<K extends keyof FilterConfig>(key: K, value: FilterConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
  }

  function reset() {
    setConfig({
      ...DEFAULT_FILTERS,
      priceMin: detected.priceColumn ? detected.priceMin : undefined,
      priceMax: detected.priceColumn ? detected.priceMax : undefined,
    });
  }

  function toggleDay(idx: number) {
    const set = new Set(config.daysOfWeek);
    if (set.has(idx)) set.delete(idx);
    else set.add(idx);
    update("daysOfWeek", [...set].sort());
  }

  const showDate = !!detected.dateColumn;
  const showTime = !!(detected.timeColumn || detected.dateColumn);
  const showLocation = !!detected.locationColumn;
  const showCategory = !!detected.categoryColumn;
  const showProduct = !!detected.productColumn;
  const showPrice = !!detected.priceColumn;
  const showUnderperf = !!(detected.productColumn || detected.categoryColumn);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onCancel(); onOpenChange(v); }}>
      <SheetContent side="right" className="sm:max-w-2xl w-full overflow-y-auto p-0 flex flex-col">
        <div className="flex items-start justify-between gap-3 p-6 border-b">
          <div>
            <SheetTitle className="text-xl">Configure Analysis</SheetTitle>
            <SheetDescription>Select filters to narrow your analysis scope.</SheetDescription>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-primary hover:underline shrink-0 mt-1"
          >
            Reset all filters
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
          {/* LEFT COLUMN */}
          <div className="space-y-6">
            {(showDate || showTime) && (
              <div>
                <SectionLabel>Time and Date</SectionLabel>
                <div className="space-y-4">
                  {showDate && (
                    <div>
                      <div className="text-xs font-medium mb-2">Time Period</div>
                      <div className="flex flex-wrap gap-1.5">
                        {TIME_PERIODS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => update("timePeriod", p.id)}
                            className={cn(
                              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                              config.timePeriod === p.id
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border hover:bg-muted",
                            )}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      {config.timePeriod === "custom" && (
                        <div className="flex items-center gap-2 mt-3">
                          <DatePickerInline
                            value={config.customStart}
                            onChange={(v) => update("customStart", v)}
                            placeholder="Start date"
                          />
                          <span className="text-xs text-muted-foreground">to</span>
                          <DatePickerInline
                            value={config.customEnd}
                            onChange={(v) => update("customEnd", v)}
                            placeholder="End date"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {showDate && (
                    <div>
                      <div className="text-xs font-medium mb-2">Day of Week</div>
                      <div className="flex gap-1">
                        {DAYS.map((d) => {
                          const active = config.daysOfWeek.includes(d.idx);
                          return (
                            <button
                              key={d.idx}
                              type="button"
                              onClick={() => toggleDay(d.idx)}
                              className={cn(
                                "h-8 flex-1 rounded-md text-[11px] font-medium border transition-colors",
                                active
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : d.weekend
                                  ? "border-dashed border-border text-muted-foreground hover:bg-muted"
                                  : "border-border text-muted-foreground hover:bg-muted",
                              )}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {showTime && (
                    <div>
                      <div className="text-xs font-medium mb-2">Time of Day</div>
                      <div className="flex flex-wrap gap-1.5">
                        {TIME_OF_DAY.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => update("timeOfDay", t.id)}
                            className={cn(
                              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                              config.timeOfDay === t.id
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border hover:bg-muted",
                            )}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      {config.timeOfDay === "custom" && (
                        <div className="flex items-center gap-2 mt-3">
                          <Input
                            type="number"
                            min={0}
                            max={23}
                            value={config.customStartHour ?? 0}
                            onChange={(e) => update("customStartHour", Number(e.target.value))}
                            className="h-8 w-20 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">to</span>
                          <Input
                            type="number"
                            min={1}
                            max={24}
                            value={config.customEndHour ?? 24}
                            onChange={(e) => update("customEndHour", Number(e.target.value))}
                            className="h-8 w-20 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">hr</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {(showProduct || showPrice) && (
              <div>
                <SectionLabel>Product and Price</SectionLabel>
                <div className="space-y-4">
                  {showProduct && (
                    <div>
                      <div className="text-xs font-medium mb-2">Specific Product</div>
                      <ProductSearch
                        values={detected.productValues}
                        selected={config.products}
                        onChange={(v) => update("products", v)}
                      />
                    </div>
                  )}
                  {showPrice && (
                    <div>
                      <div className="text-xs font-medium mb-2">Price Range</div>
                      <div className="flex items-center gap-2 mb-3">
                        <Input
                          type="number"
                          value={config.priceMin ?? detected.priceMin}
                          onChange={(e) =>
                            update("priceMin", Number(e.target.value))
                          }
                          className="h-8 w-24 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <Input
                          type="number"
                          value={config.priceMax ?? detected.priceMax}
                          onChange={(e) =>
                            update("priceMax", Number(e.target.value))
                          }
                          className="h-8 w-24 text-xs"
                        />
                      </div>
                      <Slider
                        min={detected.priceMin}
                        max={detected.priceMax}
                        step={Math.max(0.01, (detected.priceMax - detected.priceMin) / 100)}
                        value={[
                          config.priceMin ?? detected.priceMin,
                          config.priceMax ?? detected.priceMax,
                        ]}
                        onValueChange={(v) => {
                          setConfig((c) => ({ ...c, priceMin: v[0], priceMax: v[1] }));
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-6">
            {(showLocation || showCategory) && (
              <div>
                <SectionLabel>Location and Category</SectionLabel>
                <div className="space-y-5">
                  {showLocation && (
                    <div>
                      <div className="text-xs font-medium mb-2">Store Location</div>
                      <MultiCheckList
                        values={detected.locationValues}
                        selected={config.locations}
                        onChange={(v) => update("locations", v)}
                      />
                    </div>
                  )}
                  {showCategory && (
                    <div>
                      <div className="text-xs font-medium mb-2">Product Category</div>
                      <MultiCheckList
                        values={detected.categoryValues}
                        selected={config.categories}
                        onChange={(v) => update("categories", v)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {showUnderperf && (
              <div>
                <SectionLabel>Performance</SectionLabel>
                <div className="flex items-start justify-between gap-3 p-3 rounded-md border bg-muted/30">
                  <div className="flex-1">
                    <div className="text-xs font-medium">Focus on underperformers only</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Filter to {detected.productColumn ? "products" : "categories"} below the average revenue/volume — useful for spotting weak spots.
                    </div>
                  </div>
                  <Switch
                    checked={config.focusUnderperformers}
                    onCheckedChange={(v) => update("focusUnderperformers", v)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {warning && (
          <div className="px-6 py-2 text-xs text-muted-foreground bg-muted/40 border-t">
            ⚠ {warning}
          </div>
        )}

        <div className="border-t p-4 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Analyzing <span className="font-medium text-foreground">{filteredRows.length.toLocaleString()}</span> of{" "}
            {rows.length.toLocaleString()} rows
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onCancel();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={filteredRows.length === 0}
              onClick={() => {
                onConfirm(config, filteredRows);
                onOpenChange(false);
              }}
            >
              {confirmLabel ?? "Run Analysis"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
