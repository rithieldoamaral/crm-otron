# Diretiva: Busca Dinâmica de Modelos (LLM + Transcrição)

## Objetivo
Substituir listas estáticas de modelos por busca dinâmica na API de cada provedor.
Usuário escolhe o provedor → modelos atualizados são carregados automaticamente → nenhum deploy necessário para novos modelos.

## Provedores LLM suportados
| Provedor | Endpoint | SDK |
|----------|----------|-----|
| OpenAI   | api.openai.com/v1/models | openai v3.3.0 |
| Groq     | api.groq.com/openai/v1/models | openai (basePath override) |
| OpenRouter | openrouter.ai/api/v1/models | openai (basePath override) |
| Anthropic | /v1/models | @anthropic-ai/sdk |
| MiniMax  | — | lista estática (API proprietária) |

## Provedores Transcrição suportados
| Provedor | Endpoint | Diferencial |
|----------|----------|-------------|
| OpenAI   | whisper-1 | padrão, estável |
| Groq     | whisper-large-v3, distil-whisper | mais rápido e barato |

## Módulos Criados
- `AgentService/modelFetcher.ts` — SRP: busca e filtra modelos por provedor
  - `fetchLLMModels(provider, apiKey): Promise<AgentModel[]>`
  - `fetchTranscriptionModels(provider, apiKey): Promise<AgentModel[]>`
- `AgentService/transcriptionProvider.ts` — SRP: transcrição multi-provedor
  - `transcribeWithProvider(filePath, provider, model, apiKey): Promise<string>`
  - `getWhisperSettings(companyId): Promise<WhisperSettings | null>`
  - `transcribeAudioForCompany(filePath, companyId): Promise<string | null>`
- `controllers/AgentController.ts` — endpoint REST para buscar modelos
- `routes/agentRoutes.ts` — POST /agent/models

## Fluxo de busca no frontend
1. Usuário seleciona provedor ou abre a página com settings já carregadas
2. Frontend chama `POST /api/agent/models { provider, apiKey, type }`
3. Backend chama `fetchLLMModels` ou `fetchTranscriptionModels`
4. Retorna array `[{ id, label }]`; graceful degradation retorna `[]` em erro
5. Frontend usa lista dinâmica; cai para DEFAULT_MODELS se vazia

## Success Criteria
- Novo modelo lançado pela OpenAI aparece sem alteração de código
- Groq whisper-large-v3 disponível para seleção
- Erro de API (chave inválida, timeout) não quebra a tela de settings
- Modelos corretos exibidos para cada provedor selecionado

## Failure Modes
- Chave inválida → API retorna 401 → modelFetcher retorna [] → frontend mostra defaults
- Timeout → Promise rejeita → idem
- Provedor sem models endpoint (MiniMax) → retorna lista estática configurada no código
