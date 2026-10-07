# 📖 Manual — Follow-up de Leads

> Guia completo de como o sistema recupera leads sozinho e **onde VOCÊ precisa entrar**.
> Vale a pena ler as seções 1 e 2 inteiras; o resto serve de consulta.

---

## 1. Em 30 segundos

O sistema tem **4 ferramentas** de follow-up. Duas rodam sozinhas no automático, duas você aciona:

| # | Ferramenta | O que resolve | Roda | Você aciona quando |
|---|---|---|---|---|
| ① | **Régua de follow-up sem resposta** | Lead respondeu o SDR e **sumiu da conversa** | Automático (a cada 10 min) | Nunca — ela é contínua depois de ativada |
| ② | **Watchdog de leads parados** | Card **parado no funil** há dias/meses | Automático (a cada hora) | Nunca — contínuo |
| ③ | **Deal Inspector** | Revisão com **IA** de um lote de leads frios | Sob demanda | Você clica em *Pipeline → Deal Inspector* |
| ④ | **Recuperar leads antigos** (backfill) | Colocar silêncios **mais antigos que 14 dias** na régua | Manual | Você clica em *Configurações → Follow-up sem resposta* |

**A regra de ouro:** o sistema **puxa** o lead e **organiza** o trabalho — mas **quem conversa, decide e fecha é o humano.**

---

## 2. Quem faz o quê (a tabela mais importante)

### 🤖 O que o SISTEMA faz sozinho (sem ninguém tocar em nada)

1. Detecta conversa onde **nós falamos por último** e o lead não respondeu
2. Envia as **mensagens de re-engajamento** que **você configurou** (textos prontos, com o nome do lead — **não** são geradas por IA)
3. Para de enviar **no instante** em que o lead responder
4. Quando esgota as tentativas: move o card para o estágio **"Sem Resposta"** e cria uma tarefa de revisão
5. Varre o funil todo hora e cria tarefas **"Retomar contato com cliente"** para cards parados
6. Respeita sozinho: horário comercial, fim de semana, opt-out, limite de 50 envios por vez

### 👤 O que o HUMANO precisa fazer

| Quando | O que você faz | Onde |
|---|---|---|
| **Uma vez (configuração)** | Revisar as mensagens da régua, escolher o estágio de destino, **Ativar** | Configurações → Follow-up sem resposta |
| **Uma vez (configuração)** | **Ativar o Watchdog** e escolher o período (ou deixar sem período = todos) | Automações → card Watchdog |
| **Todo dia** | **Trabalhar as tarefas da Agenda** ("Retomar contato com cliente" e "Lead sem resposta — revisar"): abrir, **conversar**, concluir | Agenda |
| **Sempre que o lead responder** | **Responder de verdade** — a régua só encerra, ninguém fala com o lead no seu lugar | Chat |
| **Quando o lead voltar ao funil** | **Mover o card de volta** do estágio "Sem Resposta" para o estágio certo | Pipeline |
| **Quando o lead pedir para parar** | Marcar o contato como **opt-out** (checkbox na edição do contato) — a régua o exclui sozinha | Contatos → editar |
| **Ocasional** | Rodar o **Deal Inspector** para uma triagem com IA quando quiser entender *por que* os leads morrem | Pipeline → Deal Inspector |
| **Ocasional** | **Recuperar lead antigo** silencioso (>14 dias) escolhendo a janela | Configurações → Follow-up sem resposta |

### 🧠 Onde entra a IA (de verdade)

A IA só aparece em **um lugar** desta seção: o **Deal Inspector**. Ela **lê** a conversa inteira, **classifica** o motivo do travamento (proposta sem resposta, ghost, reunião sem retorno, objeção...), **resume** e **sugere** a mensagem. **Ela não envia nada sozinha** — você decide copiar e enviar.

> ⚠️ Não confunda com o **SDR IA** (outro módulo, em Configurações → SDR IA): enquanto o SDR IA estiver ativo numa conversa, a **régua fica de fora** automaticamente (para não ter duas respostas automáticas brigando).

---

## 3. ① A Régua — passo a passo

### 3.1 Configuração (admin, uma vez)

