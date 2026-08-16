# CRM WhatsApp

CRM de vendas simples e enxuto com WhatsApp no centro, construído sobre Supabase
(Postgres + Auth + Realtime + Edge Functions + Storage) e Evolution API.

**Status atual: Fase 0 (Fundação) + Fase 1 (Chat + Evolution API).** Fases F2+
(funil, agenda, follow-up, IA) estão no roadmap e **não** devem ser implementadas agora.

---

## Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind + shadcn/ui (`frontend/`)
- **Backend**: Supabase — Postgres + Auth + Edge Functions + Realtime + Storage
- **WhatsApp**: Evolution API self-hosted (URL e API key vivem **somente** em
  secrets de Edge Function — nunca no frontend)
- **Timezone de negócio**: `America/Sao_Paulo`

## Modelo de operação

UM número de WhatsApp da empresa, vários vendedores atendendo com **atribuição de
conversa**. O schema já suporta múltiplas instâncias (`whatsapp_instances`), mas a
UI da F1 gerencia uma só.

---

## Estrutura

```
supabase/
  migrations/           001..024 (profiles, contacts, instances, conversations, messages, status, repair)
  functions/
    _shared/
      cors.ts                    CORS + jsonResponse
      evolution-identity.ts      Camada ÚNICA de identidade (JID/LID/phone) + normalização BR
      evolution-identity_test.ts Testes dos 13 casos obrigatórios (deno test)
      contacts.ts                Upsert de contato/conversa (merge LID→phone, anti-duplicação)
    admin-users/         Gestão de usuários (admin, server-side)
    evolution-webhook/   Webhook público validado por token na URL
    evolution-proxy/     Proxy autenticado para a Evolution API
  config.toml
frontend/
  src/
    pages/    Login, Chat, Contacts, Settings (Usuários + WhatsApp), MyAccount
    components/  Layout, ProtectedRoute, ui/ (shadcn)
    hooks/use-auth.tsx
    lib/      supabase.ts, api.ts, types.ts, utils.ts
```

---

## Setup

> Deploy atual: projeto `crm_top` (ref `lxvhrzncqniexksxowah`), funções
> deployadas, migrations 001–006 aplicadas e signup desligado.

### 1. Link do projeto e migrations

```bash
supabase link --project-ref <project-ref>
supabase db push          # aplica as migrations 001–006
```

- **Importante**: em Authentication → Providers → Email, mantenha
  **"Enable sign ups" DESLIGADO** no dashboard do Supabase. Não existe tela de
  cadastro na UI; usuários são criados pelo admin (sem billing público).
- A migration `001` também desliga signup no `config.toml` local.

### 2. Secrets das Edge Functions

```bash
supabase secrets set EVOLUTION_API_URL=https://sua-evolution-api.com
supabase secrets set EVOLUTION_API_KEY=<api-key-da-evolution>
supabase secrets set WEBHOOK_SECRET=<string-aleatoria>
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente pela
plataforma. Documentação do comando: `supabase secrets set`.

**Neste deploy** já estão definidos: `WEBHOOK_SECRET` (gerado). Faltam apenas
`EVOLUTION_API_URL` e `EVOLUTION_API_KEY` com os valores da sua Evolution API —
sem eles, criar instância/QR e enviar mensagens falham com erro do Evolution.

### 3. Frontend

```bash
cd frontend
cp .env.example .env   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### 4. Deploy das funções

```bash
supabase functions deploy admin-users
supabase functions deploy evolution-proxy
supabase functions deploy evolution-webhook
```

### 5. Configuração da Evolution API

O webhook é registrado automaticamente no fluxo **Configurações → WhatsApp** do
admin, apontando para:

```
https://<project-ref>.supabase.co/functions/v1/evolution-webhook?token=<WEBHOOK_SECRET>
```

Eventos: `MESSAGES_UPSERT`, `MESSAGES_UPDATE` (entrega/leitura), `MESSAGES_SET`
(histórico do pareamento), `CONTACTS_SET`/`CONTACTS_UPSERT` e `CONNECTION_UPDATE`.

---

## Como funciona (F1)

### Webhook (`evolution-webhook`)

- Validado por `token` na query string (igual a `WEBHOOK_SECRET`).
- Por mensagem: extrai `remoteJid` → **resolução de identidade central**
  (`_shared/evolution-identity.ts`: classifica JID, LID nunca vira telefone,
  `remoteJidAlt`/`senderPn` recuperam o telefone real de LIDs) → **upsert em
  `contacts`** (merge-aware por LID→phone, com variantes do nono dígito BR) →
  **upsert em `conversations`** (`(contact_id, instance_id)` único) → **insert em
  `messages`** com `ON CONFLICT (conversation_id, evolution_message_id) DO NOTHING`.
- **Deduplicação por design**: reenviar o mesmo payload não duplica (teste de
  aceite). Rows com `evolution_message_id` nulo seguem sem dedup (aceitável).
- `messages.update` atualiza o `status` da mensagem outbound
  (`pending/sent/delivered/read/failed`) via RPC `update_message_status`.
