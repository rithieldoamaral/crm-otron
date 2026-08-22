# Diretiva — Canal Oficial do WhatsApp (Cloud API + Twilio) convivendo com Baileys

**Status:** aprovada, não iniciada
**Data:** 2026-08-21
**Autor da decisão:** usuário (via AskUserQuestion, 2026-08-21)

---

## 1. Objetivo

Permitir que uma mesma empresa opere **três tipos de canal WhatsApp lado a lado**, escolhendo o tipo no momento de criar a conexão:

| Tipo | O que é | Continua existindo? |
|---|---|---|
| `baileys` | Conexão por QR Code, protocolo não-oficial (hoje) | **Sim — inalterado** |
| `cloud_api` | API oficial da Meta, direto (Graph API) | Novo |
| `twilio` | API oficial da Meta, intermediada pela Twilio | Novo |

O Agente de IA, a Secretária, os tickets, as filas e os relatórios devem funcionar **igual nos três**, sem que nenhum deles precise saber qual canal está por trás.

### O que este projeto NÃO é

- Não é migração. O Baileys continua sendo o padrão e não muda de comportamento.
- Não é substituição do `wbotMessageListener.ts` (4.343 linhas). Ele fica intocado.
- Não inclui criação/submissão de templates para aprovação (decisão do usuário: apenas sincronizar e usar).

---

## 2. Contexto: por que isto é necessário

Registrado em `decisions_log.md` (2026-07-26): o Baileys é API não-oficial e viola os Termos de Serviço do WhatsApp. Todas as mitigações anti-banimento implementadas (`humanTypingDelay`, jitter, presença) **reduzem a probabilidade, não eliminam o risco**. O próprio comentário em `humanTypingDelay.ts` já registrava: "A solução definitiva é migrar para a API oficial".

O canal oficial elimina o risco de banimento por automação, ao custo de duas restrições novas:

1. **Janela de 24 horas** — mensagem livre só pode ser enviada até 24h após a última mensagem *do cliente*. Fora disso, exige template pré-aprovado pela Meta.
2. **Templates** — mensagens que iniciam conversa precisam de aprovação prévia.

**Consequência de produto que precisa estar clara:** funcionalidades proativas existentes (lembrete de aniversário, reengajamento, campanhas) **não funcionam** no canal oficial sem template aprovado. Ver §7.3.

---

## 3. Arquitetura

### 3.1 A costura: por que adaptador e não refatoração

`handleMessage(msg: proto.IWebMessageInfo, wbot: Session, companyId)` recebe estrutura nativa do Baileys, dentro de um arquivo de 4.343 linhas. Além disso, **19 arquivos** chamam `wbot.sendMessage()` diretamente e o tipo `WASocket` atravessa `GetTicketWbot`, `providers.ts`, `SendWhatsAppMedia` e outros.

Três opções foram consideradas:

| Opção | Avaliação |
|---|---|
| **A** — Converter payload da Cloud API para um objeto que finge ser `proto.IWebMessageInfo` e reusar `handleMessage` | **Rejeitada.** Falsificar estrutura interna de biblioteca de terceiro é frágil: qualquer campo que o listener leia e nós não preenchermos vira `undefined` silencioso no meio de 4.343 linhas. |
| **B** — Refatorar `handleMessage` para tipo neutro | **Rejeitada agora.** Tocar num arquivo de 4.343 linhas sem cobertura de teste, para entregar uma feature nova, viola II.6 (mínima mudança) e concentra risco no caminho que hoje funciona. |
| **C** — Caminho paralelo reusando os *serviços* compartilhados | **Escolhida.** O canal oficial tem seu próprio handler, que chama os mesmos serviços de negócio (`FindOrCreateTicketService`, `AgentService`, `verifyMessage`) sem passar pelo listener do Baileys. |

