# Diretiva: Fase 1A — Agente de Atendimento ao Cliente

**Status:** Pendente
**Data:** 2026-04-19
**Depende de:** Fase 0 (concluída ✅)

---

## Objetivo

Substituir o chatbot de menu (árvore de opções "Digite 1, 2, 3...") por um agente de IA conversacional para os planos que tiverem o recurso ativado. O agente atende clientes em linguagem natural, consulta a base de conhecimento do negócio (RAG simplificado via system prompt), executa ações (agendar, buscar info, notificar o dono) e pode transferir para humano a qualquer momento.

---

## Entradas

- Mensagem do cliente (texto ou áudio) chegando via Baileys
- Base de conhecimento do negócio (configurada pelo dono no painel)
- Configuração do provedor de IA (por empresa: provider, apiKey, model, baseUrl)
- Histórico de conversa (Redis, últimas 20 mensagens, TTL 1h)

## Saídas

- Resposta em texto enviada ao cliente via WhatsApp
- Ações executadas (agendamento criado, mensagem encaminhada, etc.)
- Log da ação em `AgentActions` (banco de dados)
- Notificação ao proprietário (quando urgência detectada)

---

## Arquitetura de Arquivos

### Novos arquivos a criar:

```
backend/src/services/AgentService/
├── index.ts                          ← handler principal: handleClientAgent()
├── providers/
│   ├── AIProviderFactory.ts          ← factory: retorna o provider correto
│   ├── interfaces.ts                 ← AIProvider interface + tipos comuns
│   ├── AnthropicProvider.ts          ← adapter Anthropic SDK
│   └── OpenAICompatibleProvider.ts   ← adapter OpenAI SDK (Groq/OpenRouter/etc)
├── tools/
│   ├── index.ts                      ← array de tool definitions (formato universal)
│   ├── buscarContato.ts
│   ├── enviarMensagem.ts
│   ├── listarAgendamentos.ts
│   ├── criarAgendamento.ts
│   ├── relatorioDoDia.ts
│   ├── clientesInativos.ts
│   └── notificarProprietario.ts
├── contextManager.ts                 ← Redis: carregar/salvar histórico
├── knowledgeBuilder.ts               ← monta o system prompt com RAG do negócio
└── transcribeAudio.ts                ← Whisper: áudio → texto

backend/src/models/AgentAction.ts     ← log de ações do agente
backend/src/controllers/AgentController.ts
backend/src/routes/agentRoutes.ts
backend/src/database/migrations/[ts]-add-agent-settings.ts
```

### Arquivos a modificar (mudanças cirúrgicas):

```
backend/src/services/WbotServices/wbotMessageListener.ts
  └── ~15 linhas: detecção de canal do agente antes dos handlers existentes

backend/src/models/Whatsapp.ts
  └── +1 campo: isAgentChannel (boolean, default false)
```

---

## Interfaces e Tipos (interfaces.ts)

```typescript
export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;  // para respostas de tool
  name?: string;        // nome da tool quando role='tool'
}

export interface AITool {
  name: string;
  description: string;
  parameters: object;  // JSON Schema
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface AIResponse {
  content: string | null;
  toolCalls?: AIToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  finishReason: 'stop' | 'tool_use' | 'length';
}

export interface AIProvider {
  chat(messages: AIMessage[], systemPrompt: string, options?: ChatOptions): Promise<AIResponse>;
  chatWithTools(messages: AIMessage[], tools: AITool[], systemPrompt: string, options?: ChatOptions): Promise<AIResponse>;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderConfig {
  provider: 'anthropic' | 'openai' | 'groq' | 'openrouter' | 'minimax';
  apiKey: string;
  model: string;
  baseUrl?: string;
}
```

---

## Configurações por Empresa (Settings)

Chaves adicionadas ao sistema de Settings existente:

| Chave | Tipo | Padrão | Descrição |
|---|---|---|---|
| `agentEnabled` | boolean | false | Agente de atendimento ativo |
| `agentProvider` | string | `anthropic` | Provider de IA |
| `agentApiKey` | string | — | Chave da API |
| `agentModel` | string | `claude-haiku-4-5-20251001` | Modelo |
| `agentBaseUrl` | string | — | URL customizada (Groq/OpenRouter) |
| `agentName` | string | `Otron` | Nome do agente para o cliente |
| `agentPersonality` | string | `atencioso` | Template de personalidade |
| `agentBusinessName` | string | — | Nome do negócio |
| `agentServices` | string | — | Serviços oferecidos |
| `agentHours` | string | — | Horário de funcionamento |
| `agentFAQ` | string (JSON) | `[]` | Pares pergunta/resposta |
| `agentInstructions` | string | — | Instruções especiais |
| `agentRestrictions` | string | — | O que o agente NÃO deve fazer |
| `agentOwnerNumber` | string | — | Número pessoal do proprietário |
| `agentMaxHistory` | number | 20 | Máx mensagens no contexto |

---

## System Prompt Builder (knowledgeBuilder.ts)

O `knowledgeBuilder` monta o system prompt em tempo de execução combinando:

```
[PERSONALIDADE]
Você é {agentName}, assistente do(a) {businessName}.

[SERVIÇOS]
{services}

[HORÁRIO]
{hours}

[PERGUNTAS FREQUENTES]
{faq_formatted}

[INSTRUÇÕES ESPECIAIS]
{instructions}

[RESTRIÇÕES]
{restrictions}

[REGRAS UNIVERSAIS]
- Responda sempre em português brasileiro
- Seja direto e objetivo
- Confirme ações realizadas
- Nunca invente informações — use as ferramentas para dados reais
- Se detectar urgência médica/emergência, notifique o proprietário imediatamente
- Se o cliente pedir para falar com humano, use transferir_para_humano()
```

Templates de personalidade pré-calibrados (temperatura e estilo):

| Template | Temperatura | Postura |
|---|---|---|
| `atencioso` | 0.3 | Empático, resolve problemas, calmo em emergências |
| `vendedor` | 0.7 | SPIN selling, cria urgência, destaca benefícios |
| `hibrido` | 0.5 | Atende bem e aproveita oportunidades comerciais |

---

## Ferramentas do Agente (tools/)

Cada tool segue o padrão:
1. Definição JSON Schema (para o provider de IA)
2. Implementação TypeScript (executa a ação real no banco)

### Lista de tools:

**buscar_contato(nome_ou_numero)**
- Busca em `Contacts` por nome (ILIKE) ou número
- Retorna: id, nome, número, último contato, tickets abertos

**enviar_mensagem(contactId, mensagem)**
- Usa `SendWhatsAppMessage` service existente
- Cria/encontra ticket aberto para o contato
- Retorna: confirmação de envio

**listar_agendamentos(data)**
- Consulta `Schedules` para a data informada
- Retorna: lista formatada com horário, cliente, serviço

**criar_agendamento(contactId, servico, dataHora, observacoes)**
- Cria registro em `Schedules`
- Retorna: confirmação com data/hora

**cancelar_agendamento(agendamentoId)**
- Atualiza status do Schedule para cancelado
- Retorna: confirmação

**notificar_proprietario(mensagem, prioridade)**
- Envia mensagem via WhatsApp para `agentOwnerNumber` configurado
- Prioridade: `normal` | `urgente`
- Prefixo automático: 🚨 para urgente

**transferir_para_humano(motivo)**
- Define `ticket.chatbot = false` e `ticket.userId = null` (fica na fila)
- Notifica atendentes disponíveis via Socket.IO
- Envia mensagem ao cliente: "Transferindo para um atendente..."

**informar_horario_funcionamento()**
- Retorna o horário configurado na base de conhecimento
- Sem acesso ao banco — usa dados do system prompt

---

## Fluxo de Processamento (index.ts)