1. **Configurações → aba "Follow-up sem resposta"**
2. Revise as **3 tentativas** (padrão: 24h, 72h, 7 dias). Em cada uma:
   - **Intervalo de silêncio** (horas) — quanto esperar antes daquela mensagem
   - **Texto** — use `{{contact.name}}` para o nome do lead (ou escolha um Template)
   - O campo "Tentativa ativa" liga/desliga aquela etapa
3. Revise as **Regras gerais**: horário comercial ✅, pular fim de semana ✅, tolerância final (72h) = quanto esperar depois da última tentativa antes de mover o card
4. Confira o **Funil e estágio de destino** (padrão: "Sem Resposta", já criado no funil Vendas)
5. Clique em **"Ativar régua"**

### 3.2 O que acontece sozinho (exemplo real)

```
SEG 10h   Lead: "quero um orçamento"  →  SDR responde  →  lead some
TER 10h   (silêncio de 24h)  →  ✉️ Tentativa 1: "Oi Maria, conseguiu ver minha
                                   última mensagem? Fico à disposição 😊"
QUA       se o lead responder  →  ⛔ REGUA PARA NA HORA
SEX 10h   (silêncio de 72h)   →  ✉️ Tentativa 2
SEG 10h   (silêncio de 7 dias)→  ✉️ Tentativa 3 (última)
QUA 10h   (+72h de tolerância, ainda mudo)
          →  📦 card vai para o estágio "SEM RESPOSTA" no funil
          →  📋 tarefa "Lead sem resposta — revisar" na Agenda do responsável
```

Toda mensagem enviada aparece **normalmente no chat** — você vê tudo que foi falado, nada invisível.

### 3.3 Onde você vê e o que você faz durante

| Onde | O que aparece | Sua ação |
|---|---|---|
| **Chat — lista** | Badge âmbar **`2/3`** na conversa = régua na tentativa 2 de 3 | Nada — é só informativo |
| **Chat — conversa aberta** | Faixa âmbar: *"Follow-up automático — tentativa 2 de 3 · próxima em ~2d"* + botão **Cancelar follow-up** | Cancele **se** a conversa estiver sendo tratada por outro canal/jeito (ex.: lead falou por telefone) |
| **Pipeline** | Card no estágio **"Sem Resposta"** | **DECIDIR:** mova de volta ao funil (lead interessa) ou marque **Perdido/exclua** (não interessou) |
| **Agenda** | Tarefa **"Lead sem resposta — revisar no funil"** | Abrir → olhar a conversa → decidir → **Concluir** |

### 3.4 A régua NÃO faz (limites importantes)

- ❌ **Não conversa**: se o lead responder com uma pergunta, **ninguém responde por você** — a régua só encerra e a conversa volta ao fluxo normal
- ❌ **Não gera mensagens com IA**: são os textos que você configurou
- ❌ **Não cria leads**: só age em conversas com **oportunidade aberta** no funil
- ❌ **Não insiste para sempre**: no máximo 3 tentativas (configuráveis)
- ❌ **Não envia fora do horário comercial** (padrão) nem para quem deu opt-out

### 3.5 Desligar / religar

**Desligar** (botão "Desativar régua") **congela** tudo: mensagens param e estados ficam suspensos. **Religar** retoma de onde parou. Para **encerar** o ciclo de uma conversa específica sem cancelar a régua toda: use "Cancelar follow-up" no chat.

---

## 4. ② O Watchdog — passo a passo

### 4.1 Configuração (admin, uma vez)

1. **Automações** → card **"Watchdog de leads parados"**
2. **Parado há no mínimo (dias)** = `3` (padrão; não abaixo de 3, a regra exige)
3. **Período — de/até** *(opcional)*: só entram leads cuja **última atividade** (mensagem ou movimentação do card) está entre as datas
   - Ex.: "só quem parou em setembro" → `01/09` a `30/09`
   - Vazio = **todos** os parados
4. Clique em **"Ativar"**

> A regra **"Oportunidade Parada - Follow-up"** já vem **ativa** (Automações → lista). Ela é quem cria a tarefa.

### 4.2 O que acontece sozinho