**Consequência aceita da opção C:** haverá alguma duplicação de lógica de orquestração entre o listener do Baileys e o handler novo. É preferível a duplicação a arriscar o caminho de produção. Se a duplicação crescer, a convergência para a opção B fica registrada como tech debt.

### 3.2 Camada de porta (interface de canal)

```
backend/src/services/ChannelService/
├── types.ts               # IncomingMessage, OutgoingMessage, ChannelAdapter
├── getChannelAdapter.ts   # fábrica: Whatsapp -> adaptador correto
├── adapters/
│   ├── BaileysAdapter.ts  # embrulha o wbot atual — ZERO mudança de comportamento
│   ├── CloudApiAdapter.ts # Graph API da Meta
│   └── TwilioAdapter.ts   # SDK oficial da Twilio
├── serviceWindow.ts       # cálculo da janela de 24h
└── templates/
    ├── syncTemplates.ts   # busca templates aprovados no provedor
    └── pickTemplate.ts    # escolhe template quando a janela fechou
```

**Tipos neutros** (nenhum campo específico de biblioteca):

```typescript
interface OutgoingMessage {
  to: string;              // telefone canônico (usar canonicalizePhone)
  body?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  quotedChannelMessageId?: string;
  template?: { name: string; language: string; params: string[] };
}

interface IncomingMessage {
  channelMessageId: string;   // id da mensagem no provedor
  from: string;               // telefone canônico
  body?: string;
  mediaUrl?: string;
  mediaType?: string;
  timestamp: Date;
  raw: unknown;               // payload original, para auditoria
}

interface ChannelAdapter {
  sendText(msg: OutgoingMessage): Promise<{ channelMessageId: string }>;
  sendMedia(msg: OutgoingMessage): Promise<{ channelMessageId: string }>;
  markAsRead?(channelMessageId: string): Promise<void>;
  sendTyping?(to: string, on: boolean): Promise<void>;  // só Baileys implementa
}
```

**`sendTyping` é opcional de propósito.** O canal oficial não tem indicador de "digitando"; toda a humanização anti-banimento (`humanTypingDelay`) é específica do Baileys e **não deve rodar** nos canais oficiais — lá o tráfego é autorizado e o atraso artificial só piora a experiência do cliente. O adaptador declara o que sabe fazer; quem chama verifica.

### 3.3 Roteamento de saída

`SendWhatsAppMessage` e `SendWhatsAppMedia` passam a ser o funil: em vez de `GetTicketWbot(ticket)` seguido de `wbot.sendMessage()`, chamam `getChannelAdapter(whatsapp)` e delegam.

**Os outros 17 pontos que chamam `wbot.sendMessage()` direto** (Typebot, reações, deleção, grupos) continuam Baileys-only na Fase 1. Cada um recebe uma guarda explícita:

```typescript
if (whatsapp.channelType !== "baileys") {
  throw new AppError("ERR_FEATURE_BAILEYS_ONLY", 400);
}
```

Erro alto e claro é melhor que comportamento silenciosamente errado (II.5 — `catch` silencioso é proibido; o mesmo princípio vale para caminho não suportado).

### 3.4 Roteamento de entrada (webhook)

Rota nova, **pública por necessidade** (a Meta e a Twilio chamam de fora):

```
GET  /webhook/whatsapp/:whatsappId   # handshake de verificação (Meta)
POST /webhook/whatsapp/:whatsappId   # eventos
```

Fluxo obrigatório do POST, nesta ordem:

