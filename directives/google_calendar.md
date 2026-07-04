# Diretiva: Google Calendar Integration

## Objetivo
Cada profissional (User) conecta seu Google Calendar pessoal via OAuth2.
O Agente IA e a Secretária consultam disponibilidade real, criam eventos e gerenciam
agendamentos diretamente nas agendas individuais dos atendentes.
O sistema envia lembretes automáticos com confirmação interativa via WhatsApp.

## Decisões Arquiteturais
- Google Calendar apenas (V1) — Gmail domina o mercado BR de pequenos negócios
- OAuth2 **por profissional** (não por empresa) — cada atendente conecta sua conta Google pessoal
- Horários de trabalho **por dia da semana** por profissional — máxima flexibilidade
- Serviços em nova tabela `Services` — não misturar com Filas (filas = setores)
- Profissionais por serviço via `ServiceProfessionals` — nem todo atendente faz tudo
- Confirmação de lembrete via **handler dedicado no Redis** (não via LLM) — determinístico e sem custo de tokens
- Detecção de SIM/NÃO por **regex normalizado** (sem acentos, minúsculas) — cobre variações naturais

## Modelos de Dados

### Services
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | INT PK | |
| name | STRING | Ex: "Corte masculino", "Coloração" |
| durationMinutes | INT | Duração em minutos (ex: 30, 120) |
| description | TEXT | Descrição opcional |
| companyId | INT FK | Isolamento multi-tenant |
| isActive | BOOLEAN | Serviço ativo (default: true) |

### ServiceProfessionals (junction)
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | INT PK | |
| serviceId | INT FK | |
| userId | INT FK | Profissional habilitado para este serviço |
| companyId | INT FK | |

### UserCalendars
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | INT PK | |
| userId | INT FK | Profissional dono do calendário |
| companyId | INT FK | |
| googleAccountEmail | STRING | Email da conta Google conectada |
| calendarId | STRING | ID do calendário (geralmente o email) |
| accessToken | TEXT | Token de acesso (encriptado em AES-256) |
| refreshToken | TEXT | Token de refresh (encriptado em AES-256) |
| tokenExpiry | DATE | Expiração do accessToken |
| isActive | BOOLEAN | Conexão ativa |

### UserWorkingHours
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | INT PK | |
| userId | INT FK | |
| companyId | INT FK | |
| dayOfWeek | INT | 0=Dom, 1=Seg, ..., 6=Sab |
| startTime | STRING | Ex: "08:00" |
| endTime | STRING | Ex: "18:00" |
| isWorking | BOOLEAN | Trabalha neste dia (false = folga) |

### Campos adicionados ao Schedule (existente)
| Campo | Tipo | Descrição |
|-------|------|-----------|
| serviceId | INT FK | Serviço agendado |
| professionalId | INT FK | Profissional responsável |
| googleEventId | STRING | ID do evento no Google Calendar |
| reminderStatus | ENUM | pending / confirmed / cancelled / no_response |
| reminderSentAt | DATE | Quando o lembrete foi enviado |
| confirmedAt | DATE | Quando o cliente confirmou |

## Fluxo de Agendamento via Agente

```
1. Cliente: "quero agendar"
2. Agente: "Qual serviço e qual dia você prefere?"
3. Cliente: "corte, segunda"
4. Agente → verificarDisponibilidade({ servicoId, data })
   Retorna slots por profissional, respeitando:
   - Horários de trabalho do profissional
   - Eventos já existentes no Google Calendar
   - Duração do serviço (sem overlap)
5. Agente: "Na segunda temos:\n• Carlos: 9h, 11h, 14h\n• Fabio: 9h, 10h, 15h\nQual prefere?"
6. Cliente: "Carlos às 11h"
7. Agente → criarEvento({ servicoId, atendenteId, data, hora, contactId })
   - Cria evento no Google Calendar do profissional
   - Cria registro no Schedule com googleEventId
8. Agente: "✅ Agendado! Carlos na segunda às 11h para Corte (30min)."
```

## Fluxo de Cancelamento/Remarcação via Agente

```
Cancelamento:
1. Cliente: "quero cancelar meu horário"
2. Agente → buscarAgendamentoCliente({ contactId }) → mostra próximo agendamento
3. Cliente confirma cancelamento
4. Agente → cancelarEvento({ scheduleId })
   - Remove evento do Google Calendar
   - Atualiza Schedule.status = "cancelled"
5. Agente confirma cancelamento

Remarcação:
1. Cliente: "quero remarcar meu horário de segunda"
2. Agente → buscarAgendamentoCliente → mostra agendamento atual
3. Agente: "Para qual dia e horário quer remarcar?"
4. Cliente: "quarta às 14h"
5. Agente → verificarDisponibilidade({ servicoId, data: "quarta" })
6. Agente mostra disponibilidade → Cliente confirma
7. Agente → reagendarEvento({ scheduleId, novaData, novaHora, atendenteId })
   - Remove evento antigo do Google Calendar
   - Cria novo evento
   - Atualiza Schedule
```

## Fluxo de Lembretes (Cron)

### Envio
- Cron a cada 5 min verifica agendamentos pendentes de lembrete
- Envia se: `reminderDayBefore = true` → 1 dia antes às 9h OU `reminder15min = true` → 15 min antes
- Configurable por empresa (toggles nas settings)
- Mensagem: *"Olá [nome]! Seu horário com [profissional] é [data/hora] para [serviço]. Confirme respondendo **SIM** ou cancele com **NÃO**."*
- Salva no Redis: `reminder:pending:{companyId}:{contactNumber}` com `scheduleId` e TTL de 25h

