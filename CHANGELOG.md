# Changelog

Todas as mudanças notáveis deste projeto serão documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [Unreleased]

### Security — Path traversal em nome de arquivo de mídia (CRÍTICO) (2026-06-28)

Security review completo. `verifyMediaMessage` gravava a mídia recebida com
`join(pasta, media.filename)` onde `filename` vem do REMETENTE (nome original do
documento no WhatsApp). Um atacante enviando documento chamado `..\\..\\dist\\server.js`
escreveria FORA de `public/company{id}/` — sobrescrevendo arquivos do servidor
(potencial RCE). **Fix:** novo helper [SanitizeFilename.ts](backend/src/helpers/SanitizeFilename.ts)
(basename POSIX+Windows, remove controle/reservados, nunca vazio) aplicado no
[wbotMessageListener.ts](backend/src/services/WbotServices/wbotMessageListener.ts) antes
do join. 7 testes.

### Security — GET /settings expunha API keys a qualquer usuário logado (ALTO) (2026-06-28)

O gate de admin do `SettingController.index` estava **comentado**: qualquer atendente
autenticado recebia TODAS as settings da empresa — incluindo `agentApiKey` e
`agentWhisperApiKey` (credenciais pagas de LLM). Bloquear o endpoint quebraria o
frontend de usuários comuns (settings operacionais), então o fix filtra por padrão de
nome: **admin vê tudo; não-admin recebe tudo MENOS chaves com apikey/token/secret/password**.
Novo helper [FilterSensitiveSettings.ts](backend/src/helpers/FilterSensitiveSettings.ts)
aplicado em [SettingController.ts](backend/src/controllers/SettingController.ts). 4 testes.

### Added — Captura de data de aniversário no fim do atendimento (Agente) (2026-06-28)