- Mídia: baixa via `POST /chat/getBase64FromMediaMessage/{instance}` da Evolution,
  salva no bucket **privado** `whatsapp-media` e grava o caminho em `media_url`
  (o frontend gera URLs assinadas).
- Grupos (`@g.us`), status (`@broadcast`), listas e canais são ignorados na F1.
- `connection.update` atualiza `whatsapp_instances.status`
  (`open→connected`, `connecting/pairing→connecting`, senão `disconnected`).
- `syncFullHistory: true` é aplicado na criação da instância (meta de ~60 dias de
  histórico; a cobertura real é decidida pelo WhatsApp).

### Proxy (`evolution-proxy`)

- Requer JWT de usuário autenticado (validado server-side). Ações admin
  (`create-instance`, `get-qr`, `logout-instance`, sincronizações) exigem
  `role = admin`.
- `send-text` / `send-media`: o **destino é resolvido pela camada central**
  (`resolveSendTarget`: JID confirmado → telefone E.164 → LID com prefixo
  `lid:`; nunca inventa número). Enviam via Evolution **e** gravam a mensagem
  outbound no banco com `sender_profile_id` do JWT; falhas ficam `failed` e
  sucesso `sent` (nunca `sent` antes da confirmação da API). O eco do webhook
  não duplica (mesmo `evolution_message_id`), e o proxy usa upsert para corrigir
  o `sender` caso o webhook vença a corrida.

### Frontend

- Chat em tempo real via Supabase Realtime (publication em `messages` e
  `conversations`). Abrir a conversa zera `unread_count` via RPC
  `mark_conversation_read`. A coluna `status` da mensagem mostra
  ✓ (enviada), ✓✓ (entregue), ✓✓ azul (lida), ⏱ (pendente) e ⚠ (falha) — as
  transições `delivered`/`read` chegam em tempo real via `messages.update`.
- **Nenhum request do navegador vai direto para a Evolution** — tudo passa pelas
  Edge Functions (confira na aba Network).

### Testes

```bash
npm test   # deno test supabase/functions/_shared/ (19 casos de normalização)
```

---

## Variáveis de ambiente

**Frontend (`frontend/.env`):**

| Variável | Uso |
| --- | --- |
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave anon pública |

**Secrets de Edge Functions (`supabase secrets set`):**

| Secret | Uso |
| --- | --- |
| `EVOLUTION_API_URL` | Base URL da sua Evolution API |
| `EVOLUTION_API_KEY` | API key da Evolution |
| `WEBHOOK_SECRET` | Token de validação do webhook (na URL) |
| `SUPABASE_SERVICE_ROLE_KEY` | Injetada pela plataforma (não defina manualmente) |

---

## Notas de segurança

- Todo acesso a tabelas passa por RLS. Padrão canônico: `DROP POLICY IF EXISTS`
  seguido de `CREATE POLICY` (nunca `CREATE POLICY IF NOT EXISTS`).
- `is_platform_admin` é a única flag de admin de plataforma; **nunca** checagem por
  e-mail hardcoded.
- Checagem de admin em policies via `public.is_admin()` (função `SECURITY
  DEFINER` que consulta `profiles.role` por `auth.uid()`). **Não** use o
  `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')`
  inline numa policy sobre a própria tabela `profiles` — no Postgres 17 isso
  dispara `infinite recursion detected in policy` (bug comprovado e corrigido na
  migration `006_admin_policies_fix.sql`).
- `profiles`: usuários leem/editem o próprio; **admin** gerencia papéis
  (server-side na `admin-users`). Uma policy extra permite que **toda a equipe leia
  os nomes** (necessário para o dropdown de atribuição e o indicador de dono) — a
  escrita permanece restrita a si mesmo/admin.
- `messages`: INSERT só via service role (Edge Functions); usuários apenas leem.
- Usuários **desativados** são banidos (`ban_duration`) e **nunca** deletados —
  preservando histórico de mensagens e atribuições.

---

## Critérios de aceite

### F0

- [ ] `supabase db push` aplica as migrations sem erro
- [ ] Login funciona
- [ ] Vendedor NÃO consegue alterar role de ninguém (via RLS, não só UI)
- [ ] Admin cria vendedor pela UI; o vendedor loga com a senha provisória e troca a senha
- [ ] Chamada a `admin-users` com JWT de vendedor retorna **403**
- [ ] Signup direto pela API do Supabase falha (signup desligado)
- [ ] Usuário desativado não loga; ao reativar, volta com o mesmo histórico
- [ ] Nenhuma credencial da Evolution existe em código de frontend

### F1

- [ ] Escanear o QR conecta e o status muda para `connected` sozinho (via webhook)
- [ ] Mensagem recebida aparece no chat em <3s sem refresh
- [ ] Enviar texto e imagem pelo CRM chega no WhatsApp do destinatário
- [ ] Histórico do pareamento populou conversas/mensagens retroativas
- [ ] Reprocessar o mesmo webhook NÃO duplica mensagem
- [ ] Nenhum request do navegador vai direto para a Evolution