### Recepção da resposta (Handler dedicado no wbotMessageListener)
- ANTES do fluxo normal, verifica Redis: existe `reminder:pending:{companyId}:{contactNumber}`?
- Se sim: normaliza mensagem (minúsculas + remove acentos)
- Detecta SIM: contém `sim|yes|confirmo|confirmado|pode|ok|certo|tá bom|tô lá|claro`
- Detecta NÃO: contém `não|nao|cancela|cancelar|não posso|nao posso|desmarcar|impossível`
- SIM → Schedule.reminderStatus = confirmed, confirmedAt = now, `return` (não cria ticket)
- NÃO → cancelarEvento(scheduleId), notifica secretária, `return`
- Sem match → ignora (não cancela), remove chave Redis, `return` apenas se era exata resposta ao lembrete... 
  IMPORTANTE: se não há match, NÃO cancela e NÃO intercepta — mensagem segue fluxo normal

## Tools disponíveis (AgentService + SecretaryService)

| Tool | Args | Retorno |
|------|------|---------|
| `listar_servicos` | — | Lista de serviços ativos com duração |
| `verificar_disponibilidade` | servicoId, data | Slots livres por profissional naquele dia |
| `buscar_proximo_horario` | servicoId, atendenteId? | Próximo slot livre (hoje em diante) |
| `criar_evento` | servicoId, atendenteId, data, hora, contactId | Cria no Calendar + Schedule |
| `cancelar_evento` | scheduleId | Remove do Calendar + atualiza Schedule |
| `reagendar_evento` | scheduleId, novaData, novaHora, atendenteId? | Remarca |
| `buscar_agendamento_cliente` | contactId | Próximo agendamento ativo do cliente |
| `listar_agenda_profissional` | userId, data | Agenda completa de um profissional no dia |

## Módulos

```
backend/src/services/GoogleCalendarService/
├── oauth.ts                    — OAuth2: URL de auth, callback, refresh token
├── calendarApi.ts              — Wrapper Google API: freebusy, events CRUD
├── availabilityEngine.ts       — Lógica de slots: working hours + calendar + duração
├── reminderSender.ts           — Envia lembretes via WhatsApp
├── reminderHandler.ts          — Processa resposta SIM/NÃO do cliente
├── tools/
│   ├── listarServicos.ts
│   ├── verificarDisponibilidade.ts
│   ├── buscarProximoHorario.ts
│   ├── criarEvento.ts
│   ├── cancelarEvento.ts
│   ├── reagendarEvento.ts
│   ├── buscarAgendamentoCliente.ts
│   ├── listarAgendaProfissional.ts
│   └── index.ts
└── __tests__/
    ├── availabilityEngine.spec.ts
    ├── reminderHandler.spec.ts
    └── tools/
        ├── verificarDisponibilidade.spec.ts
        ├── criarEvento.spec.ts
        ├── cancelarEvento.spec.ts
        └── ...

backend/src/models/
├── Service.ts
├── ServiceProfessional.ts
├── UserCalendar.ts
└── UserWorkingHours.ts

backend/src/controllers/GoogleCalendarController.ts
backend/src/routes/googleCalendarRoutes.ts

frontend/src/components/Settings/
├── ServicesSettings.js         — CRUD de serviços + atribuição de profissionais
└── CalendarSettings.js         — Conectar Google Calendar + horários de trabalho
```

## Variáveis de Ambiente
```env
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://seudominio.com/api/google-calendar/callback
# Tokens armazenados encriptados com AES-256 usando CALENDAR_TOKEN_SECRET
CALENDAR_TOKEN_SECRET=xxx
```

## Settings de empresa (tabela Settings)
| Key | Tipo | Descrição |
|-----|------|-----------|
| `calendarReminderDayBefore` | boolean | Lembrete 1 dia antes |
| `calendarReminder15min` | boolean | Lembrete 15min antes |

## Success Criteria
- Admin conecta Google Calendar de um profissional sem suporte técnico (< 3 cliques)
- Agente mostra todos horários disponíveis do dia em uma única resposta
- Conflito de horário é impossível (slot ocupado não é oferecido)
- Evento criado aparece no celular do profissional em < 10s
- Cliente cancela com "Não posso ir" e evento é removido automaticamente
- "Meu próximo cliente confirmou?" retorna status correto via Secretária
- Lembrete não cancela se cliente responder "talvez" (sem match claro)

## Failure Modes
- Token expirado → refresh automático antes da chamada (transparente)
- Google API offline → fallback: usa apenas Schedule do banco, avisa que calendário pode divergir
- Profissional sem calendário conectado → excluído da disponibilidade, não quebra o fluxo
- Fora do horário de trabalho → slot não oferecido mesmo se calendar está vazio
- Evento criado no banco mas falha no Google → rollback Schedule + informa agente
- Resposta ambígua ao lembrete ("talvez") → não cancela, não intercepta

## Fora do Escopo (V1)
- Outlook / Microsoft 365
- Eventos recorrentes
- Google Meet automático
- Notificações nativas do Google Calendar para o cliente
- Escolha de horário de lembrete pelo próprio cliente (V2)
