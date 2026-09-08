"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, LogOut, Plus, Users, Pencil, Check, X, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import ClientFormDialog from "@/components/ClientFormDialog";

type Client = { id: string; name: string };

export default function Sidebar() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const params = useParams<{ clientId?: string }>();
  const pathname = usePathname();
  const activeId = params.clientId;

  const [clients, setClients] = useState<Client[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("clients")
      .select("id,name")
      .order("created_at", { ascending: false });
    if (error) return toast({ title: "Failed to load clients", description: error.message, variant: "destructive" });
    setClients(data ?? []);
  }

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function startEdit(c: Client, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(c.id);
    setEditingName(c.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }

  async function saveEdit(id: string) {
    const trimmed = editingName.trim();
    if (!trimmed) return cancelEdit();
    const original = clients.find((c) => c.id === id);
    if (original && trimmed === original.name) return cancelEdit();
    setSavingEdit(true);
    const { error } = await supabase.from("clients").update({ name: trimmed }).eq("id", id);
    setSavingEdit(false);
    if (error) {
      return toast({ title: "Rename failed", description: error.message, variant: "destructive" });
    }
    cancelEdit();
    await load();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/auth");
  }

  return (
    <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col h-screen sticky top-0">
      <div className="px-4 py-5 border-b border-sidebar-border flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center">
          <BarChart3 className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-sm">BI Console</div>
          <div className="text-xs text-sidebar-foreground/60">Internal workspace</div>
        </div>
      </div>

      <div className="px-3 py-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-4 w-4" />
          New client
        </Button>
      </div>

      <div className="px-3 pb-2 text-[11px] uppercase tracking-wider text-sidebar-foreground/50 flex items-center gap-2">
        <Users className="h-3 w-3" />
        Clients
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
        {clients.length === 0 && (
          <div className="px-3 py-6 text-sm text-sidebar-foreground/50">
            No clients yet. Add your first.
          </div>
        )}
        {clients.map((c) => {
          if (editingId === c.id) {
            return (
              <div key={c.id} className="px-2 py-1.5 flex items-center gap-1">
                <Input
                  autoFocus
                  value={editingName}
                  disabled={savingEdit}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveEdit(c.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  className="h-8 text-sm bg-sidebar-accent border-sidebar-border text-sidebar-foreground"
                />
                <button
                  type="button"
                  onClick={() => saveEdit(c.id)}
                  disabled={savingEdit}
                  className="h-8 w-8 grid place-items-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-50"
                  aria-label="Save"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={savingEdit}
                  className="h-8 w-8 grid place-items-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-50"
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          }
          return (
            <div key={c.id} className="group relative">
              <Link
                href={`/clients/${c.id}`}
                className={cn(
                  "block px-3 py-2 pr-9 rounded-md text-sm transition-colors truncate",
                  activeId === c.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                {c.name}
              </Link>
              <button
                type="button"
                onClick={(e) => startEdit(c, e)}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 grid place-items-center rounded-md text-sidebar-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-opacity"
                aria-label={`Rename ${c.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-2">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
            pathname === "/settings"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <div className="text-xs text-sidebar-foreground/60 truncate px-1">{user?.email}</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>

      <ClientFormDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        client={null}
        onSaved={(c) => {
          load();
          router.push(`/clients/${c.id}`);
        }}
      />
    </aside>
  );
}
