# 📖 Manual Completo — CRM Otron

> **Para quem é este manual:** donos de pequenas/médias empresas, gerentes de atendimento e atendentes que vão usar o CRM no dia-a-dia. Linguagem direta, sem jargão técnico.

---

## 📑 Índice

1. [Visão geral — o que o CRM Otron faz](#1-visão-geral)
2. [Primeira configuração após instalação](#2-primeira-configuração)
3. [Sidebar — entendendo o menu lateral](#3-sidebar)
4. [DIA A DIA — onde o atendimento acontece](#4-dia-a-dia)
5. [GESTÃO — visão geral do negócio (inclui 💎 Retenção)](#5-gestão)
6. [CONFIGURAÇÕES — como tudo é controlado](#6-configurações)
7. [AVANÇADO — campanhas, financeiro e ferramentas](#7-avançado)
8. [SISTEMA — área do super administrador](#8-sistema)
9. [🤖 Agente Secretária IA — o diferencial](#9-agente-secretária-ia)
10. [💳 Pagamentos — Gerencianet, Mercado Pago, Asaas](#10-pagamentos)
11. [📞 Como funciona um atendimento na prática](#11-como-funciona-um-atendimento)
12. [👑 Super Admin — empresas, planos e cobranças](#12-super-admin)
13. [FAQ rápido](#13-faq)

---

## 1. Visão geral

CRM Otron é um sistema de **atendimento multicanal via WhatsApp** com inteligência artificial integrada. Ele combina:

- 💬 **Múltiplas conexões WhatsApp** numa única tela (vários números, vários atendentes)
- 🤖 **Agente IA Secretária** que atende automaticamente fora do expediente ou agenda compromissos
- 📊 **Dashboard com métricas** (tempo médio de resposta, atendimentos fechados, fila de espera)
- 📅 **Agendamentos** de mensagens e compromissos
- 🏷️ **Etiquetas** para organizar contatos
- 📋 **Kanban** para visualizar atendimentos por status
- 📣 **Campanhas em massa** (disparos segmentados)
- 💰 **Financeiro** com cobrança automática via PIX
- 👥 **Multi-empresa** (modo SaaS — uma instalação atende várias empresas)

### Quem usa cada perfil

| Perfil | Acesso | Para quem é |
|---|---|---|
| **Atendente** | Só DIA A DIA | Pessoa que responde os clientes |
| **Admin** | Tudo exceto SISTEMA | Dono da empresa / gerente |
| **Super Admin** | Tudo + gestão de empresas e planos | Dono da plataforma (você) |

---

## 2. Primeira configuração

> Pré-requisito: o sistema já está instalado (ver `DEPLOY_DOCKER_CONTABO.md`).

### Passo 1 — Login inicial
1. Acesse `https://crm.seudominio.com.br`
2. Usuário inicial criado pelo seed: `admin@admin.com` / `123456`
3. **Troque a senha IMEDIATAMENTE** (canto superior direito → Perfil)

### Passo 2 — Atualizar dados da empresa (super admin)
1. Vá em **SISTEMA → Configurações → Empresas**
2. Edite a empresa demo: nome, telefone, documento, plano contratado
3. Defina data de vencimento

### Passo 3 — Personalizar visual (super admin)
**Configurações → Logo:**
- Logo claro (modo light)
- Logo escuro (modo dark)
- Logo interno (header da plataforma)
- Tela de login
- Tela de signup
- Favicon (.ico)

### Passo 4 — Conectar o primeiro WhatsApp
1. **CONFIGURAÇÕES → WhatsApp → Adicionar**
2. Preencha:
   - **Nome:** identificação interna (ex: "Vendas - Loja Centro")
   - **Padrão:** marque se for o número principal
   - **Canal do Agente IA / Secretária:** veja seção 9
3. Salve → clique no botão **QR CODE** que aparece na linha
4. Abra o WhatsApp do celular → ⋮ → **Aparelhos conectados** → **Conectar um aparelho**
5. Aponte a câmera para o QR code
6. ✅ Status muda para "Conectado"

### Passo 5 — Configurar agente IA (se for usar)
**CONFIGURAÇÕES → Configurações → aba "Agente IA"** — ver seção 9.

### Passo 6 — Criar filas (departamentos)
1. **CONFIGURAÇÕES → Filas de atendimento → Adicionar**
2. Para cada departamento (Vendas, Suporte, Financeiro):
   - Nome e cor
   - Mensagem de saudação inicial
   - Horário de atendimento por dia da semana
   - Mensagem fora de expediente

### Passo 7 — Cadastrar atendentes
1. **CONFIGURAÇÕES → Atendentes → Adicionar usuário**
2. Para cada pessoa que vai atender:
   - Nome, e-mail, senha inicial
   - Perfil: **Atendente** (vê só atendimentos) ou **Admin** (vê tudo)
   - Conexão padrão (qual WhatsApp ela usa)
   - Filas que pode atender

Pronto — sistema operacional. Próximo passo: bote os atendentes na DIA A DIA e comece a atender.

---

## 3. Sidebar — o menu lateral

O menu é dividido em 5 seções por contexto:

```
┌─────────────────────────────────────┐
│ DIA A DIA          ← uso constante  │
│ ├─ Atendimentos                     │
│ ├─ Contatos                         │
│ ├─ Agendamentos                     │
│ ├─ Kanban                           │
│ └─ Tarefas                          │
├─────────────────────────────────────┤
│ GESTÃO             ← visão gerencial│
│ ├─ Dashboard                        │
│ ├─ Relatórios                       │
│ ├─ 💎 Retenção                      │
│ └─ Etiquetas                        │
├─────────────────────────────────────┤
│ CONFIGURAÇÕES      ← setup          │
│ ├─ WhatsApp                         │
│ ├─ Atendentes                       │
│ ├─ Configurações                    │
│ └─ Filas de atendimento             │
├─────────────────────────────────────┤
│ AVANÇADO ▾         ← uso eventual   │
│ ├─ 📣 Campanhas (3 passos)          │
│ │  ├─ 1. Listas de Contatos         │
│ │  ├─ 2. Config. Campanhas          │
│ │  └─ 3. Campanhas (disparo)        │
│ ├─ Chat Interno                     │
│ ├─ Arquivos                         │
│ ├─ API                              │
│ ├─ Financeiro                       │
│ └─ Respostas Rápidas                │
├─────────────────────────────────────┤
│ SISTEMA            ← super admin    │
│ ├─ Informativos                     │
│ ├─ Backups                          │
│ └─ Logs de Auditoria                │
└─────────────────────────────────────┘
```

### Atalho global: Cmd/Ctrl + K
Pressione `Ctrl + K` em qualquer tela e abra o **Command Palette** — busque qualquer página por nome.

---

## 4. DIA A DIA

### 4.1 Atendimentos `/tickets`

A tela principal. Aqui acontece toda a operação.

**Estrutura da tela:**
- **Coluna esquerda:** lista de atendimentos (chats) divididos em 3 abas:
  - **Aguardando** (laranja): cliente mandou mensagem, ninguém atendeu ainda
  - **Atendendo** (verde): atendente já aceitou
  - **Resolvidos**: atendimentos fechados
- **Coluna central:** conversa do chat selecionado (igual WhatsApp Web)
- **Coluna direita (drawer):** dados do contato, observações, etiquetas

**Ações no atendimento:**
- **Aceitar** → pega o chat para si
- **Transferir** → passa para outro atendente ou outra fila
- **Finalizar** → fecha o atendimento (vai pra "Resolvidos")
- **Reabrir** → volta um resolvido para ativo
- **Etiquetar** → coloca tags (ex: "VIP", "Reclamação")
- **Agendar** → cria um agendamento de mensagem ou compromisso
- **Excluir** → apaga o atendimento (admin apenas)

**Filtros (topo):**
- Por status, fila, usuário, conexão WhatsApp, etiquetas
- Por busca de texto (mensagens e nomes)

**Atalhos úteis:**
- Clicar no nome do contato no chat → abre o drawer com dados
- Botão de microfone → grava áudio direto
- Botão de anexo → manda imagem, vídeo, documento, localização

### 4.2 Contatos `/contacts`

Lista de todos os contatos do WhatsApp.

**Ações:**
- ➕ **Adicionar Contato** manualmente
- 📥 **Importar Contatos** do celular (pega da agenda do WhatsApp)
- 📊 **Importar Excel** — planilha com colunas Nome / Número / Email
- 📤 **Exportar Excel** com todos os contatos
- ✏️ **Editar** — nome, e-mail, aniversário, campos extras personalizados, desabilitar chatbot
- 🗑️ **Excluir** (admin)

**Campos extras:** você pode adicionar campos personalizados (ex: "CPF", "Plano contratado") por contato.

### 4.3 Agendamentos `/schedules`

Agendar mensagens para sair em data/hora futura.

**Como funciona:**
- Escolha um contato
- Digite a mensagem
- Defina data e hora
- Opcional: marque "Abrir Ticket" para abrir um atendimento junto
- **Recorrência:** todo dia, dias específicos da semana, mês

Quando a hora chega, o sistema envia automaticamente pelo WhatsApp da empresa.

### 4.4 Kanban `/kanban`

Visualização em colunas dos atendimentos por etiqueta.

Crie colunas baseadas em etiquetas (ex: "Lead Frio", "Em Negociação", "Fechado"). Arraste os cards entre colunas — o atendimento muda de etiqueta automaticamente.

**Ações no card:**
- 📝 Anotações
- 📅 Criar agendamento
- 💬 Ir para conversa
- ✅ Finalizar

### 4.5 Tarefas `/todolist`

Lista de afazeres do atendente. Simples to-do interno (não é tarefa de cliente).

---

## 5. GESTÃO

### 5.1 Dashboard `/`

Visão estratégica em cards e gráficos.

**Cards do topo:**
- 🟢 Conexões Ativas
- 💬 Em Conversa (atendendo agora)
- ⏳ Aguardando (fila)
- 🆕 Novos Contatos
- ⏱️ T.M. de Conversa (tempo médio de atendimento)
- 🏁 Finalizados
- ⏱️ T.M. de Espera (tempo médio na fila)

**Gráficos:**
- Atendimentos criados por dia
- Conversas por hora do dia (horário de pico)
- Atendimentos por atendente (produtividade)
- Atendimentos por fila/departamento
- Avaliações médias por departamento

**Filtros:**
- Por data (intervalo custom)
- Por período pré-definido (últimos 7/15/30/60/90 dias)
- Por fila e por atendente

### 5.2 Relatórios `/relatorios`

Duas abas:

**Atendimentos:** tabela detalhada de todos os tickets com filtros (data, status, fila, atendente). Exporta para Excel.

**Desempenho de Agentes:** mostra para cada atendente:
- Tickets fechados no período (Hoje / Semana / Mês)
- Tempo médio de resposta
- Tickets ainda abertos
- ⚠️ Alerta se está acima da meta de resposta

### 5.3 Retenção `/retencao` 💎

A central de fidelização e reativação de clientes. O sistema observa o histórico de cada cliente e automatiza mensagens, cupons e análises para você não perder ninguém.

A página tem **9 abas**, divididas em 3 grupos:

#### Grupo A — Detecção (cliente já está em risco)
- **Adormecidos**: lista contatos classificados em 3 níveis de urgência:
  - 🟡 **Atrasado** (ratio 1.2 – 2.0): passou um pouco do intervalo normal
  - 🔴 **Adormecido** (2.0 – 4.0): faz tempo que sumiu
  - 🟣 **Perdido** (≥ 4.0): muito além do normal
  - Cards no topo mostram o total de cada categoria, ordenados por urgência
  - Para cada contato, você vê: dias sem serviço, total histórico, e pode gerar cupom de reativação manual

#### Grupo B — Automações (sistema age sozinho)
- **Aniversários**: dispara 3 mensagens automáticas por aniversariante por ano
  - **D-3** (3 dias antes): mensagem de antecipação ("seu aniversário está chegando 🎁")
  - **D-0** (no dia): parabéns + cupom único gerado automaticamente
  - **D+7** (7 dias depois): follow-up lembrando que o cupom ainda está disponível
  - A aba mostra: contadores de cada toque enviado no ano, taxa de resgate dos cupons, próximos aniversariantes e janelas recentes
- **Preventivo** (Fase 3A): captura cliente ANTES dele virar atrasado
  - Quando alguém atinge ~80% do seu intervalo médio sem voltar, recebe uma mensagem proativa
  - Limiar configurável (Setting `preventiveReminderThreshold`)
  - Idempotente: 1 toque por ciclo de serviço — quando o cliente volta e gera novo histórico, abre nova janela
  - Aba mostra: total enviado no período, quantos voltaram, taxa de retorno
- **Fidelidade** (Fase 3B): cupom de bônus em marcos de serviço
  - Marcos default: 5, 10, 20, 50, 100 serviços
  - Quando o cliente atinge o marco, ganha cupom de 15% OFF (configurável)
  - Aba mostra: distribuição de recompensas por marco, total entregues, taxa de resgate
  - ⚠️ **Importante**: ServiceHistories marcados como `migration` (backfill histórico) NÃO contam para os marcos — o sistema só recompensa atividade pós-deploy
- **Win-back** (Fase 3C): reativação automática de "perdidos"
  - Quando alguém é classificado como `adormecido` ou `perdido`, recebe oferta de alto valor (20% OFF, 30 dias)
  - Cooldown de 90 dias entre tentativas para o mesmo contato
  - Quando o cliente volta, o sistema marca a tentativa como `convertida` automaticamente
  - Aba mostra: tentativas enviadas, conversões, taxa de conversão

#### Grupo C — Inteligência Estratégica (analytics)
- **RFM** (Fase 4A): segmentação da base em 7 grupos
  - **Champions**: melhores clientes (recentes, frequentes, gastam bem)
  - **Fiéis**: voltam sempre mas talvez não recentemente
  - **Potenciais**: voltaram recente mas não são frequentes ainda
  - **Em risco**: eram bons, sumiram
  - **Hibernando**: vieram pouco e faz tempo
  - **Novos**: única visita até agora
  - **Outros**: zona cinzenta
  - Use para campanhas dirigidas: ex.: ofertas premium só para Champions, win-back para Em Risco
- **Cross-sell** (Fase 4B): pares de serviços frequentemente comprados juntos
  - Lê todos os ServiceHistories da empresa e identifica padrões: "quem compra corte também compra barba 75% das vezes"
  - Oferece dados para criar combos/pacotes
  - Para um contato específico (chamada via API): sugere serviços que ele AINDA NÃO consumiu mas que clientes parecidos consomem
- **Indicações** (Fase 4C): programa "indique um amigo"
  - Cada cliente tem um **código de indicação** único (gerado preguiçosamente quando solicitado)
  - Quando o código é registrado num novo cliente e ele completa o primeiro serviço, ambos ganham cupom de 15% OFF
  - Mostra: total indicações registradas, convertidas, taxa de conversão
- **Cupons**: resumo agregado de cupons gerados pelo módulo (todos os tipos: aniversário, fidelidade, reativação, indicação)

#### Como começar
1. Habilite as features no banco (ver `DEPLOY_DOCKER_CONTABO.md` §10.6) — vêm DESLIGADAS por padrão
2. Configure horários de disparo conforme seu fuso (default: 09h, 10h e 11h BR)
3. Personalize templates de mensagem com variáveis `{{name}}`, `{{coupon}}`, `{{dias}}`, `{{milestone}}`, `{{amigo}}`, `{{desconto}}`
4. Marque uma etiqueta como "Venda Concluída" (em Etiquetas → editar tag → checkbox) — assim o Kanban registra automaticamente os atendimentos finalizados como serviço

#### Como o sistema sabe que houve um serviço?
3 fontes alimentam o `ServiceHistory`:
- **Kanban**: arrastar um card para coluna com tag marcada "Venda Concluída"
- **Agendamento**: completar um agendamento via secretária IA
- **Manual**: chamada API `recordHistory({contactId, source:'manual', serviceType, value})`

> Cupons gerados automaticamente NÃO são entregues fisicamente — o cliente recebe o código por WhatsApp. Quando ele aparece para usar, o atendente resgata o cupom em **Avançado → Cupons** (ou via API) usando o código fornecido.

---

## 6. CONFIGURAÇÕES

### 6.1 WhatsApp `/connections`

Lista todas as conexões WhatsApp da empresa.

**Status:**
- 🟢 **Conectado** — funcionando
- 🟡 **QR Code** — aguardando leitura
- 🔴 **Desconectado** — caiu, refazer QR
- ⚪ **Timeout** — sem internet
- 🔵 **Conectando** — em processo

**Botões por linha:**
- **QR CODE** — abre modal com o QR
- **Reiniciar** — reinicia a sessão sem precisar refazer QR
- **Desconectar** — desconecta o número
- **Editar** — abre configurações da conexão
- **Excluir** — remove permanentemente

### Configurações de cada conexão WhatsApp

Ao clicar em **Editar**, abre o modal com os campos:

**Sempre visíveis:**
- **Nome** — identificação interna
- **Padrão** — toggle (se este é o WhatsApp principal)
- **Canal do Agente IA** — toggle (se ativo, IA atende automaticamente — ver seção 9)
- **Canal Secretária** — toggle (modo agente IA com tools de agendamento)
- **Token** — usado para integrações API externas
- **Chave PIX** — chave PIX para cobranças automáticas
- **Mensagem Personalizada PIX** — texto enviado antes da chave
- **Filas vinculadas** — quais departamentos esta conexão atende
- **Encerrar chats após X minutos** — fechamento automático por inatividade

**Visíveis apenas se NÃO for canal de IA:**
- **Mensagem de saudação** — enviada quando o cliente abre o chat
- **Mídia de saudação** — imagem opcional junto da saudação
- **Mensagem de conclusão** — enviada quando o atendimento é fechado
- **Mensagem fora de expediente** — quando recebe mensagem fora do horário
- **Mensagem de avaliação** — pesquisa de satisfação (1-5) ao finalizar
- **Redirecionamento de fila** — transfere para outra fila após X minutos sem resposta
- **Mensagem por inatividade** — quando cliente para de responder

> **Por que canais de IA não mostram esses campos?** Porque a IA gerencia toda a conversa (saudações, despedidas, fora de expediente) através do prompt configurado em Configurações → Agente IA. Os campos de fluxo manual ficariam conflitantes.

### 6.2 Atendentes `/users`

Cadastro de quem vai atender no sistema.

**Por usuário:**
- Nome, e-mail, senha
- Perfil: **user** (atendente) ou **admin**
- **Super User** (toggle) — só admin pode marcar — vê dados de todas as empresas
- **Ticket Sem Fila Invisível** — toggle: se sim, o atendente só vê chats da sua fila
- **Conexão Padrão** — qual WhatsApp ele usa por padrão
- **Filas** — quais departamentos pode atender

**Tabela inclui métricas:**
- Status (online/offline)
- Tickets fechados hoje
- Tempo médio de resposta

### 6.3 Configurações `/settings`

Configurações gerais da empresa. Várias abas:

**Aba Opções (gerais):**
- **Pesquisa de satisfação** — ativa/desativa NPS após finalizar
- **Gerenciamento de Expediente** — usa horário da fila ou da empresa
- **Ignorar Mensagens de Grupos** — não cria ticket para grupos WhatsApp
- **Aceitar Chamada** — aceita ou bloqueia chamadas de áudio/vídeo
- **Tipo Chatbot** — modo do fluxo automático
- **Enviar saudação ao aceitar ticket** — manda mensagem quando atendente aceita
- **Enviar mensagem de transferência** — avisa cliente quando muda de fila/atendente
- **Aviso de aniversariantes** — manda mensagem automática no aniversário do contato
- **Mensagem de recesso/feriados** — datas específicas com mensagem custom
- **Saudação quando houver só 1 fila** — pula menu se só tem 1 departamento
- **Operador Visualiza Tickets Fechados** — atendente vê resolvidos?
- **Operador Visualiza Grupos** — atendente vê chats de grupo?
- **Menu Lateral Inicial** — sidebar começa aberto ou fechado

**Aba Configurações Globais (super admin):**
- Registro permitido (sim/não)
- Registro visível (mostra signup público)
- Tempo de Trial (dias grátis para novas empresas — padrão 7)

**Aba Agente IA** — ver seção 9 detalhada.

**Aba Integrações:**
- **ASAAS** — token API para integração Asaas
- **MERCADO PAGO** — public key + access token + webhook secret
- **GEMINI AI** — token Google Gemini (gera sugestões automáticas)

### 6.4 Filas de atendimento `/queues`

Departamentos do atendimento. Cada fila tem:

**Aba Dados da Fila:**
- Nome, cor, ordem (peso para o bot priorizar)
- Mensagem de saudação
- Mensagem de conclusão
- Mensagem fora de expediente
- Mensagem de avaliação
- Token (API)
- Integração (Typebot, N8N, etc.)
- Vincular a grupos WhatsApp

**Aba Horários de Atendimento:**
- 2 turnos por dia (manhã/tarde) — segunda a domingo
- Definido por fila (cada departamento pode ter horário diferente)

**Aba Opções (sub-menu):**
- Cria níveis do chatbot: "1. Vendas / 2. Suporte"
- Tipos de opção: Texto, Atendente, Fila, API externa

---

## 7. AVANÇADO

### 7.1 📣 Campanhas (3 passos)

Disparo de mensagens em massa. **Siga a ordem:**

#### Passo 1 — Listas de Contatos `/contact-lists`
1. Clique em **Nova Lista**
2. Nomeie (ex: "Aniversariantes Setembro")
3. Dentro da lista, adicione contatos:
   - **Manualmente** (nome + número)
   - **Importar Excel** com colunas: nome, número, email
4. O sistema valida quais números têm WhatsApp ativo (✅ verde / ❌ vermelho)

#### Passo 2 — Config. Campanhas `/campaigns-config`
- **Intervalo Randômico** — tempo entre cada disparo (evita ban do WhatsApp)
- **Intervalo Maior** — após X mensagens, faz pausa maior
- **Variáveis Personalizadas** — placeholders custom (ex: `{cidade}`, `{produto}`)

⚠️ **Configure isto ANTES de disparar.** Se mandar 1000 mensagens em 1 minuto, o WhatsApp bloqueia o número.

**Configuração recomendada:**
- Intervalo randômico: 30-60 segundos
- A cada 50 mensagens: pausa de 5 minutos

#### Passo 3 — Campanhas `/campaigns`
1. **Nova Campanha**
2. Configure:
   - Nome interno
   - Conexão WhatsApp que vai disparar
   - Lista de contatos
   - Lista de etiquetas (opcional — para filtrar contatos)
   - Lista de arquivos (anexos)
   - Data/hora do agendamento
3. Crie até 5 mensagens diferentes (Msg. 1 a 5) — sistema alterna entre elas para parecer mais natural
4. Salve → status fica **Programada**
5. Quando chega a hora, status muda para **Em Andamento** e dispara

**Status possíveis:**
- Inativa, Programada, Em Andamento, Cancelada, Finalizada

### 7.2 Chat Interno `/chats`

Mensagens internas entre atendentes (chat tipo Slack/Teams). Não vai pro cliente.

Útil para coordenar: "preciso de ajuda com este chat", "passa pra mim", etc.

### 7.3 Arquivos `/files`

Bibliotecas de arquivos pré-cadastrados (catálogos, tabelas de preço, manuais). Cada lista tem uma mensagem associada — o atendente seleciona e dispara rapidamente.

### 7.4 API `/messages-api`

Documentação técnica + testador para integrações externas (n8n, Zapier, sistemas próprios).

**Endpoints disponíveis:**
- `POST /api/messages/send` — texto
- `POST /api/messages/send-media` — imagem/vídeo/documento

**Autenticação:** Bearer token (peguei em **CONFIGURAÇÕES → WhatsApp → editar conexão → Token**).

### 7.5 Financeiro `/financeiro`

Faturas geradas pela cobrança automática do plano.

**Estados:**
- 🟢 Pago
- 🔴 Vencido
- 🟡 Em Aberto

**Botão PAGAR:** abre tela de checkout com PIX gerado.

### 7.6 Respostas Rápidas `/quick-messages`

Atalhos de texto. Crie atalho `/preco` e ele expande para "Nossos preços são: ...".

Use no chat digitando `/` + atalho. Pode incluir anexos.

**Tipos:**
- **Globais** — todos os atendentes veem
- **Pessoais** — só você vê

**Editar antes de enviar:** opção para revisar/customizar antes do disparo.

---

## 8. SISTEMA (super admin)

### 8.1 Informativos `/announcements`

Banners/anúncios mostrados para usuários. Pode ser:
- Para **todas as empresas** (broadcast)
- Para **superadmin** apenas

**Prioridades:** Alta / Média / Baixa (afeta cor do banner).

Útil para avisar manutenções, novas features, problemas do servidor.

### 8.2 Backups `/backups`

Backups do banco de dados + arquivos do sistema.

**Botões:**
- 🟢 **Fazer Backup** — gera ZIP com banco + uploads
- ⬇️ **Download** — baixa um backup existente
- 🗑️ **Excluir** — remove um backup

**Progresso:** mostra etapas (preparando → banco → backend → frontend → comprimindo).

⚠️ **Recomendado:** complementar com o backup automático via cron (ver `DEPLOY_DOCKER_CONTABO.md` seção "backup").

### 8.3 Logs de Auditoria `/logs`

Histórico de TODAS as ações sensíveis no sistema:
- Login / logout
- Criação / edição / exclusão de usuários
- Mudanças de configuração
- Acessos a dados de empresas
- Erros críticos

Cada log tem: timestamp, usuário, IP, ação, alvo.

Importante para conformidade LGPD e investigação de incidentes.

---

## 9. 🤖 Agente Secretária IA

O grande diferencial. Substitui a recepcionista 24/7.

### 9.1 Conceito

A IA conversa com o cliente naturalmente e pode:
- ✅ Responder dúvidas com base em conhecimento da empresa
- ✅ Agendar compromissos no Google Calendar
- ✅ Cancelar/reagendar compromissos existentes
- ✅ Consultar disponibilidade de horários
- ✅ Confirmar agendamentos
- ✅ Encaminhar para atendente humano quando necessário

### 9.2 Onde configurar

**CONFIGURAÇÕES → Configurações → aba "Agente IA"**

### 9.3 Campos da configuração

**Aba "Provedor & Modelo":**
- **Provedor:** Anthropic (Claude), OpenAI (GPT), Google (Gemini)
- **API Key:** chave da plataforma escolhida
- **Modelo:** lista carregada automaticamente após inserir a key
  - Recomendado: `claude-haiku-4-5` (rápido, barato) ou `claude-sonnet-4-5` (mais inteligente)
- **Modelo de transcrição:** para áudios — Whisper / Deepgram
- **Personalidade:** Formal / Casual / Híbrido (afeta temperatura do LLM)

**Aba "Conhecimento":**
- **Sobre a empresa:** descrição livre (nome, segmento, valores)
- **Serviços oferecidos:** lista
- **Política de atendimento:** horários, regras
- **FAQ:** perguntas frequentes
- **Tom de voz:** instruções específicas

A IA usa tudo isso para responder com contexto correto.

**Aba "Google Calendar":**
- **Conectar conta Google** — OAuth (popup do Google)
- Ao conectar, libera ferramentas: criar evento, cancelar, listar disponibilidade
- Permissões: leitura/escrita do calendário principal

**Aba "Templates":**
- Mensagens padrão (saudação, despedida, transferência)
- Variáveis suportadas: `{{nome}}`, `{{empresa}}`, `{{horario}}`

**Aba "Avançado":**
- **Tempo de "digitando..."** — humaniza a resposta (1-5 segundos)
- **Histórico máximo** — quantas mensagens a IA lembra (padrão 20)
- **Encaminhar para humano** — palavras-chave que ativam transferência (ex: "atendente", "humano", "falar com pessoa")

**Aba "Sandbox":**
- 💬 Chat de teste com a IA SEM disparar mensagem real no WhatsApp
- Use para testar o prompt antes de ativar em produção
- Histórico isolado por sessão

### 9.4 Como ativar a IA num número

1. **CONFIGURAÇÕES → WhatsApp → editar conexão**
2. Marque **Canal Secretária** (ou **Canal do Agente IA**)
3. Salve

Pronto: todas as mensagens recebidas nesse número são respondidas pela IA automaticamente.

### 9.5 Quando a IA passa para humano

A IA encaminha quando:
- Cliente usa palavra-chave configurada ("atendente", "humano")
- Cliente expressa raiva/insatisfação clara
- Pergunta foge muito do conhecimento configurado
- Cliente solicita algo financeiro complexo

Ao encaminhar, o ticket entra na fila como **Aguardando** com etiqueta "IA→Humano".

### 9.6 Custos esperados (referência maio/2026)

| Provedor | Modelo | Custo aprox. por atendimento |
|---|---|---|
| Anthropic | Claude Haiku 4.5 | R$ 0,02-0,05 |
| Anthropic | Claude Sonnet 4.5 | R$ 0,15-0,30 |
| OpenAI | GPT-4o-mini | R$ 0,03-0,08 |
| OpenAI | GPT-4o | R$ 0,20-0,40 |
| Google | Gemini 2.0 Flash | R$ 0,01-0,03 |

Um atendimento médio gasta 5-15 turnos de conversa. Para 1000 atendimentos/mês com Claude Haiku: ~R$ 30-50/mês de custo de API.

---

## 10. 💳 Pagamentos

O CRM tem 3 integrações de pagamento (escolha uma):

### 10.1 Gerencianet / Efí (padrão)
**Use se:** empresa brasileira, quer PIX direto.

**Setup:**
1. Crie conta em [efipay.com.br](https://efipay.com.br)
2. Painel → Pix → Aplicações → Criar aplicação
3. Baixe o certificado `.p12`
4. Pegue Client ID + Client Secret
5. **CONFIGURAÇÕES → Configurações → Integrações:**
   - Provedor: Gerencianet
   - Ambiente: Sandbox (testes) ou Produção
   - Client ID, Client Secret
   - Upload do .p12
   - Chave PIX

**Como funciona:** ao gerar fatura, o sistema cria cobrança PIX dinâmica no Efí. O QR code aparece no checkout. Webhook do Efí confirma o pagamento automaticamente.

### 10.2 Mercado Pago
**Use se:** já tem conta MP ou quer também aceitar cartão.

**Setup:**
1. [mercadopago.com.br](https://mercadopago.com.br) → Suas integrações → Criar aplicação
2. Pegue Public Key + Access Token
3. **Configurar notificações Webhooks** → copie a Assinatura secreta
4. **CONFIGURAÇÕES → Configurações → Integrações:**
   - Provedor: Mercado Pago
   - Public Key, Access Token, Webhook Secret

**Suporta:** PIX, cartão de crédito, boleto.

### 10.3 ASAAS
**Use se:** prefere o Asaas (popular entre prestadores de serviço).

**Setup:**
1. [asaas.com](https://asaas.com) → Gerar API Key
2. **CONFIGURAÇÕES → Configurações → Integrações → ASAAS:**
   - Cole o Token Asaas

### 10.4 Validação do webhook

Em qualquer um, depois de configurar:
1. Cole a URL do webhook (ex: `https://api.seudominio.com.br/subscription/webhook`)
2. Clique em **Validar Webhook**
3. ✅ deve aparecer se o endpoint está acessível
4. Configure essa mesma URL no painel da provedora

### 10.5 Cobrança das empresas (super admin)

No super admin:
- **SISTEMA → Configurações → Empresas → editar empresa → "Recorrência"**
- Define se a empresa é cobrada mensalmente ou anualmente
- Data de vencimento
- O sistema gera fatura automaticamente próximo do vencimento
- Cliente recebe notificação no painel + e-mail

---

## 11. 📞 Como funciona um atendimento

**Fluxo padrão (sem IA):**

```
Cliente manda mensagem WhatsApp
    ↓
Sistema cria Ticket → status "Aguardando" → fila do conexão
    ↓
Atendente vê na lista de "Aguardando" → clica → "Aceitar"
    ↓
Ticket muda para "Atendendo" → atribuído ao atendente
    ↓
Conversa rola em tempo real (Socket.io)
    ↓
Atendente clica "Finalizar"
    ↓
Sistema envia "Mensagem de conclusão" + (opcional) pesquisa de satisfação
    ↓
Cliente responde 1-5 → registrado em UserRating
    ↓
Ticket vai para "Resolvidos"
```

**Fluxo com IA:**

```
Cliente manda mensagem
    ↓
Sistema cria Ticket → conexão marcada como "Canal Secretária"
    ↓
Ticket vai direto para a fila Bull/Redis (assíncrono)
    ↓
IA recebe → consulta knowledge base + Google Calendar
    ↓
IA responde naturalmente (com "digitando..." 1-5s)
    ↓
Loop continua até:
  • Cliente fica satisfeito → IA não recebe mais mensagens (ticket fica aberto e fecha por inatividade)
  • Cliente pede humano → ticket vai para fila como "Aguardando"
  • IA cria/cancela evento no Calendar
```

**Recursos do atendente durante a conversa:**
- Anexos: imagem, vídeo, áudio, documento, localização, sticker, GIF
- Respostas rápidas (`/atalho`)
- Buscar mensagem dentro do chat
- Editar mensagem enviada (até 15 min)
- Apagar mensagem (para ambos)
- Reagir com emoji
- Encaminhar mensagem
- Citar/responder mensagem específica

---

## 12. 👑 Super Admin

Visão da plataforma como SaaS multi-empresa.

### 12.1 Acesso
Apenas usuários com `super = true`. Setado em:
- Banco direto (primeiro super criado pelo seed)
- Ou via **CONFIGURAÇÕES → Atendentes → editar → Super User toggle**

### 12.2 Empresas

**SISTEMA → Configurações → aba "Empresas"**

Lista todas as empresas (tenants) cadastradas.

**Por empresa:**
- Nome, documento (CPF/CNPJ)
- Plano contratado
- Recorrência (mensal/anual)
- Data de vencimento (afeta acesso — vencido = bloqueado)
- Status (ativa/inativa)
- E-mail/telefone de contato

**Ações:**
- ➕ Cadastrar Empresa (cria tenant novo)
- ✏️ Editar
- 🗑️ Excluir (apaga TUDO da empresa — confirmação dupla)

### 12.3 Planos

**SISTEMA → Configurações → aba "Planos"**

Tabela de planos comerciais oferecidos.

**Por plano:**
- Nome (ex: "Básico", "Pro", "Enterprise")
- Quantidade de usuários permitidos
- Quantidade de conexões WhatsApp permitidas
- Filas permitidas
- Campanhas (habilitado/desabilitado)
- Agendamentos (habilitado/desabilitado)
- Chat Interno (habilitado/desabilitado)
- Kanban (habilitado/desabilitado)
- API externa (habilitado/desabilitado)
- Valor em R$ (mensal)

### 12.4 Trial — dias grátis

**SISTEMA → Configurações → aba "Configurações Globais" → "Tempo de Trial"**

Define quantos dias toda nova empresa criada via signup público ganha grátis.

**Valor padrão:** 3 dias. Recomendado: 7-15 dias.

**Como funciona:**
1. Empresa nova se cadastra em `/signup`
2. Sistema gera `dueDate = hoje + X dias`
3. Acesso liberado a tudo durante o trial
4. Próximo do fim, banner avisa: "Seu trial termina em 2 dias"
5. Após vencer, login bloqueado até pagar primeira fatura

### 12.5 Cobrança e financeiro (super)

O super admin vê o financeiro consolidado:
- Faturas de todas as empresas
- Quem pagou / quem está vencido
- Receita total por mês
- MRR (Monthly Recurring Revenue)

Em produção, o cron do backend gera faturas automaticamente baseado na `dueDate` de cada empresa.

### 12.6 Logs de auditoria

Como super, você vê logs de TODAS as empresas. Útil para:
- Investigar reclamação ("essa empresa deletou dado X?")
- Detectar abuso ("essa empresa criou 50 usuários em 1 hora")
- Conformidade LGPD (provar que dados foram acessados conforme política)

---

## 13. FAQ

**P: Quantos WhatsApps posso conectar?**
R: Depende do plano. No banco, o limite é por `CONNECTIONS_LIMIT` no `.env`. Recomendamos no máximo 5-10 por VPS (cada conexão Baileys consome ~200MB RAM).

**P: O WhatsApp pode banir o número?**
R: Sim, principalmente em campanhas. Use intervalos longos (30-60s), mensagens variadas (5 versões) e nunca exceda 1000 disparos/dia por número.

**P: Posso usar o WhatsApp Business API oficial em vez do Baileys?**
R: Atualmente o sistema usa Baileys (não-oficial). Integração com API oficial Meta exige adaptação no `WbotServices`.

**P: A IA pode acessar meu calendário pessoal?**
R: Só se você conectar via OAuth. A conta conectada é a que vai aparecer nos eventos criados.

**P: Posso ter atendentes em vários fusos horários?**
R: Sim, mas o horário de atendimento da fila é configurado em fuso fixo do servidor. Documente para os atendentes.

**P: Como migrar para outro servidor?**
R: 1) Faça backup (SISTEMA → Backups). 2) Suba a stack no novo servidor (DEPLOY_DOCKER_CONTABO.md). 3) Restaure o dump: `docker compose exec postgres psql -U otron_user -d otron_db < backup.sql`.

**P: Os clientes sabem que estão falando com IA?**
R: Por padrão não. Você pode configurar o prompt para sempre identificar (ex: "Sou a Sofia, assistente virtual da empresa X").

**P: Posso usar isso para WhatsApp pessoal?**
R: Funciona, mas é projetado para uso comercial. Para uso pessoal, ferramentas como WhatsApp Web original são mais simples.

**P: Preciso de internet 24/7 na VPS?**
R: Sim. Se a VPS cair, o WhatsApp desconecta e clientes não recebem resposta.

**P: O sistema funciona com WhatsApp em modo grupo?**
R: Sim, há configuração para visualizar grupos. Útil para suporte de comunidade.

---

## 📞 Suporte

- **Documentação técnica:** `docs/DEPLOY_DOCKER_CONTABO.md`
- **Decisões arquiteturais:** `decisions_log.md`
- **Diretrizes de desenvolvimento:** `CLAUDE.md`

---

**Versão deste manual:** 1.0 — 2026-05-17
