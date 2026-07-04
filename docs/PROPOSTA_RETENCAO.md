# 💎 Proposta: Módulo de Retenção & Reativação

> **Objetivo:** transformar o CRM Otron em uma máquina de fidelização que detecta automaticamente clientes em risco de evasão e gera ações de reativação.
> **Público alvo principal:** barbearias, salões de beleza, clínicas estéticas, oficinas, pet shops, dentistas — qualquer negócio com **serviços recorrentes**.

---

## 📊 Os 3 problemas que vamos resolver

| Problema | Custo invisível | Solução proposta |
|---|---|---|
| Cliente recorrente "some" sem avisar | Você perde ~30% da base/ano sem nem perceber | **Detecção de Adormecidos** com painel + IA |
| Aniversários passam batido ou viram spam genérico | Mensagem fria → 5% de conversão | **Aniversário Inteligente** com cupom rastreável |
| Falta visibilidade de quem vale a pena reativar | Manda promoção pra base inteira → ROI baixo | **Segmentação RFM automática** com 7 grupos comerciais |

---

## 🎯 FEATURE 1 — Detecção de Clientes Adormecidos

### Como funciona (algoritmo)

Para cada contato com **3+ atendimentos finalizados**, calculamos:

```
intervalo_medio = média dos intervalos entre as últimas 5 visitas
dias_desde_ultima = hoje - data da última visita
razao = dias_desde_ultima / intervalo_medio
```

Classificação:

| Status | Razão | Cor | Significado |
|---|---|---|---|
| 🟢 **Em dia** | < 0,8 | verde | Ainda dentro do ciclo normal |
| 🟡 **Quase na hora** | 0,8 - 1,2 | amarelo | Próximo do retorno previsto |
| 🟠 **Atrasado** | 1,2 - 2,0 | laranja | Já passou do esperado |
| 🔴 **Adormecido** | 2,0 - 4,0 | vermelho | Cliente em risco real |
| ⚫ **Perdido** | > 4,0 | cinza | Provavelmente foi pra concorrência |

**Exemplo real (barbearia):**
- Marcelo vem dia 1, 30, 62, 90 → intervalo médio = 30 dias
- Hoje é dia 130 → faz 40 dias desde a última visita
- Razão = 40/30 = 1,33 → **🟠 Atrasado**

### O que o sistema faz automaticamente

1. **Cron diário às 8h** roda o scan na base inteira
2. Atualiza o status de cada cliente
3. Gera **alertas** no painel: "Você tem 12 novos clientes adormecidos hoje"
4. **Opcional**: IA pode disparar mensagem automática (se você autorizar por segmento)

### Painel visual

```
┌─ Reativação ──────────────────────────────────────────────────┐
│                                                                 │
│  📊 Visão Geral                       Filtrar: [Todos serviços]│
│  ┌─────┬─────┬─────┬─────┬─────┐                              │
│  │ 234 │  47 │  28 │  19 │  12 │                              │
│  │ 🟢  │ 🟡  │ 🟠  │ 🔴  │ ⚫  │                              │
│  │ Em  │Hora │Atras│Adorm│Perd │                              │
│  │ dia │     │ado  │ecido│ido  │                              │
│  └─────┴─────┴─────┴─────┴─────┘                              │
│                                                                 │
│  🎯 Ação prioritária: 19 adormecidos com alto valor LTV       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Cliente      │ Última  │ Intv  │ Status │ Ações         │  │
│  ├──────────────┼─────────┼───────┼────────┼───────────────┤  │
│  │ Maria Silva  │ 67 dias │ 30 d  │ 🔴 Adm │ [💬][🤖][⏭️] │  │
│  │ João Souza   │ 45 dias │ 21 d  │ 🟠 Atr │ [💬][🤖][⏭️] │  │
│  │ Ana Costa    │ 90 dias │ 28 d  │ 🔴 Adm │ [💬][🤖][⏭️] │  │
│  └──────────────┴─────────┴───────┴────────┴───────────────┘  │
│                                                                 │
│  💬 Enviar manual  🤖 Aprovar IA  ⏭️ Adiar 30 dias            │
└─────────────────────────────────────────────────────────────────┘
```

### Templates de mensagem de reativação

Pré-prontos, customizáveis, com variáveis:

**Soft (atrasado 1,2-2,0):**
> Oi {{nome}}! 👋 Faz {{dias}} dias que você não passa por aqui. Tá tudo bem? Quer que eu já reserve um horário pra essa semana?

**Médio (adormecido 2,0-4,0) — com cupom:**
> {{nome}}, sentimos sua falta! Reservei aqui um cupom de 15% só pra você: **{{cupom}}** (válido até {{validade}}). Bora marcar?

**Win-back (perdido >4,0) — última tentativa:**
> Oi {{nome}}, há mais de {{meses}} meses não nos vemos. Houve algo que não te agradou? Adoraríamos te ouvir e fazer diferente. 💜

---

## 🎂 FEATURE 2 — Aniversário Inteligente

### O que já existe vs. o que vai ter

| Hoje (Whaticket original) | Nova versão |
|---|---|
| Mensagem genérica enviada no dia | Mensagem **3 dias antes** (pra cliente agendar) |
| Sem cupom | **Cupom único rastreável** auto-gerado |
| Sem follow-up | **3 toques:** 3 dias antes → no dia → 7 dias depois |
| Sem tracking de conversão | Dashboard de **redenção de cupons** |
| Texto puro | Suporta **carteirinha visual** (imagem com nome do cliente) |

### Fluxo automatizado

```
[D-3]  → "Falta pouco pro seu aniversário, {{nome}}! 🎉
          Tenho um presente esperando você: cupom ANIVER-MARIA-7H2K"

[D-0]  → "🎂 Parabéns, {{nome}}! Que seu dia seja incrível!
          Lembrete: cupom ANIVER-MARIA-7H2K vale até {{validade}}"

[D+7]  → "Oi {{nome}}! Seu cupom de aniversário expira em 3 dias.
          Quer aproveitar? Já reservei {{horario_sugerido}} pra você"
```

### Geração de cupom

Formato: `ANIVER-{{primeiroNome}}-{{4_chars_aleatorios}}`
- Único por cliente, único por ano
- Validade: 30 dias após o aniversário
- Desconto: configurável (padrão 15%)
- Uso: marcado como "redimido" quando atendente ou IA confirma uso

### Painel de aniversários

```
┌─ Aniversários ────────────────────────────────────────────────┐
│                                                                 │
│  📅 Próximos 30 dias: 47 aniversariantes                       │
│                                                                 │
│  Performance último ciclo:                                      │
│  ├─ Mensagens enviadas:  127                                   │
│  ├─ Cupons gerados:      127                                   │
│  ├─ Cupons usados:       38 (29,9% de conversão) ✅            │
│  └─ Receita gerada:      R$ 2.840                              │
│                                                                 │
│  ┌─ Hoje ─────────────────────────────────────────────────┐   │
│  │ 🎂 Maria Silva   │ ANIVER-MARIA-7H2K │ enviado ✓      │   │
│  │ 🎂 João Santos   │ ANIVER-JOAO-K3M2  │ pendente       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🏆 FEATURE 3 — Funções de Retenção do Mercado (6 propostas)

### 3.A — Lembrete Preventivo (antes de virar adormecido)

**Conceito:** mandar mensagem ANTES do cliente esquecer.

Quando 80% do intervalo médio passar, dispara:
> "Oi {{nome}}, faz {{dias}} dias do seu último corte. Que tal já marcar pra próxima semana?"

**Diferença para a Feature 1:** ali agimos quando JÁ perdemos o ritmo. Aqui agimos ANTES de perder.

**ROI esperado:** muito alto. Cliente em ritmo é mais barato que cliente perdido.

---

### 3.B — Cross-sell por Padrão de Uso

**Conceito:** baseado no histórico de serviços, oferta complementares.

Exemplo barbearia:
- Cliente sempre pede só "corte" → após 3ª visita, IA oferece "tal dia experimenta a barba também?"
- Cliente faz corte+barba → ofertar "sobrancelha"

Exemplo salão:
- Cliente faz só unha → ofertar "depilação"
- Cliente faz cabelo → ofertar "hidratação"

**Como funciona:** etiquetas por serviço. Sistema sabe o que cada um faz/não faz. Sugestão automática no painel do atendente quando o cliente abre chat.

---

### 3.C — Programa de Fidelidade Automático

**Conceito:** "a cada 10 visitas, 1 grátis" (configurável).

Sistema conta visitas no banco. Quando atinge a meta:
> "{{nome}}, você completou 10 visitas! 🏆 Seu próximo corte é por nossa conta. Use o cupom FIDELIDADE-{{cupom}}"

**Painel mostra:**
- Cliente | Visitas no ciclo | Próximo prêmio | Progresso

Mensagens automáticas:
- A cada 3 visitas: "você está a 7 do prêmio!"
- Na 9ª: "Falta UMA visita pra ganhar seu corte grátis!"

---

### 3.D — Indicação Premiada (Referral)

**Conceito:** cliente compartilha link único, ganha quando alguém vem por ele.

Funcionamento:
1. Cliente recebe `https://crm.seudominio/conv/MARIA-2VFR`
2. Esse link abre um chat já identificando "veio pela Maria"
3. Quando o novo cliente FECHA primeira venda, Maria ganha cupom

