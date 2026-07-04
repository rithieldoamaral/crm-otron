# MEMORY.md — Contexto Completo do Projeto CRM Otron

> **Para qualquer nova sessão Claude:** leia este arquivo INTEIRO antes de começar qualquer tarefa.
> Ele substitui o histórico de conversa e contém tudo que foi construído, decidido e aprendido.
> Última atualização: 2026-06-20
>
> **⚠️ DEPLOY — LEIA ANTES DE TESTAR QUALQUER FIX:** o usuário roda o backend com `npm start`, que executa o código **COMPILADO** em `dist/server.js`. Toda alteração em arquivos `.ts` SÓ tem efeito após `cd backend && npm run build` (roda `tsc`). Se você corrigir algo e o usuário reiniciar sem rebuildar, o fix NÃO está rodando. Sempre instrua `npm run build` antes de `npm start`. (Causa de dois ciclos de "falhou de novo" em maio/2026.)

---

## 1. Quem é o Usuário

- **Perfil:** Empreendedor brasileiro, visão estratégica clara, sem background técnico profundo
- **Comunicação:** Português BR, respostas diretas ("não doure a pírula"), sem rodeios
- **Domínio:** Entende bem o negócio — WhatsApp Business, automação, agentes de IA, n8n
- **Público-alvo do produto:** Barbearias, salões de beleza, petshops, manicures, clínicas, mecânicas, escritórios

---

## 2. O que é o Projeto

**CRM Otron** — fork customizado do Whaticket SaaS v6.3.0, transformado em plataforma SaaS agêntica multi-tenant com IA própria.

