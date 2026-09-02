# CRM WhatsApp

CRM de vendas com WhatsApp no centro, construído sobre Supabase (Postgres +
Auth + Realtime + Edge Functions + Storage) e Evolution API.

**Status: F0–F4 implementadas** — fundação, chat, funil, agenda, automações,
SDR IA (com transcrição de áudio), templates de resposta e dashboard.

## Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind + shad/ui (rotas com code-splitting)
- **Backend**: Supabase — Postgres + Auth + Edge Functions + Realtime + Storage
- **WhatsApp**: Evolution API self-hosted (credenciais só em secrets server-side)
- **IA**: OpenRouter (key em `app_secrets`, service-role only; default `google/gemini-2.5-flash`)
- **Timezone de negócio**: `America/Sao_Paulo`

## Funcionalidades

| Área | Rota | Notas |
| --- | --- | --- |
| Chat | `/` | Realtime, envio otimista, status ✓✓, templates com `{{nome}}`, transcrição de áudio, bip/título com não-lidas |
| Contatos | `/contacts` | Busca, tags, vínculo telefone↔LID |
| Funil | `/pipeline` | Kanban (drag & drop), oportunidades por contato |
| Agenda | `/agenda` | Tarefas, follow-ups, reuniões |
| Automações | `/automations` | Regras disparadas por eventos (admin) |
| Dashboard | `/dashboard` | Métricas comerciais |
| Configurações | `/settings` | Usuários, WhatsApp, Templates, IA, SDR IA (admin) |
| Minha conta | `/account` | Troca de senha |

### SDR IA + áudio

Áudios recebidos são transcritos no webhook (best-effort, em background) e o
texto alimenta o SDR (`sdr-engine`), os resumos/insights (`ai-service`) e o
inspector de deals (`deal-inspector`). Configuração em **Configurações → IA →
Transcrição de Áudios** (modelo + liga/desliga). Coluna: `messages.transcription`.

### Confiabilidade do webhook

- **Dedup** por `(conversation_id, evolution_message_id)` — reentrega não duplica.
- **Reconciliação na reconexão**: ao voltar para `connected`, o webhook lista os
  chats da própria Evolution (`findChats` + `findMessages`, janela de 3 dias) e
  reimporta o que caiu — cobre mensagens perdidas em queda de entrega, inclusive
  conversas novas (leads) que ainda não existiam no CRM.
- Enriquecimento (transcrição → SDR → automação) roda **após** responder a
  Evolution (via `EdgeRuntime.waitUntil`), evitando timeout/queda de entrega.

## Estrutura

```
supabase/
  migrations/          001..040 (profiles → message_templates, app_secrets, merge LID)
  functions/
    _shared/           cors, evolution-identity (camada única de identidade LID/JID/phone),
                       contacts (upsert merge-aware), lid-phone-resolver (cache),
                       transcribe (OpenRouter audio), secrets (app_secrets)
    admin-users/       gestão de usuários + config IA/segredos (admin, server-side)
    evolution-webhook  entrada dos eventos da Evolution (token na URL)
    evolution-proxy    proxy autenticado p/ Evolution (send-text/media, instâncias, syncs)
    ai-service         resumos, análise de lead, sugestão de resposta, transcrição on-demand
    sdr-engine         atendimento automático (qualificação), agenda de SDR, métricas
    automation-engine  regras evento→ação (chamado pelo webhook)
    deal-inspector     análise de deals parados
frontend/
  src/pages/           Chat, Contacts, Pipeline, Agenda, Automations, Dashboard,
                       Settings (UsersAdmin/WhatsApp/AISettings/SDRSettings/Templates), MyAccount, Login
  src/hooks/           use-auth, use-ai, use-tags, use-templates, use-commercial
  src/lib/             supabase, api (Edge Functions), types, utils, media-cache
```

## Setup

```bash
supabase link --project-ref <ref>
supabase db push
supabase secrets set EVOLUTION_API_URL=... EVOLUTION_API_KEY=... WEBHOOK_SECRET=...
cd frontend && cp .env.example .env   # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install && npm run dev
```

Deploy das funções: `supabase functions deploy <nome>` (por função).
Signup público **desligado** — usuários criados pelo admin.
Webhook: `https://<ref>.supabase.co/functions/v1/evolution-webhook?token=<WEBHOOK_SECRET>`.

## Notas de segurança

- **Segredos**: `app_secrets` sem policies — leitura apenas por service role nas
  Edge Functions. A key da OpenRouter **nunca** fica mais em `activity_log`.
- `activity_log`: leitura/escrita restrita a admin (a policy antiga expunha tudo
  a qualquer usuário autenticado).
- RLS em tudo; admin checado por `public.is_admin()` (SECURITY DEFINER), nunca
  e-mail hardcoded.
- `messages`: INSERT apenas via service role; usuários leem.
- Credenciais da Evolution só vivem em secrets de Edge Function.

## Testes e CI

```bash
npm test          # deno test supabase/functions/_shared/ (37 casos)
npm run build     # tsc + vite
npm --prefix frontend run lint
```

CI no GitHub Actions (`.github/workflows/ci.yml`): testes Deno, type-check das
Edge Functions, lint e build do frontend em cada push/PR.

## Dívida conhecida / próximos passos

- Atualizações **majors** pendentes (avisadas pelo `npm audit`): vite 5→8 e
  react-router 6→7 (com testes), em branch dedicada.
- `evolution-proxy` com ~1.7k linhas — dividir em módulos na próxima mudança grande.
- Regras de automação fora `MESSAGE_RECEIVED`/`FIRST_MESSAGE_RECEIVED` ainda não
  têm emissor (ex.: `OPPORTUNITY_STAGE_CHANGED`, `TASK_OVERDUE` via cron).
