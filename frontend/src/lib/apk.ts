import { getSupabaseUrl } from "./supabase"

export const APK_DOWNLOAD_URL = `${getSupabaseUrl()}/storage/v1/object/public/apk-releases/latest/atendatop-crm.apk`

export type ApkManifest = {
  version: string
  code: number
  built_at: string
  size_bytes: number
}

export async function fetchApkManifest(): Promise<ApkManifest | null> {
  try {
    const res = await fetch(
      `${getSupabaseUrl()}/storage/v1/object/public/apk-releases/latest/manifest.json`,
    )
    if (!res.ok) return null
    return (await res.json()) as ApkManifest
  } catch {
    return null
  }
}