1. **Verificar assinatura** — `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com o app secret) na Meta; `X-Twilio-Signature` na Twilio. Assinatura inválida → **403 imediato**, sem processar nada.
2. Resolver `whatsappId` → `Whatsapp` → `companyId`. Não encontrado → 404.
3. Responder **200 em seguida**, antes de processar. A Meta espera resposta em segundos e reenvia se demorar; processamento vai para fila (Bull, já usado no projeto).
4. Converter payload → `IncomingMessage`.
5. Chamar `handleIncomingChannelMessage(incoming, whatsapp)`.

**O corpo bruto já está disponível.** Verificado em `app.ts:37`: o `bodyParser.json()` do projeto já usa `verify` preenchendo `req.rawBody`. Nenhuma mudança no parser é necessária — basta consumir `req.rawBody` no HMAC. Isto elimina o risco descrito em §10 ("corpo já consumido").

---

## 4. Modelo de dados

### 4.1 Colunas novas em `Whatsapps`

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `channelType` | STRING | `"baileys"` | `baileys` \| `cloud_api` \| `twilio` |
| `channelConfig` | TEXT | `null` | JSON **criptografado** — ver §4.3 |

**`channelType` com default `"baileys"`** garante que toda conexão existente continue funcionando sem migração de dados.

**Não reutilizar a coluna `provider`.** Ela já existe mas guarda a versão do protocolo Baileys (`"stable"` vs beta) — nome enganoso, semântica diferente. Reaproveitar geraria bug sutil.

### 4.2 Tabela nova `WhatsappTemplates`

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | INTEGER PK | |
| `whatsappId` | FK → Whatsapps | cascade delete |
| `companyId` | FK → Companies | **isolamento multi-tenant (XV.3)** |
| `name` | STRING | nome do template no provedor |
| `language` | STRING | ex. `pt_BR` |
| `category` | STRING | `MARKETING` \| `UTILITY` \| `AUTHENTICATION` |
| `status` | STRING | `APPROVED` \| `PENDING` \| `REJECTED` |
| `bodyText` | TEXT | corpo com placeholders `{{1}}` |
| `variableCount` | INTEGER | quantos parâmetros o template espera |
| `syncedAt` | DATE | última sincronização |

Índice único em `(whatsappId, name, language)`.

### 4.3 Credenciais criptografadas em repouso (CLAUDE.md XV.6)

`channelConfig` guarda token de acesso permanente da Meta e Auth Token da Twilio — **são credenciais**, equiparáveis a senha de terceiro. XV.6 é explícito: "Tokens de terceiros (OAuth, chaves de API de cliente, sessões de WhatsApp) são credenciais: criptografados em repouso, acesso restrito, jamais em log."

- Criptografia simétrica AES-256-GCM, chave em `CHANNEL_CONFIG_SECRET` no `.env` (nunca commitada — IV.1).
- Helper novo: `backend/src/helpers/encryptedField.ts` com `encrypt()` / `decrypt()`.
- **Nunca serializar `channelConfig` para o frontend.** A API devolve apenas máscara (`"••••1234"`) e um booleano `hasCredentials`.
- Nenhum log pode conter o valor decifrado, nem em `logger.debug`.

---

## 5. UX — Assistente de Conexão

Requisito declarado pelo usuário: *"o usuário mais leigo do mundo possa fazer essa integração de forma facilitada e automatizada possível"*.

### 5.1 Onde vive

Substitui o botão único "Adicionar WhatsApp" da página Conexões por um **assistente em etapas** (`frontend/src/components/ChannelWizard/`). Componentes separados por etapa (II.4 — proibido arquivo monolítico).

### 5.2 Etapa 1 — Escolha do tipo, em linguagem de dono de negócio

Três cartões grandes, **sem jargão técnico**:

> **📱 WhatsApp comum (QR Code)**
> Conecta lendo um QR code, como no WhatsApp Web.
> ✅ Grátis, funciona na hora, envia mensagem a qualquer momento
> ⚠️ É uma conexão não-oficial — existe risco de bloqueio pelo WhatsApp
> *Melhor para: começar rápido, atendimento de baixo volume*

> **🛡️ Oficial via Twilio**
> Conexão oficial da Meta, intermediada pela Twilio.
> ✅ Sem risco de bloqueio · Começa em poucos reais por mês
> ⚠️ Para iniciar conversa fora de 24h, precisa de mensagem pré-aprovada
> *Melhor para: testar o canal oficial com pouco custo*

> **🏢 Oficial direto com a Meta**
> Conexão oficial sem intermediário.
> ✅ Sem risco de bloqueio · Menor custo por mensagem
> ⚠️ Exige CNPJ verificado na Meta · Configuração mais técnica
> *Melhor para: volume alto, quando a empresa já é verificada*

Cada cartão mostra **o que você precisa ter em mãos** antes de começar, para o usuário não descobrir no meio do caminho que falta algo.

### 5.3 Etapa 2 — Credenciais, um campo por vez

Nunca um formulário com 6 campos vazios. **Um campo por tela**, cada um com:

- **"Onde encontro isso?"** — instrução literal do caminho no painel do provedor ("No painel da Meta: WhatsApp → Configuração da API → o número em *Phone number ID*"), com captura de tela.
- **Validação ao sair do campo** — o backend testa a credencial contra a API real e devolve ✓ verde ou o erro **específico** ("Este token não tem permissão `whatsapp_business_messaging`"), nunca "erro ao validar".
- **Botão "Colar"** — reduz erro de digitação em token longo.

### 5.4 Etapa 3 — Webhook configurado automaticamente

O ponto onde um leigo trava. O CRM deve:

1. Montar a URL sozinho (`https://api.otron.tech/webhook/whatsapp/{id}`) e gerar o token de verificação — o usuário não escreve nada.
2. **Tentar configurar via API do provedor**, quando o token tiver permissão para isso. Se conseguir: ✓ pronto, o usuário não faz nada.
3. Se não conseguir: mostrar URL e token em caixas com botão de copiar, e o passo a passo de onde colar.
4. **Botão "Testar conexão"** — verifica se o provedor consegue alcançar o webhook, e diz qual é o problema se não conseguir.

