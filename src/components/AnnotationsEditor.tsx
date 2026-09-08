"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Plus, Trash2, Check, X, StickyNote } from "lucide-react";
import type { Annotation } from "@/lib/clientTypes";

type Props = {
  section: Annotation["section"];
  annotations: Annotation[];
  onChange: (next: Annotation[]) => void;
  className?: string;
  hideAddWhenEmpty?: boolean;
};

export default function AnnotationsEditor({ section, annotations, onChange, className }: Props) {
  const sectionNotes = annotations.filter((a) => a.section === section);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  function add() {
    const text = draft.trim();
    if (!text) {
      setAdding(false);
      return;
    }
    const note: Annotation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      section,
      text,
      created_at: new Date().toISOString(),
    };
    onChange([...annotations, note]);
    setDraft("");
    setAdding(false);
  }

  function saveEdit(id: string) {
    const text = editingText.trim();
    if (!text) {
      remove(id);
      setEditingId(null);
      return;
    }
    onChange(annotations.map((a) => (a.id === id ? { ...a, text } : a)));
    setEditingId(null);
  }

  function remove(id: string) {
    onChange(annotations.filter((a) => a.id !== id));
  }

  return (
    <div className={className}>
      {sectionNotes.map((n) => (
        <div
          key={n.id}
          className="rounded-md border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 mb-2 group"
        >
          <div className="flex items-start gap-2">
            <StickyNote className="h-3.5 w-3.5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-0.5">
                Consultant note
              </div>
              {editingId === n.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={2}
                    className="text-xs bg-background"
                  />
                  <div className="flex gap-1 no-print">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => saveEdit(n.id)}>
                      <Check className="h-3 w-3" /> Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setEditingId(null)}>
                      <X className="h-3 w-3" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-900 dark:text-amber-100 whitespace-pre-wrap leading-snug">
                  {n.text}
                </p>
              )}
            </div>
            {editingId !== n.id && (
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity no-print">
                <button
                  type="button"
                  onClick={() => { setEditingId(n.id); setEditingText(n.text); }}
                  className="h-6 w-6 grid place-items-center rounded text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  aria-label="Edit note"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  className="h-6 w-6 grid place-items-center rounded text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  aria-label="Delete note"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {adding ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-2 mb-2 space-y-2 no-print">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your commentary…"
            rows={2}
            className="text-xs bg-background"
          />
          <div className="flex gap-1">
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={add}>
              <Check className="h-3 w-3" /> Add note
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => { setAdding(false); setDraft(""); }}>
              <X className="h-3 w-3" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 no-print"
        >
          <Plus className="h-3 w-3" /> Add consultant note
        </button>
      )}
    </div>
  );
}
