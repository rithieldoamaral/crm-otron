# Diretiva: Transcrição de Áudio no Canal Agente IA

## Objetivo
Permitir que o Agente IA processe mensagens de voz (audioMessage / pttMessage) recebidas no canal isAgentChannel, transcrevendo o áudio via OpenAI Whisper antes de enviar o texto ao loop agêntico.

## Entradas
- Arquivo de áudio salvo em `public/` (ogg/mp4, max ~25 MB — limite Whisper)
- API Key do OpenAI Whisper (`agentWhisperApiKey` em Settings)
- companyId para lookup da chave

## Saída
- String com o texto transcrito em português
- Fallback textual se a transcrição falhar ou chave ausente

## Ferramentas / Libs
- `openai` v3.3.0 já instalado (`openai.createTranscription`)
- `fs.createReadStream` para stream do arquivo salvo
- `Setting` model para buscar a chave por companyId

## Fluxo
1. `wbotMessageListener` detecta `msgType === audioMessage | pttMessage` no bloco `isAgentChannel`
2. Chama `verifyMediaMessage(msg, ticket, contact)` → salva no BD e retorna Message com `mediaUrl`
3. Monta caminho do arquivo: `public/<filename>`
4. Chama `transcribeAudio(filePath, apiKey)` → retorna texto
5. Passa texto como `userMessage` para `handleAgentMessage`

## Módulos Criados
- `AgentService/audioTranscriber.ts` — SRP: só transcreve
  - `transcribeAudio(filePath, apiKey): Promise<string>`
  - `getWhisperApiKey(companyId): Promise<string | null>`
- `AgentSettings.js` — nova seção "Transcrição de Áudio" com campo `agentWhisperApiKey`

## Success Criteria
- Mensagem de voz resulta em resposta contextual do agente (não "Áudio")
- Áudio é salvo no histórico do ticket normalmente via verifyMediaMessage
- Sem chave configurada: agente recebe fallback legível (não string vazia)
- Erro na API Whisper: ticket não quebra, fallback é enviado ao agente

## Failure Modes
- `agentWhisperApiKey` ausente → fallback "[mensagem de áudio]"
- Arquivo não encontrado (download falhou) → fallback + log de erro
- API Whisper rate limit / timeout → fallback + log de erro, atendimento continua
- Áudio corrompido → Whisper retorna string vazia → agente recebe "" (trata como silêncio)