Painel:
```
Top indicadores este mês:
1. Maria Silva — 4 indicações (R$ 380 gerados)
2. João Santos — 2 indicações
```

---

### 3.E — Segmentação RFM Automática (a peça mais poderosa)

**Conceito de mercado:** todo cliente cai em 1 de 11 segmentos baseado em:
- **R**ecency: quão recente foi a última compra
- **F**requency: quantas vezes comprou
- **M**onetary: quanto gastou no total

O sistema classifica TODO mundo automaticamente em:

| Segmento | Quem é | Ação ideal |
|---|---|---|
| 🏆 **Campeões** | Recente + frequente + alto valor | Programa VIP, brindes |
| 💎 **Leais** | Frequente + alto valor | Manutenção, cross-sell |
| 🌱 **Promissores** | Recente + médio valor | Incentivar 2ª compra |
| 😟 **Em risco** | Era leal mas sumiu | Reativação urgente |
| 🆘 **Não podem perder** | Alto valor, longe | Atendimento VIP de win-back |
| 💤 **Hibernando** | Pouca frequência, valor baixo | Cupom genérico |
| 👋 **Perdidos** | Sumiram há muito | Última tentativa ou arquivar |

**Visual:** bolhas coloridas (cada segmento é um quadrante de um gráfico R×F).

---

### 3.F — Win-back Imediato Pós-Cancelamento

**Conceito:** cliente cancela agendamento → sistema age **imediatamente**.

Não esperar virar adormecido. No momento do cancelamento:
> "Sem problema, {{nome}}! Quer já reagendar pra outro dia? Tenho horário {{sugestao_1}} ou {{sugestao_2}}"

Se cliente não responde em 24h:
> "Tudo bem por aí? Se preferir não vir mais, me avisa que eu não te chateio mais. 😊"

Isso PARECE pequeno mas reduz churn em ~15%.

---

## 🏗️ Arquitetura técnica recomendada

### Backend
```
backend/src/
├── services/
│   └── RetentionService/
│       ├── DormantDetectionService.ts   ← Feature 1
│       ├── BirthdayService.ts            ← Feature 2
│       ├── CouponService.ts              ← gera + valida cupons
│       ├── RFMAnalysisService.ts         ← Feature 3.E
│       ├── PreventiveReminderService.ts  ← Feature 3.A
│       ├── LoyaltyProgramService.ts      ← Feature 3.C
│       ├── ReferralService.ts            ← Feature 3.D
│       └── WinbackService.ts             ← Feature 3.F
├── jobs/
│   ├── dormantScan.cron.ts          ← roda 8h diário
│   ├── birthdayScan.cron.ts         ← roda 9h diário
│   ├── preventiveReminder.cron.ts   ← roda 10h diário
│   └── rfmRecalculate.cron.ts       ← roda 2h domingo
├── models/
│   ├── Coupon.ts                    ← novo
│   ├── CustomerSegment.ts           ← novo (cache do RFM)
│   ├── ServiceHistory.ts            ← novo (track de serviços por contato)
│   └── ReferralCode.ts              ← novo
└── controllers/
    └── RetentionController.ts       ← novo endpoint
```