### 5.5 Etapa 4 — Teste real antes de concluir

Envia uma mensagem de teste para o WhatsApp do próprio administrador e pergunta: **"Chegou?"**. Só marca a conexão como `CONNECTED` após confirmação.

Motivo: as credenciais podem estar sintaticamente corretas e a entrega ainda falhar (número não registrado, WABA suspensa, template inexistente). Descobrir isso agora é muito melhor que descobrir com o cliente real.

### 5.6 Botão de Embedded Signup, preparado

Decisão do usuário: *"já deixe pronto o botão único para quando eu for um CNPJ verificado"*.

Na Etapa 1, o cartão "Oficial direto com a Meta" traz também:

```
[ 🔵 Conectar com Facebook ]  ← desabilitado
Disponível quando sua empresa estiver verificada
na Meta e o app aprovado como Tech Provider.
[Como habilitar isso?]
```

- O componente `EmbeddedSignupButton` é **construído de verdade**, com o fluxo completo do SDK do Facebook, mas fica atrás de uma flag de ambiente `META_EMBEDDED_SIGNUP_ENABLED` (default `false`).
- O backend já expõe a rota de troca de código por token (`POST /channel/embedded-signup/exchange`), testada com mock.
- **Ligar depois = trocar a flag para `true`**, não escrever código novo.

Isto atende IV.3: o App ID da Meta é público por design (vai no navegador); o App Secret fica só no backend.

---

## 6. Fases de entrega

Cada fase é um commit independente, testável e reversível (II.6).

### Fase 1 — Fundação (sem UI, sem comportamento novo)
- Migration: `channelType` + `channelConfig` em `Whatsapps`
- `helpers/encryptedField.ts` + testes
- `ChannelService/types.ts` — interfaces neutras
- `BaileysAdapter` embrulhando o wbot atual
- `getChannelAdapter()` devolvendo sempre Baileys
- **Critério de sucesso: a suíte inteira continua verde e o comportamento do Baileys é idêntico.** Nada visível muda.