```
1. wbotMessageListener detecta: conexão é agentChannel E !fromMe E !isGroup
   → chama handleClientAgent(msg, wbot, ticket, contact, companyId)

2. handleClientAgent():
   a. Carrega configurações de IA da empresa (Settings)
   b. Verifica agentEnabled — se false, retorna (fluxo normal)
   c. Se áudio → transcribeAudio() → texto
   d. Carrega histórico Redis (contextManager.loadContext)
   e. Monta system prompt (knowledgeBuilder.build)
   f. Inicializa provider (AIProviderFactory.create)
   g. Loop de agente (máx 5 iterações para evitar loop infinito):
      i.  Chama provider.chatWithTools(messages, tools, systemPrompt)
      ii. Se finishReason === 'tool_use':
            - Executa cada tool call
            - Adiciona resultado ao messages
            - Continua loop
      iii. Se finishReason === 'stop':
            - Envia resposta ao cliente
            - Salva contexto no Redis
            - Registra ação no AgentActions
            - Break
   h. Em caso de erro: mensagem de fallback + log de erro
```

---

## Migration (add-agent-settings)

Não requer novas tabelas — usa o sistema `Settings` existente e adiciona `isAgentChannel` ao modelo `Whatsapp`.

```sql
ALTER TABLE "Whatsapps" ADD COLUMN "isAgentChannel" BOOLEAN DEFAULT false;
```

Nova tabela `AgentActions` para auditoria:
```sql
CREATE TABLE "AgentActions" (
  id SERIAL PRIMARY KEY,
  companyId INTEGER NOT NULL,
  ticketId INTEGER,
  contactId INTEGER,
  action VARCHAR(100) NOT NULL,
  parameters JSONB,
  result JSONB,
  success BOOLEAN DEFAULT true,
  errorMessage TEXT,
  provider VARCHAR(50),
  model VARCHAR(100),
  inputTokens INTEGER,
  outputTokens INTEGER,
  createdAt TIMESTAMPTZ NOT NULL,
  updatedAt TIMESTAMPTZ NOT NULL
);
```

---

## Testes (TDD — escrever ANTES do código)

Arquivo: `backend/src/tests/unit/AgentService/`

- `AIProviderFactory.test.ts` — retorna provider correto para cada configuração
- `AnthropicProvider.test.ts` — mock de API, verifica formato de mensagens
- `OpenAICompatibleProvider.test.ts` — mock de API, verifica baseURL customizada
- `knowledgeBuilder.test.ts` — verifica geração correta do system prompt
- `contextManager.test.ts` — verifica save/load do Redis
- `tools/buscarContato.test.ts` — mock do Sequelize, verifica busca
- `tools/enviarMensagem.test.ts` — mock do SendWhatsAppMessage
- `handleClientAgent.test.ts` — teste de integração do fluxo completo

Cobertura mínima: 80% (exigência CLAUDE.md).

---

## Dependências a instalar

```bash
# Anthropic SDK
npm install @anthropic-ai/sdk

# OpenAI SDK (cobre Groq, OpenRouter, MiniMax via baseURL)
npm install openai

# Já existem no projeto: redis (para contextManager), openai (versão antiga - atualizar)
```

---

## Success Criteria

✅ Mensagem de texto do cliente → agente responde em linguagem natural
✅ Mensagem de áudio → transcrita → agente responde
✅ "Quero agendar" → agente cria agendamento no banco
✅ "Quero falar com uma pessoa" → transfere para fila humana
✅ Urgência detectada → notifica proprietário via WhatsApp
✅ Troca de provider funciona mudando apenas Settings no banco
✅ Histórico de contexto funciona em múltiplos turnos
✅ Humano assume ticket → agente para de responder automaticamente
✅ Cobertura de testes ≥ 80%

---

## Failure Modes

❌ Provider indisponível → fallback para mensagem de erro amigável, nunca silêncio
❌ Loop infinito de tools → limite de 5 iterações, timeout de 30s
❌ Contexto Redis expirado → inicia nova conversa sem histórico (aceitável)
❌ Transcrição de áudio falha → solicita que o cliente escreva o texto
❌ Tool falha → agente informa ao cliente e sugere alternativa

---

## Próximo Passo após Fase 1A

Fase 1B — Agente Secretária (canal do proprietário) — ver `directives/phase1b_agent_secretaria.md`
