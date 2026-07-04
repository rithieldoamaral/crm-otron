# Diretiva — Módulo de Retenção & Reativação

> **Status:** Em implementação (Fase 1)
> **Documento de referência:** `docs/PROPOSTA_RETENCAO.md` (visão de produto)
> **Última atualização:** 2026-05-18

---

## 1. Objetivo

Construir um módulo de retenção e reativação que detecta automaticamente clientes em risco de evasão, gera cupons rastreáveis e permite reativação assistida por IA (sempre com aprovação humana).

## 2. Success Criteria

- ✅ Sistema detecta clientes adormecidos com base em histórico real de serviços
- ✅ Tickets de agendamento são auto-fechados após 60 min do horário marcado (se sem interação recente)
- ✅ Atendente pode marcar uma etiqueta do Kanban como "Venda Concluída" → fechar ticket nessa etiqueta conta como serviço
- ✅ Cupons únicos podem ser gerados, rastreados e marcados como usados
- ✅ Painel de Retenção mostra cards de ação (Adormecidos / Aniversários / Cupons / RFM / Fidelidade / Indicações)
- ✅ IA tem novas tools para reativação (acionadas só após operador aprovar)
- ✅ LGPD: opt-out funcional, logs de auditoria de todos disparos

## 3. Failure Modes (o que NÃO pode acontecer)

- ❌ Fechar ticket no meio de uma conversa ativa (com mensagens dos últimos 15 min)
- ❌ Disparar mensagem sem aprovação explícita do operador (na v1)
- ❌ Gerar cupom duplicado para o mesmo cliente no mesmo evento
- ❌ Reativar cliente que pediu opt-out
- ❌ Spam: mais de 1 reativação por cliente em janela de 30 dias

---

## 4. Decisões arquiteturais consolidadas

| # | Decisão | Confirmada em |
|---|---|---|
| 1 | Escopo: Módulo completo (Fases 1-4) | 2026-05-18 |
| 2 | IA dispatches: sempre com aprovação humana (v1) | 2026-05-18 |
| 3 | Funil de venda: reaproveitar Kanban existente (etiqueta marcada como "completion") | 2026-05-18 |
| 4 | Auto-close de agendamento: 60 min após horário marcado | 2026-05-18 |
| 5 | Não fechar se interação nos últimos 15 min — reagendar check para +30 min | 2026-05-18 |
| 6 | Service tracking híbrido: agendamento confirmado OR ticket → tag completion | 2026-05-18 |

---

## 5. Modelo de dados (Fase 1)

### 5.1 — Nova tabela `ServiceHistories`

Registra cada "visita/serviço realizado" do cliente. Fonte de verdade para cálculo de adormecidos, RFM, fidelidade.

```sql
CREATE TABLE "ServiceHistories" (
  id                SERIAL PRIMARY KEY,
  contactId         INTEGER NOT NULL REFERENCES "Contacts"(id) ON DELETE CASCADE,
  ticketId          INTEGER REFERENCES "Tickets"(id) ON DELETE SET NULL,
  companyId         INTEGER NOT NULL REFERENCES "Companies"(id) ON DELETE CASCADE,
  scheduleId        INTEGER REFERENCES "Schedules"(id) ON DELETE SET NULL,
  source            VARCHAR(20) NOT NULL,    -- 'scheduled_autoclose' | 'kanban_completion' | 'manual'
  serviceType       VARCHAR(80),             -- opcional: 'corte', 'barba', 'pintura' (vem de tags ou input)
  value             DECIMAL(10,2),           -- opcional: valor da venda
  occurredAt        TIMESTAMP NOT NULL,      -- data do serviço (não do registro)
  createdAt         TIMESTAMP DEFAULT NOW(),
  updatedAt         TIMESTAMP DEFAULT NOW(),

  -- índices para queries de adormecidos serem rápidas
  INDEX (contactId, occurredAt DESC),
  INDEX (companyId, occurredAt DESC)
);
```

### 5.2 — Nova tabela `Coupons`