### Fase 2 — Saída pelos canais oficiais
- `CloudApiAdapter` + `TwilioAdapter` (envio de texto e mídia)
- `SendWhatsAppMessage` / `SendWhatsAppMedia` roteando pelo adaptador
- Guardas `ERR_FEATURE_BAILEYS_ONLY` nos 17 pontos não migrados
- `serviceWindow.ts` — cálculo da janela de 24h

### Fase 3 — Entrada (webhook)
- Rota pública + verificação de assinatura (Meta e Twilio)
- Preservação do corpo bruto para HMAC
- Enfileiramento e resposta 200 imediata
- `handleIncomingChannelMessage` → serviços compartilhados
- Agente e Secretária respondendo por canal oficial

### Fase 4 — Templates
- Tabela `WhatsappTemplates` + migration
- `syncTemplates` (Meta e Twilio)
- `pickTemplate` — seleção automática quando a janela fechou
- Tela de listagem, somente leitura

### Fase 5 — Assistente de Conexão (UI)
- Wizard completo, etapas §5.2 a §5.5
- Rotas de validação de credencial
- `EmbeddedSignupButton` atrás da flag

### Fase 6 — Documentação
- `docs/MANUAL_PLATAFORMA.md`: seção nova explicando os três tipos
- `CHANGELOG.md` e `decisions_log.md`

---

## 7. Edge cases

### 7.1 Conexão e sessão
- **Cloud API não tem sessão.** `StartWhatsAppSession` deve retornar cedo para `channelType !== "baileys"` — não há socket para abrir nem QR para gerar. O status vem de teste ativo contra a API, não de evento de conexão.
- **`StartAllWhatsAppsSessions` no boot** não pode tentar abrir socket para canal oficial.
- **A tela de QR Code** não pode aparecer para canal oficial.

### 7.2 Telefone
- O JID do Baileys (`5548...@s.whatsapp.net`) e o formato da Cloud API (`+5548...`) são diferentes. **Sempre canonicalizar** com `canonicalizePhone` (`SecretaryService/phoneMatch.ts`), que já trata DDI, 9º dígito e máscara.
- Precedente registrado: o bug do `agentOwnerNumber` (2026-08-20) nasceu exatamente de não canonicalizar.

### 7.3 Janela de 24h — o caso mais perigoso
Funcionalidades proativas existentes que **quebram** no canal oficial sem template:
`BirthdayReminderService`, `RetentionService` (winback, preventivo, fidelidade), campanhas, `secretaryBriefing`, alertas da Secretária.

Comportamento obrigatório: ao tentar enviar com a janela fechada e **sem** template correspondente, **falhar alto** com `ERR_OUTSIDE_SERVICE_WINDOW`, logar em `WARN` com `companyId` e `ticketId`, e **não** tentar enviar como mensagem livre. Enviar e falhar silenciosamente na Meta seria pior: o sistema marcaria como enviado e o cliente nunca receberia.

### 7.4 Mídia
- **URL de mídia recebida da Cloud API expira em ~5 minutos.** Baixar e persistir **no momento do webhook**, nunca sob demanda depois.
- Limite de 100 MB por arquivo na Cloud API (o Baileys aceita mais).

### 7.5 Multi-tenant (XV.3)
- O webhook resolve empresa a partir do `whatsappId` da URL, **nunca** de campo do corpo — corpo é controlado por quem chama.
- Teste obrigatório: webhook do `whatsappId` da empresa A **não pode** criar ticket na empresa B.

### 7.6 Falhas do provedor
- `130429` (rate limit da Meta) → reenfileirar com backoff, não descartar.
- Token expirado/revogado → marcar conexão como `DISCONNECTED` e notificar, não tentar em loop.
- Webhook duplicado (a Meta reenvia se não receber 200) → **idempotência por `channelMessageId`**, para não duplicar mensagem no ticket.

---

## 8. Segurança (checklist XV.9 aplicado)

