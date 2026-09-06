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
    // Colisões de identidade (mesma pessoa com dois contatos): antes de
    // preencher phone/lid, verifica se outro contato já é o dono — se for,
    // funde os dois em vez de duplicar (o backfill silencioso violava as
    // constraints UNIQUE(phone)/UNIQUE(lid) e o erro era ignorado, deixando
    // contatos LID órfãos que geravam conversas duplicadas pós-reconexão).
    if (phone && !existing.phone) {
      const { data: phoneOwner } = await supabase
        .from("contacts")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();
      if (phoneOwner && phoneOwner.id !== existing.id) {
        await mergeContacts(supabase, existing.id, phoneOwner.id);
        return phoneOwner.id;
      }
    }
    if (lid && existing.lid !== lid) {
      const { data: lidOwner } = await supabase
        .from("contacts")
        .select("id")
        .eq("lid", lid)
        .maybeSingle();
      if (lidOwner && lidOwner.id !== existing.id) {
        // Mantém o dono do telefone (existing), absorve o dono do LID.
        await mergeContacts(supabase, lidOwner.id, existing.id);
        return existing.id;
      }
    }

    const patch: Record<string, unknown> = {};
    if (pushName && existing.push_name !== pushName) patch.push_name = pushName;
    if (jid && existing.jid !== jid) patch.jid = jid;
    if (phone && !existing.phone) patch.phone = phone;
    if (lid && existing.lid !== lid) patch.lid = lid;
    if (Object.keys(patch).length > 0) {
      const { error: patchError } = await supabase
        .from("contacts")
        .update(patch)
        .eq("id", existing.id);
      if (patchError) console.error("CONTACT_PATCH_FAILED", existing.id, patchError.message);
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

export type ConversationSource = "organic" | "ad" | "campaign" | "manual";

export interface ConversationOrigin {
  source?: ConversationSource;
  meta?: Record<string, unknown> | null;
}

export async function upsertConversation(
  supabase: Supabase,
  contactId: string,
  instanceId: string,
  origin?: ConversationOrigin,
): Promise<string> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (existing) return existing.id;

  // Sem origem explícita (anúncio), herda a origem do contato: contato
  // cadastrado manualmente no CRM gera conversa 'manual', não 'organic'.
  let source: ConversationSource = origin?.source ?? "organic";
  if (!origin?.source) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("source")
      .eq("id", contactId)
      .maybeSingle();
    if (contact?.source === "manual") source = "manual";
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      contact_id: contactId,
      instance_id: instanceId,
      source,
      source_meta: origin?.meta ?? null,
    })
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

// ---------------------------------------------------------------------------
// Fusão de contatos (mesma pessoa identificada por caminhos diferentes:
// telefone vs LID). Usado pelo upsertContact (colisão de phone/lid) e pelos
// fluxos de sync do evolution-proxy.
// ---------------------------------------------------------------------------

/**
 * Funde o contato `fromId` em `intoId`: move conversas (com dedup de
 * mensagens por evolution_message_id), referenciais e atribui o LID.
 * LIDs alternativos são registrados no lid_phone_cache para as próximas
 * resoluções. Idempotente e best-effort: nunca lança.
 */