```sql
CREATE TABLE "Coupons" (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(40) UNIQUE NOT NULL,    -- ex: ANIVER-MARIA-7H2K
  contactId       INTEGER REFERENCES "Contacts"(id) ON DELETE SET NULL,
  companyId       INTEGER NOT NULL REFERENCES "Companies"(id) ON DELETE CASCADE,
  reason          VARCHAR(40) NOT NULL,           -- 'birthday' | 'reactivation' | 'loyalty' | 'referral' | 'manual'
  discountType    VARCHAR(10) NOT NULL,           -- 'percent' | 'fixed' | 'free_service'
  discountValue   DECIMAL(10,2) NOT NULL,
  validFrom       TIMESTAMP NOT NULL,
  validUntil      TIMESTAMP NOT NULL,
  redeemedAt      TIMESTAMP,                       -- NULL = ainda não usado
  redeemedBy      INTEGER REFERENCES "Users"(id), -- atendente que confirmou
  createdAt       TIMESTAMP DEFAULT NOW(),
  updatedAt       TIMESTAMP DEFAULT NOW(),

  INDEX (contactId, validUntil),
  INDEX (companyId, redeemedAt)
);
```

### 5.3 — Alteração em `Tags`

Adicionar flag para marcar a etiqueta que representa "Venda Concluída" no Kanban:

```sql
ALTER TABLE "Tags" ADD COLUMN "isCompletionTag" BOOLEAN DEFAULT false;

-- Constraint: apenas 1 tag por empresa pode ter isCompletionTag = true
CREATE UNIQUE INDEX tags_completion_per_company
  ON "Tags" (companyId)
  WHERE "isCompletionTag" = true;
```

### 5.4 — Novas configurações da empresa (table `Settings`)

Inseridas como rows na tabela `Settings` existente (chave/valor por companyId):

```
key: 'retention.autoCloseMinutes'    valor padrão: '60'
key: 'retention.inactivityWindow'    valor padrão: '15'   (minutos)
key: 'retention.dormantMultiplier'   valor padrão: '2'    (X intervalo médio = adormecido)
key: 'retention.minServicesForDetection' valor padrão: '3' (precisa N serviços p/ calcular)
key: 'retention.optOutEnabled'       valor padrão: 'enabled'
```

### 5.5 — Alteração em `Contacts`

Adicionar campos para opt-out de marketing:

```sql
ALTER TABLE "Contacts" ADD COLUMN "marketingOptOut" BOOLEAN DEFAULT false;
ALTER TABLE "Contacts" ADD COLUMN "marketingOptOutAt" TIMESTAMP;
ALTER TABLE "Contacts" ADD COLUMN "marketingOptOutReason" VARCHAR(255);
```

---

## 6. Lógica de auto-close de agendamentos

### Fluxo (cron a cada 5 minutos)

```typescript
// backend/src/jobs/autoCloseScheduledTickets.ts

EVERY 5 minutes:
  Buscar Schedules onde:
    - sendAt <= NOW() - autoCloseMinutes  // padrão 60 min
    - openTicket = true (criou ticket)
    - ticketId não nulo
    - Ticket.status = 'open' OU 'pending'

  Para cada schedule:
    ticket = Ticket.findByPk(schedule.ticketId)
    lastMsg = Message.findOne({ ticketId, order: createdAt DESC })

    IF lastMsg.createdAt > NOW() - inactivityWindow:  // 15 min de tolerância
      // Cliente ainda está conversando — pular
      schedule.nextAutoCloseCheck = NOW() + 30 min
      continue

    // Pode fechar:
    await UpdateTicketService(ticket, { status: 'closed' })

    // Registra serviço
    await ServiceHistoryService.record({
      contactId: ticket.contactId,
      ticketId: ticket.id,
      companyId: ticket.companyId,
      scheduleId: schedule.id,
      source: 'scheduled_autoclose',
      occurredAt: schedule.sendAt,  // usa a data ORIGINAL do agendamento
    })

    logger.info('Auto-closed scheduled ticket', { ticketId, scheduleId })
```

### Edge cases tratados

- **Sem ticket associado**: ignora (não tem o que fechar)
- **Ticket já fechado**: ignora (não duplica ServiceHistory — verificar antes)
- **Mensagem nos últimos 15 min**: reagenda check
- **Cliente respondeu fora do horário**: tudo bem, atendente vai fechar manualmente depois
- **Agendamento recorrente**: a regra se aplica para cada ocorrência individual

---

## 7. Lógica do Kanban → ServiceHistory

### Hook no movimento de tag

Quando um Ticket recebe a tag marcada como `isCompletionTag`:

```typescript
// Hook em UpdateTicketTagsService ou similar

afterTicketTagUpdate(ticket, newTags) {
  const completionTag = newTags.find(t => t.isCompletionTag)

  if (completionTag) {
    // 1. Verificar se já não foi registrado (idempotência)
    const existing = await ServiceHistory.findOne({
      where: { ticketId: ticket.id, source: 'kanban_completion' }
    })
    if (existing) return

    // 2. Registrar
    await ServiceHistoryService.record({
      contactId: ticket.contactId,
      ticketId: ticket.id,
      companyId: ticket.companyId,
      source: 'kanban_completion',
      occurredAt: NOW(),
      // valor e serviceType vêm de campos opcionais que atendente pode preencher
    })

    // 3. Fechar ticket automaticamente
    await UpdateTicketService(ticket, { status: 'closed' })
  }
}
```

### UI: marcar uma tag como "completion"

Na página `/tags`, adicionar:
- Toggle "Marcar como etiqueta de Venda Concluída" no modal de edição
- Indicador visual na lista: ⭐ na linha da tag completion
- Apenas 1 tag por empresa pode ter o toggle (constraint do banco)
- Quando atendente arrasta ticket pra essa coluna no Kanban → fecha automático

---

## 8. Algoritmo de detecção de adormecidos

```typescript
// backend/src/services/RetentionService/DormantDetectionService.ts

interface DormantStatus {
  contactId: number
  status: 'em_dia' | 'quase_na_hora' | 'atrasado' | 'adormecido' | 'perdido' | 'novo'
  daysSinceLastService: number
  averageInterval: number  // dias
  ratio: number  // daysSince / averageInterval
  totalServices: number
}

async function calculateStatus(contactId, companyId): Promise<DormantStatus> {
  const services = await ServiceHistory.findAll({
    where: { contactId, companyId },
    order: [['occurredAt', 'DESC']],
    limit: 6  // últimas 6 ocorrências
  })

  if (services.length < 3) {
    return { status: 'novo', totalServices: services.length, ... }
  }

  // Calcula intervalos entre as últimas 5 ocorrências
  const intervals = []
  for (let i = 0; i < Math.min(5, services.length - 1); i++) {
    const days = daysBetween(services[i].occurredAt, services[i+1].occurredAt)
    intervals.push(days)
  }
  const averageInterval = mean(intervals)

  const daysSinceLastService = daysBetween(NOW(), services[0].occurredAt)
  const ratio = daysSinceLastService / averageInterval

  let status
  if (ratio < 0.8) status = 'em_dia'
  else if (ratio < 1.2) status = 'quase_na_hora'
  else if (ratio < 2.0) status = 'atrasado'
  else if (ratio < 4.0) status = 'adormecido'
  else status = 'perdido'

  return { contactId, status, daysSinceLastService, averageInterval, ratio, totalServices: services.length }
}
```

### Cron de scan diário

```typescript
// backend/src/jobs/dormantScan.cron.ts — roda às 8h diariamente

EVERY DAY at 08:00:
  Para cada empresa ativa:
    contatos = Contact.findAll({ companyId, marketingOptOut: false })
    Para cada contato:
      status = await calculateStatus(contato.id, companyId)
      // Cacheia em CustomerSegment para queries rápidas na UI
      await CustomerSegment.upsert({ contactId, dormantStatus: status.status, ... })

    // Notifica admin se há novos adormecidos
    novos = await contar novos adormecidos hoje
    if (novos > 0) {
      criar notificação no painel: "X novos clientes adormecidos hoje"
    }
```

---

## 9. UI — Painel `/retencao`

### Sidebar (atualizar)

```
GESTÃO
├─ Dashboard
├─ Relatórios
├─ 💎 Retenção         ← NOVO
└─ Etiquetas
```

### Estrutura da página

```
/retencao
├── Aba "Adormecidos"   ← Fase 1
├── Aba "Cupons"         ← Fase 1
├── Aba "Aniversários"   ← Fase 2
├── Aba "Fidelidade"     ← Fase 3
├── Aba "Win-back"       ← Fase 3
├── Aba "Indicações"     ← Fase 4
└── Aba "RFM"            ← Fase 4
```

### Aba Adormecidos (mockup textual)

