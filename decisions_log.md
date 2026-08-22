# Log de Decisões Arquiteturais

Registro de decisões técnicas e de produto com justificativas.
Formato: Data | Decisão | Motivo | Alternativas descartadas

---

## 2026-08-19 — Incidente de produção: frontend com `REACT_APP_BACKEND_URL` vazio (build-time vs runtime env var)

**Contexto:** durante um deploy manual (atualização do CRM para a última versão do GitHub, antes de `scripts/deploy.sh` existir), o rebuild dos containers foi rodado como `docker compose -f docker-compose.prod.yml up -d --build`, sem `--env-file .env.production`. O `docker compose` sem esse flag lê `.env` (que não existe neste projeto — as credenciais reais vivem em `.env.production`), então toda variável do `docker-compose.prod.yml` interpolada via `${VAR}` resolveu para string vazia.

**Sintoma reportado pelo usuário:** "https://crm.otron.tech/ está dando vários erros". O frontend em si carregava (HTTP 200), mas a aplicação React entrava em loop de erro.

**Causa raiz (3 níveis, não parou no sintoma):**
1. Por que a página dá erro? → chamadas de API (logo, login, refresh de sessão) iam para `crm.otron.tech` em vez de `api.otron.tech`.
2. Por que iam para o domínio errado? → o bundle JS compilado (`main.*.js`) não continha a string `api.otron.tech` em lugar nenhum — confirmado com `grep -c` no bundle servido.
3. Por que a URL não estava no bundle? → `REACT_APP_BACKEND_URL` é um **build ARG** do Create React App (`frontend/Dockerfile`), não uma env var lida em runtime pelo Nginx que serve os arquivos estáticos depois. Ele é resolvido e congelado no JS **no momento do `docker build`**. Como o build rodou sem `--env-file`, `${BACKEND_URL}` (usado em `docker-compose.prod.yml:112` como valor do build arg) resolveu vazio, e o CRA compilou `${undefined}/public/logotipos/...` → caminho relativo ao próprio domínio do frontend.

**Por que passou despercebido no momento do build:** o build em si não falha — `npm run build` completa normalmente com a env var vazia, só produz um artefato semanticamente errado. Não há erro de compilação, só comportamento errado em runtime. Nenhum teste do CI cobre isso (é uma variável de infraestrutura de deploy, não lógica de negócio).

**Fix aplicado:**
1. Rebuild do frontend com `docker compose -f docker-compose.prod.yml --env-file .env.production build frontend` (build isolado, sem afetar backend/postgres/redis já saudáveis).
2. `docker compose ... up -d frontend` para recriar o container com a imagem nova.
3. Validação real (não só assumida): bundle novo (`main.4302ef6b.js`, hash diferente do anterior `main.afa9ec0c.js`) contém `api.otron.tech`; `curl https://api.otron.tech/public/logotipos/interno.png` → 200; CORS liberando `https://crm.otron.tech` como origin; logs do nginx sem mais o padrão de retry em loop.

**Prevenção estrutural (não é só "lembrar da próxima vez"):** `scripts/deploy.sh` (commit `d4c5365`) agora é o único caminho suportado de deploy e SEMPRE roda `up -d --build` com `--env-file .env.production` explícito — a classe inteira de bug (esquecer o env-file, seja pro backend em runtime ou pro frontend em build-time) fica estruturalmente impossível pelo fluxo normal. Documentado também no `CLAUDE.md` Seção VI.6 como regra geral (build-time vs runtime), não só como nota deste incidente.

**Lição (anti-repetição):** em builds multi-stage com CRA/Vite, "a env var está no `.env.production`" não é suficiente — ela só chega ao bundle final se (a) o comando de build recebeu o `--env-file`/`--build-arg` explicitamente E (b) o `Dockerfile` declara `ARG` + `ENV` para repassar ao processo de build. Runtime env var (lida por `process.env` num backend Node) e build-time env var (congelada no bundle por um bundler) são duas categorias diferentes de bug — um `docker compose up -d` sem rebuild nunca corrige a segunda, mesmo com o env-file certo depois.

---

## 2026-07-26 — Endurecimento anti-banimento enquanto operamos via Baileys

**Contexto:** o usuário pretende obter a licença de integrador oficial da Meta no futuro (processo burocrático: página oficial, comprovação de empresa), mas vai operar com a Baileys (API não-oficial) até lá. Pediu três frentes de mitigação e, no ponto 3, pediu explicitamente para ser consultado antes da execução.

**Pesquisa (ponto 3) — sinais de detecção confirmados:** taxa de resposta abaixo de 10%, distância no grafo de contatos (mensagens a desconhecidos), padrões temporais robóticos, contagem de mensagens não respondidas (adicionado em 2026), volume sem aquecimento de número novo, presença online 24/7 e fingerprint de navegador. Já estávamos cobertos em dois: `markOnlineOnConnect: false` e `Browsers.appropriate("Desktop")`.

**Decisão do usuário (consultado via AskUserQuestion):** implementar apenas o **jitter aleatório** agora; **não** implementar rate limit global, pausa noturna nem rampa de aquecimento nesta rodada. Para a API externa, escolheu **bloquear para não-super**. As três medidas não escolhidas ficam registradas como tech debt consciente, não como esquecimento.

**Por que o gate ficou no BACKEND e não só no menu:** o pedido literal foi "ocultar as abas". Mas o objetivo declarado era impedir que clientes disparem em massa. Esconder o menu deixa `/campaigns` acessível por URL direta e a API de campanha aberta a qualquer JWT autenticado — seria fachada, não mitigação. Implementado `isSuper` nas 4 rotas de campanha + frontend alinhado (menu, rotas via nova prop `isSuper` no wrapper `Route`, e paleta de comandos via flag `superOnly`).

**Middleware novo (`isSuperCompany`) — por que não reusar `isSuper`:** `/api/messages/send` autentica por token da conexão WhatsApp (`tokenAuth`), não por JWT. Não existe `req.user`, então o `isSuper` padrão quebraria. O novo resolve identidade por token → Whatsapp → companyId → a empresa tem algum usuário `super`? Só a empresa do dono da plataforma tem.

**Calibração do delay de digitação (ponto 2):** a fórmula anterior (`min(1500 + len*15, 5000)`) entregava 15ms/char ≈ 4.000 WPM — sobre-humano — e era determinística. Novo: 160ms/char (≈47 WPM, atendente treinado) + 1.200ms de leitura, jitter ±30%, piso 2s, teto 25s. Escolhido **Bates (média de 2 uniformes)** em vez de gaussiana real porque Bates é *limitada*: uma gaussiana geraria outliers de 3-sigma com esperas absurdas.

**Renovação do "digitando...":** consequência obrigatória de aumentar o delay. O indicador expira em ~10s no WhatsApp; sem renovar a cada 8s, uma espera de 25s faria o indicador sumir e a mensagem surgir do nada — padrão mais suspeito que o original. Não é feature extra, é o que torna a mudança coerente.

**Secretária incluída:** respondia instantaneamente e sem presence. Mesmo conversando só com o dono da empresa, para a Meta é apenas mais um chat.

**Efeito colateral aceito:** a tela de gerenciamento de Respostas Rápidas (`/quick-messages`, dentro de "Avançado") ficou restrita ao super admin. Verificado que as respostas rápidas continuam utilizáveis por todos dentro do chat (atalho `/` em `MessageInputCustom`) — perde-se só o CRUD, não o uso.

**Limite reconhecido:** nada disso impede o banimento, apenas reduz a probabilidade. A pesquisa é consistente em que a detecção é heurística/ML e não-determinística (contas idênticas podem durar semanas ou meses). A solução real é a API oficial.

---

## 2026-07-26 — DeepSeek/Qwen como provedores; correção de gap no MiniMax; Qwen-ASR

**Contexto:** usuário pediu para adicionar DeepSeek e Qwen como provedores de LLM (barateando o custo do agente de atendimento, ver análise de custo da mesma sessão) e perguntou se o botão "atualizar modelos" (já existente) puxaria os modelos de todos os provedores automaticamente. Também pediu para verificar se a DeepSeek tem API de transcrição de voz (hoje usamos OpenAI) e, se sim, garantir a mesma capacidade de atualização para voz.

**Descoberta ao investigar (antes de implementar):**
1. `modelFetcher.ts` (o botão "atualizar modelos") **não tinha entrada para MiniMax** — mesmo o MiniMax já funcionando para chat via `AIProviderFactory`, o botão falhava silenciosamente e sempre caía no fallback estático do frontend. Bug pré-existente, não relacionado ao pedido, mas direto no caminho do que "garantir para todos os provedores" exige — corrigido.
2. `PROVIDER_BASE_URLS.minimax` apontava para `api.minimax.chat` — domínio que não corresponde à documentação oficial atual (`api.minimax.io`). O modelo padrão `abab6.5s-chat` também é de uma geração anterior (atual: M2/M2.5/M2.7/M3). Ambos corrigidos.
3. **A alegação do usuário sobre transcrição da DeepSeek é FALSA** — verificado em múltiplas fontes (incluindo repositórios de voice-agent construídos sobre a DeepSeek): não existe endpoint de STT/transcrição na API da DeepSeek. A comunidade recomenda emparelhar a DeepSeek (só texto) com um serviço de STT de terceiro. Reportado ao usuário; **não implementado** (implementar seria fabricar um recurso que não existe).
4. **Qwen tem uma API de ASR real** (Qwen3-ASR-Flash, via Alibaba Cloud Model Studio/DashScope), mas com um contrato de chamada fundamentalmente diferente do Whisper: não é multipart `/audio/transcriptions`, é uma chamada JSON para `/chat/completions` com o áudio embutido em base64 numa mensagem `type: "input_audio"`. Implementado como função própria (`transcribeWithQwenASR`) em vez de reaproveitar o SDK `openai` (que só fala o protocolo multipart).
5. **MiniMax: NÃO adicionado à transcrição.** A documentação oficial encontrada (`platform.minimax.io/docs/api-reference/speech-t2a-http`) cobre apenas Text-to-Speech (T2A) — o oposto do que precisamos. Não há endpoint de ASR/STT documentado e verificável. Uma issue aberta em um projeto de terceiros pedindo essa funcionalidade sugere que, se existir, não é pública/estável o suficiente para confiar em produção. Decisão: não fabricar suporte não verificado.

**Por que Qwen usa o endpoint internacional (Singapura) do DashScope:** `dashscope-intl.aliyuncs.com`, não `dashscope.aliyuncs.com` (China mainland) — chaves de API das duas regiões não são intercambiáveis, e o usuário/clientes operam fora da China.

**Trade-off aceito:** `LLM_FILTER.qwen` filtra por substring (exclui `asr`/`tts`/`embedding`/`rerank`) em vez de uma lista de allowlist exata, porque o catálogo real de modelos da DashScope não foi verificado ao vivo (sem chave de API disponível nesta sessão). Se o filtro deixar passar algo inesperado, o pior caso é um item extra no dropdown — degradação graciosa, consistente com o padrão já usado para OpenAI/Groq.

---

## 2026-07-12 — Rastreamento de erros: GlitchTip self-hosted em vez de Sentry SaaS

**Contexto:** usuário perguntou se o backend registra erros "de forma otimizada, mostrando o porquê da falha, para todos os clientes". Investigação encontrou o SDK `@sentry/node` já integrado em 51 pontos do código (`Sentry.captureException`) e um handler global de erros no Express — mas `SENTRY_DSN` nunca foi definido em nenhum `.env`, ou seja, todo esse código captura erros e os descarta silenciosamente (SDK em modo no-op sem DSN). Mais um caso do padrão "infra construída, nunca ligada" (ver entrada anterior sobre `dbLog()`).

**Decisão:** oferecidas 3 opções (Sentry SaaS gratuito, GlitchTip self-hosted, ou não fazer nada agora). Usuário escolheu **GlitchTip self-hosted** — open source, compatível com o SDK do Sentry (mesmo protocolo/DSN), sem mensalidade, rodando na própria VPS.

**Por que não precisou tocar nos 51 call sites:** em vez de marcar `companyId` em cada `Sentry.captureException()` espalhado pelo código, a marcação foi centralizada em `isAuth.ts` (middleware por onde toda requisição autenticada passa) — `Sentry.setTag("companyId", ...)` logo após decodificar o JWT. O Sentry propaga esse escopo para toda a requisição, então qualquer captura de erro feita depois (nos 51 pontos já existentes) sai automaticamente marcada por empresa, sem precisar editar cada um.

**Escopo entregue nesta sessão:** (1) código de marcação por `companyId`/`userId` em `isAuth.ts` com 3 testes; (2) `docker-compose.glitchtip.yml` (stack isolado — banco/redis próprios, não compartilha com o CRM); (3) `nginx/sites/glitchtip.conf.example` (subdomínio `errors.seudominio.com.br` com SSL, mesmo padrão do `crm.conf`); (4) seção "Rastreamento de Erros" no `DEPLOY_DOCKER_HOSTINGER.md` com passo a passo leigo completo; (5) `.env.glitchtip.example` + entradas no `.gitignore`.

**O que NÃO foi feito agora (deliberado):** a instalação real do GlitchTip na VPS. Usuário pediu para "planejar e informar como instalar no futuro" — ainda não migrou para a Hostinger. `SENTRY_DSN` fica vazio no `.env.example`/`.env.production` até lá; enquanto vazio, o SDK permanece em no-op (nenhuma mudança de comportamento hoje).

**Alternativa descartada:** log simples em arquivo (redirecionar o `pino` pra um arquivo na VPS, sem software novo) foi a primeira recomendação dada — mais barata e suficiente pro volume atual de clientes. Usuário preferiu o caminho open-source/self-hosted mesmo assim, optando por robustez (agrupamento de erros repetidos, alertas automáticos) em vez da solução mínima.

---

## 2026-07-11 — Calendário ativo como sinal de "empresa faz agendamento"

**Contexto:** nem todo comércio trabalha com hora marcada. A regra dura "SEMPRE chame listar_servicos" + fluxo de agendamento eram sempre injetados, fazendo o agente empurrar agendamento mesmo para quem não agenda.

**Decisão:** usar a presença de ao menos um `UserCalendar` ativo (`isActive:true`) da empresa como o interruptor determinístico. `companyHasActiveCalendar(companyId)` no `knowledgeBuilder`; se true, injeta os blocos de agendamento (comportamento atual); se false, injeta bloco "NÃO trabalha com agendamento" e omite a regra dura.

**Por que o calendário (e não uma nova flag/Setting):** o usuário pediu explicitamente que a sincronização de calendário fosse a referência. Vantagem: zero configuração extra — conectar/desconectar o Google Calendar já liga/desliga o modo. Menos um Setting para o dono entender.

**Compatibilidade:** ambas as empresas de teste (Otron CRM e Bomma) têm calendário ativo hoje → nenhuma perde o fluxo. Para Otron CRM virar não-agendamento (vende assinatura de software), basta desconectar o calendário dela.

**Trade-off aceito:** +1 query `UserCalendar.count` por turno (não cacheada). É um count indexado por companyId — desprezível perto da chamada ao LLM. Se virar gargalo, cachear junto do settingsCache (TTL 30s). Registrado, não otimizado agora (mínima mudança).

**Não gateado (deixado intacto por minimalidade):** o item 7/8 do bloco genérico "REGRAS DE FERRAMENTAS" ainda cita criar_evento/dia-da-semana mesmo sem calendário. É condicional ("Para criar agendamentos...") e o bloco explícito "NÃO agenda" domina. Fragmentar o bloco genérico não valia o churn.

---

## 2026-07-11 — Migração do guia de deploy: Contabo → Hostinger VPS KVM 4

**Decisão:** usuário pediu segunda opinião (Claude Web) sobre hospedagem; escolheu Hostinger VPS **KVM 4** (4 vCPU AMD EPYC, 16GB RAM, 200GB NVMe SSD, 16TB banda). `docs/DEPLOY_DOCKER_CONTABO.md` renomeado (git mv, preserva histórico) para `docs/DEPLOY_DOCKER_HOSTINGER.md` e reescrito para o fluxo real da Hostinger (hPanel, terminal no navegador, firewall gerenciado, backup/snapshot nativo).

**Verificado via pesquisa (não assumido):** specs do KVM 4, fluxo de setup (hPanel → VPS → Setup → template Ubuntu), onde ficam IP/credenciais (Overview → SSH Access), terminal embutido no navegador (opção sem instalar nada), firewall gerenciado (Segurança → Firewall, bloqueia tudo por padrão — precisa liberar porta 22 antes de qualquer coisa), backup nativo (Backups & Monitoramento → Snapshots & Backups).

