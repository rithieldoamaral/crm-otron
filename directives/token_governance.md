# Diretiva: Governança de Tokens e Créditos (módulo superadmin)

## Objetivo

Dar ao superadmin visibilidade confiável do consumo de LLM por empresa — quanto
cada cliente custa, em que modelo, e quanto custa cada atendimento — e a
infraestrutura de créditos para eventualmente repassar esse custo.

**Não-objetivo nesta fase:** bloquear empresa que estoure o crédito. Ver
"Decisão de produto" abaixo.

## Contexto: por que o dado atual não serve

`AgentAction` já tem `inputTokens`/`outputTokens`, mas o registro acontece
**dentro do laço de tool calls** (`AgentService/index.ts`, `secretaryLoop.ts`):

```js
for (const toolCall of response.toolCalls) {
  await AgentAction.create({ ..., inputTokens: response.usage?.inputTokens })
}
```

| Cenário | Efeito |
|---|---|
| Turno com N tool calls | N linhas, cada uma com o consumo **inteiro** do turno → conta N× |
| Turno só de texto (sem tool) | Nenhuma linha → consumo **perdido** |

Num agente de atendimento a maioria dos turnos é texto puro. O somatório atual
subconta o grosso e infla o restante — não é utilizável para cobrança em
nenhuma direção. Corrigir isso é pré-requisito do módulo, não item opcional.

## Decisão de produto: medir e alertar, não bloquear

Aprovado pelo dono em 2026-08-17.

Se o crédito acabasse e o sistema bloqueasse, quem ficaria sem resposta não é o
cliente da plataforma — é **o cliente dele**, no meio de uma conversa no
WhatsApp. O agente simplesmente emudece. Numa plataforma de atendimento esse é
o pior modo de falha: sacrifica a reputação do cliente para proteger margem.

Portanto:

- O razão de créditos é implementado por completo (saldo, concessão, débito).
- Os alertas de 80% e 100% são implementados e ativos.
- O **bloqueio** é implementado atrás de flag `enforcementEnabled`, **desligada
  por padrão**. Ligar é decisão comercial futura, não default técnico.

## Entradas

- `AIResponse.usage` (`inputTokens`, `outputTokens`) devolvido por todo provider
- `ProviderConfig` (provider + model) da empresa
- `companyId`, `ticketId` (quando houver), origem (`agent` | `secretary` | `summary`)
- Tabela de preços por provider+modelo (USD por 1M tokens)
- Cotação USD→BRL configurável
- Markup por empresa (padrão 0 — o dono absorve o custo nesta fase)

## Saídas

- Uma linha em `TokenUsages` **por chamada ao LLM** (não por tool)
- Agregações: consumo por empresa / período / modelo, custo por atendimento
- Saldo de créditos por empresa (soma do razão)
- Alertas quando o consumo cruza os limiares

## Módulos a criar (SRP — CLAUDE.md II.4)

```
models/TokenUsage.ts              # registro append-only de consumo
models/CreditLedger.ts            # lançamentos de crédito
models/CompanyBillingSettings.ts  # markup, limiares, flag de enforcement

services/TokenGovernance/
├── modelPricing.ts        # tabela de preços + lookup; SÓ preços
├── recordTokenUsage.ts    # grava 1 linha por chamada; SÓ gravação
├── usageReports.ts        # agregações para o painel; SÓ leitura
├── creditLedger.ts        # saldo, concessão, débito; SÓ razão
└── usageAlerts.ts         # avalia limiares e notifica; SÓ alerta

controllers/TokenGovernanceController.ts
routes/tokenGovernanceRoutes.ts   # TODAS as rotas com isSuper
```

## Regras invioláveis

1. **Uma linha por chamada ao LLM.** O `recordTokenUsage` é chamado logo após o
   retorno do provider, antes de qualquer ramificação por tool call.
2. **Preço congelado no registro.** Cada linha grava o preço unitário usado.
   Nunca recalcular consumo antigo com preço de hoje — isso reescreveria
   histórico e invalidaria qualquer valor já informado ao cliente.
3. **Falha de medição nunca quebra o atendimento.** `recordTokenUsage` captura
   a própria exceção, loga com contexto (`logger.error`, nunca catch silencioso
   — II.5) e retorna. Cliente final não pode ficar sem resposta porque a
   contabilidade falhou.
4. **Saldo é soma do razão, nunca coluna mutável.** Coluna de saldo sofre lost
   update sob concorrência e apaga o rastro de como se chegou ali.
5. **Toda rota é `isSuper`.** Consumo de uma empresa é dado comercial sensível;
   nenhum cliente pode ver o de outro nem o próprio custo bruto (XV.3).
6. **`AgentAction.inputTokens` deixa de ser fonte de cobrança.** Permanece como
   contexto de auditoria por tool, documentado como não-somável.

## Edge cases

| Caso | Comportamento esperado |
|---|---|
| Provider não devolve `usage` | Grava linha com tokens 0 e `usageMissing: true`; não estima. Estimativa silenciosa vira número errado com aparência de certo. |
| Modelo desconhecido na tabela de preços | Grava consumo com preço 0 e `pricingMissing: true`; aparece no painel como "preço não cadastrado". Nunca chuta preço. |
| `finishReason === "error"` | Ainda grava: chamada que falhou pode ter consumido tokens de entrada. |
| Retry da mesma chamada | Chave de idempotência evita débito duplicado. |
| Empresa apagada | Registro permanece (histórico financeiro não some com a empresa). |
| Cotação USD→BRL ausente | Usa a última conhecida e marca a linha; não bloqueia gravação. |

## Success Criteria

- [ ] Soma de tokens de uma conversa bate com a soma de `usage` das chamadas
- [ ] Turno sem tool call gera registro (o bug principal)
- [ ] Turno com N tools gera **1** registro, não N
- [ ] Falha de gravação não interrompe a resposta ao cliente
- [ ] Painel mostra: consumo/custo por empresa, por modelo, custo por atendimento
- [ ] Saldo de créditos = soma do razão, conferido por teste com concorrência
- [ ] Rota acessada por não-super devolve 401/403
- [ ] Cobertura ≥ 80% no código novo

## Failure Modes

| Falha | Como detectar | Mitigação |
|---|---|---|
| Medição volta a duplicar | Teste que roda turno com 3 tools e espera 1 registro | Teste de regressão permanente |
| Preço desatualizado silenciosamente | Painel destaca modelos com `pricingMissing` | Revisão trimestral da tabela |
| Débito duplicado por retry | Teste de idempotência | Chave única no banco |
| Painel lento com volume | Índices em (companyId, createdAt) | Agregação por período, nunca varredura completa |

## Alavanca que o módulo deve tornar visível

O maior custo desta arquitetura é o system prompt + definições de tools
reenviados a cada turno (~4.000 dos ~22.000 tokens de entrada por conversa).
Anthropic e DeepSeek descontam esse prefixo repetido via prompt caching, que
**não está em uso hoje**. Por isso o registro separa `cachedInputTokens` desde
o início: quando o caching for ativado, a economia fica mensurável no mesmo
painel, e a decisão "ativar cache vs vender crédito" passa a ter número.