```
┌─ Reativação > Adormecidos ──────────────────────────────────┐
│                                                              │
│  Filtros: [Período: 30d] [Serviço: Todos] [Min visitas: 3]  │
│                                                              │
│  📊 Visão geral                                              │
│  ┌─────┬─────┬─────┬─────┬─────┐                            │
│  │ 234 │ 47  │ 28  │ 19  │ 12  │                            │
│  │ 🟢  │ 🟡  │ 🟠  │ 🔴  │ ⚫  │                            │
│  └─────┴─────┴─────┴─────┴─────┘                            │
│  Em dia | Quase | Atrasado | Adormecido | Perdido           │
│                                                              │
│  🎯 19 adormecidos com 3+ visitas no histórico              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ☐ │ Cliente    │ Última  │ Intv. │ Status │ Ações     │ │
│  ├───┼────────────┼─────────┼───────┼────────┼───────────┤ │
│  │ ☐ │ Maria S.   │ 67 dias │ 30 d  │ 🔴 Adm │ 💬 🤖 ⏭️ │ │
│  │ ☐ │ João S.    │ 45 dias │ 21 d  │ 🟠 Atr │ 💬 🤖 ⏭️ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [☑ Selecionar todos]  [🤖 Aprovar IA p/ selecionados]      │
└──────────────────────────────────────────────────────────────┘
```

### Ações nos cards

| Botão | Ação |
|---|---|
| 💬 Mensagem manual | Abre modal com template editável → envia direto via WhatsApp |
| 🤖 Aprovar IA | Marca contato para IA disparar (próximo cron de envio) |
| ⏭️ Adiar | Esconde da lista por 30 dias |
| 🗑️ Opt-out | Marca `marketingOptOut = true` (não aparece mais) |

---

## 10. Fases — escopo de cada uma

### 🏗️ Fase 1 — Fundação (semana 1-3) — EM PROGRESSO

**Backend:**
- [x] Documento de diretiva (este)
- [ ] Migration: criar `ServiceHistories`
- [ ] Migration: criar `Coupons`
- [ ] Migration: adicionar `isCompletionTag` em Tags
- [ ] Migration: adicionar campos opt-out em Contacts
- [ ] Migration: seed retention.* settings padrão
- [ ] Model: ServiceHistory + testes
- [ ] Model: Coupon + testes
- [ ] Model: Tag (update) + testes
- [ ] Service: ServiceHistoryService (record / list / queryByContact) + testes
- [ ] Service: AutoCloseScheduledService + testes (mock de Schedule + Message)
- [ ] Service: DormantDetectionService + testes (input fictícios)
- [ ] Service: CouponService (generate / redeem / validate) + testes
- [ ] Cron: `autoCloseScheduledTickets.ts` (a cada 5 min)
- [ ] Cron: `dormantScan.ts` (diário às 8h)
- [ ] Hook: ao mudar tag de ticket para completionTag, fechar + criar ServiceHistory
- [ ] Endpoint: `GET /retention/dormant?status=adormecido&companyId=X`
- [ ] Endpoint: `POST /retention/dormant/:id/coupon` (gera cupom para 1 contato)
- [ ] Endpoint: `POST /retention/dormant/bulk-approve` (autoriza IA p/ N contatos)
- [ ] Endpoint: `POST /coupons/redeem` (marca como usado)

**Frontend:**
- [ ] Sidebar: adicionar item "💎 Retenção" em GESTÃO
- [ ] Página: `/retencao` com tabs (Adormecidos, Cupons placeholder)
- [ ] Tab Adormecidos: cards de visão geral + tabela + ações
- [ ] Tab Cupons: lista de cupons gerados, filtro por status
- [ ] Página /tags: toggle "Marcar como Venda Concluída"
- [ ] Modal: "Enviar mensagem de reativação" com template + cupom opcional

### 🎂 Fase 2 — Aniversário Inteligente (semana 4) — PRÓXIMA

- [ ] Refactor do `birthdayReminder` existente
- [ ] 3 toques: D-3 (cron 8h), D-0 (cron 9h), D+7 (cron 10h)
- [ ] Geração automática de cupom para cada aniversariante
- [ ] Template "carteirinha visual" (imagem com nome)
- [ ] Aba "Aniversários" em /retencao com métricas de conversão
- [ ] Janela de redenção: 30 dias

### ⚡ Fase 3 — Automações avançadas (semana 5-8)

- [ ] Lembrete preventivo (3.A) — cron diário verificando 80% do intervalo
- [ ] Programa de fidelidade (3.C) — contador automático de visitas
- [ ] Win-back imediato (3.F) — hook no cancelamento de agendamento

### 📊 Fase 4 — Analytics (semana 9-10)

- [ ] RFM Analysis (3.E) — segmentação em 7 grupos
- [ ] Cross-sell suggestions (3.B) — análise de tags por contato
- [ ] Indicação premiada (3.D) — links únicos + tracking

