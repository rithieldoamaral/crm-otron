# 🤖 CRM Otron

> **Plataforma de atendimento WhatsApp multi-canal com Agente IA Secretária integrado.**

CRM completo para pequenas e médias empresas que querem automatizar o atendimento via WhatsApp, agendar compromissos com IA, gerenciar múltiplos atendentes e disparar campanhas — tudo numa única interface.

---

## ✨ Recursos principais

### Para atendimento
- 💬 **Múltiplas conexões WhatsApp** simultâneas na mesma tela
- 👥 **Atribuição de tickets** por fila/departamento e atendente
- 🏷️ **Etiquetas** (tags) personalizadas para organizar contatos
- 📋 **Kanban** com drag-and-drop por status
- 📅 **Agendamento** de mensagens com recorrência
- 🔍 **Busca** de mensagens em conversas
- ⭐ **Pesquisa de satisfação** automática pós-atendimento

### Agente IA Secretária
- 🤖 Atende clientes **24/7** com linguagem natural
- 📆 Cria, cancela, remarca e consulta eventos no **Google Calendar** por profissional
- 🕐 **Agendamento determinístico:** disponibilidade por período (manhã/tarde/noite), horários em hora cheia, apresentação em faixa ("das 13h às 18h") e validação anti-duplicata / anti-horário-ocupado no backend (não depende do LLM)
- 🎯 Encaminha para humano quando necessário
- 🧠 Suporta **Anthropic Claude**, **OpenAI GPT** e **Google Gemini**
- 🎤 Transcrição automática de áudios (Whisper / Deepgram)
- 🧪 **Sandbox** para testar prompts antes de ativar em produção

### Para gestão
- 📊 **Dashboard** com métricas em tempo real
- 📈 **Relatórios** de produtividade por atendente
- 💰 **Cobrança automática** via PIX (Gerencianet, Mercado Pago, Asaas)
- 🏢 **Multi-empresa** (modo SaaS) com planos e trial configuráveis
- 📣 **Campanhas em massa** com intervalos randômicos anti-ban
- 🔐 **Logs de auditoria** para conformidade LGPD

---

## 🚀 Quick start

### Para deploy em produção
👉 **Leia o guia completo:** [`docs/DEPLOY_DOCKER_CONTABO.md`](docs/DEPLOY_DOCKER_CONTABO.md)

Resumo (5 comandos):
```bash
git clone https://github.com/SEU_USUARIO/crm_otron.git /opt/crm_otron
cd /opt/crm_otron
cp backend/.env.example .env.production
nano .env.production   # preencha JWT_SECRET, DB_PASS, REDIS_PASSWORD, etc.
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### Para desenvolvimento local
```bash
# Pré-requisitos: Node.js 20+, Docker, Docker Compose

# Sobe Postgres + Redis em containers
docker compose up -d

# Backend
cd backend
cp .env.example .env       # ajuste DB_HOST=localhost, REDIS_URI=redis://localhost:6379
npm install --legacy-peer-deps
npx sequelize db:migrate
npx sequelize db:seed:all
npm run dev:server

# Em outro terminal — Frontend
cd frontend
npm install --legacy-peer-deps
npm start
```

Acesse `http://localhost:3000` (login inicial: `admin@admin.com` / `123456` — **TROQUE IMEDIATAMENTE**).

---

## 📚 Documentação

| Documento | O que tem |
|---|---|
| [`docs/DEPLOY_DOCKER_CONTABO.md`](docs/DEPLOY_DOCKER_CONTABO.md) | Deploy passo-a-passo na Contabo VPS com Docker, SSL, backups e rotação de segredos |
| [`docs/MANUAL_PLATAFORMA.md`](docs/MANUAL_PLATAFORMA.md) | Manual completo de uso (cada aba, cada função, Agente IA, pagamentos, super admin) |
| [`CLAUDE.md`](CLAUDE.md) | Diretrizes de arquitetura, TDD, segurança e padrões de código (para devs) |
| [`MEMORY.md`](MEMORY.md) | Estado completo do projeto: módulos, decisões, tech debt — ponto de partida obrigatório para qualquer sessão de dev/IA |
| [`decisions_log.md`](decisions_log.md) | Log de decisões arquiteturais com justificativas |
| [`CHANGELOG.md`](CHANGELOG.md) | Histórico de mudanças (formato Keep a Changelog) |

---

## 🛠️ Stack técnica

| Camada | Tecnologias |
|---|---|
| **Frontend** | React 17, Material-UI v4, Socket.io-client, Formik, react-i18next |
| **Backend** | Node.js 20, Express, TypeScript, Sequelize, Socket.io, Bull |
| **Banco** | PostgreSQL 15 |
| **Fila / Cache** | Redis 7 + Bull queue |
| **WhatsApp** | [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) |
| **IA / LLM** | Anthropic Claude SDK, OpenAI SDK, Google Gemini SDK |
| **Calendário** | Google Calendar API (OAuth2) |
| **Pagamentos** | Gerencianet/Efí, Mercado Pago, Asaas |
| **Infra** | Docker, Docker Compose, Nginx, Let's Encrypt |

---

## 🔒 Segurança

Este projeto segue diretrizes rigorosas — ver [`CLAUDE.md`](CLAUDE.md) seções IV-VII.

**Checklist mínimo antes de subir produção:**
- [ ] `.env.production` NÃO commitado (já no `.gitignore`)
- [ ] `JWT_SECRET` e `JWT_REFRESH_SECRET` **únicos e gerados via `openssl rand -base64 32`**
- [ ] Senha forte no Redis e PostgreSQL
- [ ] HTTPS configurado (Let's Encrypt via Certbot — incluído no `docker-compose.prod.yml`)
- [ ] Firewall UFW liberando apenas 22, 80, 443
- [ ] Backups automáticos do PostgreSQL configurados
- [ ] Logs de auditoria habilitados

Se encontrar uma vulnerabilidade, **por favor reporte de forma responsável** abrindo issue privada ou via e-mail (não publique no repositório público).

---

## 🤝 Contribuindo

Pull requests são bem-vindos. Para mudanças significativas:

1. Leia [`CLAUDE.md`](CLAUDE.md) — diretrizes de TDD, modularização e qualidade
2. Abra uma issue descrevendo a mudança proposta
3. Faça fork → branch (`feature/nome`) → commit → PR
4. Garanta que os testes passem: `npm test` (frontend e backend)
5. Use commits convencionais: `[FEATURE]`, `[BUGFIX]`, `[REFACTOR]`, `[DOCS]`, etc.

---

## 📜 Licença

Este projeto está licenciado sob **MIT License** — veja [`LICENSE`](LICENSE) para detalhes.

CRM Otron é baseado em ideias do projeto open-source [Whaticket](https://github.com/canove/whaticket-community) (também MIT), com modificações substanciais para integração com IA, multi-empresa SaaS e fluxos brasileiros.

---

## ⚠️ Aviso legal

- O uso do WhatsApp via Baileys **não é oficial** da Meta. Pode haver risco de banimento de números em caso de abuso (campanhas em massa sem intervalos, spam, etc.).
- Para uso comercial em escala, considere migrar para a **WhatsApp Business Cloud API** oficial.
- Esta plataforma é uma ferramenta — **a conformidade com LGPD, leis trabalhistas e termos do WhatsApp** é responsabilidade de quem a opera.

---

**Versão:** 6.3.0
**Última atualização:** 2026-06-01
**Maintainer:** [Seu Nome](https://github.com/SEU_USUARIO)