export async function mergeContacts(
  supabase: Supabase,
  fromId: string,
  intoId: string,
): Promise<void> {
  try {
    if (fromId === intoId) return;
    const { data: fromContact } = await supabase
      .from("contacts")
      .select("id, lid, phone, name, push_name, jid")
      .eq("id", fromId)
      .maybeSingle();
    if (!fromContact) return;
    const { data: intoContact } = await supabase
      .from("contacts")
      .select("id, lid, phone, name, push_name, jid")
      .eq("id", intoId)
      .maybeSingle();
    if (!intoContact) return;

    // Conversas: mesma instância → move conteúdo com dedup e apaga a origem;
    // sem conversa alvo → reassocia ao contato destino.
    const { data: fromConvs } = await supabase
      .from("conversations")
      .select("id, instance_id")
      .eq("contact_id", fromId);
    const { data: intoConvs } = await supabase
      .from("conversations")
      .select("id, instance_id")
      .eq("contact_id", intoId);
    const intoByInstance = new Map<string, string>(
      (intoConvs ?? []).map((c: any) => [c.instance_id, c.id]),
    );

    for (const fc of fromConvs ?? []) {
      const target = intoByInstance.get(fc.instance_id);
      if (target) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("id, evolution_message_id")
          .eq("conversation_id", fc.id);
        for (const m of msgs ?? []) {
          if (!m.evolution_message_id) {
            await supabase.from("messages").update({ conversation_id: target }).eq("id", m.id);
            continue;
          }
          const { data: dup } = await supabase
            .from("messages")
            .select("id")
            .eq("conversation_id", target)
            .eq("evolution_message_id", m.evolution_message_id)
            .maybeSingle();
          if (!dup) {
            await supabase.from("messages").update({ conversation_id: target }).eq("id", m.id);
          }
        }
        // SDR/opportunities apontam para a conversa origem (FK sem cascade)
        if (await hasSdrConversation(supabase, target)) {
          await supabase.from("sdr_conversations").delete().eq("conversation_id", fc.id);
        } else {
          await supabase
            .from("sdr_conversations")
            .update({ conversation_id: target })
            .eq("conversation_id", fc.id);
        }
        await supabase
          .from("opportunities")
          .update({ conversation_id: target })
          .eq("conversation_id", fc.id);
        await supabase.from("conversations").delete().eq("id", fc.id);
      } else {
        await supabase.from("conversations").update({ contact_id: intoId }).eq("id", fc.id);
      }
    }

    // Referenciais do contato fundido
    const { data: fromTags } = await supabase
      .from("contact_tags")
      .select("tag_id")
      .eq("contact_id", fromId);
    for (const t of fromTags ?? []) {
      await supabase
        .from("contact_tags")
        .delete()
        .eq("contact_id", fromId)
        .eq("tag_id", t.tag_id);
      await supabase
        .from("contact_tags")
        .upsert({ contact_id: intoId, tag_id: t.tag_id })
        .then(() => {}, () => {});
    }
    await supabase.from("opportunities").update({ contact_id: intoId }).eq("contact_id", fromId);
    await supabase.from("meetings").update({ contact_id: intoId }).eq("contact_id", fromId);
    await supabase.from("opportunity_tasks").update({ contact_id: intoId }).eq("contact_id", fromId);
    await supabase.from("sdr_conversations").update({ contact_id: intoId }).eq("contact_id", fromId);
    await supabase.from("deal_insights").update({ contact_id: intoId }).eq("contact_id", fromId);

    // Enriquecimento e LID
    const patch: Record<string, unknown> = {};
    if (!intoContact.name && fromContact.name) patch.name = fromContact.name;
    if (!intoContact.push_name && fromContact.push_name) {
      patch.push_name = fromContact.push_name;
    }
    if (!intoContact.jid && fromContact.jid) patch.jid = fromContact.jid;
    if (Object.keys(patch).length > 0) {
      await supabase.from("contacts").update(patch).eq("id", intoId);
    }
    if (fromContact.lid) {
      if (!intoContact.lid) {
        const { error: lidErr } = await supabase
          .from("contacts")
          .update({ lid: fromContact.lid })
          .eq("id", intoId);
        if (lidErr) {
          await putLidCacheMapping(supabase, fromContact.lid, intoContact.phone);
        }
      } else if (intoContact.lid !== fromContact.lid) {
        await putLidCacheMapping(supabase, fromContact.lid, intoContact.phone);
      }
    }
    await supabase.from("contacts").delete().eq("id", fromId);
  } catch (err) {
    console.error("CONTACT_MERGE_FAILED", fromId, intoId, err);
  }
}

async function hasSdrConversation(supabase: Supabase, conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from("sdr_conversations")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  return Boolean(data);
}

async function putLidCacheMapping(supabase: Supabase, lid: string, phone: string | null): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("lid_phone_cache")
    .upsert(
      {
        lid,
        phone,
        resolved_at: phone ? now : null,
        last_attempt_at: now,
        updated_at: now,
      },
      { onConflict: "lid" },
    )
    .then(() => {}, () => {});
}