---

## 11. Integração com o Agente IA

### Novas tools no SecretaryService

```typescript
// backend/src/services/SecretaryService/tools/retention.ts

// Tool 1: Consultar status do cliente
async function consultarStatusRetencao(args: { contactId: number }) {
  const status = await DormantDetectionService.calculateStatus(contactId)
  return {
    status: status.status,
    daysSinceLastService: status.daysSinceLastService,
    averageInterval: status.averageInterval,
    suggestion: ratio > 2 ? 'Cliente adormecido — considere enviar cupom' : null
  }
}

// Tool 2: Gerar cupom para um cliente (só se autorizada pelo operador)
async function gerarCupomReativacao(args: { contactId: number, discount: number, validDays: number }) {
  // Verifica se há autorização do operador para este cliente
  const auth = await RetentionAuthorization.findOne({ contactId, status: 'approved' })
  if (!auth) throw new Error('Operador não autorizou disparo para este cliente')

  return await CouponService.generate({
    contactId,
    reason: 'reactivation',
    discountType: 'percent',
    discountValue: args.discount,
    validDays: args.validDays,
  })
}
```

### Fluxo de autorização

```
Operador clica "🤖 Aprovar IA" no card do cliente Maria
  ↓
Cria registro: RetentionAuthorization { contactId: Maria, status: 'approved', expiresAt: +24h }
  ↓
Cron de envio (roda 4 vezes ao dia) pega aprovações pendentes
  ↓
Para cada uma:
  - IA gera mensagem personalizada (com histórico do contato)
  - Envia via WhatsApp
  - Marca autorização como 'sent'
  - Loga em audit_log
```

---

## 12. LGPD & Auditoria

### Opt-out

- Campo `marketingOptOut` em Contacts (já adicionado no schema)
- Cliente pode pedir opt-out via mensagem ("não me mande mais", "parar")
- Sistema detecta e marca automaticamente (palavra-chave configurável)
- UI: botão "🗑️ Opt-out" nos cards de retenção
- Contatos com opt-out SAEM de todas as queries de retenção

### Auditoria

Todos os disparos de retenção são logados em `audit_log`:

```json
{
  "action": "retention.message_sent",
  "userId": 42,
  "contactId": 100,
  "type": "reactivation",
  "couponId": 7,
  "method": "manual" | "ai_approved" | "automatic",
  "timestamp": "2026-05-18T10:30:00Z"
}
```

---

## 13. Testes (TDD obrigatório — CLAUDE.md §II.1)

### Cobertura mínima por componente

| Componente | Testes obrigatórios |
|---|---|
| `ServiceHistory.ts` | Criar registro, listar por contato, query por janela de tempo |
| `Coupon.ts` | Gerar com código único, validar expiração, redimir, prevenir double-redeem |
| `DormantDetectionService` | Status correto para cada faixa de ratio (em_dia, atrasado, adormecido, perdido), edge case com < 3 serviços |
| `AutoCloseScheduledService` | Fecha ticket atrasado, NÃO fecha se conversa ativa, idempotência |
| `CouponService.generate` | Código único, sem colisão, formato correto |
| Endpoints `/retention/*` | Auth required, filtros funcionam, paginação |

### Estrutura de teste

```
backend/src/services/RetentionService/__tests__/
├── DormantDetectionService.spec.ts
├── AutoCloseScheduledService.spec.ts
├── CouponService.spec.ts
└── ServiceHistoryService.spec.ts
```

---

## 14. Plano de rollout

1. Implementar Fase 1 completa
2. Testar em staging com dados sintéticos por 3 dias
3. Migrar dados existentes:
   - Para cada Ticket fechado nos últimos 90 dias, criar ServiceHistory retroativo
   - Source = 'migration' (novo enum)
4. Subir em produção em horário de baixo movimento
5. Monitorar cron jobs por 7 dias
6. Iniciar Fase 2 após estabilização

---

## 15. Próximas perguntas (para Fase 2+)

- Templates de mensagem: usar i18n ou texto livre por empresa?
- Cupons: precisam ser sincronizados com sistema fiscal/PDV?
- RFM: pesos (R/F/M) iguais ou configurável por empresa?
- Indicação: cupom para indicador VÁLIDO antes ou depois do 1º atendimento?

---

**Status atual:** Fase 1 iniciando — próximo passo: migrations + models + testes.