- **Repositório:** `C:\Users\rithi\OneDrive\Documentos\Aplicativos\crm_otron\`
- **Backend:** `backend/` — Node.js + TypeScript + Sequelize + PostgreSQL 15 + Redis 7
- **Frontend:** `frontend/` — React 17 + Material UI
- **WhatsApp:** Baileys 7.x (reverse-engineered, risco de ban — mas decisão aceita pelo usuário)
- **Deploy alvo:** VPS Contabo (deploy manual documentado em `directives/`)

---

## 3. Stack Técnica

| Camada | Tecnologia |
|---|---|
| Backend runtime | Node.js + TypeScript |
| ORM | Sequelize v5 (legacy, manter compatibilidade) |
| Banco de dados | PostgreSQL 15 |
| Cache / Sessões | Redis 7 |
| WhatsApp | Baileys 7.x |
| Frontend | React 17 + Material UI |
| Testes | Jest + ts-jest |
| LLM providers | Anthropic, OpenAI, Groq, OpenRouter, MiniMax |
| Calendário | Google Calendar API (OAuth2) |

---

## 4. Módulos Implementados (estado atual: 2026-05-23)

### ✅ AgentService — Agente de Atendimento WhatsApp
- **Localização:** `backend/src/services/AgentService/`
- **Função:** Recebe mensagem do cliente via WhatsApp → loop agêntico → responde
- **Provider:** Multi-provider configurável (Anthropic, OpenAI, Groq, OpenRouter, MiniMax)
- **Config prioritária:** GlobalSettings (super admin) > Settings da empresa > defaults hardcoded
- **Modelo padrão:** `claude-haiku-4-5-20251001`
- **Max iterações:** 8 por turno
- **Contexto:** Histórico de conversa salvo no Redis por ticket (TTL 1h)
- **Compactação:** Ativa acima de 30 mensagens → LLM gera resumo → `applyCompaction` injeta como `role: "user"` com marker `[CONTEXTO ANTERIOR RESUMIDO]`
- **Segurança:** `sanitizeUserMessage` + `wrapUserMessage` (delimitadores) + `checkOutputSafety` (guardrail output)
- **Tools disponíveis:** buscar_contato, listar_servicos, verificar_disponibilidade, criar_evento, buscar_agendamento_cliente, cancelar_agendamento, reagendar_agendamento, transferir_para_humano, notificar_proprietario, buscar_proximo_horario, listar_pacotes_cliente, consumir_sessao_pacote, listar_pacotes_disponiveis
- **Canal dedicado:** flag `isAgentChannel` na tabela `Whatsapps`
- **Bug #32 (gate determinístico):** máximo 1 serviço diferente por turno em `verificar_disponibilidade` — bloqueia dump de múltiplos slots

### ✅ SecretaryService — Secretária IA (canal admin WhatsApp)
- **Localização:** `backend/src/services/SecretaryService/`
- **Função:** Responde ao proprietário/admin via WhatsApp — análises, relatórios, gestão
- **Autenticação:** número de WhatsApp do admin configurado nas Settings (`secretaryAdminNumber`)
- **Provider:** GlobalSettings (`globalSecretaryProvider/Key/Model`) > GlobalAgent > Settings empresa > defaults
- **Modelo padrão:** `claude-sonnet-4-6` (mais inteligente que o agente — análises complexas)
- **Canal dedicado:** flag `isSecretaryChannel` na tabela `Whatsapps`
- **Aceita áudio:** proprietário pode mandar mensagem de voz — transcrita via Whisper antes de chegar à secretária (ex: "fala pro dono do Totó que já pode buscar"). Sem criar ticket — usa `downloadMedia` direto + arquivo temporário.
- **7 Tools básicas:** listar_agendamentos_dia, listar_clientes, buscar_agendamento, criar_agendamento_manual, cancelar_agendamento, reagendar_agendamento, notificar_cliente
- **5 Tools financeiras (Fase 8):** finance_summary, finance_by_day, finance_by_weekday, finance_top_clients, finance_top_services
- **HARDENING (2026-06-21):** loop blindado ACIMA do Agente — agora loga TODA tool em `AgentActions` (auditoria + diagnóstico via `scripts/diag_agentactions.js`), try/catch por-tool, trata `finishReason=error`, fallback pseudo-XML, preserva `toolCalls` (corrigiu quebra de multi-step na OpenAI), MAX_ITERATIONS=8. Auth do admin normaliza JID/máscara (dígito-exato, fail-closed). Multi-tenancy auditada (todas as tools por companyId). `cancelar_agendamento` agora grava `status:"CANCELADO"` (paridade c/ Agente). **Gate DETERMINÍSTICO de destrutivas (concluído):** cancelar/reagendar/fechar/reabrir/transferir/enviar nunca executam direto — o loop estaciona (`pendingAction` tipo `confirm_tool`) e só executa após "sim" do admin (interceptor). **Injeção de 2ª ordem (concluído):** `neutralizeInjectionMarkers` (securityGuards) sanea TODO tool result antes do LLM. 77 suítes / 1252 testes verdes.

### ✅ GoogleCalendarService — Agendamentos sincronizados
- **Localização:** `backend/src/services/GoogleCalendarService/`
- **Função:** Verifica disponibilidade e cria eventos no Google Calendar dos profissionais
- **OAuth2:** Por profissional (tabela `UserCalendar`, tokens AES-256 criptografados)
- **Models novos:** Service, ServiceProfessional, UserCalendar, UserWorkingHours
- **Migrations:** 20260421000002 até 00006
- **Cron:** Check a cada 5min para lembretes de agendamento (SIM/NÃO via Redis)
- **Pendente:** Aplicar migrations no servidor de produção + configurar variáveis no .env de produção

**Módulos puros (determinísticos, 100% testáveis — base da blindagem de 2026-05/06):**
- `availabilityEngine.ts` — cálculo de slots livres. Funções: `calculateAvailableSlots` (slotInterval = `duration ≤ 30 ? 30 : 60` → sempre hora cheia/meia-hora, Bug #38), `subtractBusyPeriods`, `filterPastSlots` (não oferece slot no passado, Bug #12), `normalizePeriod` + `filterSlotsByPeriod` (manhã/tarde/noite determinístico, Bug #35), `slotsToRanges` (slots → faixa "das 12:00 às 18:00", Feature UX-1/Bug #39)
- `timezone.ts` — `brtWallClockToInstant(data, hora)` + `BRT_OFFSET="-03:00"` (Brasil sem DST). Garante que "14:00" sempre vire o instante BRT correto mesmo em servidor UTC (Bug #36)

**Tools e suas garantias determinísticas:**
- `verificar_disponibilidade`: devolve por profissional `rangeFormatado` (faixa) + `horariosDisponiveis` (contagem). **NÃO devolve mais a lista `slots` ao LLM** de propósito (gpt-4o-mini despejava horário por horário) — Bug #39. Aceita `periodo`. **Aceita `hora` (round 12, 2026-06-20):** quando o cliente pergunta horário específico ("tem às 11h?"), devolve `horaConsultadaDisponivel` (true/false) + `horaDisponivel` por profissional — resposta determinística (antes o LLM não sabia se 11h cabia na faixa e dizia "não consegui verificar"). Devolve também `dataFormatada` ("segunda-feira, 22/06/2026")
- `buscar_proximo_horario`: próximo horário livre a partir de HOJE; aceita `periodo`
- `criar_evento`: valida no write path → não-passado (Bug #13), anti-duplicata PENDENTE/ENVIADA (Bug #8/#15/#24), instante BRT (Bug #36), e **disponibilidade real** (expediente + agenda livre, Bug #39 — única barreira contra double-booking já que o LLM não recebe mais os slots; `fail-open` em erro do Google)
- `reagendar_evento`: cancel+create atômico (create→delete→update, Bug #16), preserva o serviço original. **VALIDA disponibilidade do novo horário** (Bug #41, fechado 2026-05-31). Round 13 (2026-06-20): ganhou guarda de passado (paridade com criar) + guarda de status CANCELADO (recusa remarcar cancelado) + datas em linguagem natural nas mensagens

**Robustez do agente no fluxo de calendário (em `AgentService/index.ts`):**
- **Injeção determinística de período (Bug #37):** se o cliente diz "à tarde" e o LLM esquece de passar `periodo`, o orquestrador extrai de `normalizePeriod(sanitizedMessage)` e injeta no tool call
- **Contexto de serviço em refinamento (Bug #40):** `buildLastServiceBlock` cobre refinamentos ("e a tarde?", "e amanhã?") → usa o mesmo serviço, proibido re-perguntar. Regra 11 tem exceção quando já há serviço em discussão

### ✅ ServiceCatalogService — Catálogo de Serviços (Fase 5)
- **Localização:** `backend/src/services/ServiceCatalogService/`
- **Função:** CRUD de serviços com preço, duração, profissionais associados
- **Models:** Service, ServiceProfessional (tabelas existentes do Google Calendar)
- **Endpoints:** `/service-catalog` (GET, POST, PUT/:id, DELETE/:id)

### ✅ PackageService — Pacotes de Serviços (Fase 6)
- **Localização:** `backend/src/services/PackageService/`
- **Função:** Pacotes de sessões pré-pagas (ex: "10 sessões de depilação")
- **Models novos:** Package, ClientPackagePurchase, PackageConsumption
- **Migrations:** criar estas 3 tabelas
- **Proteção:** Mutex via transaction + LOCK.UPDATE em consumeSession (evita race condition)
- **Frontend:** Página `/packages` com listagem de pacotes e compras por cliente
- **Tools do Agente:** listar_pacotes_disponiveis, listar_pacotes_cliente, consumir_sessao_pacote

### ✅ FinanceService — Analytics Financeiro (Fase 7)
- **Localização:** `backend/src/services/FinanceService/`
- **Função:** KPIs de receita, tendências, top clientes, top serviços
- **Bug crítico corrigido:** timezone em `applyDateRangeDefaults` (endDate "YYYY-MM-DD" virava T00:00:00Z perdendo o dia inteiro — fix: estender para T23:59:59.999Z)
- **Endpoint:** `/finance/*` (summary, byDay, byWeekday, topClients, topServices)
- **Frontend:** Página `/finance` com KPI cards + gráficos Recharts

### ✅ GlobalSettings — Configurações Globais de Plataforma (2026-05-23)
- **Localização:** `backend/src/models/GlobalSetting.ts`, `backend/src/services/GlobalSettingsService/`
- **Função:** Settings a nível de plataforma (sem companyId), controladas pelo super admin
- **Migration:** `20260523000001-create-GlobalSettings.ts`
- **Chaves configuradas:**
  - `globalAgentProvider` / `globalAgentApiKey` / `globalAgentModel` — LLM do Agente de Atendimento
  - `globalSecretaryProvider` / `globalSecretaryApiKey` / `globalSecretaryModel` — LLM da Secretária IA
  - `globalWhisperProvider` / `globalWhisperApiKey` / `globalWhisperModel` — Whisper (transcrição de áudio)
- **API:** `GET /global-settings` + `PUT /global-settings` — ambas protegidas por `isAuth + isSuper`
- **Segurança:** API keys mascaradas com `"••••"` no GET (`globalAgentApiKey`, `globalSecretaryApiKey`, `globalWhisperApiKey`); sentinel `"••••"` ignorado no PUT
- **Cache:** TTL 30s, `invalidateGlobalCache()` chamada imediatamente após `upsertMany()`

### ✅ contextCompactor — Compactação de Contexto do Agente (2026-05-23)
- **Localização:** `backend/src/services/AgentService/contextCompactor.ts`
- **Função:** Funções puras (sem I/O) para compactar histórico de conversa longo
- **Threshold:** 30 mensagens → dispara compactação
- **Estratégia:** Mantém últimas 10 mensagens + resume o restante via LLM → `role: "user"` com marker
- **Funções exportadas:** `shouldCompact`, `extractTextContent`, `buildCompactionContext`, `applyCompaction`, `estimateTokenCount`
- **Falha segura:** erro na compactação → loga + continua com histórico original (não bloqueia atendimento)

---

## 5. Arquitetura de Settings (Prioridade em Cascata)

```
GlobalSettings (super admin, plataforma inteira)
    ↓ (fallback se não configurado)
Settings da empresa (companyId)
    ↓ (fallback final)
Defaults hardcoded no código
```

**Regra:** companyId SEMPRE vem do JWT (`req.user.companyId`), NUNCA do body da requisição.

---

## 6. Frontend — Telas e Abas

### `/settings` — SettingsCustom
- **Opções** (todos os usuários): configurações gerais da empresa
- **Agente IA** (todos): personalidade, FAQ, restrições, instruções de tom de voz — SEM aba de Provedor para usuários comuns
- **Serviços** (todos): catálogo de serviços
- **Calendário** (todos): Google Calendar OAuth
- **Horários** (condicional: se `scheduleType = "company"`)
- **Logo** (super apenas): upload de logotipo
- **Empresas** (super apenas): listagem de empresas
- **Cadastrar Empresa** (super apenas): formulário nova empresa
- **Planos** (super apenas): planos SaaS
- **Ajuda** (super apenas): conteúdo de ajuda
- **Integrações** (super apenas): configuração de LLMs globais (Agente + Secretária)

### `/finance` — Página Analytics
- KPI cards (receita total, ticket médio, serviços vendidos, sessões de pacote)
- Gráfico receita por dia + por dia da semana
- Top clientes + Top serviços

### `/packages` — Pacotes de Serviços
- Listagem de pacotes disponíveis
- Compras por cliente (com consumo de sessões)

### AgentSettings — Aba "Agente IA"
- **Sub-abas:** Provedor (super apenas), Personalidade, Conhecimento, Secretária IA, Sandbox
- **Aba Personalidade:** dropdown de personalidade (atencioso/vendedor/híbrido) + TextField "Tom de Voz / Instruções Personalizadas"
- **Aba Provedor:** oculta para usuários não-super (LLM controlado pelo super admin via Integrações)
- **Aba Áudio removida:** Whisper passou a ser configuração global — está na aba Integrações do super admin

### IntegrationSettings — Aba "Integrações" (super apenas)
- **Três painéis:** LLM Agente de Atendimento + LLM Secretária IA + Whisper (Transcrição de Áudio)
- Por painel LLM: dropdown de Provedor (5 opções), API Key mascarada, seletor de Modelo + botão Refresh
- Painel Whisper: dropdown Provedor (OpenAI/Groq), API Key mascarada, seletor de Modelo + Refresh
- Aviso de impacto global (afeta TODAS as empresas)
- PUT `/global-settings` ao salvar

---

## 7. Regras Críticas de Segurança (INVIOLÁVEIS)

1. **companyId SEMPRE do JWT** (`req.user.companyId`) — nunca do body
2. **Multi-tenancy:** toda query no banco filtra por `companyId`
3. **Admin check:** `if (req.user.profile !== "admin") throw new AppError("ERR_NO_PERMISSION", 403)`
4. **Super check:** middleware `isSuper` na rota (NÃO duplicar no controller)
5. **Secrets nunca no frontend:** API keys ficam só no backend
6. **`catch` silencioso é proibido:** toda exceção capturada deve ser logada com contexto
7. **API keys em GlobalSettings:** mascaradas com "••••" no GET; sentinel ignorado no PUT

---

## 8. Padrões de Código Estabelecidos

### Separação de responsabilidades
- **`*.utils.ts` / `contextCompactor.ts`:** funções puras sem I/O — testáveis isoladamente
- **`settingsCache.ts`:** cache em memória TTL-30s para Settings — `clearSettingsCache()` em `beforeEach` nos testes
- **Controllers:** apenas fazem a ponte HTTP ↔ Service, sem lógica de negócio
- **Middleware de rota** (`isAuth`, `isSuper`): guards aplicados na rota, não duplicados no controller

### TDD obrigatório
- Teste ANTES do código de produção
- Suite completa (`npx jest --forceExit`) antes de declarar "pronto" — 1069 testes passando (2026-05-23)
- Ao mockar novo model Sequelize em testes, sempre adicionar `jest.mock("../../../models/NomeModel")` + `(NomeModel.findAll as jest.Mock).mockResolvedValue([])` no `beforeEach`

### Commits
- Formato: `[TIPO] descrição breve` (FEATURE, BUGFIX, REFACTOR, TEST, DOCS, PERF, SECURITY)
- Nunca commitar `.env`, credenciais, API keys
- Cada fix = menor mudança necessária (CLAUDE.md §II.6)

---

## 9. Tech Debt Documentado (pendente)

| Item | Prioridade | Estimativa | Notas |
|---|---|---|---|
| ~~Validação de disponibilidade no `reagendar_evento`~~ | ~~Alta~~ | — | ✅ FECHADO (Bug #41, 2026-05-31). A memória estava errada; o código já validava |
| ~~Validação profissional↔serviço no `reagendar_evento`~~ | ~~Baixa~~ | — | ✅ FECHADO (round 13, 2026-06-20). Valida vínculo quando `novoAtendenteId` troca o profissional |
| Fila persistente Bull/Redis para mensagens do agente | Alta | 1-2 dias | Sem ela, restart em pico = perda de mensagens em voo |
| Migração de limpeza: remover `promptId`, tabela `prompts`, `QueueIntegrations` | Média | 1 dia + 5min downtime | Colunas FK ainda existem nos models core |
| `Contact.notes` — campo de memória cross-session do agente | Média | Migration nova | Agente perderia memória entre tickets diferentes; Contact model não tem `notes` hoje |
| Cache de `getBusyPeriods` (Google Calendar) TTL-30s | Média | Algumas horas | Reduz latência percebida |
| Rate limit handling explícito Anthropic 429 | Baixa | Algumas horas | SDK cobre com `maxRetries: 2`; monitorar em produção |
| Refactor `wbotMessageListener.ts` (4137 linhas) | Baixa | 2-3 dias | Alto risco, baixa urgência |
| Sequelize v5 → v6 migration | Baixa | 1 semana | Sem impacto funcional imediato |

---

## 10. Variáveis de Ambiente Necessárias (.env)

```env
# Banco e cache
DATABASE_URL=postgresql://user:pass@localhost/crm_otron
REDIS_URI=redis://localhost:6379

# Segurança
JWT_SECRET=...
CALENDAR_TOKEN_SECRET=...   # AES-256 para tokens Google Calendar

# Google Calendar
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://seudominio.com/google-calendar-callback

# LLMs (opcional — preferir GlobalSettings via painel)
# Se não configurado no painel, o agente usa o provider padrão Anthropic
```

**Nota:** As API Keys de LLM são configuradas pelo super admin diretamente no painel (aba Integrações → GlobalSettings), não via `.env`. Isso facilita troca sem restart do servidor.

---

## 11. Como Rodar os Testes

```bash
cd backend

# Suite completa (obrigatório antes de declarar qualquer coisa "pronto")
npx jest --forceExit

# Suite específica
npx jest --testPathPattern="AgentService.spec" --forceExit

# TypeScript check
npx tsc --noEmit
```

**Estado atual:** 76 suítes, **1211 testes**, todos passando (2026-06-20). Sempre rodar com `--forceExit` (há open handles benignos) e, em runs grandes, `NODE_OPTIONS=--max-old-space-size=4096` para evitar OOM do V8 no Windows.

---

## 12. Estado Atual e Próximos Passos

### O que foi feito na última sessão (2026-06-20) — Blindagem round 13 (auditoria do write-path)

Auditoria sênior das tools de escrita (criar/reagendar/cancelar). **O Bug #41 já estava fechado** — a memória estava errada (corrigida). 5 furos reais corrigidos (detalhes em `decisions_log.md`/`CHANGELOG.md`):
1. **`buscar_agendamento_cliente` mostrava hora 3h errada em produção** (formatava sem fuso → UTC). Fix: BRT explícito + `dataISO` + `dataFormatada`.
2. `reagendar_evento` sem guarda de passado → adicionada (paridade com criar).
3. `reagendar`/`cancelar` sem guarda de CANCELADO → reagendar recusa; cancelar virou idempotente.
4. `criar_evento` não validava profissional↔serviço → valida `ServiceProfessional` (anti-hallucination de atendenteId, classe Bug #8).
5. Datas ISO cru nas mensagens → `formatDateWithWeekdayBRT` (linguagem natural).

**Validação:** tsc limpo, 76 suítes / 1211 testes, `dist/` recompilado.

### O que foi feito antes nesta data (2026-06-20) — Blindagem round 12 (dia da semana + horário específico)

Dois furos recorrentes reportados com print real. Causas-raiz e fixes (todos determinísticos) em `decisions_log.md` e `CHANGELOG.md`. Resumo:

1. **Dia da semana — agente se esquivava** ("recomendo conferir no seu calendário"): a regra 8 do prompt (Bug #5) PROIBIA mencionar o dia da semana, mas a tabela `buildWeekCalendar` (mai/2026) já tinha o dado correto — a regra ficou obsoleta/contraditória. Fix: `formatDateWithWeekdayBRT` (pura, em `availabilityEngine.ts`) → tools devolvem `dataFormatada` ("segunda-feira, 22/06/2026"); regra 8 reescrita + regra 16 (usar dia da semana de dado pronto, nunca calcular).
2. **"Tem horário para as 11h?" → "não consegui verificar"**: (2a) o Bug #39 removeu a lista de slots, então o LLM não tinha como responder horário exato; (2b) faltava âncora de DATA. Fix 2a: `verificar_disponibilidade` aceita `hora` → `horaConsultadaDisponivel` determinístico + injeção de `hora` no orquestrador (`extractTimeFromMessage`, espelha Bug #37) + regra 15. Fix 2b: `extractLastDiscussedDate` + `buildLastDateBlock` (âncora de data, análogo ao serviço Bug #40).

**Validação:** tsc limpo, 76 suítes / 1205 testes passando, `dist/` recompilado.

**Nota sobre arquitetura:** `formatDateWithWeekdayBRT` ficou em `GoogleCalendarService/availabilityEngine.ts` (não em `agentUtils`) para evitar ciclo de dependência entre as pastas — AgentService já importa de availabilityEngine.

### O que foi feito nas sessões anteriores (2026-05-28 a 2026-06-01) — Blindagem do módulo de Calendário

Auditoria + correção de causa-raiz do agendamento, motivada por falhas reais reportadas pelo usuário ("não consegui verificar a tarde", horários quebrados, agente re-perguntando o serviço). Detalhes completos em `decisions_log.md` e `CHANGELOG.md`. Resumo dos 6 fixes (todos determinísticos — CLAUDE.md §I):

1. **Bug #35 — período do dia:** filtro manhã/tarde/noite movido do LLM para o backend (`normalizePeriod` + `filterSlotsByPeriod` em `availabilityEngine.ts`)
2. **Bug #36 — fuso no write path:** `timezone.ts` (`brtWallClockToInstant`, offset BRT fixo) — `criar`/`reagendar` não criam mais evento 3h adiantado em servidor UTC
3. **Bug #37 — injeção determinística de período:** orquestrador injeta `periodo` quando o gpt-4o-mini esquece de passar. **Descoberto aqui o problema do `dist/` defasado** (ver aviso no topo deste arquivo)
4. **Bug #38 — horários quebrados:** `slotInterval` agora ancora em hora cheia/meia-hora (era a duração do serviço → 12:52, 13:50…)
5. **Bug #39 — faixa em vez de lista + validação no `criar_evento`:** `verificar_disponibilidade` devolve `rangeFormatado` (sem a lista `slots`); `criar_evento` ganhou validação determinística de disponibilidade (anti double-booking)
6. **Bug #40 — contexto de serviço em refinamento:** agente não re-pergunta o serviço ao ouvir "e a tarde?"

**Validação final:** tsc limpo, 76 suítes / 1172 testes passando, `dist/` recompilado.

### Tech debt aberto desta frente

- **`reagendar_evento` sem validação de disponibilidade** (futuro Bug #41) — ver tabela na seção 9. Há um chip de tarefa criado para isso.

### Possíveis próximos passos (não confirmados pelo usuário)

- Corrigir o Bug #41 (validação no reagendar)
- Aplicar as migrations novas no servidor de produção (Contabo) e configurar `.env`
- Continuar validando o agente em produção com casos reais de agendamento
- Módulo de marketing agêntico (premium) — análise de concorrentes, copywriting, gestão de tráfego

### Nota sobre handoff de conta (2026-06-01)

O usuário trocou de conta Claude (mesmo PC, mesmas pastas). A auto-memória anterior (específica da conta) não migra — TODO o contexto durável está nos arquivos do projeto: este `MEMORY.md`, `decisions_log.md`, `CHANGELOG.md`, `README.md` e `CLAUDE.md`. Comece sempre lendo este arquivo.

---

## 12.1 Diagnóstico de comportamento agêntico (IMPORTANTE)

- **A fonte de verdade para depurar o Agente é a tabela `AgentActions`** (tool + parâmetros + resultado, por turno). Bug agêntico NÃO se diagnostica por teste mockado — mock sempre passa args válidos. Em jun/2026 três hipóteses erradas foram feitas antes de olhar os dados; a causa real (modelo alucina `servicoId` inexistente + gate Bug#32 contava a chamada falha e bloqueava a correta) só apareceu no `AgentActions`.
- Script pronto: `node backend/scripts/diag_agentactions.js <ticketId> [limit]` (lê `.env`, read-only).
- **O `SecretaryService` NÃO loga em `AgentActions`** — tech debt: sem isso, não dá pra diagnosticar a Secretária por dados (adicionar antes de confiar nela em produção).
- **Gotcha de modelo:** a Secretária herda o modelo do Agente por cascata (`globalSecretaryModel ?? globalAgentModel ?? ...`). Se só `globalAgentModel` estiver setado (ex: gpt-4o-mini), a Secretária roda gpt-4o-mini também — NÃO o Sonnet do default. Para análise/financeiro a Secretária precisa de modelo forte: setar `globalSecretaryModel` dedicado.
- **gpt-4o-mini** aluciná `servicoId` em praticamente todo fluxo de disponibilidade e pula confirmação. Os guard-rails determinísticos tornam isso não-fatal, mas a recomendação é trocar o Agente para Claude Haiku 4.5 (mesma faixa de custo, muito mais preciso em tool-calling).

## 13. Regras de Trabalho (APLICAR SEMPRE)

- ✅ Teste ANTES do código (TDD)
- ✅ Suite completa antes de declarar "pronto" (`npx jest --forceExit`)
- ✅ Causa raiz ANTES do fix (perguntar "por quê" 3x)
- ✅ Mínima mudança necessária — sem refactor junto com bugfix
- ✅ `decisions_log.md` e `CHANGELOG.md` atualizados após mudanças
- ✅ `catch` silencioso proibido — toda exceção logada com contexto
- ✅ companyId sempre do JWT, nunca do body
- ❌ Código sem teste
- ❌ Arquivos monolíticos
- ❌ Secrets no frontend ou commitados
- ❌ `assertSuper` no controller se já tem middleware `isSuper` na rota (duplicação)
