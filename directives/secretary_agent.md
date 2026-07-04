# Diretiva: Agente Secretária

## Objetivo
Canal WhatsApp exclusivo para admins gerenciarem o negócio por linguagem natural.
Admins enviam comandos como "avise o cliente das 18h que atrasei 15 min" e a secretária
localiza o ticket/cliente correto, envia a mensagem e confirma a ação.

## Autenticação
- Só responde se o remetente tiver um User com `profile = "admin"` na empresa
- Verificação por número de WhatsApp do remetente vs. campo `whatsappNumber` nos Users
- Mensagens de não-admins são silenciosamente ignoradas

## Tools disponíveis
| Tool | Ação |
|------|------|
| `consultarAtendimentos` | Lista tickets por status/fila/data |
| `consultarAgendamentos` | Lista agendamentos do dia ou data informada |
| `buscarTicket` | Localiza ticket por nome, serviço ou contexto ("cliente das 18h") |
| `consultarUsuarios` | Lista agentes disponíveis para transferência |
| `transferirTicket` | Move ticket para outro usuário/fila |
| `fecharTicket` | Encerra um atendimento |
| `enviarMensagemParaCliente` | Envia mensagem WhatsApp ao cliente via ticket |

## Alertas Proativos (MVP)
Cron job a cada 5 minutos verifica:
- **waitAlert**: tickets `open` sem resposta há mais de `secretaryAlertWaitMinutes` min → notifica canal secretária
- **agentError**: tickets caindo em `pending` com `chatbot: false` após erro do agente → notifica

Settings keys:
- `secretaryAlertWaitMinutes` (number, 0 = desativado)
- `secretaryAlertAgentError` ("enabled" | "disabled")

## Módulos
- `SecretaryService/index.ts` — loop agêntico com prompt gerencial
- `SecretaryService/handleSecretaryMessage.ts` — orquestra: auth + loop + resposta
- `SecretaryService/secretaryTools/` — cada tool em arquivo separado
- `SecretaryService/secretaryAlerts.ts` — cron de alertas proativos
- `controllers/SecretaryController.ts` — endpoints de settings
- Whatsapp model: adicionar `isSecretaryChannel: boolean`
- wbotMessageListener: hook para canal secretária

## Fluxo de envio de mensagem para cliente
1. Admin: "avise o cliente do cachorro Otto que está pronto"
2. `buscarTicket({ query: "cachorro Otto" })` → encontra ticketId + whatsappId
3. `enviarMensagemParaCliente({ ticketId, mensagem })` → usa wbot correto para enviar
4. Secretária confirma: "✅ Mensagem enviada para [nome] no ticket #[id]"

## Success Criteria
- Admin manda mensagem no canal → secretária responde em < 5s
- "avise X" → mensagem chega no WhatsApp do cliente
- "quantos atendimentos abertos?" → número correto
- Alerta de wait time dispara quando configurado
- Não-admin não recebe resposta

## Failure Modes
- Admin não encontrado (número não cadastrado) → silencioso
- Ticket não encontrado → secretária pede mais detalhes
- wbot offline → erro capturado, secretária avisa admin
- Loop agêntico > 5 iterações → fallback com o que apurou até ali
