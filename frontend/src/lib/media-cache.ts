import { supabase } from "./supabase"

const cache = new Map<string, { url: string; exp: number }>()

// URL assinada com cache em memória (bucket whatsapp-media é privado).
// Evita um createSignedUrl por bolha de mídia a cada re-render do chat.
export async function getSignedMediaUrl(path: string): Promise<string | null> {
  const hit = cache.get(path)
  if (hit && hit.exp > Date.now()) return hit.url
  const { data, error } = await supabase
    .storage
    .from("whatsapp-media")
    .createSignedUrl(path, 3600)
  if (error || !data) {
    console.error("createSignedUrl", error)
    return null
  }
  cache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 })
  return data.signedUrl
}