### Frontend
```
frontend/src/pages/
└── Retencao/
    ├── index.js                     ← container com Tabs
    ├── tabs/
    │   ├── Dormentes.js             ← Feature 1
    │   ├── Aniversarios.js          ← Feature 2
    │   ├── Cupons.js                ← gestão de todos os cupons
    │   ├── SegmentosRFM.js          ← Feature 3.E
    │   ├── Fidelidade.js            ← Feature 3.C
    │   └── Indicacoes.js            ← Feature 3.D
    └── components/
        ├── CustomerCard.js          ← card de cliente com ações
        ├── SegmentBubble.js         ← bolhas RFM
        └── CouponPreview.js
```

### IA — novas tools para o agente
```typescript
// backend/src/services/SecretaryService/tools/retention.ts
relatorioReativacao(filtro)         // lista clientes pra reativar
enviarMensagemReativacao(contactId, template, cupomId?)
gerarCupom(contactId, motivo, desconto, validade)
consultarStatusCliente(contactId)   // retorna: status, ultima_visita, intervalo_medio
```

### Sidebar — novo item

```
GESTÃO
├─ Dashboard
├─ Relatórios
├─ 💎 Retenção         ← NOVO
└─ Etiquetas
```

---

## 📅 Plano de implementação faseado

### Fase 1 — Fundação (2-3 semanas)
- Model `ServiceHistory` (track serviços por contato)
- Model `Coupon` (geração e validação)
- `DormantDetectionService` + cron + painel básico de adormecidos
- Cupom mínimo (gerar + marcar como usado manualmente)

### Fase 2 — Aniversários inteligentes (1 semana)
- Refactor do `birthdayReminder` existente
- 3 toques (D-3, D-0, D+7) com cupom rastreável
- Dashboard de conversão

### Fase 3 — Automações avançadas (3-4 semanas)
- Lembrete preventivo (3.A)
- Programa de fidelidade (3.C)
- Win-back pós-cancelamento (3.F)

### Fase 4 — Analytics profundo (2-3 semanas)
- RFM automático com 7 segmentos (3.E)
- Cross-sell suggestions (3.B)
- Programa de indicação (3.D)

### Total estimado: 8-10 semanas para o módulo completo

---

## 💡 Recomendação: o que construir primeiro

**Se eu fosse priorizar para uma barbearia/salão começando agora:**

1. **Fase 1 + Fase 2** primeiro (4 semanas) → impacto IMEDIATO no churn
2. **Fase 3** depois (4 semanas) → potencializa o que foi feito
3. **Fase 4** por último (3 semanas) → polimento e análise

**Por que essa ordem:**
- Fase 1 já te dá lista de "quem reativar HOJE" — você ganha receita na primeira semana
- Fase 2 é low-effort, high-impact (você já tem aniversário, só precisa melhorar)
- Fase 3 são automações que rodam sozinhas — escalam sem esforço
- Fase 4 é "nice to have" — bonito mas não-essencial até a base estar grande

---

## 🤖 Como a IA Secretária entra nisso

Hoje a IA atende mensagens recebidas. Com este módulo, ela ganha **iniciativa**:

```
[Operador no painel de Adormecidos]
  ↓
"Aprovar disparo IA para os 12 adormecidos com LTV > R$ 500"
  ↓
[IA recebe lista + template]
  ↓
Para cada cliente:
  1. Lê histórico do contato (últimos chats, preferências)
  2. Personaliza a mensagem (tom, referência ao último serviço)
  3. Envia
  4. Aguarda resposta
  5. Se responder → entra em modo conversação normal (agendamento)
  6. Se não responder em 48h → marca como "tentativa sem retorno"
```

**Você sempre controla:** nenhum disparo automático sem aprovação do operador (na primeira versão). Depois pode liberar "disparo livre" por segmento.

---

## ⚠️ Considerações importantes

### LGPD
- Cliente precisa ter dado opt-in pra receber comunicação de marketing
- Sistema deve respeitar "não me mande mais" (botão de descadastrar)
- Logs de auditoria de todos disparos automáticos

### Anti-spam WhatsApp
- Limite de mensagens automáticas por dia (ex: máx 50)
- Intervalos randômicos entre disparos (mesmo padrão de campanhas)
- Mensagens personalizadas (não copia-cola idênticas) — IA varia naturalmente

### Custos da IA
- Cada disparo de reativação consome ~500 tokens (mensagem + contexto)
- 1000 reativações/mês com Claude Haiku ≈ R$ 15
- 1000 reativações/mês com Claude Sonnet ≈ R$ 80

---

**Versão deste documento:** 1.0 — 2026-05-18