**O que NÃO mudou:** toda a parte Docker/Compose (imagens, migrations, .env, SSL Let's Encrypt) é idêntica — só o provedor de VPS por baixo mudou. Mantido o script `pg_dump` de backup granular do banco JUNTO com o backup nativo da Hostinger (granularidades diferentes, complementares).

**Referências no README.md/MANUAL_PLATAFORMA.md atualizadas.** Entradas históricas do decisions_log sobre Contabo (2026-05-20) mantidas intactas — são registro de decisão daquele momento, não documentação viva.

---

## 2026-07-11 — dbLog() nunca instrumentado: recurso construído mas nunca conectado

**Contexto:** usuário reportou logs vazios para a empresa Bomma no painel de auditoria. Grep confirmou `dbLog()` (interface + `LOG_ACTIONS` completos) sem NENHUM call site real — nem para Bomma, nem para nenhuma empresa. É um caso de "infra construída, nunca ligada".

**Decisão:** instrumentar os pontos de maior valor para LGPD/auditoria primeiro (login/logout, CRUD usuário, update setting, CRUD empresa), em vez de instrumentar tudo de uma vez. `ticket.closed/reopened/transferred` e `backup.created` ficam com constante pronta mas sem call site — próximo passo quando houver necessidade real.

**Lição (anti-repetição):** ao herdar/revisar uma feature com "infraestrutura pronta" (model + controller + página), sempre verificar com grep se as funções de escrita são REALMENTE chamadas em algum lugar — não assumir que existir = funcionar. Esse padrão ("construído mas nunca conectado") já se repetiu neste projeto.

---

## 2026-07-05 — Tier 3 (escala): ITEM D step 4 (GROUP BY serviceId) adiado

**Contexto:** Fase 7 adiciona FK `serviceId` (nullable) em `ServiceHistory` para
permitir GROUP BY confiável por serviço do catálogo no analytics financeiro
(`FinanceService.getTopServices`, hoje agrupa pelo texto livre `serviceType`).

**Feito nesta sessão (backward-compatible, com TDD):** migration nullable + index (NÃO
executada — só o arquivo), campo no model `ServiceHistory`, e persistência de `serviceId`
em `recordHistory` (grava quando fornecido; chamadas legadas → null).

**Adiado (com motivo):** trocar o `group: ["serviceType"]` de `getTopServices` para
`serviceId`. Motivo: **todos os registros existentes têm `serviceId=NULL`** (a coluna
acabou de ser criada e ainda não foi backfillada). Trocar o GROUP BY agora não traz
benefício (não há dado novo para agrupar) e cria risco real de regressão nos números do
dashboard — mistura de buckets serviceId vs serviceType, colisão de labels
("Sem categoria"), e necessidade de JOIN com Services para o nome. CLAUDE.md II.5/II.6
(mínima mudança, não quebrar números existentes).

**Gatilho para ativar:** quando (a) a migration for executada em produção, (b) `recordHistory`
estiver populando serviceId há tempo suficiente para os dados acumularem, OU houver backfill.
Aí: reescrever `getTopServices` para PREFERIR serviceId quando presente (JOIN em Services
para o nome) mantendo FALLBACK a serviceType para registros históricos sem serviceId, com
TDD provando que os totais legados não mudam.

---

## 2026-06-28 — Security review completo + revisão geral (achados e tech debt)

**Corrigido nesta sessão (com TDD):**
- Path traversal em `media.filename` (CRÍTICO) → `SanitizeFilename.ts`.
- GET /settings expunha API keys a não-admins (gate comentado) → `FilterSensitiveSettings.ts`.

**Achado MÁXIMO (processo, não código): o repositório tem ZERO commits.** Todo o código vive só no disco (+OneDrive). Sem histórico: sem rollback (CLAUDE.md IX), sem bisect, sem auditoria. Ação: commit inicial imediato (o .gitignore já protege .env/node_modules/public).

**Tech debt registrado (correções adiadas — mínima mudança):**
1. `ClosedAllOpenTickets` (wbotClosedTickets.ts): `tickets.forEach(async ...)` — erros escapam do try/catch (unhandled rejection observado em teste); `ticketTraking` pode ser null antes de `.update`. Trocar por `for..of` com await + null-check. Sem teste existente; escrever spec antes.
2. `handleMessage` roda `Message.count({ where: { companyId } })` a CADA mensagem (para dedup de contatos a cada 1000) — query pesada em tabela grande. Trocar por contador em cache/Redis ou cron.
3. `verifyMessage`/GIF: `console.log` de debug em produção (vários) — migrar para `logger.debug`.
4. Edge case do envio proativo a contato que é OUTRO admin (ticket status=secretary): `FindOrCreateTicketService` pode flipar o ticket de secretária para pending (janela 2h sem filtro de status) ou violar a UNIQUE. Baixa probabilidade (multi-admin); tratar quando houver 2º admin real.
5. Pasta do projeto dentro do OneDrive: sync de node_modules/dist degrada IO e pode corromper `node_modules` durante npm install. Recomendado mover para fora do OneDrive (ex: C:\dev) e versionar com git/GitHub como backup.

---

## 2026-06-28 — Módulo de contatos da Secretária (acesso + envio)

**Contexto:** a Secretária não achava contatos sem ticket. Adicionada `consultar_contatos` (busca na lista inteira, reusa `buscarContato` do Agente). 

**Próximo passo (tech debt / produto):** ENVIAR a um contato sem ticket aberto. `enviar_mensagem_para_cliente` exige `ticketId`. Para "avise a Amanda" quando ela não tem ticket, falta: estender o envio para aceitar `contactId` → `FindOrCreateTicketService(contact, whatsappId, ...)` (cria/abre ticket de cliente no canal do agente) → enviar. O gate de confirmação destrutiva (DESTRUCTIVE_TOOLS) já cobre o envio. Implicações de produto a decidir com o dono: (a) disparo proativo cria ticket de cliente — ok; (b) campanhas em massa (aniversário/cupom) devem usar o RetentionService (já existe BirthdayService/CouponService/WinbackService), NÃO a Secretária em loop; (c) compliance/opt-out para mensagens proativas. Adiado para alinhamento com o usuário.

**Captura de data de nascimento:** Contact tem campo `birthday` (DATEONLY). Melhor momento: ao FINAL de um atendimento concluído (cliente satisfeito, menor fricção) ou na primeira coleta de cadastro. Evitar pedir no meio do agendamento (fricção). O Agente pode capturar e gravar via tool; o RetentionService/BirthdayService consome.

---

## 2026-06-28 — Ticket de Secretária CONVERTE em vez de criar (UNIQUE constraint)

**Contexto:** o admin continuava caindo no agente mesmo reconhecido. Diagnóstico rodando o serviço contra o banco real revelou `SequelizeUniqueConstraintError`.

**Causa:** a tabela `Tickets` tem `contactid_companyid_unique` = UNIQUE (`contactId`, `companyId`, `whatsappId`). Só existe UM ticket por contato/empresa/canal. Criar um segundo ticket "secretary" para o admin (que já tinha #22) violava a constraint.

**Decisão:** `FindOrCreateSecretaryTicketService` **converte** o ticket existente do admin para `status="secretary"` (limpando fila/usuário/chatbot), em vez de criar outro. Alinha com o modelo: o admin tem UM thread, que é o da Secretária — ele não é cliente.

**Lição (anti-repetição):** qualquer lógica que crie ticket para um contato que já pode ter um DEVE respeitar a UNIQUE (contactId, companyId, whatsappId) — reusar/converter, nunca criar um segundo. O hardening que "cai no agente em erro" MASCAROU o bug; hardening de fallback deve preferir falhar alto a desviar silenciosamente para outro módulo (corrigido: agora retorna sem cair no agente).

---

## 2026-06-28 — Varredura de paridade de robustez Secretária ↔ Agente

**Contexto:** usuário pediu para varrer as melhorias do Agente e portar as aplicáveis à Secretária, prevenindo bugs já mapeados (como o de horário).

**Resultado da auditoria:**
- **Portado:** `looksLikePromise` (Bug #20) — re-iteração de promise-text. Crítico na Secretária (ação destrutiva prometida que não executa). Movido para `agentUtils.ts` (DRY).
- **Já em paridade:** sanitize/wrap/checkOutput/securityBlock/neutralizeInjection (segurança), preservação de `toolCalls` (Round 7), parser pseudo-XML, tratamento `finishReason=error`, `lastNonEmptyContent`, `MAX_ITERATIONS=8`, logging em `AgentActions`, contexto temporal (Bug #11), matching de telefone 9º dígito.
- **Gate destrutivo da Secretária é MAIS forte** que o do Agente: confirmação determinística (pendingAction) antes de cancelar/fechar/enviar — o Agente não tem equivalente.
- **NÃO aplicável (domínio do cliente):** `looksLikeAvailabilityDodge`, `isPureScheduleRequest`+Bug #A, validação de servicoId do Bug #B3, injeção de data/período/hora em `verificar_disponibilidade`. São defesas das tools de disponibilidade que a Secretária não usa para ofertar horários a cliente.

**Princípio para o futuro (anti-repetição de bug):**
1. **agentUtils.ts é o lar compartilhado** das defesas puras (looksLikePromise, buildCurrentDateTimeBlock, buildWeekCalendar, extractores). Ao endurecer um canal, checar se o outro reusa.
2. **Teste de orquestração, não só de tool:** o gap recorrente é teste unitário mockado passar args válidos e NÃO reproduzir o LLM se comportando mal (omitir arg, prometer sem executar, alucinar ID). Ao adicionar tool/fluxo na Secretária, testar o LOOP com o LLM mockado se comportando mal — não só a tool isolada.
3. **Testes dependentes de data** devem injetar `now` fixo (as funções aceitam `now`), nunca assertar data futura hardcoded.
4. **Tech debt aberto (baixa prio):** o gate destrutivo da Secretária estaciona o ID que o LLM deu sem validar existência antes de pedir confirmação. Se alucinado, a tool retorna "não encontrado" (tratado), mas a UX pede confirmar um ID inexistente. Validar o ID contra dados reais antes de estacionar (análogo ao Bug #B3) seria o próximo passo.

---

## 2026-06-28 — Aba dedicada "Secretária" + contexto temporal (ticket #22, pontos 1-3)

**Contexto:** após o admin ser reconhecido, três problemas: (1) Secretária assumia o ano errado; (2) mensagens do admin não apareciam no frontend; (3) conversa da Secretária se misturava com atendimentos de cliente. Usuário escolheu (via pergunta de UX) a **Opção A: aba/filtro dedicado**.

**Decisões:**
- **`status="secretary"` em vez de coluna `isSecretary`:** evita migration, reaproveita o filtro exato de status do `ListTicketsService` (exclui das abas Atendendo/Aguardando automaticamente) e o roteamento por status-room do socket (`company-{id}-secretary`). Trade-off: um valor de status fora do trio open/pending/closed; mitigado porque o ticket de Secretária é gerenciado só pelo listener (find-or-create idempotente, nunca transiciona) e os serviços de cron/autoclose filtram por open/pending — não tocam nele.
- **Roteamento de AMBAS as direções no listener:** mensagem de admin (recebida + echo fromMe) vai para o ticket de Secretária via `verifyMessage`. Antes só o echo vazava para o ticket de cliente. `verifyMessage` faz upsert por message-id (dedup) e emite socket — reaproveitado sem código novo.
- **Contexto temporal DRY:** `buildCurrentDateTimeBlock`/`isoLocalDate` movidos para `agentUtils.ts` e reusados pela Secretária (mesmo Bug #11 do Agente).
- **Aba admin-only no frontend:** espelha o gate do backend `joinTickets` (socket.ts:147 — só `profile==="admin"` entra em status-room arbitrário).

**Tech debt registrado:**
- **Access-control REST da listagem de Secretária:** ~~o frontend esconde a aba de não-admins, e o realtime (socket) já é admin-only por design. Mas o endpoint REST `/tickets?status=secretary&showAll=true` é craftável por um não-admin da MESMA empresa (escopo intra-tenant, não cross-tenant). Hardening futuro: exigir `profile==="admin"` no controller/serviço quando `status==="secretary"`. Baixo risco (agentes são funcionários da empresa); adiado para manter o escopo desta entrega.~~ **RESOLVIDO (2026-06-28):** gate `profile==="admin"` adicionado em `TicketController.index` — `403 (ERR_NO_PERMISSION)` quando `status==="secretary"` e não-admin. Mesmo padrão dos controllers Coupon/Package/Tag/Schedule. Teste TDD em `TicketController.spec.ts` (admin vê / não-admin 403 / status normais inalterados). Escolhido o controller (não o serviço) por mínima mudança e por ser o ponto de entrada — segue a convenção dominante do codebase.

---

## 2026-06-28 — Reconhecimento do admin por telefone tolerante ao 9º dígito (ticket #22)

**Contexto:** a Secretária não reconhecia o admin mesmo com o número correto cadastrado. Diagnóstico no banco revelou que o WhatsApp entrega o JID brasileiro SEM o 9º dígito (`554888368758`), enquanto o cadastro tinha o 9 (`5548988368758`). A comparação dígito-exata falhava.

**Decisão:** canonicalização determinística (`canonicalizePhone`) que remove o 9º dígito de celulares BR de 13 díg e prepend `55` quando ausente, comparando por igualdade na chave canônica. Reduzir à forma SEM o 9 (em vez de gerar variantes com/sem) foi escolhido por ser uma chave única e estável.

**Alternativas descartadas:**
- Gerar conjunto de variantes (com/sem 9) e checar interseção: funciona, mas a chave canônica única é mais simples e suficiente.
- Lib externa (libphonenumber): peso desproporcional para o escopo (matching de admin BR), adiaria o fix urgente.

**Tech debt registrado (NÃO incluído neste fix — fora do escopo do bug reportado):**
- **Envio OUTBOUND para admin** (briefing matinal e alertas em `secretaryBriefing.ts`/`secretaryAlerts.ts`) ainda usa o número cru cadastrado como JID (`${number}@s.whatsapp.net`). Se o cadastro tiver o 9 e o JID real não, a entrega pode falhar. O bug reportado era de INBOUND (reconhecimento). Aplicar `canonicalizePhone` ao destino do envio é o próximo passo natural; adiado para manter mínima mudança. Responsável: próxima sessão de hardening da Secretária.

---

## 2026-06-21 — Hardening do Módulo Secretária (coração do sistema)

**Contexto:** após estabilizar o Agente (caça ao "não consegui verificar" via `AgentActions`), hardening completo da Secretária — o canal de MAIOR privilégio (cancela, fecha ticket, envia em nome da empresa, vê financeiro). Meta: mais robusto que o Atendimento. A Secretária já roda Haiku (bom em tool-calling), então o foco foi ARQUITETURA à prova de falha, não babá de LLM.

**Bugs corrigidos:**
- `secretaryLoop` não preservava `toolCalls` (mesmo bug do Agente Round 7) → quebrava multi-step na OpenAI.
- `cancelar_agendamento` gravava só `reminderStatus`, não `status:"CANCELADO"` → inconsistência com o Agente.

**Robustez adicionada (orquestração):** logging em `AgentActions` (auditoria + diagnóstico), try/catch por-tool, tratamento de `finishReason=error`, fallback pseudo-XML, `lastNonEmptyContent`, MAX_ITERATIONS 5→8.

**Segurança:** normalização de número do admin (JID/máscara) mantendo dígito-exato; multi-tenancy auditada em todas as tools; prompt reforçado para confirmar destrutivas e nunca inventar IDs.

**Decisões / tech debt registrado:**
- **Logging na Secretária reusa `AgentActions`** (não tabela nova) — DRY e permite o mesmo `scripts/diag_agentactions.js`. `ticketId` extraído dos args quando presente; `contactId` fica null (a Secretária não opera num contato único).
- **Gate de confirmação de destrutivas via prompt + validação das tools**, NÃO determinístico (como o `pendingAction` é para envio de mensagem). Generalizar o `pendingAction` para cancelar/fechar/reagendar é possível, mas adiciona fricção de UX e complexidade; adiado. As tools já validam (not found, já cancelado) e tudo é auditado.
- **Injeção de 2ª ordem (dados do cliente nos tool results):** o `wrapUserMessage`/securityBlock protegem a mensagem do admin, mas tool results com texto controlado pelo cliente (nome, mensagens) não são envoltos. Mitigado hoje por `checkOutputSafety` + prompt. Hardening futuro: envolver/sanear tool results de tools que retornam dados de cliente. Registrado como item de próximo nível.

---

## 2026-06-20 — Blindagem round 13: auditoria profunda do write-path (criar/reagendar/cancelar)

**Contexto:** Usuário pediu auditoria sênior do módulo inteiro de agendamento para torná-lo robusto (vamos usar LLMs mais baratos e migrar para outros módulos). Foco: `reagendar_evento`, `cancelar_evento`, `criar_evento`.

**Descoberta inicial:** o "Bug #41" (reagendar sem validação de disponibilidade) que o `MEMORY.md` listava como pendente **já estava corrigido no código** (reagendarEvento.ts, datado 2026-05-31). A memória estava desatualizada — corrigida.

**5 furos REAIS encontrados e corrigidos (todos determinísticos, mirando LLM barato + linguagem natural):**

1. **`buscar_agendamento_cliente` mostrava hora errada em produção (ALTO).** `data`/`hora` eram formatadas com `toLocaleDateString`/`toLocaleTimeString` SEM `timeZone` → renderizavam no fuso do processo. Em produção (container Docker UTC), um agendamento de 14:00 BRT aparecia como "17:00" — o agente informava 3h errado. Mesma classe do Bug #36/#33. **Fix:** formatar tudo em `America/Sao_Paulo` explícito; adicionados `dataISO` (round-trip de tools) e `dataFormatada` (dia da semana, natural).

2. **`reagendar_evento` sem guarda de passado (MÉDIO).** `criar_evento` bloqueia instante no passado (Bug #13) ANTES de tudo; reagendar não tinha. A validação de disponibilidade filtra slots passados, mas é pulada no fail-open do Google → LLM barato poderia remarcar para o passado com Google instável. **Fix:** guarda explícita `novoSendAt <= now`, paridade com criar.

3. **`reagendar`/`cancelar` sem guarda de status CANCELADO (MÉDIO).** LLM barato chama cancelar 2x ou remarca um cancelado. **Fix:** reagendar recusa CANCELADO (orienta a criar_evento); cancelar é idempotente (responde "já estava cancelado", sem tentar deletar de novo no Google → evita 404/410 e falso alarme de "cancelamento parcial").

4. **`criar_evento` não validava que o profissional realiza o serviço (MÉDIO).** Classe do Bug #8 (gpt-oss-120b passou atendenteId=1 errado). Sem checagem, agendaria com profissional que não faz o procedimento, usando o expediente DELE. **Fix:** valida vínculo `ServiceProfessional(serviceId, userId, companyId)`; se não existe, recusa e orienta a usar as tools de disponibilidade.

5. **Datas em ISO cru nas mensagens (MÉDIO — linguagem natural).** "Agendado em 2026-06-22" é robótico. **Fix:** `formatDateWithWeekdayBRT` em todas as mensagens de sucesso/erro de criar e reagendar → "segunda-feira, 22/06/2026". (Exceção: o ISO permanece nos exemplos de chamada de tool dentro de erros — é instrução para o LLM, não texto ao cliente.)

**Alternativas descartadas:**
- Tratar 404/410 do Google no cancelar como sucesso → a guarda de status CANCELADO cobre o caso comum (dupla chamada) com menos complexidade; 404 por outras causas ainda loga honestamente.
- Validar profissional↔serviço também no reagendar → reagendar preserva o serviço e só muda profissional via `novoAtendenteId` (raro); priorizado o criar (ponto de entrada). Registrado como possível extensão futura.

**Validação:** TDD (testes antes do código). `tsc` limpo. Suíte completa executada. `dist/` recompilado.

---

## 2026-06-20 — Blindagem round 12: dia da semana, horário específico e âncora de data

**Contexto:** Usuário reportou (com print real) dois furos recorrentes do módulo de agendamento, após meses de iterações:
1. Cliente pergunta "22 é que dia? Segunda ou terça?" → bot se esquiva ("recomendo conferir no seu calendário"). Robótico, anti-humano.
2. Cliente pergunta "Tem horário para as 11h?" → bot responde "não consegui verificar a disponibilidade" mesmo com o Google Calendar conectado.

**Causas-raiz (3 buracos arquiteturais, não "LLM burro"):**

- **Dia da semana — regra de prompt obsoleta.** A regra 8 do `knowledgeBuilder.ts` (Bug #5, abr/2026) PROIBIA o agente de mencionar o dia da semana porque o LLM errava o cálculo de cabeça — e ainda ditava a frase de esquiva exata do print. Mas em mai/2026 foi adicionada a `buildWeekCalendar` (tabela determinística dia→data no prompt). A regra 8 ficou contraditória com o resto do prompt; o modelo escolheu a esquiva.

- **Horário específico virou impossível de responder (regressão latente do Bug #39).** Ao remover a lista de slots do retorno de `verificar_disponibilidade` (Bug #39, deixou só a faixa "das 12:00 às 18:00"), o LLM perdeu a capacidade de responder "11:00 está livre?" — teria que "olhar" se 11h cabe na faixa, e o gpt-4o-mini erra isso. Não havia caminho determinístico para horário exato.

- **Faltava âncora de DATA.** Já existia âncora do último SERVIÇO discutido (Bug #33/#40), mas não da última DATA. "Tem às 11h?" (sem repetir o dia) deixava o LLM sem saber qual data usar → chamava a tool com data faltando/errada.

**Decisão (tudo determinístico — CLAUDE.md §I):**

1. **`formatDateWithWeekdayBRT(iso)`** (pura, em `availabilityEngine.ts` — domínio de calendário, evita ciclo de dependência com AgentService): calcula o dia da semana no backend. As tools `verificar_disponibilidade` e `buscar_proximo_horario` passam a devolver `dataFormatada` ("segunda-feira, 22/06/2026"). O LLM repassa a string pronta, NUNCA calcula. Regra 8 reescrita: incluir o dia da semana, mas sempre a partir de dado pronto.

2. **`verificar_disponibilidade` ganha parâmetro opcional `hora`.** Quando informado, responde deterministicamente `horaConsultadaDisponivel` (true/false) + `horaDisponivel` por profissional, checando contra os slots livres reais. Se ocupado, ainda devolve a faixa para reofertar. Nova regra 15 no prompt: responda por esse campo, proibido "não consegui verificar".

3. **Injeção determinística de `hora`** no orquestrador (`extractTimeFromMessage`, espelhando a injeção de `periodo` do Bug #37): se o cliente disse "às 11h" e o LLM omitiu o argumento, o orquestrador injeta. Conservadora: só reconhece marcador explícito de hora (`:` ou sufixo `h`), não confunde "dia 22" com horário.

4. **Âncora de data** (`extractLastDiscussedDate` + `buildLastDateBlock`): injeta no prompt a última data discutida (com dia da semana), análogo ao serviço. Refinamentos por horário usam essa data sem re-perguntar.

**Alternativas descartadas:**
- Voltar a devolver a lista de slots ao LLM → reabre o Bug #39 (despejo de horário por horário). A resposta determinística de horário específico é superior.
- Instruir o LLM a calcular o dia da semana / interpretar a faixa melhor → probabilístico, é a causa-raiz que estamos eliminando.
- Tool nova só para horário específico → `verificar_disponibilidade` com `hora` opcional é mudança menor e mantém um único ponto de consulta de disponibilidade.

**Validação:** TDD (testes antes do código). `tsc` limpo. Suíte completa executada. `dist/` recompilado (`npm run build`).

---

## 2026-05-25 — Bug #35: Calendário de semana no system prompt (data de dia da semana)

**Contexto:** Cliente pediu "terça a tarde". O LLM respondeu "não temos horários na terça 30/05/2026 e quarta 31/05/2026". Problema: 30/05/2026 é sábado, não terça. O LLM calculou a data errada.

**Causa raiz:** LLMs não têm aritmética de calendário confiável. Mesmo com "hoje = 25/05/2026" injetado, o modelo cometeu um erro de +4 dias na conversão "terça → próxima terça".

**Decisão:** Injetar tabela explícita com os próximos 7 dias (dia da semana → ISO date) no system prompt. A função `buildWeekCalendar(now)` é exportada de `agentUtils.ts` (funções puras, testável) e usada em `buildCurrentDateTimeBlock()` no `AgentService/index.ts`.

**Alternativas descartadas:**
- Instruir o LLM a calcular melhor → probabilístico, não resolve a causa raiz
- Adicionar ferramenta de cálculo de data → adiciona complexidade sem ganho; a tabela é suficiente

---

## 2026-05-25 — `listarPacotes` tool + serviceId obrigatório em Pacotes

**Contexto:** Serviço "Depilação a Laser" existia apenas como pacote ("Pacote Laser 10 sessões"), não no catálogo de serviços avulsos. `listar_servicos` retornava apenas serviços avulsos → agente dizia "Depilação não está disponível", o que era incorreto.

**Decisão:** 
1. Nova tool `listar_pacotes` (em `AgentService/tools/listarPacotes.ts`) retorna pacotes ativos com nome do serviço, sessões, preço e desconto percentual calculado.
2. `knowledgeBuilder.ts` instrui o agente a chamar `listar_pacotes` junto com `listar_servicos` e a verificar pacotes antes de dizer "não disponível".
3. `serviceId` em Pacotes passou a ser **obrigatório** (validação no controller `store` e no frontend `Packages/index.js`). Sem isso o agente não sabe qual procedimento o pacote representa. DB mantido nullable para compatibilidade retroativa com registros existentes.

**Alternativas descartadas:**
- Criar serviços avulsos para tudo que tem pacote → duplica o cadastro e complica o fluxo de agendamento (pacotes não têm agenda)
- Deixar serviceId opcional → inviabiliza o agente de entender e oferecer o pacote correto

---

## 2026-05-25 — Rename "Pacotes de Sessões" → "Pacotes de Serviços"

**Decisão:** Nome mais preciso — um pacote pode cobrir qualquer tipo de serviço (consulta, procedimento estético, terapia), não apenas "sessões". Mudança puramente de texto em `pt.js` e `Packages/index.js`.

---

## 2026-05-24 — Unificação UX: Serviços como fonte única de verdade

### Decisão 1: Catálogo de Serviços como único ponto de cadastro

**Contexto:** Dois pontos de cadastro de serviços coexistiam na plataforma:
1. Aba **Serviços** (`/services`) — CRUD com preço, categoria, duração (endpoint `/service-catalog`)
2. **Configurações → Agendamentos → Serviços** (`ServicesSettings.js`) — CRUD com profissionais, sem preço/categoria (endpoint `/google-calendar/services`)

Ambos escreviam na mesma tabela `Services` + `ServiceProfessionals`, mas mostravam campos diferentes, causando confusão para o cliente sobre onde cadastrar.

**Decisão:** `ServiceCatalog` é a única fonte de verdade. O CRUD da aba Configurações foi removido.
- `ServiceCatalogService` recebe `professionalIds` em `createService` e `updateService`
- `ServiceCatalogController` aceita `professionalIds` no body de POST/PUT
- `Services/index.js` exibe coluna de profissionais + checkboxes no modal
- `ServicesSettings.js` convertido para visualizador somente-leitura com link para `/services`

**Alternativa descartada — manter dois formulários com merge automático:** complexidade desnecessária e ainda confundia o usuário com dois caminhos de entrada.

**Retrocompatibilidade:** endpoints `GET /google-calendar/services` mantidos (consumidos pelo agente de calendário e `listarServicos` tool). Os endpoints de CRUD do GoogleCalendarController (`POST/PUT/DELETE /google-calendar/services`) continuam funcionando para retrocompatibilidade, mas o frontend não os usa mais.

**Arquivos alterados:**
- `backend/src/services/ServiceCatalogService/index.ts` — professionalIds, transações, include professionals
- `backend/src/controllers/ServiceCatalogController.ts` — professionalIds em store/update
- `backend/src/controllers/GlobalSettingsController.ts` — removido `assertSuper(req)` redundante (TS error)
- `frontend/src/pages/Services/index.js` — coluna + modal com profissionais
- `frontend/src/components/Settings/ServicesSettings.js` — somente-leitura
- `backend/src/services/ServiceCatalogService/__tests__/ServiceCatalogServiceIO.spec.ts` — novos testes I/O

---

## 2026-05-23 — GlobalSettings, compactação de contexto e aba Integrações (Tasks 26-30)

### Decisão 1: Tabela dedicada `GlobalSettings` (sem companyId)

**Contexto:** Necessidade de configurações a nível de plataforma (LLM provider/key/model) controladas pelo super admin e que afetam todas as empresas simultaneamente.

**Decisão:** Criar model `GlobalSetting` com tabela própria (`GlobalSettings`), sem FK `companyId`. Chaves únicas (UNIQUE constraint em `key`).

**Alternativa descartada — `companyId = null` em `Settings`:** reutilizaria a tabela existente, mas criaria ambiguidade de FK (NULL não é uma company real), quebraria queries multi-tenant que assumem `companyId IS NOT NULL`, e misturaria settings de empresa com settings de plataforma no mesmo modelo.

**Trade-off aceito:** Nova migration + novo model. Custo baixo, semântica limpa.

**Migration:** `20260523000001-create-GlobalSettings.ts`

---

### Decisão 2: Prioridade de configuração LLM — cascade GlobalSettings > empresa > default

**Contexto:** AgentService e SecretaryService liam apenas Settings da empresa para configurar o provider LLM. Com GlobalSettings, a prioridade precisava ser definida.

**Decisão:**
```
GlobalSettings (super admin) → Settings da empresa → defaults hardcoded
```
- Agent: `globalAgentProvider` / `globalAgentApiKey` / `globalAgentModel`
- Secretary: `globalSecretaryProvider` / `globalSecretaryApiKey` / `globalSecretaryModel`
  - Secretary tem fallback adicional para `globalAgentProvider/Key/Model` antes de cair nos da empresa

**Justificativa:** Super admin controla o custo e o modelo de toda a plataforma. Empresas individuais não precisam (nem devem) configurar o LLM — isso é infraestrutura da plataforma. A aba "Provedor" em AgentSettings ficou oculta para usuários não-super.

**Resultado:** Secretary padroniza para `claude-sonnet-4-6` (mais capaz para análises financeiras complexas). Agent padroniza para `claude-haiku-4-5-20251001` (rápido para atendimento).

---

### Decisão 3: Guard `isSuper` na rota, não no controller

**Contexto:** `GlobalSettingsController` precisava verificar que o chamador é super admin. Tentativa inicial de adicionar `assertSuper(req)` no controller falhou: `req.user.super` não existe no tipo `{ id: string; profile: string; companyId: number }` definido em `@types/express.d.ts`.

**Decisão:** Remover verificação do controller. Usar middleware `isSuper` existente (`backend/src/middleware/isSuper.ts`) na rota: `isAuth, isSuper, GlobalSettingsController.index`.

**Por quê:** O `isSuper` middleware já existe e já faz `User.findByPk(req.user.id)` para checar o campo `super`. Duplicar a lógica no controller seria violação do DRY e criaria dois pontos de manutenção para a mesma regra de segurança.

**Padrão estabelecido:** Guards de autorização ficam no middleware de rota. Controllers assumem que os guards já passaram.

---

### Decisão 4: Mascaramento de API keys sensíveis com sentinel "••••"

**Contexto:** API keys em GlobalSettings nunca devem ser retornadas em texto claro pelo GET.

**Decisão:**
- `GET /global-settings`: chaves em `SENSITIVE_KEYS` = `["globalAgentApiKey", "globalSecretaryApiKey"]` são substituídas por `"••••"` se existirem
- `PUT /global-settings`: valores `"••••"` são ignorados (significa "não alterada" — frontend envia sentinel quando o usuário não digitou uma nova chave)

**Alternativa descartada — omitir a chave no GET:** Frontend não saberia se a chave está configurada ou não (não conseguiria mostrar `"••••"` no input).

---

### Decisão 5: contextCompactor — funções puras no arquivo separado, chamada ao LLM no AgentService

**Contexto:** Histórico de conversa longo (50+ mensagens) faz o LLM "esquecer" o início. Precisávamos compactar usando um resumo gerado pelo próprio LLM.

**Decisão arquitetural:**
- `contextCompactor.ts` contém APENAS funções puras: `shouldCompact`, `extractTextContent`, `buildCompactionContext`, `applyCompaction`, `estimateTokenCount` — zero I/O, zero Sequelize, zero Redis
- A chamada ao LLM para gerar o resumo fica em `AgentService/index.ts` (tem acesso ao `provider`)
- `contextManager.ts` permanece puro Redis/cache

**Justificativa:** `contextManager.ts` não tem acesso ao provider LLM. Misturar I/O de LLM no contextManager criaria dependência circular (AgentService → contextManager → AgentService). Separação limpa: funções puras são testáveis isoladamente sem mock de provider.

**Threshold:** 30 mensagens. Mantém últimas 10. Resume o restante.

**Role do resumo:** `role: "user"` com prefixo `[CONTEXTO ANTERIOR RESUMIDO — NÃO É UMA NOVA MENSAGEM DO CLIENTE]` — evita que providers rejeitem `role: "system"` injetado no meio do histórico (OpenAI rejeita system fora da posição 0).

**Falha segura:** Erro na compactação → loga com contexto → continua com histórico original. Atendimento nunca é bloqueado por falha na compactação.

---

### Decisão 6: `agentInstructions` movido de Conhecimento para Personalidade no frontend

**Contexto:** Campo de texto livre para instruções de personalidade do agente estava ausente na aba "Personalidade" — só havia dropdown com 3 opções preset. O campo existia na aba "Conhecimento" como instrução geral, mas o lugar semântico correto é "Personalidade".

**Decisão:** Mover o TextField "Tom de Voz / Instruções Personalizadas" para a aba Personalidade (logo após o dropdown de personalidade). Remover da aba Conhecimento para evitar duplicação.

---

### Bug: `GlobalSetting` não mockado em `AgentService.spec.ts`

**Sintoma:** Após Task 28 (AgentService passou a chamar `getGlobalSettings()`), todos os 30 testes do `AgentService.spec.ts` falhavam com `FALLBACK_REPLY`.

**Causa raiz:** `getGlobalSettings()` chama `GlobalSetting.findAll()`. `GlobalSetting` é um novo model não incluído nos mocks do spec. A chamada falhava silenciosamente → `loadProviderConfig` lançava erro → try/catch externo capturava → retornava `FALLBACK_REPLY`.

**Fix (3 linhas no spec):**
1. `jest.mock("../../../models/GlobalSetting")`
2. `import GlobalSetting from "../../../models/GlobalSetting"`
3. `(GlobalSetting.findAll as jest.Mock).mockResolvedValue([])` no `beforeEach`

**Lição:** Sempre que um novo model Sequelize é introduzido em qualquer serviço que já tem testes, adicionar o mock correspondente no spec. A ausência não causa erro de compilação — apenas falha silenciosa em runtime de teste.

---

## 2026-05-22 — Auditoria Sênior Fases 5–8: bugs corrigidos

Revisão pós-implementação cobrindo Fases 5 (Catálogo), 6 (Pacotes), 7 (Analytics) e 8 (Tools IA).

### Bugs encontrados e corrigidos

**B1 — Race condition em `consumeSession` (CRÍTICO, integridade de dados)**
- Arquivo: `PackageService/index.ts:334`
- Problema: duas requisições paralelas para a mesma compra de pacote liam o mesmo `sessionsUsed`, incrementavam ao mesmo valor → over-consumption silenciosa (N PackageConsumption + sessionsUsed só +1).
- Fix: envelopar em `sequelize.transaction()` com `lock: t.LOCK.UPDATE` na linha da ClientPackagePurchase. PackageConsumption.create + purchase.update agora atômicos.
- Side-effect: WhatsApp send movido para FORA da transação (`setImmediate` pós-commit) para não segurar o lock durante I/O externo.
- Contact agora é re-buscado dentro do `setImmediate` (em vez de carregado via include com lock).

**B2 — Bug de timezone em `applyDateRangeDefaults` (CRÍTICO, analytics)**
- Arquivo: `FinanceService/FinanceService.utils.ts:112`
- Problema: `endDate="2026-05-22"` virava `2026-05-22T00:00:00Z` (início do dia). Query `BETWEEN start AND end` perdia TODOS os registros do dia 22 — silenciosamente subreportava receita. Afetava as 5 funções de analytics (summary, byDay, byWeekday, topClients, topServices) e via Secretária IA também.
- Fix: detectar formato YYYY-MM-DD em endDate e estender para `23:59:59.999Z`. Adicionado também `safeParseDate` que rejeita strings inválidas (cai no default).
- Tests: +8 testes cobrindo end-of-day, start-of-day, timestamp explícito preservado, datas inválidas, strings vazias, cenário real (registro às 14h BRT do dia limite agora é capturado).

**B3 — NaN não tratado em `FinanceController` (MÉDIO, robustez)**
- Arquivo: `FinanceController.ts:113,140`
- Problema: `?limit=abc` → `Number("abc") = NaN` → `Math.min(NaN, 50) = NaN` → Sequelize quebra com erro 500.
- Fix: helper `parseLimit()` que valida `isFinite`, clamp positivo e teto em max=50.
- DRY-consideration: a mesma lógica existe em `FinanceTools.utils.ts:clampLimit`. Mantido inline no controller para evitar import cross-folder (CLAUDE.md §II.6 — mínima mudança). Refator centralizado fica como tech debt.

**B4 — Frontend `limit` fora de `params` (BAIXO, latente)**
- Arquivo: `frontend/src/pages/Finance/index.js:200-201`
- Problema: `api.get(url, { params, limit: 10 })` — axios espera `{ params: {...} }`. O `limit: 10` ficava como propriedade ignorada do config. Não-bug visível porque o backend default também é 10. Trocar default revelaria o erro.
- Fix: `paramsTop = { ...params, limit: 10 }` agora dentro de `params`.

### Achados verificados sem ação (OK)

- ✅ Multi-tenancy: 100% das queries Sequelize filtram por `companyId` do JWT.
- ✅ Authorization: PackageController checa `req.user.profile === "admin"` em store/update/remove.
- ✅ FinanceController é read-only — sem admin gate necessário (analytics da própria empresa).
- ✅ `Op.like` parametrizado — sem risco de SQL injection.
- ✅ `verSaldoPacote`: valida contactId via `Contact.findOne({ where: { id, companyId } })`.
- ✅ `listClientPurchases(companyId, contactId)`: filtra por ambos — sem info leak entre empresas.
- ✅ `clampLimit` em Secretary tools defende NaN/string/negative.
- ✅ Frontend (Finance + Packages): zero `dangerouslySetInnerHTML`, sem XSS.
- ✅ Datas armazenadas em UTC; defaults usam `Date.UTC()`.

### Tech debt registrado e ELIMINADO em segunda rodada (2026-05-22)

Após o user perguntar "necessita corrigir? se sim, corrija da melhor forma possível", todos os 4 itens foram eliminados:

- [x] **Centralizar `clampLimit`** — promovida a utility compartilhada em `FinanceService.utils.ts`. `FinanceController` e `FinanceTools.utils.ts` agora importam do mesmo arquivo. DRY conforme CLAUDE.md §II.4. Testes (12 casos: válidos, NaN, Infinity, objeto, array, etc) consolidados em `FinanceService.spec.ts`.
- [x] **Validar formato de data no `PackageController`** — nova função pura `parseOptionalDate(raw, fieldName)` em `PackageService.utils.ts` valida `Date | null | undefined | "" | "xyz"` etc. Controller envolve em try/catch que converte para `AppError(400)` com código `ERR_INVALID_DATE_<FIELDNAME>`. Antes: 500 genérico. +11 testes unitários.
- [x] **`as any` em `PackageController.update:122`** — substituído por `UpdatePackageDTO` (exportado do service). Type safety estática preservada.
- [x] **Transação `purchasePackage` + `ServiceHistory`** — agora atômico via `sequelize.transaction()`. Se ServiceHistory.create falhar (DB indisponível, validação), a compra NÃO é registrada. Elimina o cenário "cliente pagou mas receita sumiu" (risco fiscal). Substitui o `try/catch` silencioso anterior.

### Métricas pós-auditoria FINAL

| Métrica | Antes auditoria | Após auditoria | Após tech debt |
|---|---|---|---|
| Test suites | 70 | 70 | 70 |
| Tests passing | 1018 | 1025 | **1039** (+21 vs antes) |
| TypeScript errors | 0 | 0 | 0 |
| `as any` em controllers | 1 | 1 | **0** |
| Race conditions abertas | 1 | 0 | 0 |
| Bugs de timezone abertos | 1 | 0 | 0 |
| Catches silenciosos com risco fiscal | 1 | 1 | **0** |
| Duplicações de função pura | 1 | 1 | **0** |
| Datas inválidas → 500 | 1 | 1 | **0** (agora 400 claro) |

### Métricas pós-auditoria

| Métrica | Antes | Após auditoria |
|---|---|---|
| Test suites | 70 | 70 |
| Tests passing | 1018 | 1025 (+7 testes de timezone/inválido) |
| TypeScript errors | 0 | 0 |
| Bugs críticos abertos | 2 | 0 |
| Bugs médios abertos | 1 | 0 |

**Status:** ✅ **APROVADA** — código pronto para deploy. Race condition eliminada, analytics financeiras agora consistentes em dias-limite.

---

## 2026-05-17 — Sprint Simplificação: Limpeza e Reorganização da Plataforma

**Decisão:** Executar sprint de simplificação completo aprovado pelo usuário.

### Mudanças realizadas:

**1. Limpeza de arquivos _OLD (zero risco)**
- Deletados 10 arquivos confirmados como orphans (sem imports): `Options_OLD.js`, `index_OLD.js` (TicketsManagerTabs), `index_alternativo.js`, `Contact_OLD.ts`, `QuickMessage_OLD.ts`, `settingRoutes_OLD.ts`, `CreateContactService_OLD.ts`, `UpdateContactService_OLD.ts`, `UpdateTicketService_OLD.ts`, `SendWhatsAppMessage_OLD.ts`.
- Deletado diretório `translate_old/` (sem nenhum import externo).
- `DashbardDataService.ts` mantido: ainda referenciado por `DashbardController.ts`. Renomear requer tocar 2 arquivos — adiado para futuro sprint dedicado.

**2. i18n (pt.js)**
- Removida entrada `prompts: "Open.Ai"` do mainDrawer.listItems (legacy Whaticket).
- Corrigido: `"Acessar Ticket"` → `"Acessar Atendimento"`, `id: "Ticket"` → `"Atendimento"` (reports.table), `tickets: "Tickets"` → `"Atendimentos"` (dashboard.charts).
- Corrigido typo: `"Registros Tagdos"` → `"Atendimentos marcados"`.
- Renomeado "Tags" → "Etiquetas" em todos os labels: tagModal, tags section, filterTags, campaigns.tagList.
- Renomeados labels do mainDrawer para nova estrutura de seções (diaDia, gestao, configuracoes, avancado, sistema).
- Renomeados: "Conexões" → "WhatsApp", "Usuários" → "Atendentes", "Filas & Chatbot" → "Filas de atendimento", "Lista de arquivos" → "Arquivos".
- Renomeado: "Avaliações" → "Pesquisa de satisfação" (settingsOptions.labels.ratings).

**3. Options.js cleanup**
- Removidos blocos JSX comentados de IXC e MK-AUTH (~130 linhas mortas).
- Removidas variáveis de estado e handlers correspondentes (ipixc, tokenixc, ipmkauth, clientidmkauth, clientsecretmkauth).
- ASAAS mantido: bloco ativo, ainda em uso.

**4. WhatsApp modal — campos condicionais**
- Adicionado `isSpecialChannel = values.isAgentChannel || values.isSecretaryChannel`.
- Quando verdadeiro: ocultados campos greetingMessage (+ mídia), complationMessage, outOfHoursMessage, ratingMessage, queueRedirection (timeToTransfer + transferQueue + expiresInactiveMessage).
- Removido campo `prompt` (Open.AI legacy) do modal inteiramente — sem substituto.
- `expiresTicket` mantido visível para todos os canais.

**5. Sidebar reorganização (MainListItems.js)**
Nova estrutura de seções:
  - DIA A DIA: Atendimentos, Contatos, Agendamentos, Kanban, Tarefas
  - GESTÃO: Dashboard, Relatórios, Etiquetas
  - CONFIGURAÇÕES: WhatsApp, Atendentes, Configurações, Filas de atendimento
  - AVANÇADO (recolhível): Campanhas, Listas, Chat Interno, Arquivos, API, Financeiro, Respostas Rápidas
  - SISTEMA (super apenas): Informativos, Backups, Logs

**Motivo:** Reduzir jargão técnico (Ticket, Tags, Conexões, Filas & Chatbot), agrupar itens por contexto de uso, ocultar complexidade administrativa de usuários operacionais.

**Alternativas descartadas:**
- Manter estrutura flat atual: piora usabilidade para público não-técnico.
- Renomear variáveis de backend `{{agent}}` → `{{atendente}}`: risco de quebrar templates existentes sem migration. Adiado.

**Build:** Frontend ✅ (warnings de duplicate keys pré-existentes em pt.js, nenhum erro). Backend TypeScript ✅.

---

## 2026-05-17 — Revisão sênior pré-deploy: 6 fixes críticos aplicados

**Decisão:** Revisão sênior identificou 3 regressões introduzidas pelo sprint + 3 blockers de segurança pré-existentes. Todos corrigidos antes do deploy.

### Regressões corrigidas
1. **Sidebar duplicava "DIA A DIA" para admins** — `MainListItems.js` tinha o bloco DIA A DIA tanto no `<Can no={...}>` (que dispara para qualquer perfil sem `drawer-service-items:view`, ou seja, todos) quanto no `<Can yes={drawer-admin-items:view}>`. Removido do bloco admin com comentário explicativo do gating de permission.
2. **WhatsApp Modal disparava toast 404 a cada abertura** — `useEffect` chamava `api.get("/prompt")` (endpoint removido). Removidos state `selectedPrompt`/`prompts`, useEffect, handler `handleChangePrompt` e imports MUI órfãos (`Select`, `MenuItem`, `InputLabel`, `FormControl`). `promptId` agora hardcoded como `null` (campo legacy Open.AI desativado).
3. **i18n EN/ES com chaves antigas** — `en.js` e `es.js` ainda tinham `atendimento/gerencia/campanhas/administracao`. Substituídas pelas novas (`diaDia/gestao/configuracoes/avancado`) e labels renomeados (Connections→WhatsApp, Users→Agents, Tags→Tags/Etiquetas, Files→Files/Archivos, prompts removido). TR não verificado (manter como tech debt).

### Blockers de segurança corrigidos
1. **`JWT_SECRET` real exposto em `.env.example`** — valor real estava versionado no template público. Substituído por placeholders explícitos com instrução para gerar via `openssl rand -base64 32`. **AÇÃO PENDENTE DO USUÁRIO:** rotacionar o secret real em produção (gerar novos JWT_SECRET e JWT_REFRESH_SECRET, atualizar `.env` da VPS). Todos os tokens emitidos com o antigo devem ser considerados queimados.
2. **SQL Injection em `ShowMessageService.ts`** — `sequelize.query(\`select * from "Messages" where id = '${messageId}'\`)` aceitava `messageId` direto do `req.body` em `forwardMessage`. Substituído por `Message.findByPk(messageId)` (parametrizado pelo Sequelize, imune a SQLi). Imports não usados removidos.
3. **Redis sem senha em `.env.example`** — `redis://127.0.0.1:6379` sem auth. Atualizado para `redis://:CHANGE_ME_REDIS_PASSWORD@127.0.0.1:6379` com comentário sobre PII na Bull queue. **AÇÃO PENDENTE:** confirmar senha + bind em rede privada na VPS.

### Avisos corrigidos (não-bloqueantes)
- **Sandbox sem max-length** — adicionado limite de 4000 chars na `message` e 30 mensagens no `history` (evita abuso de tokens LLM).
- **CORS permissivo (CWE-942)** — o callback retornava `true` mesmo no `else`. Agora rejeita origins não-listadas com erro explícito. Webhooks server-to-server (sem header `Origin`) continuam permitidos pois não carregam credenciais do navegador.
- **`.gitignore` raiz inexistente** — criado `.gitignore` raiz com catch-all defensivo `**/.env` + secrets/certificados/sessões WhatsApp. Também criado `frontend/.gitignore`.

### Adiado (tech debt registrado)
- **Código IXC/MK-AUTH no backend** (`providers.ts` linhas 32-220 e 1206-1242, `CreateCompanyService.ts`, seeds): UI já foi removida no sprint anterior, mas o código backend está gateado por `if (urlmkauth != "" && ...)` com seeds vazios — dead code mas inerte. Remoção exige ~300 linhas de refactor em providers.ts. Adiado para sprint dedicado por CLAUDE.md §II.6 (mínima mudança).
- **`DashbardDataService.ts` typo** — rename adiado.
- **i18n TR** (turco) — não atualizado, pode ter chaves órfãs se algum usuário usar.

**Build pós-fixes:** Backend TypeScript ✅ · Frontend ✅ (bundle -44B).

---

## 2026-05-10 — Link Google Calendar (Opção A) sobre alternativas mais complexas

**Decisão:** Após sucesso em `criar_evento`, retornar campo `linkCalendario` no tool result com URL pré-preenchida do Google Calendar (`action=TEMPLATE`). O LLM oferece o link ao cliente na mensagem de confirmação.

**Motivo:** Captura ~80% do valor UX de "convite no calendário" (como inbarberapp.com) com ~10% do esforço de implementação. Zero infra nova: sem SMTP, sem OAuth de cliente, sem coleta de email. Funciona universalmente em qualquer navegador/dispositivo com Google Calendar (a maioria absoluta no mercado BR).

**Alternativas descartadas:**
- **Opção B — `.ics` por email via nodemailer**: experiência mais polida (universal: Google/Apple/Outlook) mas exige (a) configuração SMTP, (b) coleta de email do cliente no fluxo (fricção), (c) infra de envio de email transacional. Fica como roadmap para um próximo round se houver demanda.
- **Opção C — Google Calendar OAuth por cliente**: cada cliente fazendo OAuth com Google via WhatsApp é fricção enorme, taxa de conclusão mínima, gerenciar N tokens de clientes adiciona complexidade de segurança considerável. Descartada como impraticável.

**Arquitetura escolhida:**
- Função utilitária pura `gerarLinkGoogleCalendar.ts` — sem side effects, sem DB, sem rede. Recebe `{title, data, hora, durationMinutes, details?}` e retorna a URL. 100% testável isoladamente.
- Integração mínima em `criarEvento.ts`: 1 import, 1 campo opcional no result type, 1 chamada no retorno de sucesso.
- `criarEventoDefinition.description` atualizada para instruir o LLM a oferecer o link.

**Trade-offs aceitos:** Cliente que NÃO usa Google Calendar (minoria) não tem opção nativa de adicionar ao calendário. Aceitável no MVP — se o feedback do mercado pedir, evoluímos para Opção B sem refatorar a arquitetura atual (o link continua sendo gerado, só adiciona o envio de `.ics` opcional).

---

## 2026-05-10 — Bug #25: contactId interno NÃO deve ser parâmetro do LLM

**Decisão:** Remover `contactId` dos parâmetros da tool `buscar_agendamento_cliente` e injetá-lo sempre via contexto de execução em `executeCalendarTool`. Tools de calendário que precisam de `contactId` o recebem do AgentService, não do LLM.

**Motivo:** O LLM só conhece dados que estão no system prompt ou no histórico da conversa. IDs internos (contactId, scheduleId, etc.) são detalhes de implementação que:
- O LLM NÃO precisa conhecer para tomar decisões de negócio
- O LLM NÃO PODE inferir corretamente (causa hallucination ou recusa de chamada)
- Causam acoplamento desnecessário entre prompt e schema de banco

Quando declaramos `contactId` como `required` numa tool, modelos estritos (Claude) se recusam a chamar a tool por falta de dados. Modelos permissivos passam valores hallucinados, causando bugs piores (cancela agendamento de outro cliente, por exemplo).

**Princípio (a internalizar):** Tools que operam sobre "o cliente atual" devem receber a identidade do cliente do CONTEXTO DE EXECUÇÃO, não dos argumentos do LLM. O LLM opera em linguagem natural — não tem como saber que João Silva tem `contactId=42` no nosso banco.

**Alternativas descartadas:**
- Adicionar `contactId` ao system prompt e manter como parâmetro: redundante, propenso a erro do LLM (passar valor errado), e expõe detalhe interno sem ganho.
- Manter como parâmetro com fallback `args.contactId ?? ctx.contactId`: já existia e não resolveu — fallback só age quando LLM passa `null`/`undefined`, mas o problema era o LLM não chamar ou passar valor errado (que não é nullish).

**Padrão para futuras tools:**
- Identificadores do *cliente atual* (contactId, ticketId, whatsappId, companyId) → vêm do contexto, nunca do LLM.
- Identificadores que o LLM PODE descobrir via tool prévia (scheduleId via `buscar_agendamento_cliente`, servicoId via `listar_servicos`) → permitido como parâmetro, pois o LLM tem caminho determinístico para obtê-los.

**Impacto:** 3 edits cirúrgicos — tool definition (remover param), dispatch (`executeCalendarTool` usa ctx.contactId direto), `buildContactContextBlock` (expõe contactId como cinto-e-suspensórios para outras tools). 2 testes TDD garantem que a regressão não acontece silenciosamente.

---

## 2026-05-10 — Bug #24: status ENVIADA excluído incorretamente das queries de agendamento

**Decisão:** Remover `"ENVIADA"` do `Op.notIn` em `buscarAgendamentoCliente` e adicionar ao `Op.in` em `criarEvento`.

**Motivo:** O ciclo de vida do `Schedule` tem 3 estados relevantes para agendamentos ativos:
- `PENDENTE`: lembrete ainda não enviado
- `ENVIADA`: lembrete WhatsApp já enviado ao cliente (agendamento ATIVO)
- `CANCELADO`: agendamento encerrado (único que deve ser excluído das buscas)

O `reminderHandler` (job noturno/job de filas) muda `PENDENTE → ENVIADA` ao disparar o WhatsApp de confirmação. Para agendamentos com horário próximo, isso acontece com horas/dias de antecedência. Entre o momento do envio e a data do agendamento, o status fica em `ENVIADA` mas o cliente ainda tem o horário marcado. A exclusão de `ENVIADA` criava uma janela de invisibilidade onde o agente não conseguia nem encontrar nem proteger o agendamento existente.

**Alternativas descartadas:**
- Adicionar `CONFIRMADO` como novo status: adicionaria complexidade desnecessária ao ciclo de vida. O `reminderStatus = "confirmed"` já captura a confirmação do cliente sem mudar o status principal.
- Mudar o job para não alterar o status: quebraria a lógica do `reminderHandler` que usa `ENVIADA` para não reenviar lembretes.

**Impacto mínimo:** 2 linhas de código alteradas em 2 arquivos. Testes TDD em 2 novas suítes validam tanto o comportamento quanto a query Sequelize gerada (via inspeção dos símbolos Op).

---

## 2026-05-19 — Módulo de Retenção Fase 1, Semana 2: 4 chunks implementados

**Contexto:** O módulo de retenção detecta clientes adormecidos, fecha tickets de agendamento vencidos automaticamente e gerencia cupons de fidelidade. Esta fase entrega a base de serviços e APIs REST.

### Chunk 1 — AutoCloseScheduledService (2026-05-18)

**Decisão:** Separar lógica pura de decisão (`shouldCloseSchedule`) em `.utils.ts` e manter I/O em `.ts`.

**Motivo:** `UpdateTicketService` puxa `socket.ts → auth.ts → JWT_SECRET` no load do módulo. Em ambiente Jest sem `.env`, isso causa erro imediato antes de qualquer teste. A separação de arquivos resolve sem configurar `jest.mock` complexo — padrão adotado para todos os serviços do módulo.

**Regras de negócio:** (1) tem ticketId, (2) ticket não está fechado, (3) passou `autoCloseMinutes` desde `sendAt`, (4) não houve mensagem nos últimos `inactivityWindow` minutos. Limite exato do tempo é fechado (>=). Janela de inatividade é exclusiva no limite (>).

**14 testes TDD.** TypeScript clean.

### Chunk 2 — ServiceHistoryService + Kanban Completion Hook (2026-05-19)

**Decisão:** Hook de Kanban inserido em `SyncTagsService.ts` envolto em `try/catch` que loga mas não re-lança.

**Motivo:** Falha no hook não deve derrubar a sincronização de tags. Log de erro é suficiente para diagnóstico.

**Fetch de tags completas do banco:** Após `bulkCreate`, buscamos `Tag.findAll()` com os IDs passados para garantir presença de `isCompletionTag` — o frontend pode enviar stubs sem o campo.

**Idempotência:** `findOne({ ticketId, source: 'kanban_completion' })` antes de criar — evita duplicatas em re-syncs acidentais.

**14 testes TDD.** TypeScript clean.

### Chunk 3 — CouponService + endpoints REST (2026-05-19)

**Decisão:** Alfabeto sem ambiguidade visual para códigos gerados (sem O, 0, I, 1, L) — atendentes digitam códigos de papel.

**Colisão:** Loop de até 5 tentativas. Probabilidade com 10k cupons: ~10^-8. Defensive programming.

**Endpoints:** `POST /coupons`, `GET /coupons/:code`, `POST /coupons/:code/redeem`, `GET /contacts/:contactId/coupons`.

**20 testes TDD.** TypeScript clean.

### Chunk 4 — RetentionController (2026-05-19)

**Decisão:** `GET /retention/dormant` classifica apenas contatos com ServiceHistory — não todos os contatos da empresa.

**Motivo:** Semanticamente correto (sem serviço concluído, não há o que classificar) e mais eficiente.

**Urgency derivado de proporção de perdidos:** `low` (zero perdidos), `medium` (> 0 e ≤ 25%), `high` (> 25%).

**Tech debt:** Para empresas com 500+ contatos ativos, o loop O(N×M) pode ter latência. Mitigação futura: cache de classificação em Redis com TTL de 1h, reprocessado pelo cron das 03h.

**Endpoints:** `GET /retention/dormant`, `GET /retention/summary`, `GET /contacts/:contactId/retention`, `POST /retention/:contactId/coupon`.

**21 testes TDD.** TypeScript clean.

### Totais da Fase 1 Semana 2: 69 novos testes TDD, TypeScript limpo em todos os chunks.

---

## 2026-05-19 — Módulo de Retenção Fase 2: Aniversário Inteligente

**Contexto:** Fase 1 entregou detecção de adormecidos, ServiceHistory e Cupons. Fase 2 eleva o serviço de aniversário de D-0 único para um fluxo de 3 toques com cupom automático.

### Bloco B1 — Funções puras + TDD (BirthdayService.utils.ts)

**Decisão:** Separação de lógica pura (utils.ts) da orquestração I/O (BirthdayIntelligentService.ts). O mesmo padrão já estabelecido na Fase 1.

**Funções criadas:** `extractMonthDay`, `getDayOffsetFromBirthday`, `whichTouchToFire`, `buildTouchMessage`.

**Parsing de data de aniversário:** string extraction para "YYYY-MM-DD" (evita problema de timezone). UTC methods para Date objects.

**Semântica de offset:** negativo = futuro, 0 = hoje, positivo = passado. Diferente do intuitivo, mas consistente com `nowMidnight - bday`.

**50 testes TDD — todos passaram.** TypeScript clean.

### Bloco B2 — BirthdayIntelligentService.ts (orquestração I/O)

**Decisão:** Substitui `BirthdayReminderService.ts` (D-0 apenas, idempotência frágil via análise de conteúdo de mensagem).

**Idempotência:** `BirthdayTouch` com UNIQUE(contactId, year, touchType) — o banco rejeita duplicatas automaticamente, sem lock de código.

**Cupom no D-0:** `discountType: "percent", discountValue: 10, validDays: 30`. Configurabilidade via Settings adiada para quando a tela de configurações for expandida.

**D+7 sem D-0:** o toque D+7 busca o BirthdayTouch do D-0 para pegar o couponId. Se D-0 não foi enviado, envia sem cupom (degradação graciosa).

**Opt-out:** filtro `marketingOptOut: { [Op.not]: true }` na query — respeita privacidade antes de iterar.

**Migração do server.ts:** `BirthdayReminderService` substituído por `BirthdayIntelligentService` em server.ts. Arquivo antigo preservado (não deletado) para possível rollback.

**Correção de bug na migração:** `addConstraint` estava usando assinatura v6+ (`{fields, type, name}`). Corrigido para Sequelize v5: `addConstraint(table, fields[], options)`.

### Bloco B3 — GET /retention/birthday-stats

**Decisão:** Endpoint analítico que agrega: toques enviados no ano, cupons gerados/resgatados, aniversários próximos (7d) e recentes (janela D+7).

**Anti-N+1:** busca BirthdayTouches de todos os contatos em um único query, monta Map para lookup O(1).

**Cálculo de offset:** reutiliza `extractMonthDay` + `getDayOffsetFromBirthday` (funções puras já testadas).

### F1 — Frontend: página Retenção

**Decisão:** Sidebar item em GESTÃO, entre Relatórios e Etiquetas. Ícone `FiRefreshCw` (re-engajamento). Rota `/retencao`.

**3 abas:** Adormecidos (tabela + cards de urgência), Aniversários (próximos + recentes + stats), Cupons (stats de resgate).

**Tech debt:** aba Cupons mostra apenas resumo (reaproveitando birthday-stats). Lista individual de cupons por contato pode ser expandida com endpoint dedicado no futuro.

### F2 — Tags modal: toggle "Marcar como Venda Concluída"

**Decisão:** Campo `isCompletionTag` adicionado ao TagModal (mesmo padrão do campo `kanban`). Visível apenas para admin/supervisor.

**Propagação:** TagController `store` + `update` → CreateService + UpdateService → model (campo já existia desde Fase 1).

**Sem validação de unicidade no service layer:** a constraint "apenas 1 tag por empresa" é responsabilidade do banco. Se for necessário UI melhor (bloquear seleção dupla), adicionar em sprint futuro.

### Totais da Fase 2: 50 novos testes TDD, TypeScript clean, zero regressões na full suite.

---

## 2026-05-19 — Módulo de Retenção Fase 3: Retenção Proativa (3 blocos)

**Contexto:** Fase 1+2 cobriram detecção e aniversário. Fase 3 fecha o ciclo: previne dormência, recompensa fidelidade e reativa perdidos.

### Bloco 3A — Lembrete Preventivo

**Decisão:** Dispara quando `status === "quase_na_hora"` E ratio entre 0.8 e 1.0 (ceiling intencional — acima de 1.0 já não é mais "preventivo").

**Idempotência:** UNIQUE(contactId, baselineHistoryId) na tabela `PreventiveTouches`. Quando o cliente volta e cria novo ServiceHistory, `baselineHistoryId` muda → abre nova janela.

**Threshold configurável:** Setting `preventiveReminderThreshold` permite tunar a faixa. Defaults: 0.8 (start) com ceiling fixo em 1.0.

**Filtragem `marketingOptOut`:** respeitado na query (`Op.not: true`).

**25 testes TDD.** Cron a cada minuto + janela de tolerância de 2 min.

### Bloco 3B — Programa de Fidelidade

**Decisão:** Hook em `ServiceHistoryService.recordHistory` em vez de cron separado. Cada novo serviço dispara verificação; idempotência via UNIQUE(contactId, milestone) garante zero duplicatas.

**Marcos default:** 5, 10, 20, 50, 100. Configurável via Setting `loyaltyMilestones` (CSV).

**Tratamento de pulos:** `getNewlyReachedMilestones` aceita salto (cliente foi de 4 para 22 em uma migração) e entrega todos os marcos pendentes.

**Bug capturado pelo TDD:** a função não ordenava o output quando `milestones` vinha desordenado. Fix: sort defensivo na saída (contrato explícito).

**Opt-out tratado especial:** ainda gera cupom (cliente pode descobrir depois), mas NÃO envia mensagem. Mantém o benefício sem violar privacidade.

**31 testes TDD.** Source='migration' não dispara hook (backfill seguro).

### Bloco 3C — Win-back Pós-perda

**Decisão:** Diferente dos outros toques (1 por ciclo), win-back usa **cooldown temporal** (default 90 dias). Cliente perdido não tem mais ciclos — então a constraint UNIQUE não se aplica.

**Status alvo:** `adormecido` (ratio 2.0-4.0) ou `perdido` (ratio ≥ 4.0). Diferencia-se do "atrasado" (ratio 1.2-2.0) que ainda está na faixa preventiva.

**Outcomes:** pending → converted (cliente voltou) | no_response (passou cooldown). Conversão é detectada via hook em `recordHistory` — quando contato com winback pending cria ServiceHistory, marcamos `outcome=converted` e `convertedAt=now`.

**Cupom de alto valor:** default 20% OFF (vs 10% fidelidade e 10% aniversário). Configurável via `winbackDiscountValue`.

**23 testes TDD.**

### Totais da Fase 3: 79 novos testes TDD (25+31+23), TypeScript clean.

---

## 2026-05-19 — Módulo de Retenção Fase 4: Inteligência Avançada (3 blocos)

**Contexto:** Fase 3 fechou o ciclo operacional (prevent/loyal/winback). Fase 4 entrega ferramentas estratégicas: segmentação, descoberta de oportunidades e crescimento viral.

### Bloco 4A — RFM Segmentation

**Decisão:** Implementação puramente analítica — zero migration, zero novas tabelas. Computa scores R/F/M (1-5 cada) on-demand a partir de `ServiceHistory` existente.

**Thresholds escolhidos com base em SMB brasileiro:**
- Recency: ≤7d → 5; ≤30d → 4; ≤60d → 3; ≤120d → 2; >120 → 1
- Frequency: ≥20 → 5; ≥10 → 4; ≥5 → 3; ≥2 → 2; 1 → 1
- Monetary (R$): ≥1000 → 5; ≥500 → 4; ≥200 → 3; ≥50 → 2; <50 → 1

**Segmentos (ordem de prioridade nas regras):**
1. F=1 → "new" (única visita)
2. R≥4 ∧ F≥4 ∧ M≥4 → "champions"
3. F≥4 → "loyal"
4. R≥4 → "potential"
5. R≤2 ∧ F≥3 → "at_risk"
6. R=1 ∧ F≤2 → "hibernating"
7. demais → "others"

**Por que regras simples vs. clustering K-Means:** SMB tem ~100-1000 contatos por empresa. K-Means seria overkill e menos interpretável. Regras explícitas permitem ao admin entender e ajustar.

**32 testes TDD.**

### Bloco 4B — Cross-sell (Market Basket simplificado)

**Decisão:** Implementação ingênua (O(n²) sobre tipos de serviço por cliente) — suficiente para até ~10k transações por empresa. Para volumes maiores: FP-Growth ou Apriori (adiado).

**Outputs:**
- Pares globais com `cooccurrence`, `supportA`, `supportB`, `confidenceAtoB`, `confidenceBtoA`
- Sugestões individuais: serviços que o cliente AINDA NÃO consumiu, ordenados por confidence

**Determinismo:** pares sempre ordenados alfabeticamente (a < b). Resultado idêntico independente da ordem dos records.

**Filtros default:** `minSupport=2`, `minConfidence=30%`. Configuráveis via query params.

**Sugestão deduplicada:** se múltiplos serviços do cliente sugerem o mesmo terceiro, mantém apenas a maior confidence.

**22 testes TDD.**

### Bloco 4C — Programa de Indicação (Referral)

**Decisão:** Adição de campo `referralCode` no Contact (preguiçoso — gerado on-demand). Tabela `Referrals` rastreia o trio (referrer, referred, code) + cupons gerados.

**Geração de código:** 6 caracteres do alfabeto seguro (sem 0/O/1/I/L). `INDICA-XXXXXX` ≈ 729M combinações.

**Validação anti-fraude:** auto-indicação (mesmo ID) e empresas diferentes são rejeitadas no service layer via `validateReferralRegistration`.

**Idempotência por referido:** UNIQUE(referredContactId) — um novo cliente só pode ter UMA indicação. Tentativas duplicadas retornam AppError 409.

**Conversão automática:** hook em `recordHistory` detecta `totalServices === 1` (primeiro serviço do referido) e dispara `convertReferralIfPending`. Gera 2 cupons (`INDICA-` para referrer, `AMIGO-` para referred), envia 2 mensagens com templates configuráveis.

**Best-effort delivery:** opt-out de marketing respeitado individualmente para cada lado. Falha de WhatsApp não impede cupom (cliente pode descobrir depois).

**27 testes TDD.**

### Totais da Fase 4: 81 novos testes TDD (32+22+27), TypeScript clean.

### Totais Fases 3+4 combinadas: 160 novos testes TDD. Todas as features atrás de Setting (gates por empresa) — habilitam progressivamente sem mudar comportamento default.

---

## 2026-05-20 — Módulo de Retenção: revisão sênior aplicada + preparação para Contabo

**Contexto:** Após entrega das Fases 1-4, conduzi revisão sênior completa. Resultado: 3 blockers reais (B1, B3, B4) e 3 races de alta criticidade (H1, H3/H4, H6) — todos corrigidos antes do deploy.

### Blockers corrigidos

**B1 — Loyalty/Referral double-counting com `source='migration'`**
- **Causa raiz:** `ServiceHistory.count()` em `recordHistory` incluía registros backfill, disparando recompensas erradas para clientes recém-importados (cliente com 4 visitas migradas + 1 real = 5 → marco 5 disparado indevidamente).
- **Fix:** count agora exclui `source='migration'`. Backfill é invisível para programas de retenção.

**B3 — Timezone bug nos 3 crons**
- **Causa raiz:** `new Date().getHours()` lê timezone do container (UTC no Docker). Admin configura "09:00" pensando em BR → disparo às 06:00 BR (3h adiantado).
- **Fix:** novo helper `_shared.utils.ts/isWithinFireWindow(time, timezone, now)` usa `moment-timezone`. Setting `timezone` por empresa, default `America/Sao_Paulo`. 11 testes específicos cobrindo o bug.

**B4 — N+1 em endpoints analíticos**
- **Causa raiz:** Cross-sell carregava TODOS os ServiceHistories da empresa sem limit. Para 50k+ rows → OOM/timeout.
- **Fix parcial:** cap defensivo de 50.000 rows com header `X-Cross-Sell-Capped`. Tech debt: agregação em SQL via GROUP BY para getRFMSegments/getDormant (afeta empresas > 1k contatos).

### Races corrigidas

**H1 — `getOrCreateReferralCode`**: requisições concorrentes podiam gerar códigos diferentes. Fix: UPDATE atômico `WHERE referralCode IS NULL` + re-read se afetou 0 rows.

**H3/H4 — Crons faziam queries desnecessárias antes do time check**: reordenamento — `enabled` primeiro, depois `isWithinFireWindow`, depois resto. Logs per-minute removidos.

**H6 — `convertReferralIfPending` race**: webhooks reentregues geravam 4 cupons em vez de 2. Fix: atomic claim via `UPDATE Referrals SET outcome='converted' WHERE outcome='pending'` ANTES de gerar cupons.

### Refator: helper compartilhado

Extraído `_shared.utils.ts` (pure) + `_shared.ts` (I/O) — separação porque `_shared` precisava importar `getWbot` que carrega `baileys` (ESM, incompatível com Jest sem transform). Pure funcs em arquivo separado permite testes 100% isolados.

Funções centralizadas: `addDays`, `isWithinFireWindow`, `formatDiscountLabel`, `safeCouponDiscountType`, `safeTimezone`, `getActiveWhatsapp`, `getSetting`, `getCompanyTimezone`. Cada cron service perdeu ~30 linhas de boilerplate.

### Tech debt registrado (não bloqueia deploy)

- **M3 — Hooks fire-and-forget vs transactional boundary:** os 3 hooks (`checkAndAwardLoyalty`, `markWinbackConverted`, `convertReferralIfPending`) rodam após `ServiceHistory.create` sem aguardar commit do caller. Quando alguém envolver `recordKanbanCompletion` em transação, hooks podem persistir dados órfãos se a transação rolar back. Mover para Bull queue `afterCommit` quando isso virar problema.
- **M5 — `as any` em `Model.create()`:** ~6 ocorrências. Refator mecânico, sem bugs ativos.
- **M6 — Settings sem registry tipado:** 30+ keys hoje só são descobertas por grep. Próximo passo: `RetentionService/settings.ts` com registry tipado + migração que insere defaults por empresa.
- **M7 — `WinbackAttempt` sem UNIQUE constraint:** cooldown é puramente em JS. Multi-instância pode disparar 2 attempts simultâneos. Adicionar Redis SETNX como distributed lock (não bloqueante no plano single-instance do Contabo).
- **L4 (corrigido):** removidos imports unused (`Whatsapp`, `getWbot`, `ServiceHistory`) em Preventive/Winback/Referral após refactor para helper.

### Análise de segurança

Resultado: ✅ aprovado. Todos os 15 endpoints novos têm `isAuth`, queries 100% ORM, multi-tenancy garantida via companyId do JWT, coupon codes usam `crypto.randomBytes`, anti-fraude no referral (auto-indicação + companies diferentes), opt-out respeitado, idempotência via UNIQUE constraints + atomic updates.

Pontos de atenção (não bloqueantes): PII (`contact.name`) em logs — considerar mascarar para Loki/CloudWatch; rate limiting nos endpoints analíticos pesados.

### Integração com código legado

Auditados todos os pontos de acoplamento: server.ts (+2 crons), database/index.ts (+4 models), Contact.ts (+1 campo nullable), SyncTagsService.ts (+companyId opcional, hook em try/catch), TagController.ts (+isCompletionTag), MainListItems.js (+item sidebar), TagModal.js (+toggle). Zero regressões.

`BirthdayReminderController.ts` (endpoint de teste manual) agora chama `BirthdayIntelligentService` ao invés do legacy `BirthdayReminderService` para parity com o novo cron.

Legacy `services/BirthdayReminderService.ts` mantido em código (não deletado) para rollback de emergência. Registrado como tech debt para remoção em sprint futuro.

### Documentação criada

- `docs/RETENCAO_REVISAO_SENIOR.md` — relatório completo (~500 linhas) de findings priorizados, integração, segurança, métricas
- `docs/RETENCAO_PRE_DEPLOY_CHECKLIST.md` — checklist sequencial 10 passos com SQL/comandos prontos + KPIs para 2 semanas pós-deploy
- `docs/DEPLOY_DOCKER_HOSTINGER.md` § 10.5-10.7 — passos novos: timezone, habilitação das 5 features, smoke test
- `docs/MANUAL_PLATAFORMA.md` § 5.3 — seção completa de usuário final explicando as 9 abas, como cada feature funciona, como começar

### Validação final

| Métrica | Antes | Após módulo + revisão |
|---|---|---|
| Test suites | 53 | 65 |
| Tests passing | 706 | 866 |
| TypeScript errors | 0 | 0 |
| Retention coverage | — | 332 testes (13 suites) |

**Status:** ✅ pronto para subir no Contabo.

---

## 2026-05-21 — Fase 5: Catálogo de Serviços com Preço

**Contexto:** Usuário perguntou se o agente de atendimento conseguiria vender pacotes de sessões (ex: depilação a laser 1 sessão R$40, pacote 10 sessões R$300) e se haveria controle de atendimentos restantes / módulo financeiro com faturamento diário e top clientes. Análise revelou que o modelo `Service` não tinha campo de preço e não havia módulo financeiro real.

### Decisões arquiteturais

**D1 — Adicionar `price` e `category` ao modelo `Service` (não criar modelo separado)**
- **Alternativa descartada:** criar tabela `ServicePricing` separada com histórico de preços.
- **Motivo:** para o porte atual da plataforma (PMEs), um campo `price` nullable direto no Service é suficiente. Histórico de preços é um requisito de Fase 7+ (analytics financeiros). YAGNI.

**D2 — `value` em `ServiceHistory` auto-populado via `serviceId` em `recordHistory`**
- `RecordHistoryParams` ganhou `serviceId?: number`. Quando fornecido e `value` não explicitado, `recordHistory` busca `Service.price` e usa como valor.
- **Motivação:** permite rastreamento financeiro automático (Fase 7) sem alterar chamadas existentes (backward compatible — chamadores legados sem `serviceId` continuam funcionando).
- **Trade-off:** adiciona 1 query ao `recordHistory` quando `serviceId` é passado. Aceitável pelo peso do atendimento completo.
- **Não feito:** adicionar `serviceId` como FK em `ServiceHistory` (requer migration + analytics). Registrado como tech debt para Fase 7 onde o JOIN será necessário.

**D3 — `resolveHistoryValue` pura, testada separadamente de `recordHistory`**
- Regra de prioridade: `explicitValue !== null/undefined` → usa ele (inclusive 0 = serviço gratuito). Senão → `servicePrice`. Senão → null.
- Separação garante testabilidade sem mock de Sequelize.

**D4 — Secretary tool `consultar_catalogo` em vez de `listar_servicos`**
- Nome em PT-BR segue padrão das outras 15 tools (verbos de consulta).
- Retorna além da lista estruturada um `resumo` em texto formatado pronto para envio ao cliente via WhatsApp — o agente pode usar diretamente sem templating adicional.

**D5 — Frontend `/services` page admin-only para escrita**
- Leitura (listagem) disponível para todos os perfis autenticados.
- Escrita (create, update, remove) restrita a `admin` — verificação no controller (não no middleware, seguindo o padrão do `TagController`).
- Toggle isActive em vez de delete hard como primeira ação — preserva integração futura com agendamentos.

### Tech debt gerado (não bloqueia deploy)

- **serviceId como FK em ServiceHistory:** não adicionado nesta fase. Necessário para Fase 7 analytics financeiros (GROUP BY service, revenue por serviço). Requer migration + index.
- **Página `/services` sem paginação server-side:** catálogos de até ~500 serviços são raros em PMEs; se crescer, adicionar `page` + `limit` na API (já suportado pelo Sequelize, só falta expor).
- **Variação de preço por profissional:** clínicas podem querer preço diferente por profissional (senior vs junior). Fase futura: tabela `ServiceProfessionalPricing`.

### Validação

| Métrica | Antes | Após Fase 5 |
|---|---|---|
| Test suites | 65 | 67 |
| Tests passing | 866 | 924 |
| TypeScript errors | 0 | 0 |
| Endpoints novos | 15 retention | +5 service-catalog |
| Secretary tools | 15 | 16 |

**Status:** ✅ aprovado — migration + TypeScript clean + suite completa 924/924 passando (zero regressões).

---

## 2026-05-22 — Fase 8: Ferramentas Financeiras da Secretária IA

### Arquitetura adotada

**Decisão 1: 5 tools separados em vez de 1 monolítico**
- `consultar_faturamento`, `top_clientes_por_valor`, `top_servicos_por_receita`, `dia_mais_lucrativo`, `comparar_periodos`
- **Motivo:** cada tool tem descrição precisa para o modelo de IA escolher o certo. Um tool genérico `consultar_financeiro` com parâmetro `tipo` forçaria o modelo a inferir — mais propenso a erros.
- **Trade-off:** 5 entradas no `ALL_SECRETARY_TOOLS`. Aceitável; 23 tools no total.

**Decisão 2: `comparar_periodos` vs crescimento automático em `consultar_faturamento`**
- `consultar_faturamento` calcula período anterior automaticamente (mesma duração, janela anterior)
- `comparar_periodos` exige que o gestor informe explicitamente os dois períodos
- **Motivo:** são perguntas distintas. "Quanto crescemos?" → automático. "Compare março com abril" → explícito.

**Decisão 3: `FinanceTools.utils.ts` como utils compartilhado (sem duplicar)**
- 4 funções puras: `findMostProfitableWeekday`, `formatCurrencyText`, `clampLimit`, `buildPeriodLabel`
- Todas as 5 tools importam do mesmo arquivo — DRY conforme CLAUDE.md §II.4
- `formatCurrencyText` normaliza NBSP (U+00A0) emitido por `toLocaleString("pt-BR")` para espaço ASCII. Necessário porque: (a) testes `toBe()` falham com NBSP invisível, (b) WhatsApp pode não renderizar NBSP corretamente.

**Decisão 4: `clampLimit` com defaults max=50, def=10**
- `limit` vindo do agente IA pode ser string, undefined, zero ou negativo
- Sanitização centralizada evita queries sem LIMIT (risco de timeout em produção)
- **Alternativa descartada:** validar no controller — mas esses tools não têm controller; o ponto de entrada é direto.

**Decisão 5: `diaMaisLucrativo` retorna top 5 no resumo WhatsApp (não todos os 7 dias)**
- MySQL `DAYOFWEEK()` retorna apenas dias com dados — dias sem nenhuma transação não aparecem
- O resumo exibe no máximo 5 para não poluir a mensagem WhatsApp
- **Motivo:** dias zerados não agregam informação. Ranking completo disponível no campo `ranking[]` do response JSON.

### Métricas pós-Fase 8

| Métrica | Antes Fase 8 | Após Fase 8 |
|---|---|---|
| Test suites | 69 | 70 |
| Tests passing | 989 | 1018 (29 novos) |
| TypeScript errors | 0 | 0 |
| Tools Secretária | 18 | 23 |

**Status:** ✅ **CONCLUÍDA** — 29/29 testes TDD + TypeScript clean + full suite passando.

---

## 2026-05-22 — Fase 7: Módulo Financeiro Real

### Arquitetura adotada

**Decisão 1: Fonte de dados = ServiceHistory.value**
- Toda receita é lida da tabela `ServiceHistories` onde `value > 0`
- Inclui: atendimentos manuais, kanban_completion, scheduled_autoclose, package_purchase
- **Motivo:** única source of truth já existente. Não precisamos de tabela nova.

**Decisão 2: Agrupamento por `serviceType` (não `serviceId` FK)**
- `top-services` agrupa por `serviceType` (campo texto) em vez de `serviceId`
- `serviceId` FK continua como tech debt para Fase 7.1 (analytics mais ricos)
- **Motivo:** CLAUDE.md §II.6 — mínima mudança necessária. Funciona para o MVP sem migration.

**Decisão 3: Período anterior = mesma duração, imediatamente antes**
- `buildPreviousPeriod(start, end)` → desloca o intervalo completo para trás
- Exemplo: 01/05–22/05 (21 dias) compara com 10/04–01/05 (21 dias)
- **Motivo:** comparação justa independente de meses com durações diferentes.

**Decisão 4: Renomear "Financeiro" → "Mensalidade do CRM"**
- Item existente no sidebar (`/financeiro`) renomeado para evitar confusão com analytics
- Novo item "Financeiro" (`/finance`) adicionado com ícone de gráfico
- **Motivo:** clareza semântica — fatura SaaS ≠ analytics de receita do negócio.

**Decisão 5: `DAYOFWEEK()` SQL → conversão -1 para JS**
- MySQL/MariaDB `DAYOFWEEK()` retorna 1=Dom...7=Sab
- Convertemos para 0=Dom...6=Sab (padrão `Date.getDay()` do JS)
- `getWeekdayName(dayIndex)` usa o índice JS para nomes PT-BR
- **Motivo:** consistência com JS Date API, testável em isolamento.

### Métricas pós-Fase 7

| Métrica | Antes | Após Fase 7 |
|---|---|---|
| Test suites | 68 | 69 |
| Tests passing | 959 | 989 (30 novos) |
| TypeScript errors | 0 | 0 |
| Endpoints novos | 9 packages | +5 finance |
| Pages frontend | /packages | +/finance |

**Status:** ✅ **CONCLUÍDA** — 30/30 testes puros + 989/989 full suite (69 suites) + TypeScript 0 errors. Fix aplicado: `Op.between` com `as any` (Sequelize v5 strict typing), `literal` import removido.

---

## 2026-05-21 — Fase 6: Pacotes de Sessões

### Arquitetura adoptada

**Decisão 1: 3 modelos separados**
- `Package` — template reutilizável (nome, totalSessions, totalPrice, serviceId opcional)
- `ClientPackagePurchase` — venda concreta (snapshot de sessões/preço para imutabilidade histórica)
- `PackageConsumption` — cada sessão consumida (log granular)

**Motivo:** Separa o "produto" da "venda" da "execução". Permite múltiplos clientes comprarem o mesmo pacote, e preserva histórico mesmo se o template for alterado.

**Decisão 2: Receita cash basis**
- Uma entrada em `ServiceHistory` com `source='package_purchase'` na hora da compra
- Consumo de sessão NÃO gera ServiceHistory adicional
- **Motivo:** Simplesidade e consistência. Registro de receita acontece quando o dinheiro entra, não quando o serviço é prestado. Alinhado com práticas de pequenos negócios.

**Decisão 3: `sessionsUsed` snapshot vs COUNT JOIN**
- Opção escolhida: `sessionsUsed` campo direto em `ClientPackagePurchase`
- Alternativa descartada: COUNT de PackageConsumption em runtime
- **Motivo:** Performance — consultas de saldo não precisam JOIN+COUNT. Consistência garantida por `PackageConsumption.create` → `sessionsUsed += 1` na mesma transação lógica.

**Decisão 4: Status derivado em tempo real na tool `ver_saldo_pacote`**
- A tool chama `derivePackageStatus(sessionsUsed, totalSessions, expiresAt)` em cada consulta
- O campo `status` em banco é atualizado apenas no `consumeSession` (não por cron)
- **Motivo:** Mínima mudança necessária. Pacotes expiram silenciosamente sem precisar de job cron de varredura. Eventual inconsistência de algumas horas é aceitável para negócios físicos.

**Decisão 5: WhatsApp notificações fire-and-forget via `setImmediate`**
- Usa o mesmo padrão de LoyaltyService/BirthdayService (getActiveWhatsapp + FindOrCreateTicketService + SendWhatsAppMessage)
- `setImmediate` garante que a resposta HTTP retorna antes do envio WhatsApp
- Falhas logam WARN, nunca propagam
- **Motivo:** Disponibilidade do endpoint > entrega garantida do WhatsApp. Clientes não percebem delay de <1s.

**Decisão 6: SellModal usa ID numérico de contato (não autocomplete)**
- MVP: campo text com ID do contato
- Próxima iteração: autocomplete por nome/número (registrado como tech debt)
- **Motivo:** CLAUDE.md §II.6 — mínima mudança necessária. A funcionalidade existe e funciona; a UX pode ser melhorada depois sem quebrar o backend.

**Tech debt registrado:**
- [ ] Autocomplete de contato no SellModal (busca por nome/número via `/contacts`)
- [ ] DormantDetectionService: excluir clientes com pacote ativo da lista de adormecidos
- [ ] Cron de expiração automática de pacotes (atualizar status 'expired' via batch)
- [ ] Fase 7: serviceId FK em ServiceHistory para GROUP BY analytics por serviço

### Métricas pós-Fase 6

| Métrica | Antes | Após Fase 6 |
|---|---|---|
| Test suites | 67 | 68 |
| Tests passing | 924 | 959 (35 novos) |
| TypeScript errors | 0 | 0 |
| Endpoints novos | 5 service-catalog | +9 packages |
| Secretary tools | 16 | 18 |
| Models | Service + ServiceHistory | +Package, ClientPackagePurchase, PackageConsumption |

**Status:** ✅ aprovado — 35/35 testes puros passando + TypeScript clean. Migrations criadas. Pendente: migrar em produção.

---

## 2026-04-19 — Escolha do Whaticket SaaS como base

**Decisão:** Usar o Whaticket v6.3.0 como esqueleto do CRM Otron.

**Motivo:** Já possui WhatsApp via Baileys, multi-tenant, filas, OpenAI, campanhas, agendamentos, Kanban e PIX integrados — economizando meses de desenvolvimento.

**Alternativas descartadas:**
- Desenvolvimento do zero: muito tempo, muito risco
- Outro SaaS (ex: Chatwoot): menos recursos prontos para o mercado BR

**Riscos aceitos:**
- Baileys é não-oficial (risco de ban pelo WhatsApp)
- Dívida técnica (arquivo wbotMessageListener com 4137 linhas)
- Versões desatualizadas (React 17, Sequelize 5)

---

## 2026-04-19 — Provider Abstraction Layer para IA (multi-provedor)

**Decisão:** Implementar uma camada de abstração (`AIProviderFactory`) que suporta múltiplos provedores de IA via interface comum. Configuração por empresa no banco de dados (Settings).

**Provedores suportados:**
- `AnthropicProvider` — SDK próprio (`@anthropic-ai/sdk`)
- `OpenAICompatibleProvider` — SDK OpenAI com baseURL configurável (cobre Groq, OpenRouter, MiniMax, OpenAI)

**Motivo:** Custo e flexibilidade. Groq (Llama 3.3 70B) é praticamente gratuito no tier free. OpenRouter permite acessar Claude Haiku mais barato. Não queremos lock-in em um único provedor.

**Configuração:** Settings por empresa — `agentProvider`, `agentApiKey`, `agentModel`, `agentBaseUrl`.

**Alternativas descartadas:** SDK único (lock-in), variável de ambiente global (sem flexibilidade por empresa).

---

## 2026-04-19 — Agente de IA via Anthropic Claude API (não N8N)

**Decisão:** Usar Anthropic SDK (TypeScript) com `tool_use` para o AgentService. N8N descartado como orquestrador de IA.

**Motivo:** Claude com tool_use é mais controlável, mais barato por token, e mais manutenível do que fluxos N8N para tarefas que exigem raciocínio em linguagem natural.

**Alternativas descartadas:**
- N8N como cérebro: adequado para automações determinísticas, não para linguagem natural
- OpenAI GPT: Claude tem melhor performance em português e raciocínio multi-step

---

## 2026-04-19 — Dois agentes separados (Atendimento + Secretária)

**Decisão:** Arquitetura de dois agentes distintos:
1. **Agente de Atendimento** — canal do cliente (número do negócio)
2. **Agente Secretária** — canal do proprietário (chip separado)

**Motivo:** Responsabilidades completamente diferentes. O agente de atendimento usa RAG do negócio e técnicas de vendas/suporte. A secretária usa ferramentas de gestão (relatórios, busca, agendamentos).

**Conexão entre eles:** Agente de Atendimento pode notificar o proprietário via chip separado em casos de urgência.

---

## 2026-04-19 — RAG simplificado (sem vector DB no MVP)

**Decisão:** Para o MVP, o "RAG" do Agente de Atendimento será injeção de contexto no system prompt (sem vector database). Campos: sobre o negócio, FAQ, personalidade, instruções especiais, restrições.

**Motivo:** Para pequenos negócios (petshop, barbearia, clínica), o volume de conhecimento é pequeno o suficiente para caber no contexto do Claude. Vector DB adiciona complexidade sem ganho proporcional no MVP.

**Revisão:** Avaliar necessidade de vector DB (pgvector) quando clientes tiverem bases de conhecimento > 50KB.

---

## 2026-04-19 — Google Assistant descartado, WhatsApp como interface de voz

**Decisão:** Não implementar integração com Google Assistant (Actions on Google). Interface de voz via mensagens de áudio no próprio WhatsApp + transcrição Whisper.

**Motivo:** Actions on Google para consumidores foi descontinuado em junho/2023. WhatsApp já é familiar para o público-alvo.

**Roadmap futuro:** Alexa Skill como interface hands-free para planos premium.

---

## 2026-04-28 — Migração de `gpt-oss-120b` (Groq) para `gpt-4o-mini` (OpenAI) no agente de atendimento

**Decisão:** Trocar o modelo padrão do AgentService para `gpt-4o-mini` direto pela OpenAI. Mantemos o `OpenAICompatibleProvider` (mesmo SDK), só muda `baseURL`/`apiKey`/`model` nas Settings da empresa.

**Motivo:** Análise dos `AgentActions` em 5 rounds de bug-fix mostrou que o `gpt-oss-120b` da Groq tem comportamento errático em três pontos críticos para um agente de agendamento:
1. **Tool-chaining** — em instruções compostas tipo "cancele o A e marque o B", frequentemente executa só uma das ações.
2. **Manutenção de contexto** — perde rastro do que já foi confirmado no turno anterior; trata "Perfeito!" como nova solicitação (bug #17).
3. **Aderência a instrução** — ignora regras explícitas do system prompt sob carga de contexto.

`gpt-4o-mini` tem o mesmo custo ($0.15/$0.60 por M tokens), tool calling estado-da-arte para modelos baratos, e PT-BR nativo de qualidade. A latência é 1–2s vs ~200ms da Groq — aceitável para WhatsApp (canal assíncrono).

**Defesas mantidas mesmo com modelo melhor:** as defesas determinísticas do Round 5 (criar_evento bloqueia duplicata por cliente, reagendar atômico, prompt de fluxo) **NÃO** são removidas. Modelos LLM são probabilísticos por natureza — qualquer modelo, por melhor que seja, vai errar eventualmente. A arquitetura precisa falhar com graça independentemente do modelo escolhido.

**Alternativas avaliadas:**
- `llama-3.3-70b-versatile` (Groq) — melhor que `gpt-oss-120b` em tool calling mas ainda atrás do `gpt-4o-mini`. Vantagem: mantém infra Groq (latência baixa).
- `claude-3-5-haiku` (via OpenRouter ou Anthropic direto) — excelente em tool calling, mas 5x mais caro ($0.80/$4.00).
- `gemini-2.0-flash` (OpenRouter) — mais barato ($0.10/$0.40) mas tool calling não é tão maduro.
- `kimi-k2` (Groq) — TOP em raciocínio, mas $1/$3 — não é mais "barato".

**Plano de validação:** após troca, rodar 5 conversas de teste mantendo as defesas determinísticas. Medir taxa de erro em (a) duplicata, (b) lying about state, (c) tool-chaining incompleto. Comparar com baseline `gpt-oss-120b`. Se taxa < 5%, manter; se > 5%, escalar para `claude-3-5-haiku` ou `kimi-k2`.

**Risco aceito:** dependência de provedor único (OpenAI) para o agente. Mitigação: o `AIProviderFactory` continua suportando Groq/Anthropic/OpenRouter — troca de provedor é uma mudança de Settings da empresa, não de código.

---

## 2026-05-04 — Auto-invalidação de UserCalendar em runtime quando token quebra

**Decisão:** Quando uma tool de Calendar (hoje só `criarEvento`) recebe `invalid_grant` ou `insufficient authentication scopes` da API do Google, marcar `UserCalendar.isActive=false` automaticamente — sem aguardar ação humana.

**Motivo:** UX. A tela "Configurações → Calendário" lê `isActive` do banco para mostrar o chip verde "Conectado" / vermelho "Desconectado". Se o token entra em estado inválido permanente (revogado, sem scope, etc.), o chip continuava verde e o usuário não tinha como saber até um cliente reclamar. Agora a UI reflete realidade automaticamente — basta o usuário abrir Configurações para ver "Desconectado" e clicar em Conectar novamente.

**Não fazer fora do `criarEvento`:** Outras tools (`verificarDisponibilidade`, `buscarProximoHorario`, `cancelarEvento`, `reagendarEvento`) também podem encontrar esses erros, mas a invalidação automática só está em `criarEvento` por enquanto. Razão: cada tool teria que importar `UserCalendar` e replicar a lógica de update. Em vez disso, planejado para próximo round: extrair `executeWithCalendarErrorHandling()` em `GoogleCalendarService/calendarApi.ts` e centralizar — todas as tools usariam o mesmo wrapper. Adiado por escopo (CLAUDE.md II.6 — mínima mudança necessária neste round).

**Alternativas descartadas:**
- Cron job que verifica saúde dos tokens periodicamente (overengineering para um sintoma raro).
- Não auto-invalidar e contar com o usuário ler o banner (banner ajuda mas não dispensa o `isActive=false`).
- Tentar refresh manual antes de invalidar (o `googleapis` SDK já tenta; quando lança o erro, é porque o refresh já falhou).

**Risco aceito:** falsos positivos em casos transitórios (Google está temporariamente fora do ar). Aceitável porque (a) `invalid_grant` e `insufficient authentication scopes` são erros permanentes pelo design da API, (b) o usuário só precisa clicar "Conectar" se errar, (c) prevenir agendamento errado é mais importante do que evitar reconexão desnecessária.

---

## 2026-05-04 — Validação rígida de scopes na callback OAuth do Google

**Decisão:** Rejeitar tokens devolvidos pelo Google que não contêm o scope `https://www.googleapis.com/auth/calendar`. Implementado em `oauth.handleOAuthCallback` antes de qualquer chamada que persista o token (lança `MissingCalendarScopeError`).

**Motivo:** O fluxo OAuth do Google tem uma "armadilha" pouco conhecida: a tela de consent mostra cada scope com checkbox separado, e o usuário pode desmarcar individualmente. Se desmarcar tudo exceto perfil/email, o Google ainda devolve um token "válido" (HTTP 200, com `access_token` e `refresh_token`), mas com scopes reduzidos. Sem validação, salvávamos o token e a UI mentia "Conectado". Discovery: telefone reportado pelo usuário em 04/05/2026.

**Implementação em camadas (defesa em profundidade):**
1. Validação na callback (rejeição preemptiva).
2. Auto-invalidação em runtime (caso passe pela primeira camada).
3. UX explícita no frontend (banner laranja + toast direcionado).

**Alternativas descartadas:**
- Validar scopes só no momento da primeira chamada à API (perde a oportunidade de avisar o usuário no fluxo de conexão).
- Pedir ao Google que force consent completo via parâmetro `include_granted_scopes` (não impede o usuário de desmarcar individualmente).
- Tentar uma chamada de "ping" à API logo após salvar o token (mais latência no fluxo de conexão para todos os usuários, sem ganho real).

**Trade-off:** O scope de `auth/calendar` é amplo (read+write+delete). Tecnicamente poderíamos pedir scopes mais restritos como `calendar.events` ou `calendar.readonly` para algumas tools, mas mantemos `auth/calendar` para o app inteiro. Aceitável porque o agente precisa criar/deletar eventos (não é leitura passiva), e a divisão por tool aumentaria complexidade sem benefício prático no contexto atual.

---

## 2026-05-07 — Re-iteração forçada para promise-text (defesa determinística de Bug #20)

**Decisão:** Quando o LLM retorna texto no padrão "promessa sem ação" (ex: "Vou listar os serviços...") sem tool_calls, o loop em `handleClientAgent` injeta uma mensagem corretiva e força re-iteração — em vez de aceitar o promise como resposta final.

**Motivo:** `buildExecutionFlowBlock()` (instrução probabilística no system prompt) não foi suficiente para impedir que o gpt-4o-mini emitisse promise-text e parasse. Uma instrução no prompt depende do LLM obedecer; um guarda determinístico no loop não depende.

**Implementação:** `looksLikePromise(text)` + `continue` dentro do `while` loop. Limites:
- Só ativa se `iterations < MAX_ITERATIONS - 1` (preserva headroom para síntese).
- Detecta padrões específicos: "vou [verbo de ação]", "estou verificando", "deixa eu ver" — não genérico demais.
- NÃO ativa para textos com "✅"/"confirmado"/"agendado" (conclusões legítimas) nem para perguntas (terminam com "?").

**Alternativas descartadas:**
- Confiar apenas no prompt: já tentado no round 7, falhou.
- `tool_choice: "required"` (OpenAI API): força o LLM a sempre chamar uma tool — mas há casos legítimos sem tool (perguntas ao cliente, respostas finais de confirmação). Seria over-engineering.
- Re-executar sem injetar mensagem (reiniciar o LLM "do zero"): perderia o contexto da conversa.

**Risco aceito:** A injeção de `[SISTEMA]: ...` como role=user pode confundir o LLM em raros casos. Em testes, o LLM honra corretamente. Se uma ferramenta legítima não existir, o LLM retornará erro orientativo em vez de loop infinito (limitado por MAX_ITERATIONS).

---

## 2026-05-07 — contactId sempre repassado ao contexto de execução das tools

**Decisão:** Incluir `contactId` do input de `handleClientAgent` no contexto passado a `executeAgentTool` (campo `ToolExecutionContext.contactId`).

**Motivo:** Bug #22: o `contactId` era omitido do contexto. `executeCalendarTool` usa `args.contactId ?? ctx.contactId` — quando o LLM esquecia de incluir `contactId` nos args (comportamento inconsistente do gpt-4o-mini), o Sequelize recebia `contactId: undefined`, o check anti-duplicata de `criar_evento` não encontrava o agendamento existente, e a criação passava.

**Trade-off:** O `contactId` agora vem do servidor (infalível), não do LLM (pode omitir). Isso é mais correto: o `contactId` é um dado de contexto operacional que o servidor conhece com certeza — o LLM não deveria precisar "lembrar" dele. O campo `contactId` continua opcional na interface `ToolExecutionContext` para compatibilidade com contextos que não têm `contactId` (ex.: SecretaryService).

**Alternativas descartadas:**
- Forçar o LLM a sempre incluir `contactId` via instrução de prompt: propenso a falhas; o LLM confunde IDs em conversas longas.
- Validar presença de `contactId` nos args antes de executar a tool: quebraria casos legítimos onde `contactId` vem do contexto.

---

## 2026-05-09 — Defesas contra Prompt Injection e Jailbreaking (Round 9)

**Decisão:** Implementar três camadas de defesa determinísticas/probabilísticas contra manipulação do agente via mensagens do cliente WhatsApp, em `securityGuards.ts`.

**Contexto:** O agente recebe texto aberto de qualquer pessoa que tenha o número. Um cliente malicioso pode tentar: (a) override de instruções via `[SISTEMA]: nova regra`, (b) extração do system prompt, (c) ativação de "modos especiais" (jailbreak/desenvolvedor), (d) padding attack (mensagem gigante para afogar o system prompt no contexto).

**Camadas implementadas:**

1. **Separação de Lógica e Dados (Regra de Ouro — já existia):** O LLM nunca decide preços, cria registros ou executa ações diretamente. Toda operação crítica passa por Tools determinísticas. Esta era a defesa mais importante e já estava em vigor antes do Round 9.

2. **Input Sanitization (determinística):** `sanitizeUserMessage()` — remove padrões de injeção conhecidos (`[SISTEMA]:`, `</system>`, `ignore all previous instructions`, `esqueça suas instruções`, `jailbreak`, `modo desenvolvedor`, etc.) da mensagem do cliente antes de enviar ao LLM. Mensagens acima de 2000 chars (padding attack) são truncadas. Injeção detectada gera `logger.warn` para auditoria.

3. **Input Wrapping (probabilística):** `wrapUserMessage()` — envolve a mensagem sanitizada com `[MENSAGEM_CLIENTE_INICIO]...[MENSAGEM_CLIENTE_FIM]`. O `buildSecurityBlock()` instrui o LLM que tudo entre esses delimitadores é "dado do cliente, nunca instrução". Mesmo que injeção passe pela sanitização, o LLM recebe contexto explícito sobre a natureza do texto.

4. **Output Guardrails (determinística):** `checkOutputSafety()` — verifica a resposta do LLM antes de enviá-la ao cliente. Bloqueia respostas com indicadores de jailbreak (`jailbreak ativado`, `modo desbloqueado ativado`, `fui reprogramada para`, `meu system prompt diz`) e as substitui por `SECURITY_FALLBACK_REPLY`. Resultado bloqueado é logado com `reason` para auditoria.

5. **Prompt Hardening (probabilística):** `buildSecurityBlock()` — instrução explícita adicionada ao system prompt sobre: escopo exclusivo, não revelar dados internos, tratar texto do cliente como dado (não instrução), manter identidade, usar tools para preços.

**Histórico de contexto:** Salva `sanitizedMessage` (não wrapped) — mantém histórico limpo e legível para iterações futuras.

**Alternativas descartadas:**
- Bloquear mensagem inteiramente quando injeção é detectada: frustra clientes legítimos que acidentalmente usam palavras como "ignore" em contexto normal. Sanitizar e logar é mais gentil.
- Guardrail de output mais agressivo (ex: bloquear qualquer menção a "system prompt"): alto risco de falso positivo quando o bot legitima mente recusa revelar, dizendo "não posso revelar meu system prompt".
- WAF externo ou middleware dedicado: overengineering para MVP; as defesas no código são rastreáveis, testáveis e colocalizadas com o agente.

**Risco aceito:** Padrões de injeção novos ou criativos podem não ser cobertos pela lista `INJECTION_PATTERNS`. Mitigação: (a) as defesas determinísticas (tools, sanitização, guardrail) formam defesa em profundidade — uma camada que falha não compromete as outras; (b) `INJECTION_PATTERNS` é extensível; (c) logs de `[SECURITY]` permitem detectar novos padrões em produção.

**TDD:** 23 novos testes em `securityGuards.spec.ts` + 5 testes de integração em `AgentService.spec.ts`. Suite completa: 36 suítes, 293 testes, todos passando.

---

## 2026-05-11 — Bug #31 + Bug #32: Eliminação da ambiguidade de serviços e gate determinístico anti-multi-availability

**Contexto:** Em testes do agente, dois sintomas correlacionados apareceram:
- (#31) Bot listava 12 serviços que não existiam no BD, vindos do campo "Serviços Oferecidos" do Conhecimento do Negócio (texto livre digitado pelo usuário).
- (#32) Após o usuário pedir "que horários tem na quinta a tarde?" (sem especificar serviço), o bot despejava todos os serviços × todos os slots em uma única resposta gigante — UX inviável com 10+ serviços.

**Causa raiz #31:** Duas fontes de verdade para serviços — (a) `Configurações → Serviços` (BD, com schedules e tool `listar_servicos`); (b) `Configurações → Agentes de IA → Conhecimento do Negócio → Serviços Oferecidos` (texto livre injetado no system prompt). Quando divergiam, o LLM preferia o texto livre (mais saliente no prompt).

**Causa raiz #32:** Tentativas anteriores de fix via `Rule 11` no prompt falharam porque regras de prompt são probabilísticas — o LLM literalmente ignorava a instrução e chamava `verificar_disponibilidade` sequencialmente para cada servicoId retornado por `listar_servicos`. Fix em camada errada (probabilística em vez de determinística).

**Solução implementada (defesa em profundidade):**

1. **#31 — Eliminação da ambiguidade (Mínima Mudança Necessária):**
   - `knowledgeBuilder.ts`: removido `agentServices` da interface, do `loadAgentSettings` e do array de seções. Substituído por instrução explícita: "Para obter NOMES e IDs dos serviços, use `listar_servicos`. listar_servicos retorna nomes/IDs — NÃO usa para checar agenda."
   - `AgentSettings.js` (frontend): removido o `TextField "Serviços Oferecidos"`, a chave do `SETTING_KEYS` e a chave do estado inicial.
   - Tests: 2 novos em `knowledgeBuilder.spec.ts` — agentServices não vaza para o prompt; instrução de catálogo presente.

2. **#32 — Gate determinístico no agent loop:**
   - `AgentService/index.ts`: Set `availabilityServicosThisTurn` rastreia servicoIds já consultados no turno corrente. Antes de executar `verificar_disponibilidade` ou `buscar_proximo_horario`, o gate checa: se já houve consulta para outro servicoId, a tool é interceptada e o LLM recebe um tool result com `erro: "BLOQUEADO: você já consultou disponibilidade..."` instruindo a perguntar ao cliente qual procedimento ele quer.
   - O bloqueio é loggado em `AgentAction` com `success: false` para auditoria.
   - Tests: 5 novos em `AgentService.spec.ts` — bloqueio de 2º serviço, payload do erro, cobertura cruzada das duas tools, NÃO bloqueio para mesmo servicoId (datas diferentes), NÃO bloqueio para outras tools.

**Por que dois fixes para o mesmo sintoma:** A causa raiz do dump não era só "LLM tem lista grande de serviços" (#31) — mesmo com 4 serviços reais o LLM ainda dumpa todos por padrão (#32). #31 elimina alucinações de serviços fantasmas; #32 garante que mesmo com a lista correta, só 1 serviço por turno é consultado.

**Alternativas descartadas:**
- Apenas reescrever Rule 11 com linguagem ainda mais enfática: já falhou 3 vezes. Regras de prompt são suficientes para guiar, mas insuficientes para garantir comportamento — precisa da camada determinística (CLAUDE.md Seção 5).
- Limitar `verificar_disponibilidade` a 1 chamada por turno globalmente (independente de servicoId): quebraria casos legítimos onde o cliente pede "horários de quinta e sexta" para o mesmo serviço.
- Esconder a tool `listar_servicos` quando não há contexto de "qual serviço": adiciona estado e complica o roteamento; o gate atual é stateless até o turno e óbvio na auditoria.

**Risco aceito:** O LLM pode ser confundido pelo tool result de erro e responder em texto sobre o "BLOQUEADO". O wording da mensagem foi cuidado para ser instrutivo ("PERGUNTE ao cliente"), e nos testes o LLM respondeu corretamente. Em produção, monitorar `[Bug#32] Bloqueada consulta` nos logs.

**TDD:** 7 novos testes ao todo (2 knowledgeBuilder + 5 AgentService). Suite alvo (`knowledgeBuilder.spec.ts` + `AgentService.spec.ts`): 49/49 passando.

---

## 2026-05-11 — Escalabilidade P0: 4 fixes para suportar 20 clientes simultâneos

**Contexto:** Auditoria arquitetural revelou que com 20 clientes simultâneos o sistema travaria em 1-3 minutos. Causa: pool padrão de Sequelize = 5 conexões; sem timeout no LLM; Settings lidas 2× por turno sem cache; mensagens do mesmo cliente processadas em paralelo com risco de race condition.

**4 fixes implementados (em ordem de impacto):**

1. **Pool do Sequelize** (`config/database.ts`): `pool: { max: 30, min: 2, acquire: 30000, idle: 10000 }`. Sozinho move o teto de ~5 para 20+ clientes simultâneos. Zero risco — é configuração pura.

2. **Timeout LLM 30s** (`AnthropicProvider.ts`, `OpenAICompatibleProvider.ts`): Anthropic SDK com `timeout: 30000, maxRetries: 2`; fetch OpenAI-compatible com `AbortSignal.timeout(30000)`. Sem timeout, LLM lento segurava conexão de pool indefinidamente. Com timeout, erro retorna em ≤30s e o pool slot é liberado. O `catch → finishReason: "error"` já existia — a única mudança é o timeout garantido.

3. **Cache de Settings TTL-30s** (`settingsCache.ts` — novo módulo): `getSettingsByCompany(companyId)` centraliza e deduplica `Setting.findAll` com cache em memória de 30s. `loadProviderConfig` e `loadAgentSettings` (knowledgeBuilder) agora chamam o cache em vez do BD diretamente. O `Promise.all([loadProviderConfig, buildSystemPrompt])` que antes fazia 2 queries idênticas ao BD agora faz 1 (cache hit na segunda). Com 20 clientes da mesma empresa: de 40 queries/turno para 1. `clearSettingsCache()` exportada para isolamento de testes (adicionada no `beforeEach` dos specs afetados).

4. **Mutex por contato na fila de mensagens** (`wbotMessageListener.ts`): Mensagens agrupadas por `remoteJid` antes do `Promise.all`. Mensagens do MESMO contato processam em série (evita race no contexto Redis); contatos DIFERENTES processam em paralelo (sem degradação de throughput). Mudança de 5 linhas de lógica sem alterar chamadas downstream.

**TDD:** 13 novos testes — 4 em `AnthropicProvider.spec.ts` (novo), 2 em `OpenAICompatibleProvider.spec.ts`, 7 em `settingsCache.spec.ts` (novo). Suite completa: 43 suítes, 361 testes, todos passando. Zero regressão.

**O que NÃO foi feito (tech debt documentado):**
- Fila persistente Bull/Redis para mensagens agente: sem ela, restart do backend em pico = perda de mensagens em voo. Estimativa: 1-2 dias. Prioridade para escalar além de 50 clientes simultâneos.
- Cache de `getBusyPeriods` do Google Calendar (TTL 30s): reduziria latência percebida. Prioridade: média.
- Rate limit handling explícito para Anthropic 429: o `maxRetries: 2` do SDK cobre a maioria dos casos. Se ultrapassar, retorna `finishReason: "error"` e o cliente recebe a mensagem de fallback. Monitorar em produção.

**Capacidade estimada após os 4 fixes:** 20+ clientes simultâneos confortavelmente. Pico de 30-40 é possível mas não testado.

---

## 2026-05-17 — Sprint 1: Remoção de módulos externos de IA e integrações não utilizadas

**Decisão:** Remover do produto CRM Otron todas as referências a integrações externas de IA (Prompts / GPT-4, Gemini API, Typebot, N8N, Dialogflow) e o módulo QueueIntegration, tanto no frontend (rotas, sidebar, páginas, componentes) quanto no backend (controllers, services, rotas HTTP).

**O que foi removido:**
- Frontend: páginas `/prompts` e `/queue-integration`, componentes `PromptModal` e `QueueIntegrationModal`
- Frontend: sidebar items (showOpenAi, showIntegrations) e estados associados
- Frontend `Options.js`: seções "Tipo Chatbot", "Gemini AI" e "Giphy API", com todos os estados/handlers
- Frontend: assets `n8n.png`, `dialogflow.png`, `typebot.jpg`, `webhook.png`
- Frontend: páginas órfãs `pages/Settings/`, `pages/Reports/`, `pages/TicketsAdvanced/` (não referenciadas nas rotas)
- Backend `routes/index.ts`: imports e `routes.use()` de `promptRouter` e `queueIntegrationRoutes`
- Backend: `PromptController.ts`, `PromptServices/` (5 serviços), `routes/promptRouter.ts`
- Backend: `QueueIntegrationController.ts`, rotas de 4 dos 5 serviços `QueueIntegrationServices/`, `routes/queueIntegrationRoutes.ts`

**O que foi MANTIDO intencionalmente (tech debt documentado):**
- `backend/src/models/Prompt.ts` — referenciado por `Queue.ts` e `Whatsapp.ts` via `belongsTo/promptId`. Remoção exigiria migração de banco + edição de modelos core. Adiado para sprint separado com downtime controlado.
- `backend/src/models/QueueIntegrations.ts` — referenciado por `Queue.ts`, `Whatsapp.ts` e `Ticket.ts`.
- `backend/src/services/QueueIntegrationServices/ShowQueueIntegrationService.ts` — restaurado após deleção acidental; é chamado 4× em `wbotMessageListener.ts` para rotear mensagens para integrações ainda cadastradas no banco (typebot/n8n). Sem essa chamada, mensagens que chegarem com `integrationId` em filas antigas causariam runtime crash. Será removido junto com as migrações de limpeza de coluna FK.
- `backend/src/routes/geminiRoutes.ts` — Gemini ainda é usado internamente pelo AgentService como provider. Não é a mesma coisa que a "configuração de token Gemini" que foi removida do Options.js. Mantido.

**Motivo:** Decisão estratégica do produto: o CRM Otron é um SaaS com IA própria (AgentService + SecretaryService). Ter configurações de IA externa expostas para cada cliente-empresa gera confusão de produto e surface de ataque desnecessária. O valor da IA é entregue via nosso sistema agêntico gerenciado, não via configuração manual de tokens de terceiros.

**Alternativa descartada:** Ocultar via feature flag sem remover o código — aumenta manutenção, confunde novos desenvolvedores, e mantém dead code que pode ser revisitado inadvertidamente.

**Próximos passos (tech debt):**
- Migração de limpeza: remover colunas `promptId` de `queues` e `whatsapps`, remover tabela `prompts`, remover `Prompt.ts` model, remover `ShowQueueIntegrationService` e demais referências a `integrationId` no `wbotMessageListener.ts`. Estimativa: 1 dia + downtime de 5 min para migration. Prioridade: média (não impacta funcionalidade ativa).

---

## 2026-05-28 — Auditoria do módulo de Calendário: 2 causas-raiz (período do dia + fuso no write path)

**Contexto:** Regressão reportada em produção — o agente WhatsApp respondia "não consegui verificar a disponibilidade para o corte de cabelo na tarde de amanhã" quando o cliente pedia horários "à tarde", enquanto a manhã funcionava. Calendário conectado, APIs renovadas (OpenAI gpt-4o-mini). Pedido do usuário: auditar TODO o módulo de calendário (visualização, agendamento, reagendamento, cancelamento), achar e corrigir a causa raiz, deixar o sistema robusto. Investigação encontrou DUAS causas-raiz independentes.

### Bug A (#35) — Filtro de período delegado ao LLM (sintoma reportado)

**Causa raiz:** A tool `verificar_disponibilidade` devolvia os slots do DIA INTEIRO e o filtro de "manhã/tarde/noite" era responsabilidade do LLM no prompt. `gpt-4o-mini` (modelo barato, exigido pelo projeto) falhava ao filtrar a sublista da "tarde" e caía no fallback de erro genérico ("não consegui verificar"). Isso viola CLAUDE.md I — lógica de negócio determinística não pode depender do componente probabilístico.

**Fix (determinístico):**
- `availabilityEngine.ts`: novas funções puras `normalizePeriod(raw)` (PT/EN, acentos, prefixos como "à tarde" → enum `manha`/`tarde`/`noite`) e `filterSlotsByPeriod(slots, periodo)` com fronteiras `manhã <12:00`, `tarde 12:00–18:00`, `noite ≥18:00`.
- `verificarDisponibilidade.ts` e `buscarProximoHorario.ts`: novo argumento opcional `periodo`; o filtro é aplicado no backend antes de retornar. Em `buscarProximoHorario`, o período se aplica a TODOS os 7 dias da busca (slot esvaziado por período não bloqueia a busca nos dias seguintes). Mensagem de "nenhum horário" passou a citar o período pedido.
- Descrições das tools instruem o LLM a apenas REPASSAR o termo do cliente em `periodo`, "não filtre você mesmo".
- `AgentService` `buildAgendamentoFlowBlock`: nova regra 13 reforçando o repasse (camada probabilística complementar à determinística).

**TDD:** 16 testes em `availabilityEngine.spec.ts` (normalizePeriod + filterSlotsByPeriod, incluindo fronteiras 12:00/18:00) e 2 cenários de conversa (`conversationScenarios.spec.ts` Cenário 13).

### Bug B (#36) — Fuso horário ausente no WRITE PATH (latente, crítico)

**Causa raiz (descoberta durante a auditoria, não estava no sintoma reportado):** `criarEvento.ts` e `reagendarEvento.ts` montavam o instante do agendamento com `new Date(`${data}T${hora}:00`)` SEM offset de fuso. Em Node, string ISO sem offset é interpretada no fuso LOCAL do processo. O servidor de produção roda em UTC (container Docker, sem env `TZ`), então "14:00" virava 14:00 UTC = **11:00 BRT** — o evento era criado 3h ADIANTADO no relógio do cliente, e a guarda determinística de "horário no passado" (Bug #13) podia REJEITAR horários futuros válidos no fim da tarde. O READ path (`getBusyPeriods`) já fora corrigido no Bug #33; o WRITE path ficou pendente.

**Fix (mínima mudança):** Novo módulo puro `timezone.ts` com `brtWallClockToInstant(data, hora)` e `BRT_OFFSET = "-03:00"` (Brasil sem DST desde 2019 → offset fixo). `criarEvento` e `reagendarEvento` passam a usar o helper em todas as construções de instante (guarda de passado, `startISO`/`endISO` enviados ao Google, `sendAt` persistido no Schedule). `criarEvento` reusa o `sendAt` já validado em vez de reconstruir 3×.

**TDD:** 5 testes em `timezone.spec.ts` (14:00 BRT=17:00Z, virada de dia, offset fixo verão/inverno) + 2 testes em `criarEvento.spec.ts` provando que `startDateTime`/`endDateTime` enviados ao Google e o `sendAt` persistido são o instante BRT correto, independentes do fuso do runner.

**Por que dois commits lógicos:** Bug A e Bug B são causas-raiz independentes; foram corrigidos no mesmo ciclo de auditoria mas são rastreáveis separadamente (CLAUDE.md II.6 — mínima mudança por problema).

---

## 2026-05-31 — Bug #37: período do dia ainda dependia do LLM (TRIGGER probabilístico) + dist/ defasado

**Contexto:** Após o fix do Bug #35, declarei o módulo "robusto" com base na suíte de testes. O usuário reiniciou back+front, repetiu "E para a tarde?" e FALHOU NOVAMENTE. Duas causas-raiz por trás da reincidência:

**Causa raiz 1 — TRIGGER ainda probabilístico:** o Bug #35 moveu o FILTRO de período para dentro da tool (determinístico), mas o GATILHO continuava sendo o LLM lembrar de passar o argumento `periodo`. `gpt-4o-mini` frequentemente omitia o argumento ao receber "E para a tarde?", então a tool devolvia o dia inteiro e o modelo voltava a cair no fallback de erro. Os testes de cenário mascaravam isso porque mockavam o LLM JÁ chamando a tool COM `periodo` — provavam o filtro determinístico, não o gatilho real.

**Causa raiz 2 — `dist/` defasado:** o usuário roda `npm start`, que executa o `dist/server.js` COMPILADO. Os fixes em `.ts` nunca foram compilados (`dist/.../timezone.js` sequer existia). Ou seja, mesmo um fix correto jamais chegou ao runtime — nenhuma alteração de código tinha efeito sem `npm run build` antes do restart.

**Fix (determinístico, na camada de orquestração):** em `AgentService/index.ts`, dentro do handler de `AVAILABILITY_TOOLS` (após o gate de serviço do Bug #32, antes de executar a tool), extraímos o período da MENSAGEM ATUAL do cliente via `normalizePeriod(sanitizedMessage)` e o injetamos em `toolCall.arguments.periodo` SOMENTE quando o LLM o omitiu. Usa o turno atual (nunca o histórico) para não arrastar período de turnos anteriores; respeita a escolha do LLM se ele já passou um período válido. Assim o filtro de tarde/manhã/noite deixa de depender do componente probabilístico (CLAUDE.md I).

**TDD:** 2 cenários adicionais em `conversationScenarios.spec.ts` (Cenário 13): (a) LLM OMITE `periodo` para "E para a tarde?" → asserção de que `verificar_disponibilidade` recebe `periodo="tarde"` após injeção; (b) mensagem sem período → nenhuma injeção (`periodo` undefined).

**Aprendizado (registrado para auditoria):** "passou nos testes" ≠ "funciona em produção" quando (a) os testes mockam justamente o elo probabilístico que falha em produção, e (b) o artefato em execução (`dist/`) não foi recompilado. Procedimento de deploy obrigatório a partir de agora: `npm run build` ANTES de `npm start`/restart. Não declarar "robusto" sem recompilar e validar o caminho determinístico independente do LLM.

---

## 2026-05-31 — Bug #38 + Feature UX-1: horários em horas cheias + exibição como faixa

### Bug #38 — Slots em horários "quebrados" (12:52, 13:50, 14:48…)

**Contexto:** Após o fix do Bug #37, o cliente perguntou "E para a tarde?" e o agente respondeu corretamente com horários disponíveis — mas os horários eram 12:52, 13:50, 14:48, 15:46, 16:44. O serviço "Corte Feminino" tem `durationMinutes = 58`. A agenda da tarde estava inteiramente livre.

**Causa raiz:** `calculateAvailableSlots` em `availabilityEngine.ts` usava `slotInterval = Math.min(durationMinutes, 60)`. Para duração=58 → passo=58 min. O grid partia de 09:00 (início do expediente) e avançava 58 min a cada slot: 09:00, 09:58, 10:56, 11:54, **12:52**, **13:50**, **14:48**, **15:46**, **16:44**. O filtro de "tarde" (≥ 12:00) pegava apenas os últimos — horários que o cliente não conseguia interpretar como horas disponíveis.

**Fix (mínima mudança — 1 linha):**
```typescript
// Antes:
const slotInterval = Math.min(durationMinutes, 60);
// Depois (Bug #38):
const slotInterval = durationMinutes <= 30 ? 30 : 60;
```
Serviços ≤ 30 min → grade de meia-hora (09:00, 09:30…). Demais → grade de hora cheia (09:00, 10:00…). Para o serviço de 58 min: slots agora em 09:00, 10:00, … 17:00. Tarde filtrada: 12:00, 13:00, 14:00, 15:00, 16:00, 17:00.

**TDD:** 4 novos testes em `availabilityEngine.spec.ts`: (a) duration=58 gera slots em horas cheias e não contém 12:52; (b) duration=45 também; (c) duration=30 mantém grade de meia-hora; (d) filtro de tarde com duration=58 retorna horas cheias.

### Feature UX-1 — Disponibilidade exibida como faixa de horário

**Contexto:** Mesmo com os horários corrigidos, listar "12:00, 13:00, 14:00, 15:00, 16:00, 17:00" no WhatsApp é verboso. O usuário pediu apresentação como range: "temos horários das 13:00 às 18:00" ou, com lacunas, "das 13:00 às 15:00 e das 17:00 às 18:00".

**Implementação:**
- `availabilityEngine.ts`: nova função pura `slotsToRanges(slots, durationMinutes): string`. Agrupa slots consecutivos (gap ≤ slotInterval) em faixas; o fim de cada faixa é `últimoSlot + slotInterval`. Slots separados por mais de um intervalo geram duas faixas unidas por " e ".
- `verificarDisponibilidade.ts`: campo `rangeFormatado` adicionado à interface `ProfissionalSlots` e computado após `filterSlotsByPeriod`. A tool description orienta o LLM a usar esse campo.
- `AgentService/index.ts`: regra 14 instrui o LLM a apresentar `rangeFormatado` em vez de listar slots individualmente; mantém `slots` para validação da escolha do cliente.

**TDD:** 7 testes em `availabilityEngine.spec.ts`: lista vazia, slot único (60 min e 25 min), tarde inteira livre, lacuna no meio, três faixas separadas, serviço de 90 min.

---

## 2026-05-31 — Bug #39 + Bug #40: faixa determinística (sem lista) + contexto de serviço em refinamento

**Contexto:** Após reiniciar com o build correto, o usuário reportou DOIS novos problemas: (1) o agente continuava LISTANDO todos os horários ("12:00, 13:00, 14:00…") mesmo já mostrando a faixa "das 12:00 às 18:00"; (2) ao dizer "cortar o cabelo" e depois "E a tarde?", o agente RE-PERGUNTOU qual serviço — perdendo o contexto.

### Bug #39 — LLM lista slots apesar da regra de usar a faixa

**Causa raiz:** `verificar_disponibilidade` devolvia o array `slots` ao LLM. A regra 14 (prompt) mandava usar `rangeFormatado` e não listar, mas regra de prompt é probabilística — gpt-4o-mini via o array no JSON e o despejava. (Mesmo padrão dos bugs #35/#37: depender do LLM para lógica determinística falha.)

**Descoberta crítica durante a investigação:** `criar_evento` NÃO validava se o horário escolhido estava livre/no expediente — só checava passado (Bug #13) e duplicata (Bug #8/#15). A correção do sintoma de apresentação dependia de remover o array `slots`; mas remover sem validar abriria risco de double-booking (o LLM era a única barreira). Era uma lacuna determinística latente.

**Fix (duas camadas determinísticas):**
1. `verificarDisponibilidade.ts`: a resposta deixou de incluir o array `slots`. Agora expõe `horariosDisponiveis` (contagem) + `rangeFormatado` (faixa). Sem o array, o LLM não tem como listar — a apresentação por faixa é determinística.
2. `criarEvento.ts`: nova validação determinística antes de criar — recalcula os horários livres do profissional no dia (expediente via `UserWorkingHours` + agenda via `getBusyPeriods` + `calculateAvailableSlots`) e recusa se `hora` não for um slot válido. `fail-open` se a checagem do Google falhar (não bloqueia agendamento por erro transitório). É a única garantia determinística contra double-booking / horário fora da grade, agora que o LLM não recebe mais a lista de slots.

**TDD:** 5 testes em `tools/criarEvento.spec.ts` (não atende no dia; fora do expediente; sobre horário ocupado; horário válido; fail-open no erro do Google) + asserções em `verificarDisponibilidade.spec.ts` (devolve `horariosDisponiveis`/`rangeFormatado`, NÃO devolve `slots`). Specs existentes de `criar_evento` (ambos os arquivos) atualizados para mockar `UserWorkingHours` + `getBusyPeriods`.

**Tech debt registrado:** `reagendar_evento` tem a MESMA lacuna (não valida disponibilidade do novo horário). Não foi alterado neste ciclo (mínima mudança — o sintoma reportado era no fluxo de criação). Item para próximo ciclo: aplicar a mesma validação determinística em `reagendarEvento.ts`.

### Bug #40 — Agente re-pergunta o serviço em refinamento de disponibilidade

**Causa raiz:** `buildLastServiceBlock` injeta deterministicamente o serviço em discussão, mas seu texto só cobria a CONFIRMAÇÃO de agendamento ('quero agendar', 'sim'…). Quando o cliente REFINA a disponibilidade ("E a tarde?"), nenhuma regra dizia "use o mesmo serviço" — então a regra 11 ("pergunte o serviço primeiro") vencia e o agente re-perguntava, mesmo já conhecendo o serviço.

**Fix:** (1) `buildLastServiceBlock` estendido: mensagens de refinamento ("e a tarde?", "e amanhã?", "tem mais cedo?", "outro dia?") referem-se ao MESMO serviço — chamar a tool de disponibilidade diretamente, é PROIBIDO re-perguntar. (2) Regra 11 ganhou EXCEÇÃO explícita: se existe bloco "Serviço em discussão", não pergunte nem chame `listar_servicos`. Continua sendo camada de prompt (complementar à injeção determinística do bloco), mas fecha o conflito de regras que causava o sintoma.

---

## 2026-05-31 — Bug #41: validação determinística de disponibilidade no reagendar_evento

**Contexto:** Tech debt registrado na entrada do Bug #39 (acima). `reagendar_evento` tinha a MESMA lacuna determinística que `criar_evento` tinha antes do Bug #39: não validava se o NOVO horário escolhido (`novaData`/`novaHora`) estava dentro do expediente do profissional e livre na agenda.

**Causa raiz:** `reagendarEvento.ts` confiava que o LLM havia escolhido um horário válido. Antes da Feature UX-1 o LLM ao menos recebia a lista de slots de `verificar_disponibilidade` e podia (probabilisticamente) validar; depois da UX-1 a tool passou a devolver só a faixa, então o LLM não tem mais a lista exata. Sem checagem determinística, o agente podia remarcar para fora do expediente OU sobre um horário já ocupado (double-booking) — sem nenhuma barreira determinística.

**Fix:** validação determinística em `reagendarEvento.ts`, espelhando o Bug #39, rodando ANTES do PASSO 1 (criar novo evento) para falhar rápido sem tocar o Google Calendar:
1. Carrega `UserWorkingHours` para o `dayOfWeek` do novo dia (do profissional NOVO se `novoAtendenteId` for informado). Se não trabalha → recusa com "não atende".
2. Chama `getBusyPeriods` com `.catch(() => null)` (fail-open: erro transitório do Google não bloqueia a remarcação).
3. Roda `calculateAvailableSlots` e recusa se `novaHora` não estiver na lista, com erro instrutivo incluindo `slotsToRanges(livres)` (faixa de horários livres para o LLM oferecer ao cliente).

**TDD:** 5 testes novos em `__tests__/tools/reagendarEvento.spec.ts` (bloco `describe` "Bug #41"), espelhando os 5 do Bug #39: não atende no dia; fora do expediente (08:00); sobre horário ocupado (14:00 com busy 14:00–15:00); horário válido e livre; fail-open no erro do Google. Specs existentes de `reagendar_evento` atualizados para mockar `UserWorkingHours` + `getBusyPeriods` no `beforeEach` e usar data futura estável (`2099-06-15`) — necessário porque a nova validação roda `calculateAvailableSlots` com `now`, que filtraria as datas antigas (2026-05-06/15, já no passado em 2026-05-31) e bloquearia os testes.

**Verificação:** `tsc --noEmit` limpo; suite jest completa verde (1177 testes, 76 suites); `npm run build` OK.

**Escopo (CLAUDE.md II.6):** mudança mínima — só `reagendarEvento.ts` (imports + bloco de validação) e o spec correspondente. Nenhum refator adjacente. Encerra o tech debt aberto no Bug #39.

---

## 2026-07-27 — Ausência de CI/CD real + atualização do CLAUDE.md (Seção XV)

**Contexto:** o commit `aca9ffa` (feito pelo Claude Code na VPS) corrigiu um build de produção quebrado. A investigação da causa raiz revelou dois problemas de natureza diferente do bug reportado.

**Causa raiz #1 — drift de dependência:** `backend/.gitignore` ignorava `package-lock.json`. Sem lockfile versionado, o deploy rodava `npm install` (não `npm ci`), que resolveu `baileys ^7.0.0-rc.9` para o `rc13` mais recente — tipagem incompatível com `authState.ts`/`wbot.ts`. Corrigido no próprio `aca9ffa` versionando o lockfile e fixando `baileys` em `7.0.0-rc.9`. O risco maior não era o build quebrar (visível), e sim a versão nova compilar e rodar com comportamento diferente em produção — potencialmente alterando os sinais de fingerprint que o `bf2c16a` acabou de calibrar.

**Causa raiz #2 — não existe portão automático entre a máquina de desenvolvimento e produção:** o `CLAUDE.md` descreve em detalhe um pipeline de CI/CD (Seção VI) e pre-commit hooks (VII.1), mas o repositório **não possui** `.github/workflows/` nem `.pre-commit-config.yaml`. A única validação de build e testes é a execução manual local. A primeira vez que o projeto resolveu dependências do zero em ambiente real foi na própria VPS, em produção. Isso é o que permitiu o `aca9ffa` chegar até lá.

**Causa raiz #3 — o `CLAUDE.md` cobria segurança de supply chain, não de aplicação:** auditoria dos 10 pontos de um checklist de segurança web contra o documento retornou 1 coberto (IV.3, secrets no frontend), 1 parcial (rate limiting, mas classificado como tópico de *performance* na XI.5) e 8 ausentes: autorização exclusivamente no backend, teste de invalidação de sessão, RLS/isolamento multi-tenant, IDOR, dados em texto puro, XSS/sanitização, segurança por obscuridade e exposição de `.git`/`.env`/`/backup`. Diversos desses controles **existem no código** (checagem de `companyId` em 14 services, `sanitizeFilename`, `sanitizeUserMessage`, `helmet`, CORS com allowlist, `express-rate-limit`) — mas por disciplina individual, não por regra escrita. Era essa ausência que explicava o módulo Campanhas ter operado protegido apenas por menu escondido até o `bf2c16a`: nenhuma regra dizia que esconder ≠ proteger.

**Ação tomada (documentação apenas, sem mudança de código):**
- Nova **Seção XV — Security Guidelines**: ocultação ≠ proteção (15.1), autorização no backend (15.2), IDOR e isolamento multi-tenant (15.3), validação/XSS/prompt injection (15.4), rate limiting reclassificado como controle de segurança (15.5), dados em repouso (15.6), exposição de infra (15.7), auditoria do build frontend (15.8) e checklist de release (15.9).
- Nova **VI.4 — Lockfile e Determinismo de Dependências**: lockfile é código, `npm ci` no deploy, versão exata em libs de acoplamento profundo.
- Nova **VI.5 — Documento vs Realidade**: obriga a verificar se um portão descrito no documento existe de fato no repositório, e a apontar a divergência ao usuário em vez de operar como se o controle existisse.
- `AGENTS.md` e `GEMINI.md` ressincronizados com `CLAUDE.md` (estavam parados no commit inicial `5a8591e`, sem as seções II.5, II.6 e agora XV — os ambientes Antigravity/Gemini estavam operando sem essas regras).

**TECH DEBT ABERTO (prioridade alta) — não implementado neste ciclo:**
1. **`.github/workflows/ci.yml`** com `npm ci` + `tsc --noEmit` + jest + `npm run build`, bloqueante em `main`. Sozinho, teria pego o `aca9ffa` antes do push. **Este é o item que fecha a causa raiz #2.**
2. **`.pre-commit-config.yaml`** com scan de secrets (`detect-secrets`/`git-secrets`). Hoje nada impede um `.env` de entrar num commit.
3. **Auditoria do código contra a nova Seção XV** — o checklist 15.9 nunca foi rodado contra a base existente. Suspeitas conhecidas: `scriptSrc: 'unsafe-inline'` na CSP (`app.ts:48`) enfraquece a proteção anti-XSS; cobertura de checagem de `companyId` não foi verificada endpoint a endpoint.

**Escopo (CLAUDE.md II.6):** mudança restrita a documentação (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `decisions_log.md`). Nenhuma linha de código de aplicação alterada — os três itens de tech debt acima são mudanças estruturais e aguardam aprovação explícita.

---

## 2026-07-27 (b) — CI/CD implementado + auditoria de segurança da Seção XV

Fecha os três itens de tech debt abertos na entrada anterior. Trabalho dividido em duas frentes: **portões automáticos** (o que faltava de infraestrutura) e **auditoria do código** (o que a Seção XV cobrava e nunca havia sido verificado).

### Frente 1 — Portões automáticos

**`.github/workflows/ci.yml`** — 4 jobs bloqueantes em `main` e em PR:

| Job | O que faz | Custo |
|---|---|---|
| `backend-build` | `npm ci` + `tsc --noEmit` + lint incremental + build | ~5 min |
| `frontend-build` | `npm ci` + build + auditoria de bundle (XV.8) | ~8 min |
| `backend-test` | suíte jest completa (serviço Redis) | ~30 min |
| `security` | TruffleHog + `npm audit` + checagem de lockfile e `.env` | ~3 min |

O `npm ci` do `backend-build` é o portão que fecha a causa raiz do `aca9ffa`: falha se o lockfile divergir do `package.json`, em ~3 minutos, sem banco.

A auditoria de bundle do `frontend-build` automatiza a Seção XV.8, que antes dependia de alguém lembrar de abrir o DevTools: verifica ausência de source maps, ausência de credenciais de padrão conhecido e ausência de string de conexão de banco no build publicado.

**`.githooks/pre-commit`** — bash puro, sem dependências. Bloqueia: arquivo `.env`, credenciais de padrão inequívoco (`sk-`, `AKIA`, `ghp_`, chave privada PEM), arquivo maior que 1MB e `package-lock.json` reaparecendo em `.gitignore`. Avisa (sem bloquear) sobre atribuições genéricas do tipo `password: "..."`. Roda ESLint nos `.ts` staged.

*Decisão:* NÃO usamos o framework `pre-commit` (`.pre-commit-config.yaml`) apesar de a Seção VII.1 sugeri-lo. Ele exige Python + `pip`, ausentes nesta máquina, num projeto 100% Node. O arquivo existiria sem nunca executar — a falha descrita na própria Seção VI.5. Verificado com 5 testes manuais (3 de bloqueio, 2 de falso positivo, incluindo `.env.example`).

**`npm run lint` estava quebrado desde o commit inicial.** O `.eslintrc.json` estendia `prettier/@typescript-eslint`, fundido em `prettier` na v8.0.0 do `eslint-config-prettier`; o comando abortava com erro de config antes de analisar qualquer arquivo. Corrigido.

*Consequência:* com o lint funcionando, a base acusou **12.449 problemas em 711 arquivos** (74% formatação). Decisão: **lint incremental** (`scripts/lint-changed.sh`), só nos arquivos alterados. Rodar `--fix` na base geraria diff de 711 arquivos, quebrando `git blame`/`bisect` e violando II.6; lint bloqueante na base inteira faria o CI falhar em todo push até alguém desativá-lo. Duas regras do airbnb foram ajustadas com justificativa em `backend/.eslintrc.README.md`: `no-promise-executor-return` (off — proíbe o idioma padrão de sleep, usado no delay anti-banimento) e `no-await-in-loop` (warn — 131 ocorrências, e sequencialidade é obrigatória no envio ao WhatsApp).

### Frente 2 — Auditoria contra a Seção XV (5 vulnerabilidades corrigidas)

**1. IDOR + SQL injection em `ReportsController` (CRÍTICO)**

Causa raiz: `companyId`, `initialDate` e `finalDate` vinham de `req.query` e eram interpolados via template literal direto no SQL. As rotas usam apenas `isAuth`. Duas falhas na mesma linha:

- *IDOR (XV.3):* `?companyId=99` devolvia os relatórios da empresa 99 para qualquer usuário autenticado de qualquer empresa.
- *SQLi (XV.4):* `?companyId=1 OR 1=1--` era concatenado sem aspas.

Fix: helper `parseReportParams` lê `companyId` de `req.user`, valida formato das datas e as devolve para uso como `replacements` do Sequelize. 18 testes (TDD: 12 falharam antes do fix).

**2. IDOR em `DashbardController`, `QueueController` e `UserController` (ALTO)**

Mesmo padrão, três lugares: o `companyId` do cliente vencia o da sessão (`companyId ? +companyId : userCompanyId`). Expunha relatórios de atendimento, filas e a lista de usuários (nome + e-mail) de qualquer empresa.

*Nuance que mudou o desenho do fix:* o acesso entre empresas é usado de verdade — o painel de super admin (`CompaniesManager`) chama `/users/list?companyId=X`. Remover o parâmetro quebraria a feature. Novo helper `resolveCompanyId` preserva a capacidade e a restringe: empresa da sessão por padrão, outra empresa só se `User.super` for verdadeiro no banco (nunca no token — XV.2), e tentativa negada vira `logger.warn` com contexto. 8 testes.

**3. XSS armazenado em `LocationPreview` (ALTO, atacante remoto não autenticado)**

`dangerouslySetInnerHTML` recebia `message.body.split('|')[2]` — o corpo bruto de uma mensagem recebida no WhatsApp. Qualquer pessoa que mandasse mensagem para o número da empresa executava JavaScript na sessão do atendente, com acesso ao token no `localStorage` e a todas as conversas do tenant. O HTML existia só para virar quebra de linha; substituído por `white-space: pre-line`.

**4. XSS de terceiro em `LogPlw` (MÉDIO)**

A página renderiza via `dangerouslySetInnerHTML` o README de `plwdesign/attwhaticket` — repositório de TERCEIROS, buscado pela API do GitHub. Quem controla aquele repositório injetava HTML/JS no navegador do **super admin**. Renderizado como texto.

*Pendente de decisão do dono:* a página exibe o changelog de outro fornecedor. Provavelmente deveria apontar para o changelog próprio ou ser removida — mas isso é decisão de produto, não de segurança, e ficou fora do escopo.

**5. CSP com `script-src 'unsafe-inline'` (MÉDIO)**

Com `unsafe-inline`, a CSP não oferecia proteção real contra XSS — payload injetado roda exatamente como script inline. Existia por causa de UMA página: o popup de callback do OAuth do Google Calendar, única HTML servida pelo backend. Fix: `unsafe-inline` removido do escopo global; aquela rota gera um nonce aleatório por resposta e o declara em CSP própria. `style-src` mantém `unsafe-inline` (Material-UI injeta estilo em runtime; superfície muito menor).

**6. Infra (XV.7)** — `server_tokens off` e `autoindex off` explícitos no `nginx.conf`; bloqueio de dotfiles (preservando `.well-known`), de `.sql/.bak/.dump/.tar/.gz/.zip` e de `.map` no template de site.

**7. `frontend/.env.exemple`** — nome com typo, versionado, fora do padrão do `.gitignore`. Conteúdo só tinha placeholders (sem vazamento). Renomeado para `.env.example`.

### Itens VERIFICADOS e já conformes (nenhuma ação necessária)

- Senhas com `bcryptjs` (`hash`/`compare`) — XV.6
- Tokens do Google criptografados em repouso (`aes-256-cbc`, `tokenCrypto.ts`) — XV.6
- Login devolve `ERR_INVALID_CREDENTIALS` nos dois casos (conta inexistente e senha errada) — sem enumeração de contas, XV.5
- Rate limiting em `/auth` (100 req/15 min) e em `geminiRoutes` — XV.5
- CORS com allowlist explícita (CWE-942 já corrigido anteriormente) — XV.7
- Build do frontend com `GENERATE_SOURCEMAP=false` — XV.7
- Nenhum `.env` versionado; `.gitignore` cobre com `**/.env` e nega `.example` — IV.1
- Nenhuma outra interpolação de template literal em SQL raw no projeto (13 usos de `sequelize.query` conferidos) — XV.4
- Isolamento por `companyId` presente nos services (`ShowTicketService.ts:65` e outros 13) — XV.3

### TECH DEBT que permanece aberto

1. **Cobertura de testes não é medida contra o mínimo de 80% (CLAUDE.md II.1).** O CI coleta cobertura e publica como artefato, mas não há `coverageThreshold` configurado nem gate. Ativar exige antes medir a linha de base.
2. **12.449 problemas de lint na base legada.** Estratégia definida (limpeza incremental conforme cada arquivo for tocado), mas o volume continua lá.
3. **Frontend não tem lint nem testes.** O `frontend-build` do CI só compila. `CI=false` no build para não tratar warnings preexistentes do CRA como erro.
4. **`npm audit` não é bloqueante.** Advisory em dependência transitiva frequentemente não tem correção disponível no dia; bloquear travaria hotfix por motivo alheio à mudança. Revisar o relatório periodicamente.
5. **A auditoria não cobriu endpoint a endpoint.** São 45 arquivos de rota; a varredura buscou o *padrão* do bug (`companyId` vindo do cliente, interpolação em SQL, `dangerouslySetInnerHTML`) e corrigiu todas as ocorrências encontradas. Uma revisão exaustiva rota a rota continua pendente.
6. **`nginx/sites/*.conf` reais vivem na VPS**, não no repositório — só há `.example`. As correções de XV.7 precisam ser aplicadas manualmente lá.

**Escopo (CLAUDE.md II.6):** os fixes de segurança são mínimos e localizados. O `eslint --fix` foi aplicado apenas aos arquivos já tocados pelos fixes, não à base — coerente com a política de limpeza incremental.

---

## 2026-08-17 — Módulo de governança de tokens (superadmin)

Ver `directives/token_governance.md` para a especificação completa.

### Descoberta que mudou a ordem do trabalho

O pedido era um painel de consumo. A investigação mostrou que **o dado
existente não era utilizável para cobrança**, então o módulo começou por
corrigir a medição, não pela tela.

`AgentAction` já tinha `inputTokens`/`outputTokens`, mas o registro acontecia
DENTRO do laço de tool calls (`AgentService/index.ts`, `secretaryLoop.ts`):

```js
for (const toolCall of response.toolCalls) {
  await AgentAction.create({ ..., inputTokens: response.usage?.inputTokens })
}
```

| Cenário | Efeito |
|---|---|
| Turno com N tool calls | N linhas, cada uma com o consumo INTEIRO do turno → conta N× |
| Turno só de texto (sem tool) | Nenhuma linha → consumo perdido |

Num agente de atendimento a maioria dos turnos é texto puro ("bom dia",
"quanto custa?", "ok obrigado"). O somatório subcontava o grosso e inflava o
resto — número sem sentido nas duas direções. Um painel sobre esse dado seria
pior que nenhum painel: daria confiança num número errado.

### Decisões de produto (aprovadas pelo dono em 2026-08-17)

**1. Medir e alertar; NÃO bloquear.** Se o crédito acabasse e o sistema
bloqueasse, quem ficaria sem resposta não seria o cliente da plataforma, e sim
o cliente DELE, no meio de uma conversa no WhatsApp — o agente simplesmente
emudeceria. Numa plataforma de atendimento esse é o pior modo de falha:
sacrifica a reputação do cliente para proteger margem, e ele culparia a
plataforma, com razão. O bloqueio está implementado atrás de
`enforcementEnabled`, desligado por padrão; um teste trava esse default.

**2. Custo e preço separados desde o início.** O markup é 0 nesta fase (o dono
absorve), mas cada linha grava custo real e preço imputado. Cobrar depois não
exige migration nem recálculo de histórico.

**3. Histórico anterior descartado.** O painel só considera consumo a partir da
correção da medição. Os `AgentActions` antigos permanecem como log de
auditoria, agora documentados no próprio model como NÃO-SOMÁVEIS.

### Decisões técnicas

**Medição separada de auditoria.** `AgentActions` responde "o que o agente
fez" (uma linha por tool); `TokenUsages` responde "quanto custou" (uma linha
por chamada ao LLM). Misturar as duas foi a origem do bug.

**Preço congelado no registro.** Cada linha de `TokenUsages` grava o preço
unitário e a cotação usados. Recalcular consumo antigo com o preço de hoje
reescreveria histórico financeiro e invalidaria qualquer valor já informado ao
cliente — e provedores chineses mudam preço com frequência.

**Preço em tabela, não no código.** `ModelPrices` é editável pelo painel, pelo
mesmo motivo do seletor dinâmico de modelos: cadastrar modelo novo não pode
exigir deploy. O seed cobre só modelos cujo preço é conhecido com confiança;
os demais aparecem como "preço não cadastrado" em vez de receberem valor
chutado. Estimativa silenciosa vira número errado com aparência de certo.

**Saldo é soma do razão, nunca coluna.** Coluna de saldo mutável sofre lost
update sob concorrência (dois débitos leem o mesmo valor, um sobrescreve o
outro) e apaga o rastro de como a empresa chegou ali. Um teste de concorrência
trava essa escolha.

**DECIMAL, não FLOAT,** em tudo que é dinheiro: binário flutuante acumula erro
quando somado sobre milhares de chamadas.

**Sem arredondamento no cálculo.** 1.000 tokens a US$1/milhão custam US$0,001;
arredondar para centavos no cálculo zeraria o valor e, somado em milhares de
chamadas, o custo sumiria. Arredondamento é problema da exibição.

**Falha de contabilidade nunca derruba atendimento.** `recordTokenUsage` e
`recordConsumption` capturam a própria exceção, logam com contexto
(`logger.error`, nunca catch silencioso — II.5) e seguem.

**`onDelete: RESTRICT`** nas FKs de `TokenUsages` e `CreditLedgers`: histórico
financeiro não evapora junto com a empresa.

**Idempotência no banco (UNIQUE),** não no código: retry da mesma chamada não
pode virar débito duplicado, e a garantia não pode depender de alguém lembrar
de checar antes.

### Segurança

Todas as rotas exigem `isSuper` (CLAUDE.md XV.1/XV.3): consumo e custo por
empresa são dados comerciais sensíveis — um cliente não pode ver o de outro,
nem o próprio custo bruto, que revelaria a margem da plataforma. Um teste
estrutural falha se alguém adicionar rota sem o gate. Todas as queries usam
`replacements` (XV.4), lição direta da auditoria de 2026-07-27.

### A alavanca que o módulo torna visível

O maior custo desta arquitetura é o system prompt + definições de tools
reenviados a cada turno (~4.000 dos ~22.000 tokens de entrada por conversa).
Anthropic e DeepSeek descontam esse prefixo repetido via prompt caching, que
**não está em uso**. `cachedInputTokens` existe desde o início justamente para
tornar a economia mensurável quando o caching for ativado. Se o painel mostrar
consumo alto, ativar cache é a primeira alavanca — antes de vender crédito.

### Verificação

51 testes novos, todos escritos antes do código: modelPricing 13,
recordTokenUsage 12, creditLedger 18, usageReports 15 (pura), rotas 5.
`tsc --noEmit` limpo, migrations aplicadas no Postgres local, e o módulo
validado ponta a ponta no navegador com dados reais: agregação correta,
sinalização de modelo sem preço funcionando, concessão de crédito gravando no
razão, rota sem token devolvendo 401 e crédito negativo devolvendo 400.

### TECH DEBT aberto

1. **Consumo não debita o razão automaticamente.** `recordTokenUsage` grava em
   `TokenUsages`; `recordConsumption` existe e é testado, mas nada os liga
   ainda. Falta um job periódico que consolide o consumo do período em
   lançamento de consumo. Enquanto o markup é 0 e ninguém tem crédito, o saldo
   não é usado para decisão — por isso não bloqueou a entrega.
2. **Alertas de 80%/100% não são enviados.** `evaluateThresholds` calcula e é
   testado, mas nenhum canal de notificação foi ligado. Depende do item 1.
3. **Tela de cadastro de preços não foi construída.** As rotas
   `GET/PUT /token-governance/prices` existem e funcionam; a UI ainda não.
   Modelos sem preço aparecem sinalizados no painel, mas o cadastro é via API.
4. **Preços do seed precisam de conferência** nas docs oficiais de cada
   provedor antes de qualquer cobrança real.
5. **Aviso do Material-UI ao abrir aba super por URL direta** ("None of the
   Tabs' children match"). PREEXISTENTE — ocorre igual em `?tab=plans` e
   `?tab=companies`, porque as abas super só renderizam depois que
   `currentUser` carrega. Não introduzido por este módulo; não corrigido aqui
   por mínima mudança (II.6).
6. **Sem cobertura de teste no frontend** — segue o débito geral do projeto.

---

## 2026-08-20 — Identidade visual da marca e varredura de CX

### Contexto

Pedido de melhorias visuais e de experiência, com o manual da marca Otron v1.0
(agosto/2026) como referência de cor e tipografia.

### Decisões de cor

**Paleta institucional substitui a "Blue Steel".** O sistema usava `#4682B4`,
que não existe no manual. Trocado por `#123739` (verde-petróleo). Os tons de
gradiente e hover (`#0B2223` e `#1D5A5D`) NÃO estão no manual: foram derivados
do verde-petróleo mantendo matiz (183°) e saturação (52%), variando só a
luminosidade. Inventar uma cor fora da identidade seria pior que derivar da que
já existe.

**O lima `#BDF23C` entrou como token `palette.ativacao`.** O manual define essa
cor como "ativação, dado". Usada no selo "SA" e disponível para item de menu
ativo e indicadores.

**`public/index.html` foi incluído na troca.** O spinner de carregamento é a
primeira coisa que o cliente vê, antes de qualquer React montar — ficar com o
azul antigo entregaria a marca errada no momento de maior atenção.

### Decisões de CX

**Os dois "Financeiro" foram renomeados.** `/finance` ("Financeiro") e
`/financeiro` ("Mensalidade do CRM") são coisas opostas — o dinheiro do cliente
e o dinheiro que ele deve à plataforma — com rótulos quase idênticos. Agora
"Financeiro do Negócio" e "Minha Assinatura".

**A aba "Cadastrar Empresa" foi REMOVIDA.** Ela renderizava
`pages/Companies/index.js`, que é literalmente a página pública de cadastro
(`export default SignUp`): ao salvar executava `history.push("/login")`,
expulsando o superadmin para a tela de login. E era redundante — o
`CompaniesManager` da aba "Empresas" já cria empresas (`if id → update, else →
save`).

**"Personalidade" e "Conhecimento" viraram uma aba só ("Atendimento").** Eram 8
campos do mesmo agente divididos em duas abas, sem nada indicando a relação. A
separação virou dois blocos visuais dentro da mesma aba: mantém a leitura sem
esconder metade da configuração atrás de um clique.

**O WhatsApp do proprietário saiu de "Conhecimento".** Ele não é conhecimento,
é notificação. Foi para a aba da Secretária, junto dos números de admin.

### Bug corrigido: telefone do proprietário (silencioso)

`notificarProprietario` montava o destino com `replace(/\D/g, "")`, sem
canonicalizar. Como a tela da Secretária ensina o formato SEM DDI
("48988368758") e este campo esperava COM DDI, quem seguisse a convenção da
outra tela gerava um JID inválido: a mensagem não chegava, um `Contact` lixo era
criado, e a tool ainda respondia "sucesso" ao agente — falha 100% silenciosa.

Corrigido com `canonicalizePhone` (que já existia em `SecretaryService/
phoneMatch.ts` e trata DDI, 9º dígito e máscara) mais fallback para o primeiro
número de admin quando o campo está vazio. 6 testes novos, escritos antes do
fix; 4 falhavam no estado anterior.

### Tech debt registrado

1. **Anotações persistem em `localStorage`, não no banco.** São por navegador,
   não por usuário: somem ao limpar dados do site e não acompanham quem troca de
   máquina. Decisão consciente de não migrar agora — seria uma feature de
   backend completa (tabela, model, migration, rotas com isolamento por
   `companyId`, testes) e atrasaria o restante. Mitigado com aviso explícito na
   tela, para não criar expectativa falsa. **Migrar quando houver demanda real
   de compartilhamento entre a equipe.**

2. **`pages/Companies/index.js` ficou órfão.** Com a remoção da aba, ninguém
   mais o importa (a rota já estava comentada em `routes/index.js:24`). Não foi
   deletado por mínima mudança (II.6) — remover é um commit separado.

3. **Telas autenticadas não verificadas visualmente.** Sem sessão de teste
   local, só a tela de login foi inspecionada no navegador. Conferir Anotações,
   Chat Interno, menu e Configurações após o deploy.

---

## 2026-08-21 — Canal oficial do WhatsApp (Cloud API + Twilio) convivendo com Baileys

**Contexto:** o usuário quer testar a API oficial da Meta mantendo o Baileys em
operação. Pesquisa de mercado e mapeamento de código feitos antes de qualquer
linha ser escrita. Diretiva completa em `directives/canal_oficial_whatsapp.md`.

### Correção de premissa do usuário (registrada porque muda a decisão)

O usuário supôs que atendente humano usando Baileys "não teria problema de
banimento, assim como o WhatsApp Web". **Não procede.** O WhatsApp Web oficial
é cliente da Meta; o Baileys reimplementa o protocolo por fora, o que viola os
ToS **independente de quem aperta enviar**. Um humano digitando reduz a
probabilidade de detecção (padrão comportamental plausível), não o risco de ToS.

Também registrado: **Baileys e API oficial não coexistem no mesmo número.**
Manter os dois significa números diferentes — o que já é suportado pela
arquitetura multi-conexão existente.

### Decisões do usuário (via AskUserQuestion)

1. **Assistente guiado agora + botão de Embedded Signup construído e desligado
   por flag**, para ligar quando o CNPJ for verificado. Não é stub: o código é
   real, atrás de `META_EMBEDDED_SIGNUP_ENABLED` (default false).
2. **Os dois conectores em paralelo** (Twilio e Meta direto).
3. **Templates somente sincronizados**, não criados no CRM.

### Decisão arquitetural: adaptador paralelo, não refatoração

`handleMessage` recebe `proto.IWebMessageInfo` (tipo nativo do Baileys) dentro
de um arquivo de **4.343 linhas**, e **19 arquivos** chamam `wbot.sendMessage()`
direto. Três opções avaliadas:

- **A — falsificar `proto.IWebMessageInfo`** para reusar o listener: rejeitada.
  Campo não preenchido vira `undefined` silencioso no meio de 4.343 linhas.
- **B — refatorar `handleMessage` para tipo neutro**: rejeitada AGORA. Tocar
  arquivo desse tamanho sem cobertura, para entregar feature nova, viola II.6 e
  concentra risco no caminho que já é produção.
- **C — caminho paralelo reusando os serviços de negócio**: **escolhida.** O
  canal oficial tem handler próprio que chama `FindOrCreateTicketService`,
  `AgentService` e `verifyMessage` sem passar pelo listener do Baileys.

**Custo aceito:** duplicação de orquestração entre os dois caminhos. Preferível
a arriscar o canal em produção. Convergir para B quando o listener tiver testes.

### Achado durante a investigação que encurtou o plano

A diretiva previa trabalho para preservar o corpo bruto da requisição (necessário
para validar o HMAC do webhook da Meta). Verificação em `app.ts:37` mostrou que
**o projeto já preenche `req.rawBody`** via `verify` do bodyParser. Trabalho
eliminado e o risco correspondente saiu da tabela de Failure Modes.

### Pontos de atenção que a diretiva trava

- **Janela de 24h quebra funcionalidade proativa existente.** Aniversário,
  retenção, campanhas e briefing da Secretária não funcionam no canal oficial
  sem template. Comportamento obrigatório: falhar alto com
  `ERR_OUTSIDE_SERVICE_WINDOW`, nunca tentar enviar como mensagem livre — a Meta
  aceitaria a chamada e o cliente não receberia (falha silenciosa).
- **`humanTypingDelay` não roda em canal oficial.** A humanização existe para
  driblar detecção de automação; no canal autorizado só piora a experiência.
  Por isso `sendTyping` é opcional na interface do adaptador.
- **Credenciais cifradas em repouso (XV.6).** Token permanente da Meta e Auth
  Token da Twilio são credenciais de terceiro: AES-256-GCM, máscara no frontend,
  jamais em log.
- **Mídia da Cloud API expira em ~5 minutos** — baixar no webhook, nunca depois.
- **Idempotência por `channelMessageId`** — a Meta reenvia o webhook se não
  receber 200 rápido; sem isso a mensagem duplica no ticket.

### Tech debt aceito

1. Duplicação de orquestração (consequência da opção C).
2. 17 pontos seguem Baileys-only (Typebot, reações, deleção, grupos) e falham
   alto em canal oficial.
3. Embedded Signup construído mas não exercitado em produção até a Meta aprovar.
4. Templates somente leitura.

---

## 2026-08-22 — Canal oficial: Fases 1 a 4 implementadas

Execução de `directives/canal_oficial_whatsapp.md`. Fases 1 (fundação), 2
(envio), 3 (webhook) e 4 (templates).

### Decisões tomadas durante a implementação

**Uma guarda no funil, não 17 espalhadas.** A diretiva previa inserir
`ERR_FEATURE_BAILEYS_ONLY` em cada um dos ~17 pontos que chamam
`wbot.sendMessage()` direto. Ao implementar, ficou claro que TODOS passam por
`GetTicketWbot`. A guarda foi para lá: um único ponto que não pode ser
esquecido quando alguém adicionar o 18º. Menos código e cobertura maior.

**Regressão de performance que eu mesmo introduzi e corrigi.** A primeira
versão do roteamento chamava `ShowWhatsAppService` (query com includes de filas
e integrações) em TODO envio, inclusive Baileys — custo novo no caminho mais
quente de um CRM de WhatsApp. Trocado por `ticket.whatsapp ?? findByPk`, que
nem consulta quando o ticket já traz a conexão carregada.

**Guarda de 1 linha em `verifyMessage`.** Canal oficial não produz
`proto.IWebMessageInfo` e persiste a mensagem por conta própria
(`persistOutgoingMessage`), devolvendo `null`. Todos os chamadores de
`SendWhatsAppMessage` passam o retorno para `verifyMessage`, que quebraria na
primeira linha ao ler `msg.key`. Um `if (!msg) return;` no topo resolve sem
tocar no resto das 4.343 linhas — alternativa seria alterar os 4 chamadores.

**Campos que `MessageData` não aceita.** A primeira versão gravava `remoteJid`,
`participant`, `dataJson` e `isEdited` copiando o formato do listener Baileys.
O `CreateMessageService` não tem esses campos na interface — são preenchidos por
outro caminho. O `tsc` pegou; removidos.

### Segurança da rota pública de webhook

A rota NÃO leva `isAuth`, e isso não é exceção à XV.1: ela não depende de estar
escondida — o endereço é entregue ao provedor de propósito. A autenticação é a
ASSINATURA (HMAC-SHA256 no caso da Meta, `validateRequest` do SDK no caso da
Twilio).

Três decisões dentro dela:

1. **`timingSafeEqual`, nunca `===`.** Comparação comum sai no primeiro byte
   diferente; a diferença de tempo entre "errou no byte 1" e "errou no byte 30"
   vaza informação suficiente para forjar a assinatura byte a byte.
2. **Negar quando não consegue conferir.** Sem assinatura, sem segredo ou sem
   corpo → `false`. Verificação que devolve `true` na dúvida é pior que não ter
   verificação, porque dá impressão de proteção.
3. **200 antes de processar.** A Meta reenvia se demorar; processar antes de
   responder produziria duplicata. A idempotência por `channelMessageId` cobre
   a reentrega que acontecer mesmo assim.

Empresa resolvida pelo `whatsappId` da URL, nunca por campo do corpo (XV.3).

### Armadilha travada por teste

A Meta envia timestamp unix em SEGUNDOS. Sem converter, toda mensagem cairia em
1970 e `estaNaJanelaDeAtendimento` daria SEMPRE fechada — o sistema exigiria
template para responder a quem acabou de escrever. Teste explícito trava isso.

### Verificação

- 53 testes novos na camada de canal, todos verdes
- Suíte completa: **107 suítes / 1551 testes, zero falhas** — critério de
  sucesso da Fase 1 (Baileys inalterado) atendido
- `tsc` limpo, build de produção limpo
- Migrations aplicadas em banco real; as 2 conexões existentes assumiram
  `channelType = "baileys"` pelo default, confirmando que a base legada não
  precisou de migração de dados

### Pendente

Fase 5 (assistente de conexão na interface). Hoje o canal oficial envia, recebe
e usa template, mas só pode ser configurado por escrita direta no banco —
nenhuma tela cria conexão oficial ainda.
