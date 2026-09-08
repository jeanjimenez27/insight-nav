"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Message = { role: "user" | "assistant"; content: string };

type Props = {
  open: boolean;
  onClose: () => void;
  context: Record<string, unknown>;
};

const QUICK_ACTIONS = [
  { label: "Review all anomalies", prompt: "Review every anomaly in this report. For each one, tell me whether it's genuinely concerning or just noise — and explain why in plain English." },
  { label: "Check chart accuracy", prompt: "Look at the chart specs and the underlying data summary. Are the visualizations actually telling the right story, or is anything misleading or based on bad aggregation?" },
  { label: "Summarize key insights", prompt: "Give me the 3-5 most important takeaways from this analysis that the client genuinely needs to know. Skip filler." },
];

export default function ConsultantChatPanel({ open, onClose, context }: Props) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function send(prompt: string) {
    const text = prompt.trim();
    if (!text || loading) return;
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/consultant-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context }),
      });
      const data = await res.json();
      const reply = (data as { reply?: string; error?: string })?.reply;
      const errMsg = (data as { error?: string })?.error;
      if (!res.ok || (errMsg && !reply)) throw new Error(errMsg ?? "Request failed");
      setMessages([...next, { role: "assistant", content: reply ?? "(no response)" }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Consultant unavailable", description: msg, variant: "destructive" });
      setMessages(next); // keep user message, drop pending assistant slot
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside
      className={cn(
        "fixed top-0 right-0 h-screen z-40 transition-transform duration-300 ease-out",
        "w-full sm:w-[380px] bg-sidebar text-sidebar-foreground border-l border-sidebar-border shadow-2xl",
        "flex flex-col",
        open ? "translate-x-0" : "translate-x-full",
      )}
      aria-hidden={!open}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-sidebar-primary/15 text-sidebar-primary grid place-items-center">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">AI Consultant</div>
            <div className="text-[10px] text-sidebar-foreground/60 leading-tight">Senior analyst · Claude</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="h-8 w-8 grid place-items-center rounded-md hover:bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
          aria-label="Close consultant panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Quick actions */}
      <div className="px-3 py-2 border-b border-sidebar-border flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            onClick={() => send(a.prompt)}
            disabled={loading}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded-full border border-sidebar-border",
              "bg-sidebar-accent/40 hover:bg-sidebar-accent text-sidebar-foreground/90",
              "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="text-xs text-sidebar-foreground/60 text-center pt-8 px-4 leading-relaxed">
            Ask anything about this analysis. The consultant has full context of the KPIs, trends, anomalies, and recommendations on this page.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words",
                m.role === "user"
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "bg-sidebar-accent text-sidebar-foreground",
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-sidebar-accent text-sidebar-foreground rounded-lg px-3 py-2 text-xs flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-sidebar-border p-3 space-y-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask the consultant…"
          rows={2}
          className="resize-none bg-sidebar-accent/40 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/50 text-xs focus-visible:ring-sidebar-ring"
          disabled={loading}
        />
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-sidebar-foreground/50">Enter to send · Shift+Enter for new line</span>
          <Button
            size="sm"
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="h-7 text-xs"
          >
            <Send className="h-3 w-3" /> Send
          </Button>
        </div>
      </div>
    </aside>
  );
}
