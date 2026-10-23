# CRM WhatsApp

CRM de vendas com WhatsApp no centro, construído sobre Supabase (Postgres +
Auth + Realtime + Edge Functions + Storage) e Evolution API.

**Status: F0–F4 implementadas** — fundação, chat, funil, agenda, automações,
SDR IA (com transcrição de áudio), templates de resposta e dashboard.

## Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind + shad/ui (rotas com code-splitting)
- **Backend**: Supabase — Postgres + Auth + Edge Functions + Realtime + Storage
- **WhatsApp**: Evolution API self-hosted (credenciais só em secrets server-side)
- **IA**: OpenRouter (key em `app_secrets`, service-role only; default `meta/muse-spark-1.3-contributor`)
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
| Grupos | `/groups` | Posts programados em grupos + DM a quem comentar (admin) |
| Configurações | `/settings` | Usuários, WhatsApp, Templates, Cadências, Follow-up sem resposta, IA, SDR IA (admin) |
| Minha conta | `/account` | Troca de senha |

### Follow-up sem resposta (régua de recuperação)

> 📖 **Manual completo de instruções** (o que é automático, onde o humano atua e o que a IA faz): veja [`MANUAL_FOLLOWUP.md`](./MANUAL_FOLLOWUP.md).

Fluxo: o SDR responde o lead e a conversa morre em silêncio → o
`noreply-runner` (pg_cron, 10 min) detecta via `conversations.last_message_inbound
= false` e envia as mensagens de re-engajamento configuradas por tentativa
(intervals crescentes). O lead responde → a régua encerra na hora
(`noreply_mark_replied` no webhook). Silêncio até o fim → a oportunidade é
movida para o estágio de destino (padrão **"Sem Resposta"**, criado em cada
pipeline) com tarefa de revisão para o humano analisar e excluir/ganhar.

- Configuração em **Configurações → Follow-up sem resposta** (admin): liga/desliga,
  tentativas (intervalo + template/texto com `{{contact.name}}`), estágio de
  destino por funil, horário comercial, fim de semana, tolerância final.
- Mensagens manuais do SDR reiniciam o relógio **sem zerar** as tentativas
  (`noreply_touch`); a resposta do lead pode abrir um ciclo novo
  (`restart_after_reply`).
- Guardrails: contatos com opt-out nunca recebem; não roda enquanto o SDR IA
  está no comando da conversa; falha de envio não conta como tentativa (3
  falhas seguidas cancelam); envio em lote de no máximo 50/run; auditoria
  completa em `noreply_events`.
- No chat: badge âmbar `tentativa N/total` na lista + faixa com botão
  **"Cancelar follow-up"** na conversa aberta (qualquer usuário).


### SDR IA + áudio

Áudios recebidos são transcritos no webhook (best-effort, em background) e o
texto alimenta o SDR (`sdr-engine`), os resumos/insights (`ai-service`) e o
inspector de deals (`deal-inspector`). Configuração em **Configurações → IA →
Transcrição de Áudios** (modelo + liga/desliga). Coluna: `messages.transcription`.

### Posts em grupos + DM a quem comentar

**Configurações → não; página própria `/groups`** (admin): agenda texto/mídia num grupo
WhatsApp (`@g.us`, via Evolution — a API oficial Meta/Zernio não suporta grupos), com
data/hora, janela de engajamento (default 72h) e template de DM (`{{contact.name}}`).

