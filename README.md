# CRM WhatsApp — SDR de campanhas Google/Meta

CRM enxuto com WhatsApp no centro. O diferencial: **leads que clicam em anúncios
do Google Ads ou Meta (Facebook/Instagram) e mandam mensagem no WhatsApp são
atendidos automaticamente pelo SDR IA** — qualificação, mão para o humano e
oportunidade no funil com a atribuição do anúncio.

Stack: React 18 + Vite + TypeScript + Tailwind (frontend), Supabase (Postgres +
Auth + Realtime + Edge Functions + Storage), Evolution API (WhatsApp), OpenRouter
(IA), PWA. Timezone de negócio: `America/Sao_Paulo`.

## Fluxo do lead de anúncio

1. O lead clica no anúncio (click-to-WhatsApp) e envia a 1ª mensagem.
2. `evolution-webhook` detecta a origem:
   - **Meta**: payload oficial `key.advertiser` (`ad_id`, `click_id`,
     `cta_source_url`) ou texto pré-preenchido característico;
   - **Google**: UTMs/`gclid` na URL do anúncio ou texto pré-preenchido;
   - `lead-webhook` (landing) grava `source='landing'` com UTMs.
3. A atribuição é salva em `conversations.source` + `source_meta`. Se o lead
   passou pela landing e depois clicou no anúncio, a atribuição é **mesclada**
   (uma atribuição oficial nunca é rebaixada por heurística; marcação manual
   nunca é sobrescrita).
4. Para `source IN ('ad','landing')` o SDR é **ativado automaticamente** na
   primeira mensagem (`sdr_auto_activate`). Para conversas orgânicas/manuais,
   o humano ativa pelo botão **SDR Ativo** no chat. Se o humano pausou ou
   transferiu, a ativação automática **nunca** reativa a conversa.
5. `sdr-engine` qualifica via OpenRouter (prompt em `sdr_settings.code_prompt`,
   fonte única — vazio = fail-closed), enxerga a origem/campanha no prompt e
   cria a oportunidade com `network`, `ad_id`, `click_id` e UTMs no metadata.
6. `schedule_demo` / `schedule_callback` agora criam **reunião/tarefa real** no
   próximo horário livre de `presentation_slots`.
7. O humano pode pausar/assumir a qualquer momento (digitando no chat o SDR é
   pausado automaticamente). Opt-out e horário comercial são respeitados, e o
   opt-out é checado **antes** da chamada à IA (não gasta token).

## O que ficou (e o que saiu)

**Rotas:** `/` (Chat), `/contacts`, `/pipeline`, `/agenda`, `/settings`
(Usuários, WhatsApp, Templates, IA, SDR IA), `/account`, `/login`.

**Edge Functions:** `evolution-webhook`, `evolution-proxy`, `sdr-engine`,
`lead-webhook`, `admin-users`, `ai-service` (config de transcrição/teste).

**Removidos:** grupos e posts em grupos, cadências, régua "sem resposta",
automações/watchdog, campanhas/broadcast Zernio, deal inspector, APK, tela de
plataforma e o fluxo de convites de workspace. As tabelas/colunas correspondentes
foram removidas na migration `074`. As colunas `workspace_id` e as policies
foram mantidas dormentes no banco (a superfície multi-tenant saiu da UI).

## Estrutura

```
supabase/
  migrations/          001..074 (fundação → SDR → limpeza)
  functions/
    _shared/           cors, auth, contacts, evolution-identity, attribution,
                       sdr-activation, outbound, transcribe, secrets, ...
    evolution-webhook  entrada dos eventos da Evolution + atribuição + SDR
    evolution-proxy    proxy autenticado p/ Evolution (send-text/media, syncs)
    sdr-engine         qualificação, prompt, agendamento, métricas
    lead-webhook       intake de leads da landing → contato + card no funil
    admin-users        usuários + segredos/config de IA (admin, server-side)
    ai-service         config de transcrição, teste de conexão, chave da IA
frontend/
  src/pages/           Chat, Contacts, Pipeline, Agenda, Settings, MyAccount, Login
  src/hooks/           use-auth, use-ai, use-theme, use-tags, use-templates,
                       use-commercial
  src/lib/             supabase, api, types, utils, ...
  src/components/      Layout, ErrorBoundary, ProtectedRoute, ui/ (Radix)
```

## Setup

```bash
supabase link --project-ref <ref>
supabase db push
supabase secrets set EVOLUTION_API_URL=... EVOLUTION_API_KEY=... WEBHOOK_SECRET=...
cd frontend && cp .env.example .env   # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install && npm run dev
```

Deploy das funções: `supabase functions deploy <nome>`. Signup público
**desligado** — usuários criados pelo admin. Webhook:
`https://<ref>.supabase.co/functions/v1/evolution-webhook?token=<WEBHOOK_SECRET>`.

> Após a migration `073`, instalações que ainda estavam no estado de fábrica
> (`enabled=false` + `test_mode=true`) foram ligadas automaticamente. Se você
> havia desligado o SDR de propósito, reative em Configurações → SDR IA e
> confira o prompt principal (fonte única do atendimento).

## Segurança

- Segredos em `app_secrets`, leitura só por service role nas Edge Functions.
- RLS em todas as tabelas; admin por `public.is_admin()` (SECURITY DEFINER).
- Funções privileged com `revoke execute from public` + `grant to service_role`.
- Guard de rota no React é cosmético; a proteção real é RLS + `requireAdmin`.
- `messages`: INSERT só via service role. Webhook com token no header
  `x-webhook-token` (nunca na query string).

## Testes e CI

```bash
npm test              # deno test --allow-env supabase/functions/_shared/
npm run test:frontend # vitest
npm run build         # tsc + vite
npm run lint          # eslint (frontend)
```

CI em `.github/workflows/ci.yml`: testes Deno (incluindo atribuição Google/Meta
e auto-ativação do SDR), type-check das Edge Functions, lint/testes/build do
frontend e audit do bundle de produção. Deploy automático em `main` via
`.github/workflows/deploy.yml`.