- A cada **hora**, o sistema varre o funil e, para cada oportunidade **aberta** sem atividade há ≥ 3 dias, cria a tarefa **"Retomar contato com cliente"** para o vendedor responsável
- **Uma tarefa por episódio**: enquanto o lead continua parado, **não duplica**. Se ele voltar a falar e parar de novo, aí sim nasce uma nova tarefa
- Tarefas antigas: o backlog inicial (618 tarefas) já foi criado — daqui pra frente é só o que aparecer de novo

### 4.3 O que o HUMANO faz (a parte principal!)

1. **Agenda** (aba Tarefas/follow-ups) → filtre por **"Follow-ups"**
2. Clique na tarefa → abra a conversa do lead
3. **Retome o contato de verdade** (mensagem humana, ligação... — nada automático aqui)
4. Resultado:
   - Interessou → **mova o card** no funil para o estágio certo e **Conclua** a tarefa
   - Não interessou → **marque Perdido** no card e **Conclua** a tarefa
5. Repita diariamente — a Agenda é sua **caixa de trabalho**

### 4.4 Watchdog NÃO faz

- ❌ Não envia mensagem nenhuma (só cria **tarefa**)
- ❌ Não mexe em cards (não move estágio)
- ❌ Não age em cards ganhos/perdidos (só `abertas`)
- ❌ Não cobre conversas **sem card** no funil (use o Deal Inspector para essas)

---

## 5. ③ Deal Inspector — passo a passo

**Pipeline (Funil) → botão "Deal Inspector"** — é uma **revisão pontual**, para quando você quer entender e triar um lote.

1. **Paradas há mais de (dias)** — corte dos parados (ex.: 30)
2. **Silêncio iniciado de / até** *(opcional)* — escolhe o lote pela data da última mensagem (ex.: silêncios iniciados em setembro)
3. **Janela de histórico** — quantos dias de conversa a IA vai ler (30 padrão)
4. **Estágios / Motivos** — filtra onde e por quê olhar
5. **Modo de ação**:
   - **Só relatório** → só analisa e mostra
   - **Criar tarefa** → já cria follow-up na Agenda para cada lead analisado
   - **Sugerir mensagem** → a IA escreve a mensagem; você **copia** e envia pelo chat
6. **Buscar** → a IA analisa cada conversa (leva uns minutos)

**Depois, por cada lead, VOCÊ decide:**
- ✅ **Criar tarefa** (se não criou no modo automático)
- 🗑️ **Dispensar** (sem interesse — some da lista)
- 📋 **Copiar mensagem** sugerida → colar no chat e enviar

**A IA só lê e sugere. Nada é enviado sem você copiar e colar.**

---

## 6. ④ Recuperar lead antigo (backfill)

**Quando usar:** o lead está mudo há **mais de 14 dias** e você quer que a régua tente de novo.

1. **Configurações → Follow-up sem resposta** (a régua precisa estar **ativa**)
2. Card **"Recuperar leads antigos"** → informe a janela: *"silêncio de até (dias)"* (ex.: 30)
3. **Recuperar agora** → confirme → verá *"N conversa(s) matriculada(s)"*

**O que acontece:** a 1ª tentativa é agendada **daqui a ~24h** (não de uma vez — sem rajada), e daí segue o ritmo normal da régua. Todos os filtros continuam valendo (opt-out, SDR IA ativo, horário comercial, card já em "Sem Resposta").

**Dica:** para resgatar **só um período específico**, olhe antes no Deal Inspector quem está no lote; o backfill é por janela de dias, não por data fixa.

---

## 7. Mapa de telas

| Tela | Rota | O que vive lá |
|---|---|---|
| **Configurações → Follow-up sem resposta** | `/settings?tab=noreply` | Ligar/desligar régua, mensagens, estágio destino, **backfill** |
| **Automações** | `/automations` | Card do **Watchdog** (ligar, dias, período) + regra "Oportunidade Parada" + **Histórico** de execuções |
| **Agenda** | `/agenda` | **Todas as tarefas** que você precisa trabalhar (filtro "Follow-ups") |
| **Pipeline** | `/pipeline` | Cards; estágio **"Sem Resposta"**; botão **Deal Inspector** |
| **Chat** | `/` | Badge da régua, faixa "Cancelar follow-up", todas as mensagens enviadas |
| **Contatos** | `/contacts` | Checkbox **opt-out** na edição do contato |