Publicado o post (`group-publisher`, pg_cron 5 min), o webhook marca quem comentar
(**reply ao post OU qualquer mensagem na janela**, 1 por post+contato) em
`group_post_engagements` com `dm_due_at` = comentário + jitter (default 5–15 min).
O `group-dm-runner` (pg_cron 5 min) envia a DM 1:1 pela mesma instância, com pacing
(1/20s, teto 50/run). A DM **entra na fila**: SDR IA ativo, régua noreply ativa,
opt-out, horário comercial e fim de semana adiam ou pulam — nunca envia junto.
Falha de envio retenta (+30min, 3x); claim atômico (`FOR UPDATE SKIP LOCKED`) nos
dois runners impede envio duplicado. Auditoria em `activity_log` (`GROUP_POST:*`).

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
  migrations/          001..063 (profiles → cadences, noreply follow-up, hardening, cron)
  functions/
    _shared/           cors, auth (requireUser/requireAdmin server-side),
                       evolution-identity (camada única de identidade LID/JID/phone),
                       contacts (upsert merge-aware), lid-phone-resolver (cache),
                       transcribe (OpenRouter audio), secrets (app_secrets),
                       noreply-schedule (fuso BR/fim de semana p/ a régua),
                       noreply-attempts (seleção da tentativa por número),
                       outbound (caminho único de escrita de mensagem)
    admin-users/       gestão de usuários + config IA/segredos (admin, server-side)
    evolution-webhook  entrada dos eventos da Evolution (token na URL)
    evolution-proxy    proxy autenticado p/ Evolution (send-text/media, instâncias, syncs)
    ai-service         resumos, análise de lead, sugestão de resposta, transcrição on-demand
    sdr-engine         atendimento automático (qualificação), agenda de SDR, métricas
    automation-engine  regras evento→ação (chamado pelo webhook)
    cadence-runner     cadências de vendas (pg_cron, 5 min)
    noreply-runner     régua de follow-up sem resposta (pg_cron, 10 min)
    deal-inspector     análise de deals parados
    group-publisher    publica posts agendados em grupos (pg_cron, 5 min)
    group-dm-runner    DM 1:1 para quem comentou (pg_cron, 5 min)
    lead-webhook       intake de leads da landing page → contato + card no funil
    zernio-proxy      conexão oficial Meta (campanhas, templates)
    zernio-webhook     eventos da Zernio (status de mensagem/template)
frontend/
  src/pages/           Chat, Contacts, Pipeline, Agenda, Automations, Dashboard,
                       Campaigns, Groups, Settings (UsersAdmin/WhatsApp/AISettings/
                       SDRSettings/Templates/CadencesSettings/NoreplySettings),
                       MyAccount, Login
  src/hooks/           use-auth, use-ai, use-tags, use-templates, use-commercial,
                       use-cadences, use-noreply
  src/lib/             supabase, api (Edge Functions), types, utils, media-cache
  src/components/      Layout, ErrorBoundary, DealInspectorDialog, ui/ (shad/ui)
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

### Jobs do pg_cron (cadências, régua, grupos, watchdog)

A URL base e a anon key usadas pelos jobs ficam em `cron_config` — **não há
mais URL de produção hardcoded nas migrations** (antes: 6 arquivos, 9
ocorrências; `supabase db reset` em dev criava jobs que apontavam para
produção).

Configure **uma vez**, com a Edge Function `admin-users` (admin-only, os
valores vêm do ambiente — nada é digitado e nada sensível vai para o git):

```bash
curl -X POST "<ref>.supabase.co/functions/v1/admin-users" \
  -H "Authorization: Bearer <access_token_do_admin>" \
  -H "apikey: <anon_key>" -H "Content-Type: application/json" \
  -d '{"action":"set-cron-config"}'
```

Sem essa configuração os jobs **não fazem nada** (fail closed) — é
preferível a um job apontando para a URL errada.

## Notas de segurança

- **Segredos**: `app_secrets` sem policies — leitura apenas por service role nas
  Edge Functions. A key da OpenRouter **nunca** fica mais em `activity_log`.
- `activity_log`: leitura/escrita restrita a admin (a policy antiga expunha tudo
  a qualquer usuário autenticado).
- RLS em tudo; admin checado por `public.is_admin()` (SECURITY DEFINER), nunca
  e-mail hardcoded.
- **Funções privileged** (`SECURITY DEFINER`): todas com `revoke execute from
  public` + `grant to service_role`. Sem isso o default privilege do Supabase
  expunha `bump_conversation`, `claim_group_*`, `noreply_*` etc. para a anon key
  (que é pública no bundle do front).
