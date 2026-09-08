"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { BarChart3 } from "lucide-react";

export default function AuthForm() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [credType, setCredType] = useState<"password" | "pin">("password");

  const PIN_LENGTH = 6;

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  if (loading || user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else if (mode === "signup") {
      toast({ title: "Check your email", description: "We sent you a confirmation link." });
    } else {
      router.replace("/");
    }

    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-primary text-primary-foreground grid place-items-center">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>BI Console</CardTitle>
              <CardDescription>Internal client analysis workspace</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{credType === "pin" ? "PIN" : "Password"}</Label>
                <div className="flex gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => { setCredType("password"); setPassword(""); }}
                    className={`px-2 py-0.5 rounded ${credType === "password" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground"}`}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCredType("pin"); setPassword(""); }}
                    className={`px-2 py-0.5 rounded ${credType === "pin" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground"}`}
                  >
                    PIN
                  </button>
                </div>
              </div>
              {credType === "pin" ? (
                <Input
                  id="password"
                  type="password"
                  inputMode="numeric"
                  value={password}
                  onChange={(e) => setPassword(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                  placeholder="••••••"
                  minLength={PIN_LENGTH}
                  className="tracking-[0.5em] text-center"
                  required
                />
              ) : (
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              )}
              {credType === "pin" && mode === "signup" && (
                <p className="text-xs text-muted-foreground">Enter a {PIN_LENGTH}-digit PIN.</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
              <button
                type="button"
                className="underline text-foreground"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
