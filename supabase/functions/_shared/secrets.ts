// Segredos de servidor (service role only — ver migration 039).
import type { Supabase } from "./contacts.ts";

export const OPENROUTER_KEY_NAME = "openrouter_api_key";

export async function getSecret(sb: Supabase, key: string): Promise<string> {
  const { data } = await sb.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? "";
}

export async function setSecret(
  sb: Supabase,
  key: string,
  value: string,
  userId?: string | null,
): Promise<void> {
  const { error } = await sb.from("app_secrets").upsert(
    { key, value, updated_by: userId ?? null },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
}

export async function getOpenRouterKey(sb: Supabase): Promise<string> {
  const fromEnv = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (fromEnv) return fromEnv;
  return await getSecret(sb, OPENROUTER_KEY_NAME);
}