- **Guard de rota ≠ autorização**: os guards do React são cosméticos. A proteção
  real é a RLS + o `requireAdmin` server-side (`_shared/auth.ts`). Toda Edge
  Function que serve o painel checa o papel — inclusive as que desligam
  `verify_jwt` na plataforma (o cron/webhook não tem JWT de usuário).
- **RLS restrita onde é PII**: `sdr_settings`, `sdr_logs`, `campaigns`,
  `campaign_recipients` e `zernio_connections` só são legíveis por admin.
- **Identidade do contato no banco**: `CHECK` de formato em `contacts.phone` e
  `contacts.lid` (a regra de identidade precisa estar no banco, não só no app).
- **Segredos fora da URL**: o `WEBHOOK_SECRET` vai no header `x-webhook-token`
  nas chamadas internas (na query string ele ia para os logs).
- `messages`: INSERT apenas via service role; usuários leem.
- Credenciais da Evolution só vivem em secrets de Edge Function.

## Testes e CI

```bash
npm test              # deno test --allow-env supabase/functions/_shared/ (116 casos)
npm run test:frontend # vitest (26 casos em lib/utils)
npm run build         # tsc + vite
npm run lint          # eslint (frontend)
```

CI no GitHub Actions (`.github/workflows/ci.yml`): testes Deno, type-check das
Edge Functions, lint e build do frontend em cada push/PR.

- **Watchdog de leads parados**: emissor `OPPORTUNITY_IDLE` no cron horário
  (`automation-engine` com `event=WATCHDOG_IDLE`, token interno) varre
  oportunidades abertas sem atividade e dispara a regra semeadada
  "Oportunidade Parada - Follow-up" — config em **Automações → Watchdog**
  (dias mínimos + período de/até para escolher os leads; uma emissão por
  episódio de paralisia). O Deal Inspector também aceita período de/até
  (data da última mensagem) para revisão assistida com IA.

## Dívida conhecida / próximos passos

- Atualizações **majors** pendentes (avisadas pelo `npm audit`): vite 5→8 e
  react-router 6→7 (com testes), em branch dedicada. O `vitest` também está
  preso na v2 porque a v4 exige Vite 6+ — sobe junto com o vite.
- **Política de audit no CI**: o gate bloqueante é
  `npm audit --omit=dev --audit-level=high` (só o que entra no bundle do
  navegador). O audit completo, que inclui a toolchain de dev
  (`tinypool`, `tar`, `sharp`, `uuid` via capacitor), fica informativo:
  nenhuma delas é executada no navegador do usuário, e bloquear o merge
  por elas só deixaria o CI vermelho.
- `evolution-proxy` com ~2.2k linhas — dividir em módulos na próxima mudança grande.
- `Chat.tsx` (~2.2k linhas, ~35 `useState`) e `Pipeline.tsx` (~1.9k) ainda
  concentram componentes que deveriam viver em `components/chat/*` e
  `components/pipeline/*`.
- Regras de automação fora `MESSAGE_RECEIVED`/`FIRST_MESSAGE_RECEIVED`/`OPPORTUNITY_IDLE`
  ainda não têm emissor (ex.: `OPPORTUNITY_STAGE_CHANGED`, `TASK_OVERDUE`, `TASK_DUE`,
  `FOLLOWUP_DUE` via cron) — a UI oferece 21 gatilhos, só 3 disparam.
- **Sem testes automatizados no frontend** (17k linhas, nenhum framework
  instalado). Os testes Deno cobrem só `_shared/`; as Edge Functions de
  negócio (SDR, cadências, régua) não têm cobertura.
- **Deploy manual**: `supabase db push` e `supabase functions deploy` por
  função. O CI não deploya nada, então nada denuncia drift entre a migration
  aplicada e o código em produção.
- `deno fmt`/`deno lint` não rodam no CI (o repositório tem 142 lint issues e
  31 arquivos fora do padrão de formatação) — dívida pré-existente.
- `messages`, `automation_executions` e `sdr_logs` crescem sem limite: não há
  job de purga (a regra dos 60 dias só filtra no ingest).