Fecha o ciclo captura → campanha: as campanhas de aniversário já rodavam, mas
`Contact.birthday` só era preenchido manualmente. Nova tool
[registrarAniversario.ts](backend/src/services/AgentService/tools/registrarAniversario.ts):
o Agente captura a data ao FINAL de um atendimento bem-sucedido (instrução no
`knowledgeBuilder`) e grava no contato do ticket atual. Escolhas de produto (confirmadas
com o dono): **não sobrescreve** se já houver data (idempotente), **aceita dia/mês** sem
ano (ano-sentinela bissexto 1904 — campanhas usam só mês/dia), **só o Agente**. `contactId`
vem do contexto, nunca do LLM (Bug #25). 22 testes.

> **Fix aplicado:** o código (vindo de um worktree que assumiu `strict:true`) não compilava
> neste projeto (`tsconfig strict:false` não faz narrowing negativo de union discriminada em
> `if (!parsed.ok)`). Corrigido com cast explícito em `registrarAniversario.ts`.

### Added — Secretária envia mensagem a qualquer contato, mesmo sem ticket (2026-06-28)

Completa o fluxo "avise a Amanda": [enviarMensagemParaCliente.ts](backend/src/services/SecretaryService/tools/enviarMensagemParaCliente.ts)
agora aceita `contactId` além de `ticketId`. Com `contactId`, valida o contato, pega o
canal conectado (`GetDefaultWhatsApp`), abre/encontra um ticket (`FindOrCreateTicketService`)
e envia. Mantém o gate de confirmação do admin (a tool é destrutiva/visível). Se o cliente
responder, o atendimento segue pelo agente normalmente. 9 testes em
`__tests__/tools/enviarMensagemParaCliente.spec.ts` (ticketId + contactId + validações).

### Added — Secretária acessa a lista de contatos do CRM (consultar_contatos) (2026-06-28)

A Secretária era centrada em ticket: `buscar_ticket` só achava quem tinha atendimento.
Ao pedir "avise a Amanda", ela não encontrava o contato (havia "Amanda G" na lista).

**Fix:** nova tool [consultarContatos.ts](backend/src/services/SecretaryService/tools/consultarContatos.ts)
— busca na LISTA DE CONTATOS inteira (WhatsApp + importados + criados por ticket) por
nome/número, multi-tenant. Reutiliza a busca do Agente (`buscarContato`, DRY). O prompt
instrui a desambiguar: se vier mais de um ("3 Amandas"), lista e pergunta qual; se vier
zero, avisa. Registrada em `ALL_SECRETARY_TOOLS` + `executeSecretaryTool`. Testes em
`consultarContatos.spec.ts`.

> Limitação atual: para ENVIAR a um contato, `enviar_mensagem_para_cliente` ainda exige
> um ticket. Enviar a um contato sem ticket aberto (criar/abrir ticket e enviar) é o
> próximo passo — ver decisions_log.md.

### Fixed — Transcrição de áudio: caminho do arquivo sem a subpasta company{id} (2026-06-28)

**Sintoma:** a Secretária não transcrevia áudios ("configure o provedor Whisper"),
mesmo com o Whisper configurado e o áudio tocável no front.

**Causa-raiz (provada transcrevendo o arquivo real):** `verifyMediaMessage` salva a
mídia em `public/company{companyId}/arquivo.ogg`, mas o caminho passado para a
transcrição era `public/arquivo.ogg` (sem a subpasta) → arquivo não encontrado →
transcrição vazia. **O canal Agente tinha o MESMO bug** (código idêntico).

**Fix:** [wbotMessageListener.ts](backend/src/services/WbotServices/wbotMessageListener.ts):
ambos os caminhos (Secretária e Agente) agora usam `public/company{companyId}/arquivo`.
Validado contra o áudio real do ticket #22 → transcreveu corretamente:
*"Envie uma mensagem para Amanda informando que ela tem um corte de cabelo amanhã."*

### Added — Secretária conhece o negócio (nome + horário + instruções + FAQ) (2026-06-28)

A Secretária dizia "...para administradores **desta empresa**" em vez do nome real do
negócio. Como ela é a secretária do DONO, precisa conhecer o negócio que secretaria.

**Fix:** [secretaryLoop.ts](backend/src/services/SecretaryService/secretaryLoop.ts) agora
carrega as MESMAS Settings do Agente (`agentBusinessName`, `agentName`, `agentHours`,
`agentInstructions`, `agentFAQ`) e injeta um bloco de contexto do negócio no system
prompt. Ex.: "Você é a Secretária IA da **Amanda Studio**...". Sem nome configurado,
cai num genérico ("o negócio"). Testes em `secretaryLoop.spec.ts`.

### Fixed — CRÍTICO: admin caía no agente por violação de UNIQUE constraint (2026-06-28)

**Sintoma:** mesmo com o admin reconhecido (`isSecretaryAdmin` = true), as mensagens
continuavam sendo atendidas pelo **agente de atendimento**, nunca pela Secretária.

**Causa-raiz (confirmada rodando o código contra o banco real):** a tabela `Tickets`
tem a constraint `contactid_companyid_unique` = UNIQUE (`contactId`, `companyId`,
`whatsappId`) — só pode existir UM ticket por contato/empresa/canal. O admin já tinha
um ticket de teste (#22) como "cliente". O `FindOrCreateSecretaryTicketService` tentava
**criar um segundo** ticket `status="secretary"` com a mesma chave →
`SequelizeUniqueConstraintError` → o hardening do listener capturava e **caía no fluxo
do agente**. Ou seja: o próprio hardening MASCAROU o bug, transformando um erro de BD
em "agente atende o admin".

**Fix:**
- [FindOrCreateSecretaryTicketService.ts](backend/src/services/TicketServices/FindOrCreateSecretaryTicketService.ts):
  em vez de criar um segundo ticket, **CONVERTE** o ticket existente do admin (qualquer
  status) para `status="secretary"`, limpando fila/usuário/chatbot. Busca pela MESMA
  chave da constraint (`contactId`, `companyId`, `whatsappId`). O thread do admin É o
  thread da Secretária.
- [wbotMessageListener.ts](backend/src/services/WbotServices/wbotMessageListener.ts):
  o catch de hardening do roteamento do admin agora **RETORNA** (loga alto + avisa o
  admin via WhatsApp) em vez de cair no agente — elimina o conflito Secretária↔Agente
  mesmo em caso de erro.
- Verificado contra o banco real: conversão do #22 OK, sem exceção; auto-close
  (`ClosedAllOpenTickets`) só toca `status="open"`, não mexe no ticket de Secretária.
- Testes de `FindOrCreateSecretaryTicketService.spec.ts` reescritos p/ a lógica de
  conversão (4 casos). 38 testes da Secretária verdes.

> Requer **reiniciar o backend** para carregar o `dist/` novo.

### Changed — Paridade de robustez Secretária↔Agente: re-iteração de promise-text (2026-06-28)

Varredura comparando as defesas do Agente vs. Secretária (a pedido do usuário, para
prevenir bugs já mapeados no Agente). Lacuna crítica encontrada e corrigida:

- **promise-text (Bug #20 R8/R10) portado para a Secretária.** O Agente já forçava
  re-iteração quando o LLM "promete e para" sem chamar tool; a Secretária não tinha.
  Na Secretária o risco é MAIOR: "Vou cancelar o agendamento 18..." sem chamar a tool
  faria a ação destrutiva NUNCA executar, com o admin achando que foi feita.
  `looksLikePromise` movido para [agentUtils.ts](backend/src/services/AgentService/agentUtils.ts)
  (DRY, vocabulário expandido p/ ações da Secretária) e aplicado em
  [secretaryLoop.ts](backend/src/services/SecretaryService/secretaryLoop.ts): re-iteração
  forçada no loop + substituição da resposta final por aviso honesto se ainda for
  promessa após o loop. Testes em `secretaryLoop.spec.ts`.

Demais defesas já estavam em paridade (segurança, toolCalls, pseudo-XML, finishReason,
lastNonEmptyContent, logging em AgentActions) ou são específicas do domínio de
agendamento do cliente (não se aplicam à Secretária). Detalhe em decisions_log.md.

### Security — Gate de autorização na listagem REST da aba "Secretária" (2026-06-28)

**Problema:** a aba "Secretária" (`status="secretary"`) é privilégio do admin —
expõe a conversa de gestão com a Secretária IA (cancelar/fechar tickets, dados
financeiros). O frontend já escondia a aba de não-admins e o realtime (socket) já
era admin-only, mas o endpoint REST `GET /tickets?status=secretary` era **craftável
por um não-admin da MESMA empresa**, que recebia os tickets de Secretária no fetch
inicial (escopo intra-tenant; não havia vazamento cross-tenant).

**Causa raiz:** o controller confiava no frontend/socket para esconder a aba, sem
verificação de autorização server-side na listagem para esse status.

**Fix:** [TicketController.index](backend/src/controllers/TicketController.ts) agora
rejeita com `403 (ERR_NO_PERMISSION)` quando `status === "secretary"` e
`req.user.profile !== "admin"` — mesmo padrão de gate já usado em Coupon/Package/
Tag/Schedule controllers. Mínima mudança (3 linhas + import); demais status
inalterados.

**Testes:** `TicketController.spec.ts` (novo) — admin vê, não-admin recebe 403 (o
service nunca é chamado), e não-admin continua vendo status normais (`open`).
Rodados isoladamente (3 verdes). TypeScript limpo.

### Added — Aba dedicada "Secretária" + persistência da conversa de gestão (2026-06-28)

A conversa do admin com a Secretária IA agora tem casa própria, separada dos
atendimentos de cliente (pedido do usuário após ticket #22).

**Problema (ponto 2 + 3 do feedback):** a Secretária não persistia nada — só as
respostas (fromMe) vazavam para o ticket de cliente do admin, e as perguntas dele
sumiam. Tudo se misturava no "Em atendimento".

**Solução (Opção A, escolhida pelo usuário — aba/filtro dedicado):**
- Ticket dedicado com `status="secretary"` ([FindOrCreateSecretaryTicketService.ts](backend/src/services/TicketServices/FindOrCreateSecretaryTicketService.ts)).
  Sem migration: o `status` já exclui o ticket das abas Atendendo/Aguardando (filtro
  exato) e reaproveita o roteamento por status-room do socket (`company-{id}-secretary`).
- [wbotMessageListener.ts](backend/src/services/WbotServices/wbotMessageListener.ts):
  toda mensagem de um admin (recebida E echo enviado) é roteada para o ticket de
  Secretária via `verifyMessage`/`verifyMediaMessage` (persiste + emite socket).
  O admin nunca mais cai no fluxo de ticket de cliente. Áudio do admin agora também
  é persistido (antes era baixado só para transcrição e descartado).
- `isSecretaryAdmin()` exportado de [handleSecretaryMessage.ts](backend/src/services/SecretaryService/handleSecretaryMessage.ts)
  — fonte única de verdade do roteamento (reusa `phonesMatch`, tolerante ao 9º dígito).
- Frontend: aba "Secretária" (ícone headset) em [TicketsManagerTabs](frontend/src/components/TicketsManagerTabs/index.js),
  listando `status=secretary`. **Restrita a admins** (`user.profile === 'admin'`) —
  espelha o gate do backend (`joinTickets` só deixa admin entrar em status-rooms
  arbitrários); são conversas privilegiadas (financeiro/gestão).
- Testes: `FindOrCreateSecretaryTicketService.spec.ts` (novo) + `isSecretaryAdmin` em
  `handleSecretaryMessage.spec.ts`. Rodados isoladamente (25 verdes).

### Fixed — Secretária assumia o ano errado (sem contexto temporal) (2026-06-28)

**Problema (ponto 1):** a Secretária "achava" que era janeiro de 2025 e listava
agendamentos da data errada, só acertando depois que o admin informava a data. O
Agente de Atendimento já resolvia isso (Bug #11), mas a Secretária não tinha o bloco.

**Fix:** `isoLocalDate` e `buildCurrentDateTimeBlock` movidos de `AgentService/index.ts`
para [agentUtils.ts](backend/src/services/AgentService/agentUtils.ts) (DRY) e injetados
no system prompt da Secretária ([secretaryLoop.ts](backend/src/services/SecretaryService/secretaryLoop.ts)).
Agora a Secretária recebe data/hora atual em BRT + calendário dos próximos 7 dias,
com a mesma robustez do Agente. Teste em `secretaryLoop.spec.ts`.

### Fixed — Envio OUTBOUND ao admin da Secretária tolerante ao 9º dígito (2026-06-28)

Complemento do fix de reconhecimento INBOUND (ticket #22): o reconhecimento do admin
já tolerava o 9º dígito via `canonicalizePhone`, mas os envios PROATIVOS (briefing
matinal e alertas) ainda montavam o JID com o número cru cadastrado. Quando o cadastro
tinha o 9 (`5548988368758`) e o JID real do WhatsApp não tem (`554888368758`), a entrega
podia falhar — o admin não recebia o briefing/alerta.

**Fix (mínima mudança, causa-raiz):** aplicar `canonicalizePhone(number)` ao montar o
JID de destino nos dois pontos de envio, garantindo a forma canônica (sem o 9, com código
de país) — a mesma chave usada no reconhecimento, fechando o ciclo INBOUND↔OUTBOUND.
- [secretaryBriefing.ts](backend/src/services/SecretaryService/secretaryBriefing.ts):
  briefing matinal.
- [secretaryAlerts.ts](backend/src/services/SecretaryService/secretaryAlerts.ts):
  alertas de espera longa e de erro do agente.

**TDD:** 2 casos novos em `secretaryBriefing.spec.ts` (cadastro com 9 → envio sem 9;
prepend `55` em DDD+número) + asserção existente do JID ajustada para a forma canônica;
nova suíte `secretaryAlerts.spec.ts` (3 casos de canonicalização do JID). Rodada APENAS a
suíte do SecretaryService (a completa leva >1h): **22 suítes / 294 testes verdes**. `tsc`
limpo nos arquivos tocados.

### Fixed — Causa-raiz REAL do "Secretária não reconhece o admin": 9º dígito brasileiro (2026-06-28)

Reportado de novo com prints (ticket #22): mesmo com `5548988368758` cadastrado em
`secretaryAdminNumbers`, a Secretária ignorava o admin e as mensagens (inclusive
"Qual o faturamento deste mês?") eram respondidas pelo **Agente**.

**Causa-raiz (confirmada por consulta ao banco):** o WhatsApp entrega o JID do celular
brasileiro **sem o 9º dígito** — `554888368758` (12 díg) — enquanto o admin cadastrou
`5548988368758` (13 díg, com o 9). A comparação anterior (`normalizeNumber` → igualdade
dígito-exata) falhava: `554888368758 ≠ 5548988368758`. O admin nunca era reconhecido e
caía no fluxo do Agente. As correções anteriores (Bug #3 / remoção do filtro de canal)
estavam corretas, mas eram ortogonais — não tocavam na comparação de número.

**Fix (determinístico, causa-raiz):**
- Novo utilitário [phoneMatch.ts](backend/src/services/SecretaryService/phoneMatch.ts):
  `canonicalizePhone()` reduz qualquer formato a uma chave canônica (remove JID/máscara,
  prepend `55` quando falta código de país, e **remove o 9º dígito** de celulares BR de
  13 díg). `phonesMatch(a, b)` compara por igualdade na chave canônica.
- [handleSecretaryMessage.ts](backend/src/services/SecretaryService/handleSecretaryMessage.ts):
  passa a reconhecer o admin via `phonesMatch` em vez de `includes` dígito-exato. Funciona
  **retroativamente** com o número já cadastrado — sem necessidade de re-salvar.
- Diretiva: [secretary_admin_phone_match.md](directives/secretary_admin_phone_match.md).
- Testes: `phoneMatch.spec.ts` (novo, 19 casos) + 2 casos de integração em
  `handleSecretaryMessage.spec.ts`. Rodados isoladamente (29 testes verdes).

### Changed — Cadastro de admin da Secretária: só DDD + número (2026-06-28)

UX: o campo "Números dos Admins" agora pede **apenas DDD + número** (ex: `48988368758`),
sem exigir `+` nem `55` — nem todo usuário sabe que `55` é o código do Brasil. O código de
país é incluído por trás no momento de salvar.

- [AgentSettings.js](frontend/src/components/Settings/AgentSettings.js): label/placeholder/
  helper atualizados; `normalizeAdminNumbers()` faz o prepend de `55` no `handleSave`.
- O backend já tolera qualquer formato via `canonicalizePhone`, então cadastros antigos
  (com `55`) seguem válidos.

### Fixed — Bug #A + Bug #B3 + Bug #3: gates determinísticos e prioridade de admin (2026-06-28)

Três bugs confirmados em produção durante testes com ticket #22.

**Bug #A — Agente assumia serviço sem perguntar ao cliente (AgentActions #552→#553)**
- **Causa-raiz:** após `listar_servicos`, o modelo chamava imediatamente `buscar_proximo_horario` com `servicoId:6` (primeiro da lista) sem o cliente ter mencionado nenhum serviço. "Gostaria de agendar um horário" não especifica nada. Rule 11 do prompt é probabilística — o modelo ignorava.
- **Fix determinístico:** gate `isPureScheduleRequest` em `AgentService/index.ts`. Quando `listar_servicos` foi chamado nesta iteração (`listarServicosCalledThisRun=true`), não existe serviço prévio no contexto (`!lastService`) e a mensagem é genérica (sem palavra específica de serviço com ≥ 5 chars após remoção de termos genéricos), o gate **bloqueia** `buscar_proximo_horario` e força o LLM a perguntar ao cliente.
- **Threshold = 5 chars:** captura "corte" (serviço real, 5 chars) como conteúdo específico — não bloqueia pedidos que explicitam serviço.

**Bug #B3 — `criar_evento` com `servicoId:1` não existente (AgentAction #556)**
- **Causa-raiz:** mesmo padrão de alucinação dos bugs anteriores (#32, #B1) — modelo gerava `servicoId` fora da lista real. Causava erro "Serviço #1 não encontrado" no BD e uma re-tentativa corrigida automaticamente pelo modelo, mas com custo de tokens e latência.
- **Fix determinístico:** gate de validação em `AgentService/index.ts`. Quando `cachedServicosThisRun` está preenchido (lista foi buscada nesta iteração), qualquer `criar_evento` com `servicoId` não presente no cache é bloqueado antes de chegar ao BD. O tool result de erro inclui os IDs válidos para o modelo corrigir.

**Bug #3 — Secretária não respondia ao admin (canal diferente do `secretaryChannelId`)**
- **Causa-raiz:** filtro de canal em `handleSecretaryMessage.ts` bloqueava admin quando o `whatsappId` da sessão diferia do `secretaryChannelId` configurado. Admin que testou o agente como cliente ficou com ticket no canal do agente; mensagens subsequentes de admin naquele canal eram ignoradas pela Secretária.
- **Fix:** filtro de canal removido de `handleSecretaryMessage.ts`. Admin tem **prioridade incondicional** em qualquer canal — a identificação é feita pelo `senderNumber`, não pelo canal. Suporta negócios com número único (um número para agente + secretária).

**Testes adicionados:** 4 novos testes em `AgentService.spec.ts` cobrindo os gates de Bug #A e Bug #B3.
**Suite completa:** 77 suites / 1260 testes — todos passando.

### Fixed — Causa-raiz do "não consegui verificar a disponibilidade" (2026-06-21)

Reportado pelo usuário com prints: o agente respondia "não consegui verificar a disponibilidade" para data específica ("sexta") e horário específico ("11h"), mesmo com o Google Calendar conectado e o `buscar_proximo_horario` funcionando.

**Causa-raiz (diagnóstico pela evidência dos prints):** `buscar_proximo_horario` funcionava (achava segunda 09:00), mas `verificar_disponibilidade` falhava para a MESMA segunda. A única diferença entre as duas tools é o parâmetro `data`. Modelos baratos (gpt-4o-mini) chamavam `verificar_disponibilidade` **sem `data`** (quando a data estava "no contexto", ex: "tem às 11h?") ou com `data` **malformada** ("sexta"). `parseLocalDate(undefined).split(...)` **lançava exceção** → o orquestrador devolvia `{erro: "Falha ao executar..."}` → o LLM traduzia como "não consegui verificar". As defesas de round 12 (âncora de data via prompt) eram apenas um *nudge* probabilístico — insuficiente para modelo barato.

**Por que os testes não pegaram:** eram unitários **mockados**, que sempre passam uma `data` válida. Mock não reproduz o modelo real omitindo um parâmetro. Lição registrada: validação de fluxo agêntico exige teste de integração do orquestrador (com o LLM omitindo args), não só unit das tools.

**Fix (determinístico, 2 camadas):**
- **Injeção determinística da `data`** no orquestrador ([index.ts](backend/src/services/AgentService/index.ts)), espelhando a injeção de `periodo` (Bug #37) e `hora` (Bug #B1): quando o LLM não passa uma data ISO válida em `verificar_disponibilidade`, resolve da MENSAGEM (`extractDateFromMessage` — "hoje/amanhã/sexta/26/06") ou, em refinamento, da última data discutida no histórico. Nova função pura `extractDateFromMessage` em [agentUtils.ts](backend/src/services/AgentService/agentUtils.ts).
- **Guarda defensiva** em [verificarDisponibilidade.ts](backend/src/services/GoogleCalendarService/tools/verificarDisponibilidade.ts): se `data` ausente/malformada, devolve erro instrutivo e estruturado em vez de **lançar** — a tool nunca mais derruba o turno. Loga `[verificarDisponibilidade] chamada sem data válida` para diagnóstico.
- Logs `[AgentService][DataInject]` registram cada injeção/falha para auditoria em produção.

**Quarta iteração (AgentActions #543→#545):** o fix do gate ainda era incompleto — `buscar_proximo_horario` sinaliza "serviço não encontrado" via `{encontrado:false, mensagem}` (sem `erro`), então um servicoId alucinado nesse caminho ainda era contado e bloqueava o correto. Fix completado: o gate checa AMBOS os sinais de "não encontrado" (erro de `verificar` e mensagem de `buscar`). Teste adicional em `AgentService.spec.ts`.

### Changed — Hardening completo do Módulo Secretária (coração do sistema) (2026-06-21)

Auditoria de segurança + robustez do `SecretaryService`, blindando-o ACIMA do nível do Agente (a Secretária é o canal de maior privilégio: cancela, fecha ticket, envia em nome da empresa, vê financeiro). Bugs e gaps corrigidos:

**Críticos (bugs):**
- **`secretaryLoop` não preservava `toolCalls` na mensagem assistant** (mesmo bug do Agente no Round 7). Sem isso a OpenAI rejeita a request seguinte com HTTP 400 → a Secretária **quebrava em QUALQUER fluxo de 2+ tools** (buscar_ticket → enviar_mensagem). **Fix:** passa `toolCalls` no push.
- **`cancelar_agendamento` gravava só `reminderStatus`, não `status: "CANCELADO"`** → cancelamento via Secretária continuava aparecendo ATIVO para o Agente/calendário. **Fix:** marca `status: "CANCELADO"` + reconhece já-cancelado por `status`.

**Robustez/diagnóstico (orquestração):**
- **Auditoria + diagnóstico via `AgentActions`:** o loop agora loga TODA tool (companyId, action, params, result, success, provider, model, ticketId). Antes a Secretária era uma caixa-preta — impossível depurar por dados (como o Agente era). Agora tem rastreabilidade total (importante para um canal que mexe em dados sensíveis).
- **`try/catch` POR TOOL:** uma exceção numa tool não derruba mais o turno inteiro — vira tool result de erro e o loop continua.
- **`finishReason === "error"`** tratado: encerra com graça em vez de tratar o erro como resposta.
- **Fallback de pseudo-XML** (paridade com o Agente).
- **`lastNonEmptyContent`** como fallback quando o loop estoura iterações.
- `MAX_ITERATIONS` 5 → 8 (headroom para gestão multi-passo).

**Segurança:**
- **Autenticação do admin robusta:** `normalizeNumber` (remove sufixo JID `@s.whatsapp.net` e máscaras) — evita trancar o admin por formato, mantendo comparação dígito-exata (fail-closed: sem admin configurado, ninguém acessa).
- **Multi-tenancy auditada:** confirmado que TODAS as 23 tools filtram por `companyId` (incl. financeiro via `getFinanceSummary(companyId, …)`) — sem vazamento entre empresas.
- **System prompt reforçado:** confirmar ações destrutivas/irreversíveis (cancelar/fechar/reabrir/transferir/enviar) com o admin antes de executar; nunca inventar IDs; nunca declarar sucesso se a tool retornou `erro`.

**TDD:** novo `secretaryLoop.spec.ts` (auditoria, resiliência por-tool, finishReason, toolCalls) + testes de auth com JID/máscara em `handleSecretaryMessage.spec.ts`. tsc limpo, 20 suítes / 267 testes da Secretária verdes, `dist/` recompilado.

### Added — Secretária: gate determinístico de destrutivas + defesa contra injeção de 2ª ordem (2026-06-21)

Implementação dos dois itens que estavam como "próximo nível" — agora a Secretária não deixa NADA crítico nas mãos do LLM:

- **Gate determinístico de ações destrutivas:** `cancelar_agendamento`, `reagendar_agendamento`, `fechar_ticket`, `reabrir_ticket`, `transferir_ticket` e `enviar_mensagem_para_cliente` **nunca são executadas direto pelo modelo**. O loop ESTACIONA a ação (`pendingAction` tipo `confirm_tool`, com o `senderNumber` correto) e pede confirmação ao admin; a execução só acontece após o "sim", pelo interceptor determinístico. Mesmo que o modelo decida executar, o backend exige o ok. Curto-circuita antes de empurrar o assistant+toolCalls (sem tool_calls órfãos no contexto). A ação confirmada é auditada em `AgentActions`. `PendingAction` virou união (`enviar_mensagem` legado + `confirm_tool`). Prompt ajustado para o LLM NÃO fazer dupla confirmação.
- **Defesa contra injeção de 2ª ordem:** dados controlados pelo cliente (nome do contato, corpo de mensagens) entram no contexto via tool results. Nova `neutralizeInjectionMarkers` ([securityGuards.ts](backend/src/services/AgentService/securityGuards.ts)) neutraliza marcadores de injeção (`[SISTEMA]:`, `</system>`, "ignore suas instruções", etc.) em TODO tool result antes de chegar ao LLM — determinístico, sem truncar nem quebrar JSON. Fecha o vetor "cliente se cadastra com nome malicioso".

**TDD:** testes de gate (estaciona/não executa, confirma executa+audita, recusa descarta), neutralização no loop, e `neutralizeInjectionMarkers` unitário. **Suíte completa: 77 suítes / 1252 testes verdes** (zero regressão). `dist/` recompilado.

### Fixed — Causa-raiz do "não consegui verificar a disponibilidade" (2026-06-21) (continuação)

**Terceira iteração (diagnóstico pela tabela `AgentActions` do ticket 22 — fonte de verdade):** a causa-raiz REAL apareceu nos dados: o modelo barato **aluciná um `servicoId` inexistente** (ex: 1, sendo 6 o correto) na 1ª chamada de `verificar_disponibilidade` → falha "Serviço não encontrado" → **mas o gate anti-multi-serviço (Bug #32) contava esse serviço falho** e BLOQUEAVA a 2ª chamada (servicoId correto) no mesmo turno → o agente travava e re-perguntava o serviço. **Fix:** o gate só contabiliza o serviço APÓS uma consulta BEM-SUCEDIDA (`!result.erro`); um servicoId alucinado/inexistente não bloqueia mais a tentativa correta. Mantém a intenção original (barrar despejo de 2+ serviços REAIS por turno). Teste em `AgentService.spec.ts`. **Aprendizado registrado:** bug agêntico se diagnostica na tabela `AgentActions` (tool+params+result por turno), não com testes mockados — as duas iterações anteriores foram hipóteses; esta é dado.

**Segunda iteração (print real, mesmo dia):** o sintoma persistiu, e o novo print revelou a causa-raiz REAL — o modelo barato **não chamava** `verificar_disponibilidade` e **inventava** "não consegui verificar" (o cliente agendou 12:00 no mesmo dia/grid, provando que 11:00 estava livre). **Fix determinístico:** `looksLikeAvailabilityDodge` detecta a esquiva; quando o cliente pediu um horário específico e o modelo se esquiva sem chamar a tool, o orquestrador FORÇA uma re-iteração obrigando a verificação (mesmo padrão do promise-text/Bug #20). Combinado com a injeção de data/hora, o modelo não consegue mais fingir a falha. Testes de integração em `conversationScenarios.spec.ts` (esquiva → verificação forçada; e não-força quando não há pergunta de horário).

**TDD:** `extractDateFromMessage` (relativos, dias da semana, DD/MM, "dia DD", não-confunde "11h"); guarda defensiva da tool (não lança); integração no orquestrador (injeta data do histórico em "tem às 11h?" e da mensagem em "tem na sexta?"). `tsc` limpo, specs afetadas verdes, `dist/` recompilado. **Confirmação em produção pendente** (ver logs `[DataInject]` / tabela AgentActions).

---

### Fixed — Blindagem round 13: auditoria profunda do write-path (criar/reagendar/cancelar) (2026-06-20)

Auditoria sênior das tools de escrita do módulo de agendamento, para robustez com LLMs baratos. **Nota:** o "Bug #41" (reagendar sem validação de disponibilidade) já estava corrigido no código desde 2026-05-31 — o `MEMORY.md` estava desatualizado e foi corrigido. 5 furos REAIS encontrados:

- **`buscar_agendamento_cliente` — hora errada em produção (ALTO):** `data`/`hora` formatadas sem `timeZone` renderizavam no fuso do processo. Em container UTC, 14:00 BRT virava "17:00" — agente informava 3h errado. **Fix:** formatação em `America/Sao_Paulo` explícito + novos campos `dataISO` e `dataFormatada` ("segunda-feira, 22/06/2026"). [buscarAgendamentoCliente.ts](backend/src/services/GoogleCalendarService/tools/buscarAgendamentoCliente.ts)
- **`reagendar_evento` sem guarda de passado:** paridade com `criar_evento` (Bug #13). Sem ela, no fail-open do Google um LLM barato poderia remarcar para o passado. **Fix:** guarda `novoSendAt <= now`. [reagendarEvento.ts](backend/src/services/GoogleCalendarService/tools/reagendarEvento.ts)
- **`reagendar`/`cancelar` sem guarda de status CANCELADO:** **Fix:** reagendar recusa CANCELADO (orienta a `criar_evento`); cancelar vira idempotente ("já estava cancelado", sem re-deletar no Google → sem falso alarme de cancelamento parcial). [cancelarEvento.ts](backend/src/services/GoogleCalendarService/tools/cancelarEvento.ts)
- **`criar_evento` não validava profissional↔serviço:** classe do Bug #8 (LLM aluciná atendenteId). **Fix:** valida vínculo `ServiceProfessional`; recusa e orienta às tools de disponibilidade se o profissional não realiza o serviço. [criarEvento.ts](backend/src/services/GoogleCalendarService/tools/criarEvento.ts) Mesma validação estendida ao `reagendar_evento` quando o cliente troca de profissional via `novoAtendenteId` (só nesse caso, para não onerar a remarcação comum). [reagendarEvento.ts](backend/src/services/GoogleCalendarService/tools/reagendarEvento.ts)
- **Datas em ISO cru nas mensagens (linguagem natural):** **Fix:** `formatDateWithWeekdayBRT` em todas as mensagens de criar/reagendar → "segunda-feira, 22/06/2026" em vez de "2026-06-22".

**TDD:** novos testes em `buscarAgendamentoCliente.spec.ts` (formatação BRT + dataFormatada/dataISO), `reagendarEvento.spec.ts` (guarda de passado, guarda de CANCELADO), `cancelarEvento.spec.ts` (idempotência), `criarEvento.spec.ts` ×2 (validação profissional↔serviço, mensagem com dia da semana). `tsc` limpo, suíte completa verde, `dist/` recompilado.

---

### Fixed — Blindagem round 12: dia da semana natural + horário específico determinístico + âncora de data (2026-06-20)

Dois furos recorrentes reportados pelo usuário com print real. Princípio (CLAUDE.md §I): lógica de negócio é determinística, não pode depender do LLM. Modelo do agente segue probabilístico (gpt-4o-mini) — a arquitetura precisa falhar com graça.

**Problema 1 — Agente se esquivava do dia da semana ("recomendo conferir no seu calendário")**
- **Causa raiz:** a regra 8 do system prompt (Bug #5, abril) PROIBIA mencionar o dia da semana — escrita quando o LLM errava o cálculo. Em maio a `buildWeekCalendar` passou a injetar a tabela determinística dia→data, tornando a regra 8 obsoleta e contraditória. O modelo escolhia a esquiva.
- **Fix:** nova função pura `formatDateWithWeekdayBRT(iso)` em [availabilityEngine.ts](backend/src/services/GoogleCalendarService/availabilityEngine.ts) → "segunda-feira, 22/06/2026" (weekday calculado no backend, TZ-independente). As tools `verificar_disponibilidade` e `buscar_proximo_horario` agora devolvem `dataFormatada`. Regra 8 reescrita: incluir o dia da semana para soar natural, mas SEMPRE de um dado pronto (`dataFormatada`/tabela), nunca calcular. Nova regra 16 reforça. A esquiva robótica saiu do prompt.

**Problema 2 — "Tem horário para as 11h?" → "não consegui verificar a disponibilidade"**
- **Causa raiz 2a (regressão latente do Bug #39):** ao remover a lista de slots do retorno de `verificar_disponibilidade` (deixando só a faixa), o LLM perdeu como responder "11:00 está livre?" — não havia caminho determinístico para horário exato.
- **Causa raiz 2b:** faltava âncora de DATA. O agente ancorava o último SERVIÇO (Bug #33/#40) mas não a última DATA — "tem às 11h?" sem repetir o dia deixava o LLM chamar a tool com data faltando/errada.
- **Fix 2a:** [verificarDisponibilidade.ts](backend/src/services/GoogleCalendarService/tools/verificarDisponibilidade.ts) ganhou parâmetro opcional `hora`. Quando informado, devolve `horaConsultadaDisponivel` (true/false) + `horaDisponivel` por profissional — checagem determinística contra os slots livres reais. Se ocupado, ainda devolve a faixa para reofertar. Nova regra 15 no prompt: responder por esse campo, proibido "não consegui verificar". Injeção determinística de `hora` no orquestrador ([index.ts](backend/src/services/AgentService/index.ts)) via `extractTimeFromMessage` (espelha a injeção de `periodo`/Bug #37) — conservadora, não confunde "dia 22" com horário.
- **Fix 2b:** `extractLastDiscussedDate` ([agentUtils.ts](backend/src/services/AgentService/agentUtils.ts)) + `buildLastDateBlock` injetam a última data discutida (com dia da semana) no prompt. Refinamentos por horário reusam essa data sem re-perguntar.

**TDD / validação**
- `agentUtils.spec.ts`: `extractTimeFromMessage` (reconhece "11h"/"14:30", ignora "22 é que dia?") e `extractLastDiscussedDate`.
- `availabilityEngine.spec.ts`: `formatDateWithWeekdayBRT` (weekday correto, TZ-independente).
- `verificarDisponibilidade.spec.ts`: `hora` disponível/ocupado, normalização "11h"→"11:00", `dataFormatada`.
- `buscarProximoHorario.spec.ts`: `dataFormatada` na mensagem.
- `conversationScenarios.spec.ts`: Cenário 14 (injeção de `hora`, não-injeção em "22 é que dia?", bloco de âncora de data, regras 15/16 no prompt).
- `knowledgeBuilder.spec.ts`: teste de regra de dia da semana atualizado para a nova diretriz.

---

### Fixed — Blindagem do módulo de Calendário: disponibilidade, fuso e contexto (2026-05-28 a 2026-06-01)

Auditoria completa e correção de causa-raiz do módulo de agendamento (visualização, criação, reagendamento). Princípio aplicado em todos os fixes: **lógica de negócio é determinística, não pode depender do LLM** (CLAUDE.md §I). Modelo do agente: `gpt-4o-mini` (barato, não confiável para seguir instruções de prompt).

**Bug #35 — Filtro de período delegado ao LLM (sintoma reportado: "não consegui verificar a tarde")**
- `availabilityEngine.ts`: novas funções puras `normalizePeriod()` (PT/EN, acentos, "à tarde"→`tarde`) e `filterSlotsByPeriod()` (fronteiras: manhã <12:00, tarde 12:00–18:00, noite ≥18:00)
- `verificarDisponibilidade.ts` e `buscarProximoHorario.ts`: novo argumento `periodo`; filtro aplicado no backend, não pelo LLM

**Bug #36 — Fuso horário ausente no write path (latente, crítico)**
- Novo módulo puro `timezone.ts` com `brtWallClockToInstant(data, hora)` e `BRT_OFFSET = "-03:00"` (Brasil sem DST desde 2019)
- `criarEvento.ts` e `reagendarEvento.ts`: instante do agendamento passou a fixar offset BRT. Antes, em servidor UTC, "14:00" virava 14:00 UTC = 11:00 BRT (3h adiantado), podendo rejeitar horários futuros válidos

**Bug #37 — Gatilho de período ainda probabilístico + `dist/` defasado**
- `AgentService/index.ts`: injeção DETERMINÍSTICA do período — extrai o período da mensagem atual do cliente (`normalizePeriod(sanitizedMessage)`) e injeta em `toolCall.arguments.periodo` quando o LLM o omite
- **Aprendizado de deploy:** o usuário roda `npm start` (que executa `dist/` COMPILADO). Fixes em `.ts` exigem `npm run build` antes do restart, senão não têm efeito

**Bug #38 — Slots em horários "quebrados" (12:52, 13:50…)**
- `availabilityEngine.ts`: `slotInterval` deixou de ser `Math.min(durationMinutes, 60)` (serviço de 58 min gerava grade de 58 min: 09:00, 09:58, 10:56…) e passou a ser `durationMinutes ≤ 30 ? 30 : 60` — horários sempre em hora cheia/meia-hora

**Bug #39 — LLM listava todos os slots em vez da faixa + `criar_evento` sem validação**
- `verificarDisponibilidade.ts`: a resposta NÃO devolve mais o array `slots` ao LLM — só `rangeFormatado` (faixa, ex: "das 12:00 às 18:00") + `horariosDisponiveis` (contagem). Nova função pura `slotsToRanges()` agrupa slots contíguos em faixas. Sem a lista, o LLM não tem como despejar horário por horário
- `criarEvento.ts`: nova **validação determinística de disponibilidade** antes de criar — recalcula horários livres (expediente via `UserWorkingHours` + agenda via `getBusyPeriods` + `calculateAvailableSlots`) e recusa horário fora da grade/ocupado. `fail-open` em erro transitório do Google. Fecha lacuna latente de double-booking, agora que o LLM não recebe mais a lista de slots

**Bug #40 — Agente re-perguntava o serviço em refinamento ("E a tarde?")**
- `AgentService/index.ts`: `buildLastServiceBlock` estendido para cobrir refinamentos de disponibilidade ("e a tarde?", "e amanhã?", "tem mais cedo?") → usa o MESMO serviço, proibido re-perguntar. Regra 11 ganhou exceção explícita quando já há serviço em discussão

**TDD / validação**
- `availabilityEngine.spec.ts`: 43 testes (normalizePeriod, filterSlotsByPeriod, Bug #38 alinhamento, slotsToRanges)
- `criarEvento.spec.ts` (×2 arquivos): testes da validação determinística (Bug #39) + mocks de `UserWorkingHours`/`getBusyPeriods`
- `timezone.spec.ts`: 5 testes; `conversationScenarios.spec.ts`: Cenário 13 (período + injeção Bug #37)
- **Suite completa: 76 suítes, 1172 testes, todos passando**

**Tech debt registrado:** `reagendar_evento` tem a MESMA lacuna de validação de disponibilidade que o `criar_evento` tinha — corrigir em ciclo separado (futuro Bug #41).

---

### Added — Unificação UX: Catálogo de Serviços como fonte única (2026-05-24)

**Motivação:** dois formulários independentes escreviam na mesma tabela `Services` com campos complementares (um com preço/categoria, outro com profissionais). O cliente ficava confuso sobre onde cadastrar.

**Backend**
- `ServiceCatalogService.createService` agora aceita `professionalIds?: number[]` — cria `ServiceProfessional` em transação atômica com o serviço
- `ServiceCatalogService.updateService` aceita `professionalIds?: number[]` — substitui profissionais (se `undefined`, não toca; se `[]`, remove todos); operação em transação
- `ServiceCatalogService.listServices` e `findServiceById` retornam `serviceProfessionals` com `user { id, name }` — parity com `GET /google-calendar/services`
- `ServiceCatalogController.store` e `.update` aceitam `professionalIds` no body, com defensive parse e validação cross-company delegada ao service
- `GlobalSettingsController.update`: removido `assertSuper(req)` redundante (função não existia — causava erro TS; middleware `isSuper` já guarda a rota)
- Novos testes unitários: `ServiceCatalogService/__tests__/ServiceCatalogServiceIO.spec.ts` — 10 testes cobrindo professional assignment, cross-company guard, transação, e include de profissionais em listServices

**Frontend**
- `Services/index.js` (Catálogo): novo campo "Profissionais" no modal (checkboxes) + coluna na tabela exibindo chips com nomes dos profissionais
- `ServicesSettings.js` (Configurações → Agendamentos): convertido de CRUD para visualizador somente-leitura que consome `/service-catalog` — inclui banner informativo com link para `/services` e tabela read-only com preço + profissionais + status

**Removido**
- Formulário de criação/edição de serviços em `ServicesSettings.js` — substituído pela visualização do catálogo

---

### Added — GlobalSettings + Integrações super admin + compactação de contexto (2026-05-23)

**GlobalSettings — configurações a nível de plataforma**
- Novo model `GlobalSetting` (`backend/src/models/GlobalSetting.ts`) — tabela `GlobalSettings` sem `companyId`, chaves únicas (plataforma-level)
- Migration `20260523000001-create-GlobalSettings.ts`
- `GlobalSettingsService` (`getAll`, `upsertMany`) com invalidação imediata de cache
- `GlobalSettingsController` — GET mascara API keys com `"••••"`, PUT ignora sentinel `"••••"` (não sobrescreve chave não alterada)
- Rotas `GET /global-settings` + `PUT /global-settings` — ambas protegidas por `isAuth + isSuper`
- `settingsCache.ts`: nova função `getGlobalSettings()` (cache TTL-30s) + `invalidateGlobalCache()`

**Prioridade de LLM em cascata**
- `AgentService/index.ts`: `loadProviderConfig` lê `GlobalSettings` primeiro, empresa como fallback — `globalAgentProvider/Key/Model`
- `SecretaryService/secretaryLoop.ts`: idem com fallback extra — `globalSecretaryProvider/Key/Model` → `globalAgent*` → empresa → defaults
- Secretary agora padroniza para `claude-sonnet-4-6` (era confundido com o mesmo do agente)
- Agent continua com `claude-haiku-4-5-20251001` (rápido para atendimento)

**Compactação de contexto do Agente (contextCompactor)**
- Novo `backend/src/services/AgentService/contextCompactor.ts` — 5 funções puras (sem I/O): `shouldCompact`, `extractTextContent`, `buildCompactionContext`, `applyCompaction`, `estimateTokenCount`
- Threshold: 30 mensagens → compacta, mantendo últimas 10
- Resumo injetado como `role: "user"` com marker `[CONTEXTO ANTERIOR RESUMIDO]` (evita rejeição de `role: "system"` por providers)
- Falha na compactação é não-bloqueante: loga erro + continua com histórico original
- TDD: 38 testes em `contextCompactor.spec.ts` cobrindo todos os casos de borda

**Frontend — aba Integrações (super admin apenas)**
- Novo componente `frontend/src/components/Settings/IntegrationSettings.js`
- Dois painéis LLM reutilizáveis (`LLMPanel`): Agente de Atendimento + Secretária IA
- Por painel: dropdown de Provedor (5 opções), API Key com mascaramento, seletor de Modelo + botão Refresh (busca modelos do provedor via API)
- Aviso de impacto global (afeta todas as empresas simultaneamente)
- Integrado em `SettingsCustom/index.js` como nova aba "Integrações" visível apenas para super admin

**Frontend — AgentSettings melhorias**
- Aba "Provedor" ocultada para usuários não-super (LLM é infraestrutura do super admin)
- Campo "Tom de Voz / Instruções Personalizadas" (TextField livre) adicionado na aba Personalidade
- Explicit `value` props em todas as Tabs para evitar index shift ao ocultar aba Provedor
- Usuários não-super iniciam com `activeTab = 1` (Personalidade, não Provedor)

### Fixed — Mock de `GlobalSetting` ausente em `AgentService.spec.ts` (2026-05-23)

**Sintoma:** Todos os 30 testes do `AgentService.spec.ts` falhavam com `FALLBACK_REPLY` após a introdução de `getGlobalSettings()`.

**Causa:** `GlobalSetting.findAll()` chamado sem mock no spec → exceção → try/catch externo → FALLBACK_REPLY.

**Fix:** `jest.mock("../../../models/GlobalSetting")` + `(GlobalSetting.findAll as jest.Mock).mockResolvedValue([])` no `beforeEach`.

**Suite após fix:** 71 suítes, **1069 testes**, todos passando.

---

### Fixed — Bug #25: agente não conseguia chamar `buscar_agendamento_cliente` (2026-05-10 round 9)

**Sintoma**: mesmo após o fix do Bug #24, o agente continuou respondendo *"não encontrei nenhum agendamento ativo em seu nome"* para um cliente com agendamento ATIVO no banco (Schedule #13, status `PENDENTE`).

**Investigação no banco** revelou que o agendamento existia e atendia todos os filtros da query — `contactId=8`, `companyId=2`, `status=PENDENTE`, `sendAt=2026-05-11 13:00:00+00`. Portanto a query estava OK. O problema era anterior: a tool nunca era chamada.

**Causa raiz (Sintoma vs Causa, CLAUDE.md II.5)**: a `buscarAgendamentoClienteDefinition` declarava `contactId` como parâmetro **required**. Mas o `contactBlock` do system prompt só expunha ao LLM `contactName`, `contactNumber` e `ticketId` — **o `contactId` interno nunca era passado**. Resultado: Claude (modelo estrito quanto a schemas) se recusava a chamar a tool por falta do parâmetro obrigatório e respondia "do nada" que não encontrava agendamento. Modelos mais permissivos chamariam com `contactId` hallucinado, ainda errado.

**Fix em 3 camadas** (defesa em profundidade):
1. **Tool definition**: remover `contactId` dos parâmetros de `buscarAgendamentoClienteDefinition` — LLM não precisa conhecer IDs internos.
2. **Dispatch (`executeCalendarTool`)**: para `buscar_agendamento_cliente`, **sempre** usar `contactId` do contexto de execução do AgentService — ignorar qualquer valor que o LLM tenha passado.
3. **System prompt (`buildContactContextBlock`)**: incluir `contactId` no bloco de contexto como cinto-e-suspensórios para que outras tools (ex: `criar_evento`) tenham acesso ao valor correto caso precisem.

**Por que o Bug #24 não resolveu**: o fix de status `ENVIADA` era real (lacuna defensiva), mas o status do agendamento testado estava `PENDENTE` — então a query nunca era o gargalo. O gargalo era o LLM não chamar a tool. Bug #24 vira agora prevenção futura; Bug #25 é a correção do sintoma observado.

**TDD**: 2 testes adicionados verificam a definição da tool (sem `contactId` em `properties` e sem `contactId` em `required`).

---

### Added — Link Google Calendar no agendamento (2026-05-10 round 9)

**Feature (Opção A):** após criar um agendamento com sucesso, o resultado de `criar_evento` agora inclui o campo `linkCalendario` — uma URL pré-preenchida do Google Calendar (`action=TEMPLATE`) com o serviço, data, horário e profissional. O LLM oferece o link ao cliente: *"Quer adicionar ao seu Google Calendar? Acesse: [link]"*. O cliente clica e já abre a tela de salvar o evento no Google Calendar, sem precisar de email ou OAuth.

**Arquitetura:**
- Nova função utilitária pura [`gerarLinkGoogleCalendar.ts`](backend/src/services/GoogleCalendarService/tools/gerarLinkGoogleCalendar.ts) — pure function, sem side effects, 100% testável isoladamente.
- `CriarEventoResult` ganhou campo opcional `linkCalendario?: string`.
- `criarEventoDefinition.description` atualizada para instruir o LLM a oferecer o link.

**TDD:** 14 testes em [`gerarLinkGoogleCalendar.spec.ts`](backend/src/services/GoogleCalendarService/__tests__/tools/gerarLinkGoogleCalendar.spec.ts) — estrutura da URL, cálculo de data/hora de início e fim (incluindo overflow de meia-noite), details opcional, encoding de caracteres especiais. Teste de integração adicionado em `criarEvento.spec.ts`.

---

### Fixed — Bug #24: agente não encontrava agendamento com status ENVIADA (2026-05-10 round 9)

**Sintoma**: cliente com agendamento marcado para 11/05 perguntava "Tenho um agendamento marcado?" e o bot respondia "Não encontrei nenhum agendamento ativo em seu nome". O agendamento existia no banco mas era invisível para o agente.

**Causa raiz**: quando o `reminderHandler` (job de lembretes) dispara o WhatsApp de confirmação, o status do `Schedule` muda de `"PENDENTE"` para `"ENVIADA"`. Dois problemas encadeados:
1. `buscarAgendamentoCliente.ts` linha 60: `status: { [Op.notIn]: ["CANCELADO", "ENVIADA"] }` — agendamentos com lembrete enviado eram **excluídos** da busca, tornando-os invisíveis ao agente.
2. `criarEvento.ts` linha 166: `status: "PENDENTE"` no check anti-duplicata — permitiria criar um segundo agendamento caso o cliente tentasse reagendar, pois o check não encontrava o agendamento "ENVIADA" existente.

**Fix (mínima mudança, 2 linhas)**:
- `buscarAgendamentoCliente.ts`: `["CANCELADO", "ENVIADA"]` → `["CANCELADO"]` — somente `CANCELADO` representa agendamento encerrado de fato.
- `criarEvento.ts`: `status: "PENDENTE"` → `status: { [Op.in]: ["PENDENTE", "ENVIADA"] }` — ambos os status representam agendamento ativo; duplicata bloqueada.

**TDD**: 2 novas suítes criadas:
- [`buscarAgendamentoCliente.spec.ts`](backend/src/services/GoogleCalendarService/__tests__/buscarAgendamentoCliente.spec.ts): 7 testes — inclui verificação explícita que o símbolo `Op.notIn` não contém `"ENVIADA"`.
- [`criarEvento.spec.ts`](backend/src/services/GoogleCalendarService/__tests__/criarEvento.spec.ts): 7 testes — inclui verificação que o símbolo `Op.in` contém `"PENDENTE"` e `"ENVIADA"`.

---

### Security — Defesas contra Prompt Injection e Jailbreaking (2026-05-09 round 9)

Implementado `securityGuards.ts` com quatro camadas de defesa contra manipulação do agente via mensagens do cliente WhatsApp:

- **Input Sanitization** — `sanitizeUserMessage()` remove padrões de injeção conhecidos (`[SISTEMA]:`, `</system>`, `ignore all previous instructions`, `esqueça suas instruções`, `jailbreak`, `modo desenvolvedor`, etc.) antes de enviar ao LLM. Mensagens acima de 2000 chars (padding attack) são truncadas. Injeção detectada → `[AgentService][SECURITY] WARN` para auditoria.
- **Input Wrapping** — `wrapUserMessage()` delimita a mensagem com `[MENSAGEM_CLIENTE_INICIO]...[MENSAGEM_CLIENTE_FIM]` para que o LLM trate o conteúdo como "dado do cliente", nunca como instrução do sistema.
- **Output Guardrails** — `checkOutputSafety()` bloqueia respostas do LLM que indicam jailbreak bem-sucedido (`jailbreak ativado`, `modo desbloqueado ativado`, `fui reprogramada para`, `meu system prompt diz`) substituindo por `SECURITY_FALLBACK_REPLY` neutra. Bloqueio logado com `reason` + `ticketId` + `companyId` para rastreabilidade.
- **Prompt Hardening** — `buildSecurityBlock()` adicionado ao system prompt: instrui o LLM sobre escopo exclusivo de atendimento, não revelar dados internos, tratar texto entre delimitadores como dado (não instrução) e usar tools para preços/valores.

Histórico salvo com `sanitizedMessage` (não wrapped) — contexto limpo para iterações futuras.

**TDD**: 23 testes em [`securityGuards.spec.ts`](backend/src/services/AgentService/__tests__/securityGuards.spec.ts) + 5 testes de integração em [`AgentService.spec.ts`](backend/src/services/AgentService/__tests__/AgentService.spec.ts). Suite completa: 36 suítes, 293 testes, todos passando.

---

### Fixed — Split-turn e duplicata de agendamento por contactId ausente no contexto (2026-05-07 round 8)

**Contexto**: após o round 7 (gpt-4o-mini + defesas de OAuth), dois novos bugs foram observados em produção via conversa real com a clínica Bomma:

1. **Split-turn persistente**: bot disse "Vou começar listando os serviços que temos" e **parou** — nunca enviou a lista. O `buildExecutionFlowBlock()` adicionado no round 7 não foi suficiente (instrução probabilística ignorada pelo gpt-4o-mini neste caso).
2. **Remarcação com serviço errado + duplicata**: ao pedir remarcação, o bot criou um NOVO agendamento para "Avaliação odontológica e limpeza básica" (serviço errado) sem cancelar o "Reparo de dentes" existente. O check anti-duplicata em `criar_evento` deveria ter bloqueado isso — investigação revelou por que foi bypassado.

- **Bug #22 (CRÍTICO — causa raiz da duplicata) — `contactId` não era repassado ao contexto de `executeAgentTool`** ([AgentService/index.ts](backend/src/services/AgentService/index.ts)). Em `handleClientAgent`, o `contactId` vem no `input` e é desestruturado corretamente. Porém ao chamar `executeAgentTool(name, args, { companyId, ticketId, whatsappId })`, o `contactId` era **omitido do contexto**. `executeCalendarTool` então passa `contactId: (args.contactId ?? ctx.contactId)` para `criarEvento` — mas `ctx.contactId` era `undefined`. Quando o LLM (gpt-4o-mini) não incluía `contactId` nos args de `criar_evento` (comportamento inconsistente observado), a tool recebia `contactId: undefined`. A query Sequelize `WHERE contactId = undefined` é tratada como sem filtro ou match nulo — o check anti-duplicata **não encontrava o agendamento PENDENTE existente** e a criação prosseguia. Resultado: duplicata com serviço errado (o LLM havia escolhido o serviço errado ao criar, já que não usou `reagendar_evento`). **Fix**: incluir `contactId` no contexto passado a `executeAgentTool` — uma linha. O `contactId` do servidor (nunca alucinado) agora sempre serve de fallback. **TDD**: +1 teste em [AgentService.spec.ts](backend/src/services/AgentService/__tests__/AgentService.spec.ts) — verifica que `executeAgentTool` é chamado com `expect.objectContaining({ contactId: 42 })` quando o input tem `contactId: 42`.

- **Bug #20 Round 8 (determinístico) — promise-text sem re-iteração forçada** ([AgentService/index.ts](backend/src/services/AgentService/index.ts)). O `buildExecutionFlowBlock()` é uma instrução probabilística — o gpt-4o-mini ainda retorna textos como "Vou listar os serviços disponíveis para você." sem tool_calls, encerrando o turn. O loop de `handleClientAgent` ao encontrar `effectiveToolCalls.length === 0` simplesmente quebrava e enviava o "promise" como resposta final. **Fix determinístico**: nova função `looksLikePromise(text)` que detecta padrões "vou [verbo de ação]" / "estou verificando" / "deixa eu ver" sem marcadores de conclusão (✅, "agendado", "confirmado") e sem ponto de interrogação (perguntas legítimas ao cliente não são promises). Quando detectado e `iterations < MAX_ITERATIONS - 1`, o loop injeta: `messages.push({ role: "assistant", content: promiseText })` + `messages.push({ role: "user", content: "[SISTEMA]: Você prometeu executar uma ação mas não chamou nenhuma ferramenta. Execute AGORA..." })` e continua via `continue` — sem quebrar o loop. O LLM recebe a correção, tende a chamar a tool, e sintetiza a resposta real. **TDD**: +3 testes em [AgentService.spec.ts](backend/src/services/AgentService/__tests__/AgentService.spec.ts):
  - Promise-text força 3 iterações: iter1 (promise) → iter2 (tool call) → iter3 (síntese). Resposta final é a síntese, não o promise.
  - Pergunta legítima ("Qual horário você prefere?") NÃO re-itera — 1 iteração, sai direto.
  - Texto com "✅" NÃO re-itera mesmo com verbos no futuro.

- **Bug #23 (probabilístico) — LLM mudava serviço ao remarcar** ([AgentService/index.ts:buildAgendamentoFlowBlock](backend/src/services/AgentService/index.ts)). Quando o usuário disse "quebrei os dentes, quero remarcar", o bot tentou criar novo agendamento com serviço que interpretou da mensagem ("Avaliação"), em vez de chamar `reagendar_evento` que preserva o serviço original automaticamente. `buildAgendamentoFlowBlock()` ganhou **regra 7** explícita: "`reagendar_evento` NÃO recebe `servicoId` — serviço original é preservado. NÃO mude o serviço ao remarcar mesmo que o cliente mencione problema diferente. Se quiser OUTRO serviço além de remarcar, cancele + crie com serviço correto. NÃO use `criar_evento` para remarcar." `buildExecutionFlowBlock()` ganhou **regra 6**: "Quando cliente descreve problema, CHAME a tool relevante AGORA — não diga 'vou listar' sem chamar `listar_servicos`." **TDD**: +1 teste em [AgentService.spec.ts](backend/src/services/AgentService/__tests__/AgentService.spec.ts) — asserta que systemPrompt contém regex `/servi[çc]o.*preserv|preserv.*servi[çc]o/` e `/n[ãa]o.*criar_evento.*remarcar/`.

- **Test rot prevention — `verificarDisponibilidade.spec.ts`** ([verificarDisponibilidade.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/verificarDisponibilidade.spec.ts)). Três testes usavam `data: "2026-05-04"` (segunda-feira). Em 2026-05-05, essa data virou passado — `calculateAvailableSlots` com `now: new Date()` filtrava todos os slots (09:00-17:00 inteiramente no passado), `disponivel` voltava `false`, teste `toBe(true)` falhava. Mesma causa que o date-rot de `criarEvento.spec.ts` no round 7. **Fix**: helper `proximaSegunda()` que computa dinamicamente a próxima segunda-feira a partir de hoje (`nowDay === 1 ? 7 : (8 - nowDay) % 7` dias à frente). Três testes atualizados. Os testes de bug #10 (que usam datas históricas "2026-04-27", "2026-04-26" e só checam `dayOfWeek`, não `disponivel`) ficam intactos — passam corretamente mesmo com datas passadas.

- **Suite completa**: 35 suites, 267 testes (+12 novos), todos passando

---

### Fixed — Migração Groq→OpenAI revelou bug de formato de mensagens + cadeia de bugs Google Calendar (2026-05-04 round 7)

**Contexto**: após trocar `gpt-oss-120b` (Groq) por `gpt-4o-mini` (OpenAI) nas Settings da empresa, agente passou a entregar `FALLBACK_REPLY` no segundo turn de tool calling. Investigação revelou cadeia de 5 bugs latentes que só apareceram juntos quando o stack foi exercitado por um cliente real e um provider mais rigoroso (OpenAI segue o spec à risca; Groq tolerava silenciosamente). Ordem cronológica de descoberta:

- **Bug — Formato de mensagens inválido (assistant→tool)**:
  - **Causa raiz** ([interfaces.ts](backend/src/services/AgentService/providers/interfaces.ts)): `AIMessage` não tinha campo `toolCalls` para mensagens role=assistant. Loop em [AgentService/index.ts](backend/src/services/AgentService/index.ts) empilhava `{role: "assistant", content: ""}` sem tool_calls, quebrando a relação que a OpenAI exige entre `tool_calls` (assistant) e `tool_call_id` (tool result subsequente). Erro: `messages with role 'tool' must be a response to a preceeding message with 'tool_calls'`.
  - **Fix**: novo campo `toolCalls?: AIToolCall[]` em `AIMessage`; `OpenAICompatibleProvider.toOpenAIMessages` serializa como `tool_calls` array com `content: null`; `AnthropicProvider.toAnthropicMessages` monta blocos `tool_use` (Anthropic exige content array); loop empilha assistant **com** toolCalls. **TDD**: nova suite [OpenAICompatibleProvider.spec.ts](backend/src/services/AgentService/providers/__tests__/OpenAICompatibleProvider.spec.ts) com 2 testes que mockam `global.fetch` e validam o body enviado.

- **Bug #18 — `invalid_grant` cru repassado ao LLM** ([criarEvento.ts](backend/src/services/GoogleCalendarService/tools/criarEvento.ts)). Quando `refresh_token` do Google é revogado/expirado, `createCalendarEvent` lança `Error("invalid_grant")`. A tool repassava a mensagem crua, LLM ficava em loop tentando recriar e por fim transferia para humano sem explicar o problema real. **Fix**: helper `traduzirErroGoogleCalendar(err, profissionalNome)` retorna `{ mensagem, invalidarConexao }` — mensagem orientativa para o LLM repassar ao cliente; flag para o caller marcar `UserCalendar.isActive=false` quando o token está em estado inválido permanente.

- **Bug #19 — refresh handler nunca persistia novos tokens** ([calendarApi.ts:60-79](backend/src/services/GoogleCalendarService/calendarApi.ts#L60-L79)). Handler `client.on("tokens")` só ativava quando `credentials.userCalendarId` estava setado, mas as tools passam o `UserCalendar` Sequelize model — campo nativo é `id`, não `userCalendarId`. Cada refresh feito pelo `googleapis` SDK era perdido (memória apenas). Provavelmente contribuiu para o `refresh_token` morrer. **Fix**: handler aceita `id` ou `userCalendarId` (`const ucId = credentials.userCalendarId ?? credentials.id`).

- **Bug #20 — gpt-4o-mini "promete sem executar"** ([AgentService/index.ts](backend/src/services/AgentService/index.ts)). Padrão observado: cliente confirma horário → LLM responde "Perfeito! Vou confirmar agora, um momento" e **encerra o turn sem chamar `criar_evento`**. Cliente espera, eventualmente envia "ok" e só então o LLM finalmente executa. Causa: bias de modelos OpenAI baratos para responder com promessa antes de agir. **Fix probabilístico**: novo bloco `buildExecutionFlowBlock()` injetado no system prompt — "EXECUTE antes de RESPONDER", "frases como 'vou verificar' isoladas — sem chamar tool no mesmo turno — quebram a experiência", instruções de encadear tools no mesmo turn.

- **Bug #21 (CRÍTICO) — token aceito sem scope `auth/calendar`** ([oauth.ts](backend/src/services/GoogleCalendarService/oauth.ts), [GoogleCalendarController.ts](backend/src/controllers/GoogleCalendarController.ts), [CalendarSettings.js](frontend/src/components/Settings/CalendarSettings.js)). Cenário catastrófico: usuário desconectou e reconectou o Google Calendar, na tela de consent **desmarcou** a checkbox "Ver, editar, criar e excluir eventos do Google Agenda" sem perceber. Google devolveu token com `email profile userinfo.email userinfo.profile openid` — **sem `auth/calendar`**. Sistema aceitou, salvou `isActive=true`, UI mostrou "Conectado" verde. Cada chamada à API começou a falhar com 403 "insufficient authentication scopes", mas usuário não tinha como saber. Fix em **4 camadas (defesa em profundidade)**:
  
  1. **Validação na callback** ([oauth.ts](backend/src/services/GoogleCalendarService/oauth.ts)): nova função `hasCalendarScope(scopeString)` + classe `MissingCalendarScopeError`. Se token recebido não contém `auth/calendar`, lança erro **antes de qualquer persistência**.
  2. **Erro propagado ao frontend** ([GoogleCalendarController.ts](backend/src/controllers/GoogleCalendarController.ts)): `closePopup` aceita `errorCode` e `message` para distinguir motivos (`MISSING_CALENDAR_SCOPE`, `USER_DENIED`, `GENERIC`).
  3. **Auto-invalidação em runtime** ([criarEvento.ts](backend/src/services/GoogleCalendarService/tools/criarEvento.ts)): se chamada à API retornar `invalid_grant` ou `insufficient authentication scopes`, marcamos `UserCalendar.isActive=false`. UI volta a mostrar "Desconectado" — sem isso a UI mentia "Conectado".
  4. **UX reativa no frontend** ([CalendarSettings.js](frontend/src/components/Settings/CalendarSettings.js)): toast específico orientando o que fazer (12s para o usuário ler); **banner laranja persistente** quando algum profissional está desconectado, com texto explicando o impacto direto ("o agente de IA não consegue agendar para X").
  
  **TDD**: nova suite [oauth.spec.ts](backend/src/services/GoogleCalendarService/__tests__/oauth.spec.ts) com 3 testes — token sem `auth/calendar` é rejeitado (não persiste), token com scope full é aceito, scope-string com URL completa funciona como sufixo abreviado.

- **Test rot prevention — datas dinâmicas** ([criarEvento.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/criarEvento.spec.ts)). Testes hardcodavam `data: "2026-05-04"`. Conforme o tempo passa, essas datas viram "passado" e disparam a defesa do Bug #13 (rejeitar agendamento no passado), quebrando os testes. **Fix**: helper `dataFutura()` retorna `{ data, hora, sendAt }` sempre 30 dias no futuro. Testes que validam intencionalmente a defesa de past-date (Bug #13) preservam `jest.useFakeTimers()` — ambas necessidades coexistem.

---

### Fixed — Defesas determinísticas contra agendamento duplicado e reagendamento não-atômico (2026-04-28 round 5)
**Sintoma observado em produção**: cliente Rithiel tinha agendamento 09:00 com Sofia confirmado pelo bot. Cliente celebrou ("Perfeito!"); bot (gpt-oss-120b via Groq) interpretou como nova solicitação, alegou que 09:00 estava ocupado, ofereceu 10:00, depois 11:00 — e quando o cliente disse "Sim mas cancele o outro", o bot **criou** o agendamento das 11:00 sem cancelar o das 09:00. Cliente ficou com 2 agendamentos no mesmo dia/profissional. Diagnóstico revelou três falhas correlatas — uma do modelo (alucinação/perda de contexto), duas do sistema (faltavam defesas determinísticas que deveriam ter recusado a duplicata mesmo com LLM errado). Plano de mitigação em duas frentes (Frente A — defesas determinísticas neste round; Frente B — troca para gpt-4o-mini no próximo). Modelos baratos serão sempre probabilísticos; a arquitetura precisa **falhar com graça** independentemente do que o LLM tente fazer:

- **Bug #15 (CRÍTICO) — `criar_evento` permitia duplicata em horário diferente** ([criarEvento.ts:71-128](backend/src/services/GoogleCalendarService/tools/criarEvento.ts#L71-L128)). O check anti-duplicata existente (Bug #8, round 2) só bloqueava `mesmo cliente + mesmo profissional + mesmo sendAt + status PENDENTE` — duplicata **exata**. Quando o LLM tentou criar 11:00 enquanto o cliente já tinha 09:00 PENDENTE, sendAt era diferente → check passou → duplicata foi criada. **Fix**: ampliação do check para QUALQUER Schedule PENDENTE futuro do cliente (`sendAt >= startOfTodayBRT()`), com classificação inteligente do erro:
  - Caso (a) — slot exato igual: erro de duplicata literal preservado (`"Já existe agendamento #X pendente para este cliente em DATA às HORA com este profissional. Não criei duplicata..."`).
  - Caso (b) — slot diferente: erro **direcionado ao LLM** com instrução literal da tool a usar (`"Cliente já tem agendamento #X pendente (Reparo de dentes em 29/04/2026 às 09:00). Para mudar para 29/04 às 11:00, use reagendar_evento(scheduleId=X, novaData='29/04', novaHora='11:00') em vez de criar novo. Ou cancele primeiro com cancelar_evento(scheduleId=X)..."`). Erros de tool são lidos pelo LLM; sem instrução textual ele tenta criar de novo num loop.
  
  Reaproveita `startOfTodayBRT()` (helper inline duplicado em vez de extraído — manter isolamento de tools por CLAUDE.md III.4 prevalece sobre DRY para 5 linhas). **TDD**: +1 teste em [criarEvento.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/criarEvento.spec.ts) — mocka cliente com Schedule PENDENTE em 09:00, tenta criar 11:00, valida que `mockCreate` e `Schedule.create` não foram chamados e que o erro contém `reagendar_evento` + `#88`. Teste antigo do bug #8 atualizado para refletir o mock com `sendAt` e `professionalId` (necessário para a nova lógica de classificação)

- **Bug #16 (LATENTE) — `reagendar_evento` não-atômico** ([reagendarEvento.ts:1-130](backend/src/services/GoogleCalendarService/tools/reagendarEvento.ts)). Implementação anterior fazia `delete-old` PRIMEIRO, `create-new` DEPOIS. Se `createCalendarEvent` falhasse (Google API timeout, token expirado, etc.) entre as duas chamadas, o cliente ficava SEM agendamento — antigo já deletado, novo nunca criado. Pior cenário: bot diz "✅ remarcado" e cliente perde o slot completamente. Não foi observado em produção neste round, mas é classe correlata ao bug #15 e estava esperando para acontecer. Princípio CLAUDE.md II.5 (causa raiz) — não basta corrigir o sintoma observado, é preciso eliminar a classe.
  
  **Fix**: ordem invertida para create-new → delete-old → update-DB:
  - Se `createCalendarEvent` falha → `logger.error`, retorno `{sucesso: false, erro}`, antigo intacto.
  - Se delete do antigo falha (mas novo OK) → `logger.warn`, retorno `{sucesso: true, mensagem, aviso}`. Aviso porque cliente está atendido (tem o novo horário), mas evento antigo pode estar órfão na agenda do profissional. Distinguir aviso vs erro evita o LLM mentir "deu tudo certo" quando há resíduo.
  - Se update do Schedule falha → erro propagado; situação rara, fica logado para diagnóstico manual.
  
  Tipo `ReagendarResult` ganha campo `aviso?: string`. **TDD**: +3 testes em [reagendarEvento.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/reagendarEvento.spec.ts):
  - Ordem `create → delete` validada via callback em `mockImplementation`.
  - `create` falha → `mockDelete` não chamado, `update` não chamado, `sucesso: false`.
  - `create` OK + `delete` falha → `sucesso: true`, `aviso` presente, `update` chamado com `googleEventId` novo.

- **Bug #17 (PROBABILÍSTICO) — Prompt sem instruções duras de fluxo de agendamento** ([AgentService/index.ts:127-160](backend/src/services/AgentService/index.ts#L127-L160)). LLMs baratos (gpt-oss-120b, Llama) tratam celebrações curtas do cliente ("Perfeito!", "Ok!", "Beleza!") como nova intenção de ação e perdem contexto do que já foi confirmado no turno anterior. Bug #15/#16 são defesas determinísticas; #17 é a **camada probabilística** complementar — instruções duras no system prompt para reduzir a probabilidade do LLM tentar fazer algo errado em primeiro lugar.
  
  **Fix**: nova função `buildAgendamentoFlowBlock()` injetada no system prompt (junto com `dateTimeBlock` e `contactBlock`), com 6 regras numeradas:
  1. ANTES de modificar agenda, chame `buscar_agendamento_cliente`.
  2. Se cliente já tem PENDENTE e quer mudar: use `reagendar_evento` (NUNCA `criar_evento`).
  3. NUNCA crie novo enquanto anterior está PENDENTE.
  4. Confirmações curtas ("perfeito", "ok", "sim", "👍") NÃO disparam nova tool — só agradeça/finalize.
  5. Se `criar_evento` retornar erro mencionando "use reagendar_evento", SIGA — não tente criar de novo.
  6. Antes de afirmar ação ao cliente, confira `sucesso: true`. Estado real, não otimista.
  
  Não substitui as defesas determinísticas — complementa. Mesmo se o LLM ignorar o prompt, `criar_evento` (Bug #15) recusa duplicata. **TDD**: +3 testes em [AgentService.spec.ts](backend/src/services/AgentService/__tests__/AgentService.spec.ts) — assertam que `systemPrompt` recebido pelo provider contém as keywords-chave (`buscar_agendamento_cliente`, `reagendar_evento`, regras sobre confirmações curtas).

- **Decisão arquitetural — modelo LLM**: análise dos AgentActions revelou que `gpt-oss-120b` (Groq) tem comportamento erratico em tool-chaining e perda de contexto em conversas com 5+ turnos. Próximo round migra para `gpt-4o-mini` (OpenAI direto) — mesmo custo ($0.15/$0.60 por M tok) mas tool-calling é estado da arte em modelos baratos. Decisão registrada em `decisions_log.md`. Mudança coordenada com este round: as defesas determinísticas garantem que mesmo se o novo modelo ainda erre ocasionalmente, o sistema falha com graça
- **Suite completa**: 33 suites, 250 testes (+7 novos), todos passando

### Fixed — Sistema sem conceito de "agora", criação no passado, filtro de busca esconde agendamentos do dia (2026-04-27 round 4)
**Causa raiz comum dos 4 bugs deste round**: o sistema não informava ao agente IA nem aplicava determinísticamente o conceito de "instante atual". O LLM dizia "amanhã 27/04" para mensagens recebidas no próprio 27/04, oferecia slots de 09h–17h ao cliente às 19:46 do mesmo dia (todos no passado), criava agendamentos para horas já decorridas, e a busca de agendamento ativo escondia bookings do mesmo dia já passados — fazendo o LLM mentir ao cliente ("não havia agendamento" quando havia). Diagnosticado via inspeção dos `AgentActions` reais. Quatro fixes relacionados aplicados em camadas (prompt + tools determinísticas), seguindo CLAUDE.md II.5 (causa raiz, não sintoma) e II.6 (mínima mudança):

- **Bug #11 (FUNDAMENTAL) — Agente sem contexto de data/hora atual** ([AgentService/index.ts:75-115](backend/src/services/AgentService/index.ts#L75-L115)). LLMs têm conhecimento histórico do treino mas não sabem o "agora". Sem este bloco, o agente dizia "amanhã, dia 27/04/2026" para um cliente escrevendo no próprio 27/04 — propagando confusão por toda a conversa. **Fix**: nova função `buildCurrentDateTimeBlock()` que injeta no system prompt um bloco "Contexto temporal" com data/hora BRT atual + equivalências de "hoje"/"amanhã"/"depois de amanhã" tanto em DD/MM/AAAA (texto ao cliente) quanto em YYYY-MM-DD ISO (formato esperado pelas tools). Inclui regras duras: "Nunca diga 'amanhã' apontando para data que já é hoje", "Não confirme horários no passado". TZ hardcoded em `America/Sao_Paulo` — aceitável para produto BR, virar per-company quando houver clientes em outros fusos. **TDD**: +3 testes em [AgentService.spec.ts](backend/src/services/AgentService/__tests__/AgentService.spec.ts) usando `jest.useFakeTimers().setSystemTime()` — assertam DD/MM/AAAA, HH:MM em BRT, e ISO YYYY-MM-DD presentes no `systemPrompt` recebido pelo provider

- **Bug #12 — `verificar_disponibilidade` e `buscar_proximo_horario` ofereciam slots no passado** ([availabilityEngine.ts:90-140](backend/src/services/GoogleCalendarService/availabilityEngine.ts#L90-L140)). Em 27/04 19:46 BRT, ao perguntar pelo dia 27/04, o cliente recebia `slots: ["09:00","10:00","11:00",...,"17:00"]` — TODOS já passados. Bot então confirmou agendamento para 27/04 11:00 (8h atrás). **Fix**: `SlotInput` ganhou campo opcional `now?: Date`. Função interna `filterPastSlots()`: se `dateStr < today` retorna `[]`; se `dateStr == today` filtra `slot > currentHHMM`; se `dateStr > today` mantém todos. Comparações em fuso BRT via `Intl.DateTimeFormat`. Backwards-compatible: testes antigos sem `now` mantêm comportamento original. Tools [verificarDisponibilidade.ts](backend/src/services/GoogleCalendarService/tools/verificarDisponibilidade.ts) e [buscarProximoHorario.ts](backend/src/services/GoogleCalendarService/tools/buscarProximoHorario.ts) passam `now: new Date()`. **TDD**: +4 testes em [availabilityEngine.spec.ts](backend/src/services/GoogleCalendarService/__tests__/availabilityEngine.spec.ts) — slots filtrados para hoje, mantidos para amanhã, vazio para data passada, compat sem `now`

- **Bug #12.1 — `buscarProximoHorario` usava `toISOString().slice(0,10)` para `dateStr` (UTC) misturando com `getDay()` (BRT)** ([buscarProximoHorario.ts:46-58](backend/src/services/GoogleCalendarService/tools/buscarProximoHorario.ts#L46-L58)). À noite BRT (ex: 22h BRT = 01h UTC dia seguinte), `dateStr` saía como dia errado em UTC, desalinhando do `dayOfWeek` local. **Fix**: ambos derivados de `Intl.DateTimeFormat` em BRT consistente

- **Bug #13 — `criar_evento` aceitava agendar para o passado** ([criarEvento.ts:53-62](backend/src/services/GoogleCalendarService/tools/criarEvento.ts#L53-L62)). Defesa em camadas: mesmo com prompt corrigido (#11) e slots filtrados (#12), o LLM ainda pode receber/inferir um horário passado se perder contexto. Importante: **a restrição é apenas sobre o INSTANTE do agendamento estar no futuro, não sobre o momento em que a tool é chamada** — o agente recebe mensagens 24/7 e pode marcar de madrugada para 09h da manhã seguinte. **Fix**: validação `if (sendAt.getTime() <= Date.now())` antes de qualquer chamada ao Google. **TDD**: +1 teste em [criarEvento.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/criarEvento.spec.ts) com `jest.useFakeTimers` + `setSystemTime` para 19:47 BRT, tentando criar 11:00 BRT do mesmo dia → recusa, sem chamar Google nem criar Schedule

- **Bug #14 — `buscar_agendamento_cliente` mentia ao cliente sobre cancelamento** ([buscarAgendamentoCliente.ts:30-50](backend/src/services/GoogleCalendarService/tools/buscarAgendamentoCliente.ts#L30-L50)). Filtro original: `sendAt: { [Op.gte]: new Date() }`. Em 19:48 BRT, agendamento de 11:00 do mesmo dia (id=6) era invisível → tool retornava "Nenhum agendamento ativo encontrado" → bot disse ao cliente "Não havia nenhum agendamento ativo para hoje, portanto não foi necessário cancelar nada" (mentira documentada). **Fix**: helper `startOfTodayBRT()` calcula meia-noite BRT em UTC; filtro vira `sendAt >= startOfTodayBRT()`. Agendamentos do mesmo dia mesmo já decorridos continuam visíveis para cancelamento honesto. Não polui com agendamentos antigos pois filtra dias anteriores e exclui status `CANCELADO`/`ENVIADA`. **TDD**: +2 testes em [buscarAgendamentoCliente.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/buscarAgendamentoCliente.spec.ts) — um asserta limite do filtro (entre meia-noite BRT e instante atual) inspecionando o `Op.gte` symbol, outro asserta retorno correto de agendamento de 11:00 quando `now`=19:48

- **Diagnóstico via dados reais**: como em rounds 2 e 3, a investigação começou pela tabela `AgentActions` que registra cada tool call com parâmetros e resultado. Sem isso, a tentação seria reescrever o system prompt esperando que o LLM "se comportasse" — mas o LLM estava OBEDECENDO; quem mentia eram as tools determinísticas (Bug #14) ou faltava informação de contexto (Bug #11)
- **Suite completa**: 33 suites, 243 testes (+10 novos), todos passando

### Fixed — Bug de timezone em verificarDisponibilidade (2026-04-27 round 3)
- **Bug #10 (CRÍTICO) — `verificar_disponibilidade` retornava slots vazios para o dia ATUAL em fusos a oeste de UTC** ([verificarDisponibilidade.ts:34-35](backend/src/services/GoogleCalendarService/tools/verificarDisponibilidade.ts#L34-L35)). Em BRT (UTC-3), `new Date("2026-04-27")` é interpretado como UTC midnight = `2026-04-26T21:00:00 BRT` (domingo 21h). O `getDay()` retornava `0` (domingo) em vez de `1` (segunda) — então a tool consultava o expediente do **domingo** (em que Sofia não trabalha) e retornava `slots: []` para um dia em que de fato havia agenda inteira livre. **Sintoma observado em produção**: cliente pede "às 10h hoje", LLM chama `verificar_disponibilidade` para `2026-04-27` (segunda), recebe `disponivel: false, slots: []`, e responde "indisponível às 10h" — apesar da agenda estar 100% vazia. Em paralelo, `buscar_proximo_horario` retornava `09:00` correto (porque usa `new Date()` + `setDate()`, não `new Date(string)`), gerando contradição entre as duas tools. **Causa raiz**: ECMAScript especifica que strings ISO date-only (`YYYY-MM-DD`) são parseadas como UTC, mas strings com componente de tempo (`YYYY-MM-DDTHH:MM:SS` sem `Z`) são parseadas como local. A tool usava a primeira forma. **Fix**: helper `parseLocalDate(dateStr)` que faz `new Date(y, m-1, d)` — meia-noite local na data informada, TZ-independente para `getDay()`. **TDD**: +2 testes em [verificarDisponibilidade.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/verificarDisponibilidade.spec.ts) — um asserta `dayOfWeek=1` para `"2026-04-27"` (segunda), outro asserta `dayOfWeek=0` para `"2026-04-26"` (domingo). Ambos falhavam em BRT antes do fix
- **Diagnóstico via dados reais**: inspeção dos `AgentActions` da última sessão de teste revelou a contradição entre `verificar_disponibilidade` (slots `[]` para 27/04) e `buscar_proximo_horario` (slot `09:00` para 27/04). Sem essa inspeção a hipótese natural seria "LLM ignora diretiva", quando na verdade o LLM estava obedecendo — só recebia dado errado da tool determinística
- **Por que tools com `${date}T${time}:00` (criarEvento, reagendarEvento) não têm o bug**: a presença do componente de tempo sem marcador `Z` força o parse local. Apenas strings date-only têm o comportamento UTC
- **Suite completa**: 33 suites, 233 testes (+2 novos), todos passando

### Fixed — Cancelamento parcial silencioso, agendamento duplicado e dia da semana errado (2026-04-26 round 2)
- **Bug #7 (CRÍTICO) — `cancelar_evento` mentindo sobre cancelamento** ([cancelarEvento.ts:43-52](backend/src/services/GoogleCalendarService/tools/cancelarEvento.ts#L43-L52)). Catch silencioso na chamada a `deleteCalendarEvent` engolia exceções do Google API e retornava `mensagem: "✅ Agendamento #X cancelado"` idêntica ao caso de sucesso completo. O Schedule virava CANCELADO no DB local, mas o evento permanecia vivo na agenda do profissional no Google Calendar. **Causa raiz**: viola CLAUDE.md II.5 (catch silencioso) — exception engolida sem `logger.error`, e a mensagem de retorno indistinguível entre sucesso real e parcial. **Fix**: `logger.error` com contexto (scheduleId, eventId, companyId, mensagem original); mensagem distinta `"⚠️ ... cancelado parcialmente: marcado como CANCELADO no sistema, mas o evento ainda PODE permanecer na agenda do profissional. Recomende verificar."` quando Google falha. **TDD**: +2 testes ([cancelarEvento.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/cancelarEvento.spec.ts)) — um exigindo `logger.error` chamado, outro exigindo mensagem qualificada (regex `/parcial|permanec|verifi|não.*sincroniz|pode.*aparecer/i`)

- **Bug #8 (CRÍTICO) — `criar_evento` permitia duplicatas** ([criarEvento.ts:51-69](backend/src/services/GoogleCalendarService/tools/criarEvento.ts#L51-L69)). LLM `gpt-oss-120b` chamava `criar_evento` duas vezes no mesmo turn quando perdia contexto do que já tinha agendado: 1ª chamada com `atendenteId=2` (Sofia) sucesso → criou Schedule 4; 2ª chamada com `atendenteId=1` (errado, alucinado) erro "Profissional #1 não encontrado". O LLM então comunicava "agendamento não pôde ser concluído" ao cliente que **já tinha** agendamento real em PENDENTE. **Causa raiz**: nenhuma proteção determinística contra duplicata + LLM barato confunde IDs sob carga de contexto. **Fix**: bloco anti-duplicata em `criar_evento` — antes de chamar Google, busca Schedule com `{companyId, contactId, professionalId, sendAt, status: "PENDENTE"}`; se existe, retorna erro estruturado `"Já existe agendamento #X pendente para este cliente em DATA às HORA com este profissional. Não criei duplicata — confirme com o cliente antes de remarcar."`. Cancelados não bloqueiam reocupação do slot. **TDD**: +2 testes ([criarEvento.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/criarEvento.spec.ts)) — recusa quando há PENDENTE, permite quando há CANCELADO

- **Bug #5 — Dia da semana errado nas mensagens** ([knowledgeBuilder.ts:121](backend/src/services/AgentService/knowledgeBuilder.ts#L121)). LLM dizia "28/04/2026 quarta-feira" (é terça). Modelos baratos (`gpt-oss-120b`, Llama) erram aritmética de calendário de cabeça com frequência. **Fix**: regra 8 nova em REGRAS DE FERRAMENTAS — "NUNCA escreva o dia da semana ao mencionar uma data — você frequentemente erra esse cálculo. Diga apenas DD/MM/AAAA. Se o cliente perguntar, responda 'recomendo conferir no seu calendário'". Tirar o privilégio de mencionar é mais barato e confiável que adicionar tool determinística de dia-da-semana. **TDD**: +1 teste em knowledgeBuilder.spec.ts exigindo a diretiva no prompt

- **Bug #9 (descartado) — "Dessincronia CRM vs Google Calendar"**. Investigação dos AgentActions provou que Schedules 4 e 5 têm `googleEventId` populado e `createCalendarEvent` propaga exception em falha (não houve catch silencioso lá). Os eventos estão sim no Google Calendar — o usuário viu print desatualizado do calendar mobile

- **Bug #6 (sem ação) — "📎 Mídia" sem contexto enviada pela Sofia**. Cosmético, possivelmente artefato do Baileys; não afeta lógica de agendamento

- **Suite completa**: 33 suites, 231 testes (+5 novos), todos passando

### Fixed — Coerência do agente em fluxo de agendamento (2026-04-26)
- **Bug #1 — Placeholder `[Nome do profissional]` vazando na resposta** ([buscarProximoHorario.ts:34-44](backend/src/services/GoogleCalendarService/tools/buscarProximoHorario.ts#L34-L44)). A interface `ProximoHorarioResult` declarava `profissional?: string` mas o retorno só populava `profissionalId`. Quando o LLM (`gpt-oss-120b` via Groq) recebia o JSON com `profissional: undefined`, alucinava o placeholder textual `Dr(a).[Nome do profissional]` na mensagem ao cliente. **Causa raiz**: query `ServiceProfessional.findAll` não tinha `include: User`, então o nome nunca chegava ao retorno. **Fix**: incluído `User` no `findAll` e populado `profissional: sp.user?.name` no resultado. **TDD**: novo arquivo de teste [buscarProximoHorario.spec.ts](backend/src/services/GoogleCalendarService/__tests__/tools/buscarProximoHorario.spec.ts) com 4 testes (regressão de #1, sem horário em 7 dias, sem calendário, serviço inexistente) — antes não havia cobertura para essa tool

- **Bug #2 — Agente respondia "10h indisponível" mesmo com slot livre**. **Causa raiz**: o LLM usava `buscar_proximo_horario` (que retorna apenas o **primeiro** slot livre) também para perguntas sobre horário específico, e respondia "indisponível" pela ausência da hora exata no retorno — sem nunca chamar `verificar_disponibilidade` (que retorna a lista completa de slots por profissional). **Fix em [knowledgeBuilder.ts:97-105](backend/src/services/AgentService/knowledgeBuilder.ts#L97-L105)**: adicionada diretiva `1.1` no FLUXO PADRÃO — "Quando o cliente pedir um HORÁRIO ESPECÍFICO use SEMPRE `verificar_disponibilidade` para a data pedida e cheque a lista de slots por profissional. NUNCA responda 'indisponível' baseado apenas em `buscar_proximo_horario`". Sofia (`UserWorkingHours` companyId=2 confirmado: seg 09:00–18:00, isWorking=true) tinha 10h vago — bug puramente comportamental do LLM, não da agenda

- **Bug #3 (CRÍTICO) — Marcou 27/04 09h após cliente confirmar 28/04 12h**. **Causa raiz**: o LLM `gpt-oss-120b` ofereceu 27/04 09h primeiro, depois 28/04 11h, depois 28/04 12h, e quando o cliente disse "Sim pode confirmar", chamou `criar_evento` com argumentos da **primeira** oferta — divergência entre o texto de promessa e os argumentos da tool call (comportamento conhecido em modelos baratos com histórico longo). **Fix em [knowledgeBuilder.ts:97-105](backend/src/services/AgentService/knowledgeBuilder.ts#L97-L105)**: adicionada diretiva `2.1` marcada CRÍTICO — "ao chamar `criar_evento` os argumentos `data` e `hora` devem refletir EXATAMENTE o último horário oferecido por escrito e confirmado pelo cliente, nunca de uma oferta anterior. Antes de invocar a tool, releia mentalmente sua última mensagem de oferta e copie data e hora dela". Diretiva textual mantém mínima mudança (II.6); se o LLM reincidir, escalar para validação determinística no `criar_evento`

- **Bug #4 — Agendamento "Sem profissional 09:00–09:30 Rithiel" no CRM**. **Causa raiz**: resíduo da época em que `criar_agendamento` (tool removida em 2026-04-26) ainda existia — Schedule sem `professionalId`, `serviceId` nem `googleEventId`. Limpeza segura via SQL: `DELETE FROM "Schedules" WHERE "companyId"=2 AND "professionalId" IS NULL AND "googleEventId" IS NULL` (1 registro removido)

- **Cleanup do system prompt — referência fantasma a `criar_agendamento`** ([knowledgeBuilder.ts:91-93,100](backend/src/services/AgentService/knowledgeBuilder.ts#L91-L93)). O prompt ainda mencionava "`criar_agendamento` / `criar_evento` (efetivamente marcar)" e "chame `criar_agendamento`/`criar_evento`" mesmo após a remoção da tool em 2026-04-26 — contradizia a regra "use SEMPRE `criar_evento`" e adicionava ambiguidade. Removidas todas as menções remanescentes. **TDD**: 3 testes novos em [knowledgeBuilder.spec.ts](backend/src/services/AgentService/__tests__/knowledgeBuilder.spec.ts) cobrindo as três diretivas (re-confirmação de args, verificar_disponibilidade para horário específico, ausência de criar_agendamento)

- **Suite completa**: 33 suites, 226 testes, todos passando após os fixes

### Changed — Removida tool ambígua + sanitização de prompt (2026-04-26)
- **Removida `criar_agendamento`** ([AgentService/tools/criarAgendamento.ts](backend/src/services/AgentService/tools/criarAgendamento.ts) deletado, junto com seu teste). A tool era ambígua com `criar_evento` do GoogleCalendarService — ambas se descreviam como "cria agendamento", mas só `criar_evento` vincula profissional/serviço e sincroniza Google Calendar. LLMs baratos (GPT-OSS-120b, Llama) gravitavam para `criar_agendamento` (mais simples), criando Schedule sem profissional e sem sincronizar Calendar. **Critério de design**: o produto precisa rodar bem com modelos baratos para o negócio fechar conta — ambiguidade entre tools é inimiga
- **Sanitização de caracteres invisíveis** em [knowledgeBuilder.ts](backend/src/services/AgentService/knowledgeBuilder.ts) — texto de Settings copiado de Word/Notion frequentemente carrega zero-width space (U+200B), word joiner (U+2060), BOM (U+FEFF) e non-breaking hyphen (U+2011). LLM reproduzia literal na resposta gerando "Soro​siso" (em vez de "Sorriso"). Saneamos na leitura
- **Prompt reforçado** — adicionada diretriz explícita: "Nunca emita parênteses com termos técnicos, flags ou marcadores internos (ex: `(não-fazer)`, `(skip)`, `[id:123]`)". GPT-OSS-120b ocasionalmente vazava metadata interna na resposta (ex: "(não-fazer )") — comportamento similar ao pseudo-XML do Llama
- **Diretriz de criação de agendamento explicitada** — "Para criar agendamentos use SEMPRE `criar_evento`" — antes o LLM tinha que inferir entre 2 tools com nomes parecidos

### Changed — Inteligência do agente IA (2026-04-25)
- **`MAX_ITERATIONS` 5 → 8** — modelos open-source (GPT-OSS-120b, Llama via Groq) gastam turnos extras "pensando" e o limite anterior cortava antes da síntese final, devolvendo FALLBACK_REPLY ao cliente
- **Identidade do contato injetada no system prompt** — `handleAgentMessage` agora passa `contactName` + `contactNumber` para `handleClientAgent`, que monta um bloco `**Contexto do atendimento atual**` no prompt com nome, telefone e ticketId. Resolve "agente pergunta o telefone que já está visível" e dá ao LLM o `ticketId` correto para `transferir_para_humano`
- **System prompt reforçado** com FLUXO PADRÃO PARA QUALQUER PEDIDO DE ATENDIMENTO/AGENDAMENTO ([knowledgeBuilder.ts](backend/src/services/AgentService/knowledgeBuilder.ts)):
  1. Listar serviços + verificar disponibilidade ANTES de qualquer outra coisa
  2. Confirmar horário em texto natural antes de criar agendamento
  3. `notificar_proprietario` só em emergência real e SE não conseguiu agendar via tools
  4. `transferir_para_humano` é último recurso, não primeira ação
  5. Sempre responder em texto após receber resultado de tool — nunca encadear 3+ tools sem responder
- **Fallback inteligente quando MAX_ITERATIONS estoura** — em vez de mandar FALLBACK_REPLY ("dificuldades técnicas"), agora prefere o último texto não-vazio que o LLM gerou durante o loop. Se nem isso houver, usa "Estou processando sua solicitação, um momento por favor"
- **Lista explícita de tools de calendário no prompt** — antes o LLM "esquecia" que tinha tools de agenda e ia direto pra `notificar_proprietario`/`transferir_para_humano`

### Fixed — Crash do frontend e AgentAction não registrado (2026-04-25)
- **Frontend caía com "Cannot read properties of undefined (reading 'name')"** quando o agente chamava `transferir_para_humano` — a tool emitia o ticket cru (sem includes), o reducer fazia replace, e [TicketListItemCustom:683-685](frontend/src/components/TicketListItemCustom/index.js#L683-L685) acessava `ticket.contact.name` sem optional chaining. Fix em duas camadas: (1) frontend agora usa `ticket.contact?.name || ""` (defesa); (2) [transferirParaHumano.ts:53-62](backend/src/services/AgentService/tools/transferirParaHumano.ts#L53-L62) recarrega via `ShowTicketService` antes de emitir (corrige a raiz)
- **`AgentAction.create` falhava com "Model not initialized"** — o model existia em `models/AgentAction.ts` e a migration criava a tabela, mas o model nunca foi adicionado ao array de `sequelize.addModels()` em [database/index.ts](backend/src/database/index.ts). Histórico de ações do agente nunca foi persistido (silenciosamente, porque o catch original engolia). Agora registrado — `AgentAction.create` funciona e a tabela `AgentActions` recebe um registro por tool execution

### Fixed — Robustez do canal Agente IA, parte 2 (2026-04-25)
- **Badge "AGENTE IA" piscando para "SEM FILA" a cada nova mensagem** — `handleAgentMessage.emitTicketUpdate` emitia o `ticket` direto após `ticket.update()`, sem recarregar relations. Como o frontend faz replace completo no reducer (`state[idx] = ticket`), o `whatsapp` sumia do estado local até a próxima troca de aba. Agora [handleAgentMessage.ts:69-79](backend/src/services/AgentService/handleAgentMessage.ts#L69-L79) recarrega via `ShowTicketService` antes de emitir — mesmo padrão usado em `UpdateTicketService.ts`
- **Agente caindo silenciosamente em "Desculpe, estou com dificuldades técnicas"** — o `catch` em [AgentService/index.ts](backend/src/services/AgentService/index.ts) engolia o erro sem log, e o `OpenAICompatibleProvider` engolia HTTP errors (Groq retornando 400/429 com schema rejeitado, JSON.parse explodindo em tool_calls malformado, etc.). Adicionado logging estruturado em vários pontos:
  - `[AgentService] handleClientAgent crashed` com stack trace no catch geral
  - `[AgentService] tool ${name} lançou exceção` quando tool execution falha (sem abortar o loop — agora vira tool_result com erro e o LLM pode reagir)
  - `[AgentService] AgentAction.create falhou` como warning não-fatal (era ponto de falha silencioso)
  - `[AgentService] MAX_ITERATIONS atingido sem resposta` quando o loop esgota sem texto final
  - `[AgentService] pseudo-XML detectado e parseado` (info) para visibilidade do fallback
  - `[OpenAICompatibleProvider] HTTP {status}` com body do erro para diagnosticar rejeições do Groq
  - `[OpenAICompatibleProvider] tool_call args inválido` quando o LLM retorna JSON malformado
- **Defesa: `safeParseToolArgs` no OpenAICompatibleProvider** — JSON.parse direto em `tc.function.arguments` derrubava a resposta inteira quando o GPT-OSS-120b ocasionalmente devolvia args malformados. Agora cai em `{}` e loga, deixando o LLM iterar. +2 testes cobrindo HTTP error e JSON inválido

### Fixed — Robustez do canal Agente IA (2026-04-25)
- **Mensagens do CLIENTE não apareciam na conversa do CRM** — o fluxo do canal agente atalhava o listener e nunca chamava `verifyMessage` para a mensagem recebida. Agora [wbotMessageListener.ts:3378-3380](backend/src/services/WbotServices/wbotMessageListener.ts#L3378-L3380) persiste a mensagem antes de delegar ao agente. Áudios continuam fluindo via `verifyMediaMessage` (já persistia)
- **Badge mostrava "SEM FILA" em vez de "AGENTE IA"** — `ticket.whatsapp.isAgentChannel` não estava nos `attributes` serializados. Adicionado em `ListTicketsService`, `ShowTicketService`, `ListTicketsServiceKanban`. [TicketListItemCustom](frontend/src/components/TicketListItemCustom/index.js) agora prioriza badge "AGENTE IA" (cor `#7B1FA2`) quando `whatsapp.isAgentChannel && ticket.chatbot`; após transferência para humano (`chatbot=false`), volta ao badge da fila
- **Llama 3.3 70b emitia pseudo-XML em vez de tool_calls estruturados** — observado `<function=NAME={...args}</function>` inline na resposta, indo literal para o cliente. Adicionado [pseudoXmlParser.ts](backend/src/services/AgentService/pseudoXmlParser.ts) (10 testes TDD) que detecta o formato e converte em `AIToolCall[]`, ativado como fallback no loop quando `response.toolCalls` vier vazio. **Why**: modelos open-source (Llama, alguns OSS) ocasionalmente alucinam o formato pseudo-XML que aprenderam em pré-treino mesmo recebendo tools no protocolo OpenAI/Anthropic. **How to apply**: roda apenas quando o provider nativo não retornou tool_calls — Anthropic/OpenAI não pagam custo
- **System prompt reforçado** em [knowledgeBuilder.ts](backend/src/services/AgentService/knowledgeBuilder.ts) com 4 regras explícitas proibindo `<function=...>`, `function_call:`, `tool_use:` no corpo do texto — reduz frequência do problema na origem (modelo) sem depender só do parser

### Changed — Rebranding visual: Blue Steel (2026-04-23)
- Paleta principal trocada de verde (#2DDD7F) para **Blue Steel (#4682B4)** em [frontend/src/App.js](frontend/src/App.js) — afeta `primary`, `scrollbar`, `barraSuperior`, `textPrimary`, `borderPrimary`, `fontecor`
- Tons derivados centralizados num objeto `BLUE_STEEL` (main/dark/light/deep) para consistência em gradientes
- Scrollbar: hover state adicionado (main → dark) para feedback moderno
- Gradiente da barra superior e cards do Dashboard agora usam transição main→dark (profundidade)
- **Dashboard cards**: shadow colorizado `rgba(70,130,180,0.18)` + border-radius 16px + transform hover mais sutil — visual clean modernizado
- **21 arquivos com cor hardcoded atualizados**: layout, Whitelabel, Uploader, MessagesList, QrcodeModal, ButtonWithSpinner, 6 modais (Announcement/Campaign/Contact/ContactList/Modal/Users), ScheduleModal, ContactModal, UserModal, FileModal, WhatsAppModal, QueueModal, QueueIntegrationModal, QuickMessageDialog, PromptModal, SubscriptionModal, TagModal, ContactListItemModal, MessageInput*, ProgressBarCustom, MarkdownWrapper, TicketListItem*, Connections, ResearchReports
- **Mantidos com verde por convenção**: `ContactDrawer` e `AudioMessageWhatsApp` (simulam UI do WhatsApp), `QrcodeModal.whatsappIcon` (ícone oficial do WhatsApp), `PixModal` (cor oficial do PIX/Banco Central)
- **Why**: identidade visual própria da marca Otron, separada do verde WhatsApp que sugeria "extensão oficial" em vez de produto independente

### Security & Quality — Review fixes (2026-04-22)
- **F1 CRÍTICO**: OAuth state agora assinado com HMAC-SHA256 (módulo `oauthState.ts` + 6 testes) — impede forjar userId/companyId no callback
- **F3 CRÍTICO**: `saveWorkingHours`, `createService`, `updateService` envolvidos em `sequelize.transaction` — elimina estado inconsistente em caso de falha
- **F4**: `listServices` agora filtra `isActive=true` por default (flag `?includeInactive=true` para admins)
- **F5**: Validação Yup em `createService`, `updateService`, `saveWorkingHours` — rejeita name vazio, duração <5min ou >8h, dayOfWeek inválido, etc.
- **F6**: `assertUsersInCompany` valida que `professionalIds` pertencem à empresa antes de criar associações — impede vazamento cross-company
- **F7**: `buildOAuth2Client` agora persiste tokens refreshados via listener `on('tokens')` — evita refresh desnecessário a cada chamada
- **F11**: `tokenCrypto` usa salt aleatório por token (formato `salt:iv:ciphertext`) + 6 testes — impede rainbow tables mesmo se secret vazar. **Breaking**: tokens pré-existentes não decriptam; usuário precisa reconectar OAuth uma vez
- **F14**: `disconnectCalendar` agora apaga accessToken/refreshToken do DB — princípio LGPD de menor retenção

### Removed
- **F2**: `frontend/src/pages/GoogleCalendarCallback/` (código morto — Route.js redirecionava autenticados, página nunca era renderizada). Callback agora é HTML servido diretamente pelo backend.

### Changed
- **F8/F12**: ScheduleModal defensive handling — `Array.isArray` check + `console.warn` em falhas do fetch + conversão `null → ""` para Formik Select
- **F10**: `EventLabel` extraído para `frontend/src/components/Schedules/EventLabel.js` com `React.memo` — evita re-renders a cada dispatch do reducer

### Added — Pendências do módulo de agendamento (2026-04-22)
- Middleware `isAdmin` em `backend/src/middleware/isAdmin.ts` — bloqueia rotas administrativas a não-admins
- `isAdmin` aplicado em rotas sensíveis de `/google-calendar/*`: criação/edição/deleção de services, save de working hours, disconnect de outros profissionais
- `ScheduleServices/CreateService` e `UpdateService` aceitam `professionalId` e `serviceId` (opcionais, default `null`)
- `ScheduleController.store` propaga os novos campos do payload
- `ScheduleModal` (frontend) — dropdowns de Profissional + Serviço, visíveis apenas quando a empresa tem o módulo Google Calendar configurado
- **Why**: agendamentos criados manualmente pela UI agora podem ser atribuídos ao profissional correto e aparecem coloridos no calendário multi-profissional

### Added — Agenda multi-profissional (2026-04-21)
- Página `/schedules` com filtros por profissional e por serviço
- Vista híbrida react-big-calendar: mês unificado com cores, semana/dia em colunas lado-a-lado (`resources`), agenda com chips
- `frontend/src/utils/professionalColors.js` — paleta determinística de 12 cores + 7 testes unitários
- Componentes isolados `ScheduleFilters` e `ScheduleLegend` em `frontend/src/components/Schedules/`
- Backend `ListService` (Schedules) aceita `professionalId` e `serviceId` como filtros + join com `Service`
- **Why**: com 4–5 profissionais e slots de 30min, empilhar no mesmo horário fica ilegível. Colunas por profissional é padrão Fresha/Booksy

### Added — Google Calendar OAuth (2026-04-21)
- OAuth2 por profissional (`UserCalendar` + tokens criptografados AES-256)
- Callback serve HTML auto-fechante que notifica a janela pai via `postMessage` + fallback via polling `popup.closed`
- Rota `/google-calendar-callback` dedicada para o fluxo do popup
- Escopos: `calendar`, `userinfo.email`, `userinfo.profile`
- Tab ativa do SettingsCustom persistida em `?tab=...` (F5 preserva)

### Added — AgentService (Fase 1A concluída)
- `@anthropic-ai/sdk@0.90.0` instalado
- `AIProvider` interface + tipos compartilhados (`interfaces.ts`)
- `AnthropicProvider` — adapter para Claude (Haiku/Sonnet/Opus)
- `OpenAICompatibleProvider` — adapter via fetch nativo (Groq, OpenRouter, MiniMax, OpenAI)
- `AIProviderFactory` — factory multi-provider configurável por empresa
- 6 tools: `buscarContato`, `enviarMensagem`, `listarAgendamentos`, `criarAgendamento`, `notificarProprietario`, `transferirParaHumano`
- `contextManager` — histórico de conversa por ticket no Redis (TTL 1h, max 20 mensagens)
- `knowledgeBuilder` — system prompt dinâmico a partir das Settings da empresa, 3 personalidades (atencioso/vendedor/híbrido)
- `AgentService/index.ts` — loop agêntico com max 5 iterações, auditoria em `AgentActions`
- Migration `isAgentChannel` na tabela `Whatsapps` + modelo Sequelize atualizado
- Migration + modelo `AgentActions` para auditoria de custo e ações
- Hook no `wbotMessageListener` — roteia mensagens do canal agente diretamente para `handleClientAgent`
- **69 testes unitários passando** em 11 suites (TDD completo)
- Frontend: toggle "Canal do Agente IA" no `WhatsAppModal` (Formik + Switch)
- Frontend: componente `AgentSettings` com seletor de provider/modelo, personalidade, FAQ, instruções e restrições
- Frontend: aba "Agente IA" adicionada em `SettingsCustom`
- Backend: `UpdateWhatsAppService` e `WhatsappController` aceitam `isAgentChannel`

### Added
- Estrutura base do projeto: `CHANGELOG.md`, `decisions_log.md`, `directives/`
- Diretiva de Fase 0: configuração do ambiente local de desenvolvimento

## [0.1.0] - 2026-04-19 — Fase 0 Concluída

### Added
- Ambiente local de desenvolvimento 100% funcional
- PostgreSQL 15 + Redis 7 via Docker Compose
- Migrations aplicadas do zero (banco limpo/fábrica)
- Seeds: empresa padrão, usuário admin, configurações iniciais
- Login funcional em http://localhost:3000

### Fixed
- Migration `20260128120000-add-id-to-TicketUsers` corrigida para ser idempotente (verificação de coluna existente antes de criar sequence)

---