---

## 8. Cenários práticos — "estou em dúvida, o que faço?"

| Situação | O que você vê | Sua ação |
|---|---|---|
| O lead **respondeu** uma das mensagens da régua | Badge e faixa somem da conversa | **Responder e conversar** normalmente (a régua já parou) |
| O lead respondeu **depois** do card ir pra "Sem Resposta" | Card continua em "Sem Resposta" | **Mova o card de volta** para o funil e assuma a conversa |
| Régua esgotou (card em "Sem Resposta") | Tarefa "Lead sem resposta — revisar" na Agenda | Olhar a conversa → **mover de volta** (interessa) ou **Perdido/excluir** (não) → **Concluir** tarefa |
| Watchdog criou tarefa "Retomar contato" | Item na Agenda | **Abrir, conversar, concluir** |
| Lead disse "não me incomode mais" | — | Contatos → editar → marcar **opt-out** → a régua o exclui sozinha |
| Lead férias/tratamento delicado/pedido especial | Faixa na conversa | **Cancelar follow-up** na conversa |
| Lead antigo mudo há 1 mês, quero tentar | — | **Recuperar leads antigos** (backfill) |
| Quero entender por que 30 leads morreram | — | **Deal Inspector** com período de/até |
| Estou afogado em tarefas | Muitas na Agenda | Automações → Watchdog → defina **período de/até** para reduzir o escopo |
| Quer parar tudo **imediatamente** | — | Configurações → **Desativar régua** + Automações → Watchdog → **Desativar** |
| Quer ver o histórico do que rodou | — | Automações → regra "Oportunidade Parada" → **Histórico** |

---

## 9. Perguntas frequentes

**Vai mandar mensagem sem ninguém ver?**
Não. Tudo aparece como mensagem normal no chat, na hora. E só envia em horário comercial, respeitando fim de semana.

**E se o lead responder?**
A régua **para na instante** (em segundos). Quem assume é o humano — a IA não responde perguntas.

**Pode virar spam?**
Tem 4 travões: no máximo **1 mensagem por tentativa**, **3 tentativas** no total, **50 envios por execução** e **horário comercial**. Mais: se o SDR mandar uma mensagem manual, o relógio reinicia (sem zerar as tentativas).

**Por que meu lead antigo não recebeu nada pela régua?**
Porque ela cobre silêncios de até ~14 dias (anti-rajada). Use **Recuperar leads antigos** para janelas maiores.

**A tarefa duplica?**
Não. Uma por episódio de paralisia. Se o lead reagir e parar de novo, aí sim nasce outra — e é isso que queremos.

**O que acontece se eu desligar a régua?**
Congela: mensagens param, estados suspensos. Religar retoma. As tarefas já criadas continuam na Agenda.

**A IA vai escrever e enviar sozinha?**
Só a **análise** é da IA (Deal Inspector), e ela **nunca envia** — você copia. As mensagens da régua são **os seus textos** configurados.

**Quem é notificado quando algo esgota?**
O responsável pela oportunidade recebe a tarefa na Agenda; o card aparece em "Sem Resposta" no funil; e tudo fica registrado no histórico (Automações → Histórico).

**O SDR IA conflita com a régua?**
Não. Enquanto o SDR IA estiver ativo na conversa, a régua fica de fora automaticamente. Quando o SDR IA pausa (humano assumiu), a régua volta a valer.

---

## 10. Checklist de implantação (referência)

Já feito neste projeto ✅ — mantido aqui como registro:

- [x] Migration 057 (régua) aplicada — tabelas, estágio "Sem Resposta", cron 10 min
- [x] Migration 058 (watchdog) aplicada — cron horário, regra ativada
- [x] Migration 059 (backfill) aplicada — RPC com janela editável
- [x] Funções deployadas (runner, webhook, proxy, engine, inspector)
- [x] Frontend publicado (Vercel, 2 projetos)
- [x] Régua **ativada** · Watchdog **ativado** (mín. 3 dias, sem período)
- [x] Backlog inicial drenado: 618 tarefas, 0 duplicadas
- [ ] Suas ações pendentes: revisar textos da régua · decidir período do Watchdog · trabalhar a Agenda
