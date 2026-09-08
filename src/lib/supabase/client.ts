import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "./types"

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Shared singleton for client components that don't need a fresh instance —
// mirrors the old app's `import { supabase } from ".../client"` pattern.
export const supabase = createClient()
