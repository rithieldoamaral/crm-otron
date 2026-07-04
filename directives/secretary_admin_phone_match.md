# Diretiva — Reconhecimento do Admin da Secretária por Número de Telefone

## Objetivo
Garantir que a Secretária IA reconheça o admin **independente do formato** em que o
número foi cadastrado vs. o formato que o WhatsApp entrega na mensagem recebida.

## Causa-raiz (2026-06-28, ticket #22)
- Admin cadastrado nas Configurações: `5548988368758` (13 díg — forma humana com o 9º dígito).
- JID que o WhatsApp entrega para o MESMO celular: `554888368758` (12 díg — **sem o 9º dígito**).
- A comparação anterior (`normalizeNumber` → só tira `@` e não-dígitos → igualdade exata)
  falhava: `554888368758 ≠ 5548988368758`. Resultado: admin caía no fluxo do Agente,
  nunca na Secretária.

O "9º dígito" é a particularidade de celulares brasileiros: o número canônico é
`55 + DDD(2) + 9 + 8 dígitos` (13), mas a rede/WhatsApp frequentemente trafega
`55 + DDD(2) + 8 dígitos` (12), omitindo o `9`.

## Entradas
- `senderNumber`: número/JID recebido do WhatsApp (ex: `554888368758@s.whatsapp.net`).
- `adminNumbers`: lista cadastrada em `secretaryAdminNumbers` (qualquer formato).

## Saída
- `boolean` — se o remetente é um dos admins.

## Solução (determinística)
Função pura `canonicalizePhone(raw)` que reduz qualquer forma a uma chave canônica:
1. Remove sufixo de JID (`@...`) e qualquer caractere não-numérico.
2. Sem código de país (10 ou 11 díg) → assume Brasil, prepend `55`.
3. Celular brasileiro de 13 díg (`55` + DDD + `9` + 8) → **remove o 9º dígito** → 12 díg.
Comparação passa a ser igualdade exata sobre a chave canônica.

`phonesMatch(a, b)` = `canonicalizePhone(a) === canonicalizePhone(b)` (ambos não-vazios).

## Edge cases cobertos
- Cadastro com 9, JID sem 9 (e vice-versa).
- Cadastro sem código de país (`48988368758` ou `4888368758`).
- Número internacional (ex: Portugal `351937203522`) — não sofre transformação BR.
- Máscara/espaços/`+` no cadastro.
- String vazia/nula → nunca casa (segurança preservada).

## Success Criteria
- Admin `5548988368758` reconhecido quando WhatsApp entrega `554888368758`.
- Não-admin continua NÃO reconhecido (sem afrouxar segurança).

## Failure Modes
- Colisão teórica entre celular sem-9 e um fixo de mesmos 12 díg: improvável
  (fixo não começa com 9 após DDD; a remoção do 9 só ocorre em número de 13 díg).