| Item | Como é atendido |
|---|---|
| Rota pública protegida | Assinatura HMAC verificada antes de qualquer processamento; 403 se inválida |
| Autorização no backend | Rotas de configuração de canal exigem `isAuth` + dono da empresa; nenhuma decisão vem do cliente |
| IDOR / multi-tenant | `companyId` sempre da conexão resolvida no servidor; teste de vazamento entre empresas obrigatório |
| Input hostil | Payload de webhook validado por schema antes de uso; corpo bruto só para HMAC |
| Rate limiting | `express-rate-limit` na rota de webhook (XV.5 — rota que consome API paga) |
| Dados em repouso | `channelConfig` cifrado AES-256-GCM; máscara no frontend; nunca em log |
| Secrets no frontend | Só o App ID público da Meta (`REACT_APP_*`). App Secret e tokens nunca saem do backend (IV.3) |

---

## 9. Success Criteria

A implementação está completa quando **todos** forem verdadeiros:

1. Uma empresa tem simultaneamente uma conexão Baileys e uma oficial, ambas `CONNECTED`, e recebe/responde nas duas.
2. O comportamento do Baileys é **byte-a-byte o mesmo** de antes (suíte completa verde, sem alteração de teste existente).
3. O Agente responde por canal oficial sem saber que é canal oficial.
4. Mensagem recebida no canal oficial cria ticket na empresa certa e aparece na tela.
5. Envio fora da janela de 24h usa template automaticamente, ou falha alto e claro.
6. `humanTypingDelay` **não** roda em canal oficial.
7. Teste automatizado prova que webhook da empresa A não escreve na empresa B.
8. Teste automatizado prova que webhook com assinatura inválida retorna 403.
9. Credencial não aparece em nenhuma resposta de API nem em log.
10. Um usuário sem conhecimento técnico conclui a conexão pelo assistente sem consultar documentação externa.
11. Cobertura ≥ 80% no código novo (II.1).

## 10. Failure Modes

| Falha | Sintoma | Mitigação |
|---|---|---|
| Assinatura não verificada | Qualquer um na internet injeta mensagem falsa | Verificação obrigatória antes do processamento; teste com assinatura inválida |
| `req.rawBody` indisponível na rota | HMAC nunca bate, webhook 100% quebrado | Já resolvido no projeto (`app.ts:37`); teste de integração confirma que chega íntegro |
| Webhook demora a responder | Meta reenvia, mensagem duplica no ticket | 200 imediato + fila; idempotência por `channelMessageId` |
| Mídia baixada tarde demais | Anexo perdido, ticket sem contexto | Baixar no webhook, nunca depois |
| Janela de 24h ignorada | Sistema marca enviado, cliente não recebe | Falha alta com `ERR_OUTSIDE_SERVICE_WINDOW` |
| Adaptador Baileys altera comportamento | Regressão no canal que já é produção | Fase 1 entrega só o embrulho, com a suíte inteira como rede |
| Credencial em log | Vazamento de token de cliente | Revisão explícita; nunca logar `channelConfig` |
| Telefone não canonicalizado | Mensagem não entregue, contato duplicado | `canonicalizePhone` em toda fronteira |

---

## 11. Dependências novas

| Pacote | Para quê | Observação |
|---|---|---|
| `twilio` | SDK oficial Node | Mantido e maduro |
| — | Cloud API da Meta | **Sem SDK**: o oficial (`whatsapp`) está arquivado desde 2023. Usar `axios`, já presente |

Versão exata fixada no `package.json` e lockfile commitado (VI.4).

---

## 12. Tech debt aceito conscientemente

1. **Duplicação de orquestração** entre `wbotMessageListener` e `handleIncomingChannelMessage` — consequência da opção C. Convergir para tipo neutro (opção B) quando houver cobertura de teste no listener.
2. **17 pontos Baileys-only** (Typebot, reações, deleção, grupos) — falham alto em canal oficial. Migrar sob demanda real.
3. **Embedded Signup atrás de flag** — código pronto, não exercitado em produção até a Meta aprovar.
4. **Templates somente leitura** — criação continua no painel da Meta.
