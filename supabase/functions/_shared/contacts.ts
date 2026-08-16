// _shared/contacts.ts
// Upserts de contato e conversa compartilhados entre evolution-webhook e
// evolution-proxy. A resolução de identidade (phone/lid) fica em
// evolution-identity.ts; aqui só entra a persistência.
//
// Anti-duplicação: a busca é merge-aware — por LID, depois por telefone
// (incluindo variantes do nono dígito), depois fallback legado
// (phone = 'lid:<digits>'). NUNCA cria um segundo contato quando uma
// associação LID→telefone já é conhecida.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { phoneLookupVariants } from "./evolution-identity.ts";

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type Supabase = ReturnType<typeof serviceClient>;

interface ContactRow {
  id: string;
  phone: string | null;
  lid: string | null;
  push_name: string | null;
  jid: string | null;
}

/**
 * Upsert de contato resolvendo por LID e/ou telefone, sem duplicar. Ordem:
 *   1. por LID (se informado) → preenche phone/lid faltantes na linha existente;
 *   2. senão por telefone (se informado), testando também as variantes do nono
 *      dígito → preenche lid faltante;
 *   3. fallback legado: phone = 'lid:<digits>' (dados pré-LID);
 *   4. senão insere. Em corrida (unique violation), relê e devolve o existente.
 */
export async function upsertContact(
  supabase: Supabase,
  phone: string | null,
  lid: string | null,
  pushName: string | null,
  jid: string | null = null,
): Promise<string> {
  let existing: ContactRow | null = null;

  if (lid) {
    const { data } = await supabase
      .from("contacts")
      .select("id, phone, lid, push_name, jid")
      .eq("lid", lid)
      .maybeSingle();
    if (data) existing = data;
  }

  if (!existing && phone) {
    for (const variant of phoneLookupVariants(phone)) {
      const { data } = await supabase
        .from("contacts")
        .select("id, phone, lid, push_name, jid")
        .eq("phone", variant)
        .maybeSingle();
      if (data) {
        existing = data;
        break;
      }
    }
  }

  // Fallback legado: dados pré-LID armazenavam o LID dentro de `phone`
  // como `lid:<digits>`.
  if (!existing && lid) {
    const { data } = await supabase
      .from("contacts")
      .select("id, phone, lid, push_name, jid")
      .eq("phone", `lid:${lid.replace(/^lid:/, "")}`)
      .maybeSingle();
    if (data) existing = data;
  }

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (pushName && existing.push_name !== pushName) patch.push_name = pushName;
    if (jid && existing.jid !== jid) patch.jid = jid;
    if (phone && !existing.phone) patch.phone = phone;
    if (lid && existing.lid !== lid) patch.lid = lid;
    if (Object.keys(patch).length > 0) {
      await supabase.from("contacts").update(patch).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({ phone, lid, push_name: pushName ?? null, name: pushName ?? null, jid })
    .select("id")
    .single();
  if (error) {
    // Corrida: outra chamada do webhook criou o contato enquanto isso.
    const filter = lid
      ? { field: "lid", value: lid }
      : phone
      ? { field: "phone", value: phone }
      : null;
    if (filter) {
      const { data: again } = await supabase
        .from("contacts")
        .select("id")
        .eq(filter.field, filter.value)
        .maybeSingle();
      if (again) return again.id;
    }
    throw error;
  }
  return data.id;
}

export async function upsertConversation(
  supabase: Supabase,
  contactId: string,
  instanceId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase
    .from("conversations")
    .insert({ contact_id: contactId, instance_id: instanceId })
    .select("id")
    .single();
  if (error) {
    const { data: again } = await supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("instance_id", instanceId)
      .maybeSingle();
    if (again) return again.id;
    throw error;
  }
  return data.id;
}