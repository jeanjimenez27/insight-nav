import { toast as sonnerToast } from "sonner"

type ToastOptions = {
  title?: string
  description?: string
  variant?: "default" | "destructive"
}

function toast({ title, description, variant }: ToastOptions) {
  const message = title ?? description ?? ""
  const rest = title && description ? { description } : undefined

  if (variant === "destructive") {
    return sonnerToast.error(message, rest)
  }
  return sonnerToast(message, rest)
}

export function useToast() {
  return { toast }
}
