# 🚀 Deploy do CRM Otron na Hostinger VPS (KVM 4) via Docker

> **Tempo estimado:** 75-100 minutos (primeira vez)
> **Pré-requisitos:** um plano Hostinger VPS **KVM 4** contratado, um domínio (ex: `seudominio.com.br`) e acesso ao painel de DNS desse domínio.

Este guia leva você do zero (VPS recém-contratada) até o CRM Otron rodando em produção com:
- ✅ PostgreSQL (banco de dados)
- ✅ Redis (cache + fila de mensagens)
- ✅ Backend Node.js (API + WhatsApp)
- ✅ Frontend React (interface)
- ✅ Nginx (proxy reverso)
- ✅ SSL/HTTPS automático (Let's Encrypt)
- ✅ Backups automáticos do PostgreSQL (+ backup nativo da Hostinger, §12)

---

## 📋 Checklist rápido (visão geral)

| Etapa | O que vai fazer | Tempo |
|---|---|---|
| 1 | Contratar VPS Hostinger KVM 4 + escolher template Ubuntu | 10 min |
| 2 | Conectar via SSH (ou terminal do navegador) | 5 min |
| 3 | Atualizar Linux + instalar Docker | 10 min |
| 4 | Configurar firewall | 5 min |
| 5 | Apontar domínio para a VPS | 10 min (+ até 2h propagação) |
| 6 | Baixar projeto | 5 min |
| 7 | Configurar `.env.production` | 10 min |
| 8 | Gerar certificados SSL | 10 min |
| 9 | Subir os containers | 10 min |
| 10 | Criar primeiro super admin + migrations | 5 min |
| 11 | Configurar Provedor de IA (super admin) e admin da Secretária | 5 min |
| 13 *(opcional)* | Instalar GlitchTip (rastreamento de erros) | 20 min |

---

## 1. Contratar VPS Hostinger — plano KVM 4

### Por que KVM 4
| Especificação | KVM 4 | Por que serve |
|---|---|---|
| **CPU** | 4 vCPU (AMD EPYC) | Suporta múltiplas conexões WhatsApp + IA simultâneas |
| **RAM** | 16 GB | Cada conexão WhatsApp (Baileys) consome ~200MB; 16GB dá folga real |
| **Disco** | 200 GB NVMe SSD | NVMe é mais rápido que SSD comum — Postgres/Redis respondem melhor |
| **Banda** | 16 TB/mês | Não é gargalo para um CRM de WhatsApp (texto + mídia moderada) |

Acesse [hostinger.com/vps-hosting](https://www.hostinger.com/vps-hosting), escolha o plano **KVM 4** e finalize a compra.

### Configuração inicial no hPanel (painel da Hostinger)

Depois de comprar, a Hostinger NÃO manda a VPS pronta — você escolhe o sistema operacional na primeira vez:

1. Entre no **hPanel** ([hpanel.hostinger.com](https://hpanel.hostinger.com)) com a conta que comprou o plano
2. Menu **VPS** → clique em **Configurar** (Setup) no plano recém-comprado
3. Escolha o template de sistema operacional: **Ubuntu 22.04 LTS** (ou 24.04 LTS, se disponível — qualquer um dos dois serve)
4. Defina a senha de root (ou deixe a Hostinger gerar uma) e finalize
5. Aguarde alguns minutos até o status da VPS ficar **Ativo/Running**

### Onde encontrar IP e credenciais

1. No hPanel, **VPS → Visão Geral (Overview) → Acesso SSH (SSH Access)**
2. Anote: **IP do servidor** (ex: `195.200.x.x`), **usuário** (`root`) e a **senha** (se você não definiu uma própria, veja o e-mail de boas-vindas da Hostinger, que também traz esses dados)

📝 **Anote esses 3 dados.** Você vai precisar deles no próximo passo.

---

## 2. Conectar via SSH

Você tem DUAS opções — escolha a que preferir:

### Opção A — Terminal direto no navegador (mais fácil, sem instalar nada)

1. No hPanel → **VPS → Visão Geral** → clique no botão **Terminal** (canto superior direito)
2. Uma janela abre já logada como `root` — pronto, pode seguir os comandos deste guia direto ali

> Use esta opção se quiser só validar algo rápido. Para os passos longos deste guia (colar blocos grandes de `.env`, por exemplo), a Opção B costuma ser mais confortável.

### Opção B — PowerShell (Windows)
```powershell
ssh root@195.200.x.x
```
Substitua `195.200.x.x` pelo IP real da sua VPS (hPanel → SSH Access). Quando perguntar a senha, cole a senha inicial (não vai aparecer nada no terminal enquanto digita — é normal).

Na primeira conexão, ele pergunta `Are you sure you want to continue connecting (yes/no)?`. Digite `yes`.

### Trocar a senha imediatamente
```bash
passwd
```
Digite uma senha forte (mínimo 16 caracteres com letras, números e símbolos). Anote em um gerenciador de senhas.

> Você também pode trocar a senha pelo próprio hPanel (VPS → Visão Geral → Acesso SSH → "Alterar senha"), sem precisar do comando `passwd` — as duas formas têm o mesmo efeito.

---

## 3. Atualizar Linux + instalar Docker

Cole esses comandos um de cada vez no terminal SSH:

```bash
# Atualiza o sistema
apt update && apt upgrade -y

# Instala dependências básicas
apt install -y curl wget git ufw nano htop ca-certificates gnupg

# Instala Docker (script oficial)
curl -fsSL https://get.docker.com | sh

# Verifica que Docker está rodando
docker --version
docker compose version
```

Saída esperada:
```
Docker version 24.x.x, build xxxxxxx
Docker Compose version v2.x.x
```

✅ **Pronto, Docker instalado.**

---

## 4. Configurar firewall (UFW)

```bash
# Permite SSH (porta 22) — IMPORTANTE: faça isso ANTES de ativar o firewall
ufw allow OpenSSH
ufw allow 22/tcp

# Permite HTTP e HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Ativa o firewall
ufw --force enable

# Verifica
ufw status
```

Saída esperada:
```
Status: active
To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

⚠️ **Importante:** As portas 5432 (PostgreSQL) e 6379 (Redis) NÃO devem ficar abertas — o Docker já as mantém apenas na rede interna.

### 4.1 — Camada extra: Firewall gerenciado da Hostinger (recomendado)

Além do `ufw` (que roda DENTRO da VPS), a Hostinger oferece um firewall gerenciado na FRENTE da VPS (bloqueia tráfego antes mesmo de chegar ao servidor) — defesa em profundidade, e mais fácil de ajustar sem risco de se trancar para fora via SSH:

1. hPanel → **VPS** → sua VPS → **Segurança → Firewall**
2. **Adicionar Firewall** → dê um nome (ex: `otron-crm`) → Criar
3. Adicione as regras de permissão (Accept): porta 22 (SSH), porta 80 (HTTP), porta 443 (HTTPS)
4. Anexe o firewall à sua VPS

> Por padrão o firewall da Hostinger **bloqueia tudo** que não tiver regra explícita — sem a regra de porta 22 você perde acesso SSH. Adicione as 3 regras acima antes de qualquer outra coisa.

---

## 5. Apontar o domínio para a VPS

No painel do seu registrador (Registro.br, GoDaddy, Hostgator, etc.) crie **dois registros A**:

| Tipo | Nome | Aponta para |
|---|---|---|
| A | `crm` (frontend) | IP da VPS, ex: `45.91.123.456` |
| A | `api` (backend)  | IP da VPS, ex: `45.91.123.456` |

Resultado:
- `crm.seudominio.com.br` → interface do CRM
- `api.seudominio.com.br` → API (backend)

⏳ **A propagação leva de 5 minutos a 2 horas.** Confirme com:
```bash
ping crm.seudominio.com.br
# deve retornar o IP da VPS
```

Se ainda não propagou, espere antes de seguir.

---

## 6. Baixar o projeto

Ainda no SSH da VPS:

```bash
cd /opt
git clone https://SEU_USUARIO_GITHUB/crm_otron.git
cd crm_otron
```

> Se o seu repositório for privado, configure uma chave SSH ou use HTTPS com token de acesso pessoal do GitHub.

---

## 7. Configurar `.env.production`

```bash
# Copia o template
cp backend/.env.example .env.production

# Edita o arquivo
nano .env.production
```

**Preencha cada campo abaixo.** Use o editor `nano`: navegue com setas, salve com `Ctrl+O` e `Enter`, saia com `Ctrl+X`.

```env
# ─── URLs ─────────────────────────────────────────────
NODE_ENV=production
BACKEND_URL=https://api.seudominio.com.br
FRONTEND_URL=https://crm.seudominio.com.br
PROXY_PORT=8080
PORT=8080

# ─── PostgreSQL ──────────────────────────────────────
DB_DIALECT=postgres
DB_USER=otron_user
DB_PASS=COLOQUE_SENHA_FORTE_AQUI
DB_NAME=otron_db

# ─── JWT (gere com `openssl rand -base64 32`) ────────
JWT_SECRET=COLE_AQUI_O_PRIMEIRO_SECRET_GERADO
JWT_REFRESH_SECRET=COLE_AQUI_O_SEGUNDO_SECRET_GERADO

# ─── Redis ───────────────────────────────────────────
REDIS_PASSWORD=COLOQUE_SENHA_FORTE_REDIS
REDIS_OPT_LIMITER_MAX=1
REDIS_OPT_LIMITER_DURATION=3000

# ─── Limites ─────────────────────────────────────────
USER_LIMIT=10000
CONNECTIONS_LIMIT=100000
CLOSED_SEND_BY_ME=true

# ─── E-mail (para reset de senha) ────────────────────
MAIL_HOST=smtp.hostinger.com
MAIL_USER=contato@seudominio.com.br
MAIL_PASS=SENHA_DA_CAIXA_DE_EMAIL
MAIL_FROM=Recuperar Senha <contato@seudominio.com.br>
MAIL_PORT=465

# ─── Rastreamento de erros (opcional) ────────────────
# Deixe em branco por enquanto. Preencha depois de instalar o GlitchTip
# (seção "Rastreamento de Erros" mais abaixo neste guia).
SENTRY_DSN=
```

### Gerar os 2 segredos JWT
Em outro terminal SSH (ou no mesmo, antes de editar) rode:
```bash
openssl rand -base64 32
openssl rand -base64 32
```
Cole o primeiro valor em `JWT_SECRET` e o segundo em `JWT_REFRESH_SECRET`.

### Gerar senha do PostgreSQL e Redis
```bash
openssl rand -base64 24
```
Use uma para `DB_PASS` e outra para `REDIS_PASSWORD`.

> 🔒 **NUNCA reutilize valores entre dev e produção.** O `.env.production` NÃO vai pro git (já está no `.gitignore`).

---

## 8. Gerar certificados SSL (Let's Encrypt)

### 8.1 — Editar o nginx para usar seus domínios reais
```bash
cp nginx/sites/crm.conf.example nginx/sites/crm.conf
nano nginx/sites/crm.conf
```
Substitua **todas as ocorrências** de `SEU_DOMINIO.com.br` pelo seu domínio real (use `Ctrl+\` no nano para substituir tudo).

### 8.2 — Iniciar nginx temporariamente sem SSL
```bash
# Sobe só o nginx, sem certificados ainda
docker compose -f docker-compose.prod.yml up -d nginx
```
Vai dar erro porque os certs ainda não existem. Pare e use o método abaixo:

```bash
# Cria um nginx temporário só para o desafio HTTP
docker run --rm -d --name temp_nginx -p 80:80 \
  -v $(pwd)/nginx/temp_html:/usr/share/nginx/html \
  -v certbot_www:/var/www/certbot \
  nginx:alpine
```

### 8.3 — Gerar certificado para `crm.seudominio.com.br` e `api.seudominio.com.br`
```bash
docker run --rm \
  -v certbot_certs:/etc/letsencrypt \
  -v certbot_www:/var/www/certbot \
  certbot/certbot certonly --webroot \
  -w /var/www/certbot \
  -d crm.seudominio.com.br \
  -d api.seudominio.com.br \
  --email seuemail@seudominio.com.br \
  --agree-tos --no-eff-email
```

Saída esperada:
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/crm.seudominio.com.br/fullchain.pem
```

### 8.4 — Parar o nginx temporário
```bash
docker stop temp_nginx
```

---

## 9. Subir todos os containers

```bash
# Carrega o .env.production no docker compose
export $(grep -v '^#' .env.production | xargs)

# Sobe tudo
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

A primeira build leva 5-10 minutos (compila TypeScript do backend, faz `npm run build` do frontend).

### Verificar que tudo subiu
```bash
docker compose -f docker-compose.prod.yml ps
```

Deve mostrar 6 containers com `Status: Up`:
```
otron_postgres   Up (healthy)
otron_redis      Up (healthy)
otron_backend    Up
otron_frontend   Up
otron_nginx      Up
otron_certbot    Up
```

### Acompanhar logs em tempo real
```bash
docker compose -f docker-compose.prod.yml logs -f backend
```
Procure pela linha:
```
[INFO] Server started on port: 8080
```
Pressione `Ctrl+C` para sair dos logs (não para o container).

---

## 10. Rodar migrations + criar primeiro super admin

### 10.1 — Rodar migrations (cria tabelas no PostgreSQL)
```bash
docker compose -f docker-compose.prod.yml exec backend npx sequelize db:migrate
```

### 10.2 — Rodar seeds (popula configurações padrão)
```bash
docker compose -f docker-compose.prod.yml exec backend npx sequelize db:seed:all
```

Isso cria automaticamente uma empresa demo e o primeiro usuário admin:
- **E-mail:** `admin@admin.com`
- **Senha:** `123456`

### 10.3 — Acessar a plataforma
Abra no navegador:
```
https://crm.seudominio.com.br
```
Faça login com o admin acima.

### 10.4 — Trocar senha do admin IMEDIATAMENTE
1. Clique no nome do usuário (canto superior direito) → **Perfil**
2. Troque a senha para uma forte
3. Troque também o e-mail

### 10.4.1 — Configurar o Provedor de IA (super admin, OBRIGATÓRIO para usar qualquer IA)

Desde a versão atual, a chave de API do LLM (Claude/GPT/Llama) e do Whisper (transcrição de áudio) **NÃO é mais por empresa** — é configurada **uma única vez pelo super admin** e vale para toda a plataforma.

1. **CONFIGURAÇÕES → Configurações → aba "Integrações"** (só aparece para super admin)
2. Preencha **Provedor de IA — Agente de Atendimento**: escolha o provedor (recomendado: Anthropic ou Groq), cole a API Key, selecione o modelo
3. Preencha **Provedor de IA — Secretária IA**: pode ser o mesmo provedor ou um diferente
4. (Opcional) Preencha **Whisper**: só necessário se quiser que a IA entenda mensagens de áudio
5. Salve

> Sem este passo, NENHUM agente de IA (Atendimento ou Secretária) funciona — eles vão responder com uma mensagem de erro genérica. Se você não pretende usar IA agora, pode pular e configurar depois.

**Onde conseguir a API Key:**
- **Anthropic (Claude):** [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key
- **Groq (Llama, gratuito no tier inicial):** [console.groq.com](https://console.groq.com) → API Keys

### 10.4.2 — Configurar quem é admin da Secretária IA (por empresa, OBRIGATÓRIO para usar a Secretária)

A Secretária IA (a IA de gestão que só fala com você) reconhece o admin pelo **número de telefone**, não pelo canal. Sem este passo, ela nunca vai reconhecer ninguém como admin.

1. Faça login como admin da empresa (não precisa ser super admin)
2. **CONFIGURAÇÕES → Configurações → aba "Agente IA" → aba "Secretária IA"**
3. No campo **"Números dos Admins"**, digite seu número **só com DDD + número**, sem `+55` (ex: `48988368758`). Pode adicionar mais de um separado por vírgula.
4. Salve

Teste: mande uma mensagem qualquer ("oi") pelo WhatsApp desse número para o número da sua empresa conectado no CRM. Se aparecer uma resposta da "Secretária IA" (e a conversa aparecer na aba **🎧 Secretária**, não em "Aguardando"/"Atendendo"), está funcionando.

### 10.5 — Configurar timezone da empresa (IMPORTANTE para Retenção)

O Módulo de Retenção dispara mensagens em horários configurados pelo admin. Se o servidor está em UTC mas você configura "09:00" pensando em horário de Brasília, o sistema precisa saber o fuso para disparar no momento certo.

Conecte no banco e execute (substitua `1` pelo `companyId`):

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    INSERT INTO \"Settings\" (key, value, \"companyId\", \"createdAt\", \"updatedAt\")
    VALUES ('timezone', 'America/Sao_Paulo', 1, NOW(), NOW())
    ON CONFLICT DO NOTHING;
  "
```

> Sem essa configuração o sistema assume **`America/Sao_Paulo`** como default. Mas se sua empresa atende outro fuso (Manaus, Acre, etc.), ajuste com o ID IANA correto (`America/Manaus`, `America/Rio_Branco`, etc.).

### 10.6 — Configurar features do Módulo de Retenção (opcional, mas recomendado)

O módulo entrega 7 sub-features que ficam **DESLIGADAS por padrão**. Habilite individualmente conforme sua estratégia. Para cada feature:

#### A) Aniversário Inteligente (3 toques: D-3, D-0+cupom, D+7)

```sql
INSERT INTO "Settings" (key, value, "companyId", "createdAt", "updatedAt") VALUES
  ('birthdayReminderEnabled', 'enabled', 1, NOW(), NOW()),
  ('birthdayReminderTime',    '09:00',   1, NOW(), NOW()),
  ('birthdayMessage', 'Feliz aniversário, {{name}}! 🎂 Para celebrar, te damos um presente: {{coupon}}', 1, NOW(), NOW())
ON CONFLICT DO NOTHING;
```

Cron roda a cada minuto, mas só dispara contatos cujo aniversário está em D-3, D-0 ou D+7. Cupons gerados no D-0 valem 30 dias.

#### B) Lembrete Preventivo (cliente em risco de dormência)

```sql
INSERT INTO "Settings" (key, value, "companyId", "createdAt", "updatedAt") VALUES
  ('preventiveReminderEnabled',   'enabled', 1, NOW(), NOW()),
  ('preventiveReminderTime',      '10:00',   1, NOW(), NOW()),
  ('preventiveReminderThreshold', '0.8',     1, NOW(), NOW()),
  ('preventiveReminderMessage', 'Olá {{name}}! Faz {{dias}} dias desde sua última visita. Sentimos sua falta! 😊', 1, NOW(), NOW())
ON CONFLICT DO NOTHING;
```

Threshold `0.8` significa: dispara quando o cliente atinge 80% do seu intervalo médio sem voltar.

#### C) Programa de Fidelidade (cupom a cada N serviços)

```sql
INSERT INTO "Settings" (key, value, "companyId", "createdAt", "updatedAt") VALUES
  ('loyaltyEnabled',       'enabled',     1, NOW(), NOW()),
  ('loyaltyMilestones',    '5,10,20,50,100', 1, NOW(), NOW()),
  ('loyaltyDiscountType',  'percent',     1, NOW(), NOW()),
  ('loyaltyDiscountValue', '15',          1, NOW(), NOW()),
  ('loyaltyValidDays',     '60',          1, NOW(), NOW()),
  ('loyaltyMessage', 'Parabéns {{name}}! 🎉 Você completou {{milestone}} serviços conosco. Ganhe {{coupon}}', 1, NOW(), NOW())
ON CONFLICT DO NOTHING;
```

> ⚠️ **Atenção em deploys com backfill de histórico**: o sistema NÃO recompensa serviços marcados com `source='migration'`. Se você importou histórico antigo, os clientes começam a contagem do zero a partir do primeiro serviço real pós-deploy. Isto é por design — evita dispensar 50 cupons para o cliente que já tinha 50 visitas antes do sistema existir.

#### D) Win-back Pós-Perda (clientes "perdidos")

```sql
INSERT INTO "Settings" (key, value, "companyId", "createdAt", "updatedAt") VALUES
  ('winbackEnabled',        'enabled',  1, NOW(), NOW()),
  ('winbackTime',           '11:00',    1, NOW(), NOW()),
  ('winbackDiscountType',   'percent',  1, NOW(), NOW()),
  ('winbackDiscountValue',  '20',       1, NOW(), NOW()),
  ('winbackValidDays',      '30',       1, NOW(), NOW()),
  ('winbackCooldownDays',   '90',       1, NOW(), NOW()),
  ('winbackMessage', 'Oi {{name}}, faz tempo! Volte com {{coupon}} ({{desconto}}) — válido {{dias}} dias.', 1, NOW(), NOW())
ON CONFLICT DO NOTHING;
```

#### E) Programa de Indicação

```sql
INSERT INTO "Settings" (key, value, "companyId", "createdAt", "updatedAt") VALUES
  ('referralEnabled',         'enabled', 1, NOW(), NOW()),
  ('referralDiscountType',    'percent', 1, NOW(), NOW()),
  ('referralDiscountValue',   '15',      1, NOW(), NOW()),
  ('referralValidDays',       '60',      1, NOW(), NOW()),
  ('referralReferrerMessage', 'Obrigado {{name}}! {{amigo}} virou cliente. Seu agradecimento: {{coupon}}', 1, NOW(), NOW()),
  ('referralReferredMessage', 'Bem-vindo {{name}}! Você foi indicado por um amigo. Presente: {{coupon}}', 1, NOW(), NOW())
ON CONFLICT DO NOTHING;
```

> RFM Segmentation e Cross-sell não precisam de configuração — são puramente analíticos.

### 10.7 — Validar instalação do Módulo de Retenção (smoke test)

```bash
# 1. Confirma que as 4 novas tabelas foram criadas
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "\dt" | grep -E "PreventiveTouches|LoyaltyRewards|WinbackAttempts|Referrals"
```
Esperado: 4 linhas.

```bash
# 2. Confirma que o backend está disparando os crons (procure por logs do BirthdayIntelligent e PreventiveReminder)
docker compose -f docker-compose.prod.yml logs --since=2m backend | grep -iE "birthday|preventive|winback"
```
Em horário de janela configurado, deve aparecer `[BirthdayIntelligent] Empresa X: N contatos...` etc.

```bash
# 3. Acessa a tela de Retenção no frontend
# Login → menu lateral → GESTÃO → 💎 Retenção
# Deve aparecer 9 abas: Adormecidos, Aniversários, Preventivo, Fidelidade, Win-back, RFM, Cross-sell, Indicações, Cupons
```

### 10.8 — Smoke test do Catálogo de Serviços

1. Menu lateral → **CONFIGURAÇÕES → Catálogo de Serviços**
2. Clique em **Novo Serviço** → preencha nome, categoria, preço (ex: R$ 40,00), duração
3. Deve aparecer na lista com o preço formatado
4. Teste pela IA: mande "Quais são os serviços e preços de vocês?" pelo número com Canal do Agente IA ativo — a resposta deve listar exatamente o que você cadastrou (não pode inventar outro serviço)

### 10.9 — Smoke test de Pacotes de Sessões

1. Menu lateral → **CONFIGURAÇÕES → Pacotes de Sessões**
2. Clique em **Novo Pacote** → preencha nome, quantidade de sessões, preço total, serviço vinculado (opcional)
3. Clique no ícone 🛒 (vender) → informe o ID de um contato de teste → deve confirmar "Pacote vendido com sucesso!"
4. Teste pela IA: "Quais pacotes vocês têm?" e "Quantas sessões ainda tenho disponíveis?" devem responder com os dados reais

### 10.10 — Smoke test da Secretária IA (ver também §10.4.2)

1. Mande "oi" pelo seu WhatsApp cadastrado como admin
2. Confirme que a resposta vem da Secretária (não do Agente de Atendimento) e a conversa aparece na aba 🎧 Secretária
3. Teste um comando de consulta: "quantos atendimentos temos hoje?" ou "quanto faturamos este mês?"
4. Teste um comando destrutivo (ex: se houver um ticket de teste, "feche o ticket #X") — a Secretária DEVE pedir confirmação ("responda sim ou não") antes de executar

---

## 🔄 Atualizar o sistema (quando sair nova versão)

```bash
cd /opt/crm_otron
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml exec backend npx sequelize db:migrate
```

---

## 🔐 Rotação de segredos (CRÍTICO em incidentes ou rotina)

Rotacione **imediatamente** se:
- Alguém com acesso aos segredos saiu da empresa
- Suspeita de vazamento (commit acidental, ataque, dispositivo perdido)
- Auditoria de segurança detectou exposição
- A cada **90 dias** como rotina (recomendação CLAUDE.md §IV.4)

### 11.1 — Rotacionar `JWT_SECRET` e `JWT_REFRESH_SECRET`

**⚠️ EFEITO COLATERAL:** todos os usuários logados serão deslogados e precisarão refazer login. Faça em horário de baixo movimento (madrugada).

```bash
cd /opt/crm_otron

# 1. Gera novos segredos
NEW_JWT=$(openssl rand -base64 32)
NEW_REFRESH=$(openssl rand -base64 32)
echo "NOVO JWT_SECRET: $NEW_JWT"
echo "NOVO JWT_REFRESH_SECRET: $NEW_REFRESH"

# 2. Edita .env.production
nano .env.production
# Substitua os valores antigos por $NEW_JWT e $NEW_REFRESH

# 3. Reinicia o backend (não precisa rebuild)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend

# 4. Verifica os logs
docker compose -f docker-compose.prod.yml logs --tail=20 backend
```

Avise os usuários: "vamos fazer manutenção rápida, vocês podem precisar entrar de novo".

### 11.2 — Rotacionar senha do Redis

**⚠️ EFEITO COLATERAL:** breve indisponibilidade (~30s) — fila de mensagens em trânsito pode descartar 1-2 jobs. Faça em horário de baixo movimento.

```bash
cd /opt/crm_otron

# 1. Gera nova senha
NEW_REDIS=$(openssl rand -base64 24)
echo "NOVA REDIS_PASSWORD: $NEW_REDIS"

# 2. Edita .env.production
nano .env.production
# Substitua REDIS_PASSWORD pelo valor de $NEW_REDIS

# 3. Reinicia Redis + backend (backend precisa nova URI)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d redis backend

# 4. Confirma que Bull queue voltou
docker compose -f docker-compose.prod.yml logs --tail=20 backend | grep -i "redis\|bull"
```

### 11.3 — Rotacionar senha do PostgreSQL

**⚠️ MAIS DELICADO:** muda a senha em 3 lugares (Postgres, backend env, próprias conexões existentes).

```bash
cd /opt/crm_otron

# 1. Gera nova senha
NEW_DB=$(openssl rand -base64 24)
echo "NOVA DB_PASS: $NEW_DB"

# 2. Atualiza senha NO Postgres em si
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "ALTER USER otron_user WITH PASSWORD '$NEW_DB';"

# 3. Edita .env.production (DB_PASS)
nano .env.production

# 4. Reinicia o backend
docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend
```

### 11.4 — Rotacionar API Keys das LLMs (Claude/Groq/OpenAI)

⚠️ **Mudou:** a chave NÃO é mais por empresa — é uma configuração ÚNICA da plataforma, feita pelo **super admin**:

1. Login como **super admin**
2. Vá em **CONFIGURAÇÕES → Configurações → aba "Integrações"** (só super admin vê essa aba — ver `MANUAL_PLATAFORMA.md` §9.5)
3. Gere nova key no painel do provedor (Anthropic Console, Groq Console, OpenAI Platform)
4. Cole a nova key (tem um campo para o Agente de Atendimento e outro para a Secretária IA — se usam o mesmo provedor, atualize os dois)
5. **Revogue a antiga** no painel do provedor

Uma única rotação vale para **todas as empresas** da plataforma — não precisa repetir por tenant.

### 11.5 — Checklist pós-rotação

- [ ] Anotou os novos valores em local seguro (gerenciador de senhas)?
- [ ] Apagou os valores antigos do histórico do shell (`history -c`)?
- [ ] Logs do backend sem erros após restart?
- [ ] Login de usuário funciona?
- [ ] WhatsApp ainda conectado?
- [ ] Atualizou senha do Redis no `.env.production` E no banco?
- [ ] Registrou a rotação no `decisions_log.md` com data e motivo?

---

## 💾 Configurar backup automático do PostgreSQL

Crie o arquivo `/opt/crm_otron/backup.sh`:
```bash
nano /opt/crm_otron/backup.sh
```
Cole:
```bash
#!/bin/bash
BACKUP_DIR=/opt/backups
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d_%H%M%S)
docker compose -f /opt/crm_otron/docker-compose.prod.yml exec -T postgres \
  pg_dump -U otron_user otron_db | gzip > $BACKUP_DIR/otron_$DATE.sql.gz

# Mantém só os últimos 30 dias
find $BACKUP_DIR -name "otron_*.sql.gz" -mtime +30 -delete
```
Torne executável e agende no cron diário:
```bash
chmod +x /opt/crm_otron/backup.sh
crontab -e
```
Adicione a linha (backup às 3h da manhã, todo dia):
```
0 3 * * * /opt/crm_otron/backup.sh
```

### Camada extra: Backup nativo da Hostinger (complementar, recomendado)

O script acima faz backup GRANULAR do banco (só os dados). A Hostinger também oferece backup da VPS INTEIRA (sistema operacional + arquivos + configuração) — útil para restaurar tudo de uma vez se o servidor inteiro tiver problema:

- **Backups automáticos:** semanais (e diários, se habilitado) — até 4 retidos, guardados fora da VPS
- **Snapshots manuais:** captura sob demanda antes de uma mudança arriscada (ex: antes de atualizar o sistema) — expira em 1 dia

Acesse em: hPanel → VPS → sua VPS → **Backups & Monitoramento → Snapshots & Backups**.

> Os dois se complementam: o `pg_dump` (acima) permite restaurar só o banco em qualquer lugar; o backup da Hostinger permite reconstruir a VPS inteira rapidamente. Mantenha os dois ativos.

---

## 🔍 Rastreamento de Erros (GlitchTip, opcional mas recomendado)

**O que é:** quando algo falha no CRM (ex: erro ao enviar mensagem, falha ao conectar no Google Calendário), o sistema hoje só imprime isso no console do servidor — some quando o processo reinicia. O GlitchTip é um software **open source e gratuito** (você mesmo hospeda, sem mensalidade) que guarda cada erro com todos os detalhes técnicos (o que aconteceu, em qual tela, qual cliente/empresa, linha do código), agrupa erros repetidos num só lugar, e te avisa por e-mail quando aparece um erro novo.

O código do CRM já está pronto pra isso — ele só precisa saber PARA ONDE mandar os erros (o "DSN"). Enquanto o campo `SENTRY_DSN` estiver vazio no `.env.production`, nada disso roda; é 100% opcional.

### 13.1 — Criar o arquivo de senhas do GlitchTip

```bash
cd /opt/crm_otron
nano .env.glitchtip
```
Cole (gere as senhas/segredo com `openssl rand -base64 32`, uma vez para cada linha marcada):
```env
GLITCHTIP_DB_USER=glitchtip_user
GLITCHTIP_DB_PASS=COLOQUE_SENHA_FORTE_AQUI
GLITCHTIP_DB_NAME=glitchtip_db
GLITCHTIP_SECRET_KEY=COLE_AQUI_UM_SEGREDO_GERADO
GLITCHTIP_DOMAIN=https://errors.seudominio.com.br
GLITCHTIP_EMAIL_FROM=glitchtip@seudominio.com.br
```
> Use senhas diferentes das do banco principal do CRM — são dois bancos separados.

### 13.2 — Subir os containers do GlitchTip

```bash
docker compose -f docker-compose.glitchtip.yml --env-file .env.glitchtip up -d
```
Isso sobe 5 containers: banco e fila próprios do GlitchTip, o painel web e o worker que processa os erros. Não mexe em nada do CRM já rodando.

### 13.3 — Apontar um subdomínio e gerar SSL (igual fizemos para o CRM)

1. No painel do seu domínio, crie um registro DNS tipo **A** apontando `errors.seudominio.com.br` para o IP da VPS (mesmo processo da seção 5).
2. Copie o arquivo de exemplo do nginx:
   ```bash
   cp nginx/sites/glitchtip.conf.example nginx/sites/glitchtip.conf
   nano nginx/sites/glitchtip.conf
   ```
   Substitua `SEU_DOMINIO.com.br` pelo seu domínio real (igual fez em `crm.conf`).
3. Gere o certificado SSL para esse novo subdomínio (mesmo comando da seção 8.3, trocando o domínio):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm certbot certonly \
     --webroot -w /var/www/certbot \
     -d errors.seudominio.com.br
   ```
4. Reinicie o nginx do CRM para carregar o novo site:
   ```bash
   docker compose -f docker-compose.prod.yml restart nginx
   ```

### 13.4 — Criar sua conta de administrador do GlitchTip

```bash
docker compose -f docker-compose.glitchtip.yml --env-file .env.glitchtip \
  exec glitchtip_web ./manage.py createsuperuser
```
Siga as perguntas (e-mail e senha). Depois acesse `https://errors.seudominio.com.br` e faça login.

### 13.5 — Criar o projeto e pegar o DSN

1. Dentro do GlitchTip, crie uma **Organização** (ex: "Otron CRM") e um **Projeto** (ex: "backend", plataforma "Node.js Express").
2. O GlitchTip mostra um **DSN** — algo como `https://abc123@errors.seudominio.com.br/1`. Copie esse valor.
3. Cole em `.env.production` do CRM:
   ```env
   SENTRY_DSN=https://abc123@errors.seudominio.com.br/1
   ```
4. Reinicie o backend do CRM:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build backend
   ```

A partir daqui, qualquer erro do CRM aparece no painel do GlitchTip, já identificado por empresa/cliente (usamos o `companyId` como marcação — ver `decisions_log.md`, entrada sobre rastreamento de erros).

### 13.6 — Testar que está funcionando

Force um erro proposital (ex: peça pra IA marcar um horário com o Google Calendário desconectado, ou tente enviar uma mensagem com o WhatsApp desconectado) e veja se ele aparece em `https://errors.seudominio.com.br` em poucos segundos.

> 💾 **Backup:** o banco do GlitchTip (`glitchtip_postgres_data`) guarda o histórico de erros. Se quiser, adicione uma segunda linha no script de backup da seção anterior fazendo `pg_dump` desse banco também — não é crítico como o banco principal do CRM (perder o histórico de erros não afeta clientes), mas é barato de manter.

---

## 🔧 Comandos úteis do dia-a-dia

### Ver logs de um serviço
```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f frontend
docker compose -f docker-compose.prod.yml logs -f postgres
```

### Reiniciar só o backend
```bash
docker compose -f docker-compose.prod.yml restart backend
```

### Acessar o banco direto
```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U otron_user -d otron_db
```

### Ver uso de recursos
```bash
docker stats
```

### Parar tudo
```bash
docker compose -f docker-compose.prod.yml down
```

### Parar e remover volumes (⚠️ APAGA DADOS!)
```bash
docker compose -f docker-compose.prod.yml down -v
```

---

## 🆘 Troubleshooting

### "502 Bad Gateway" ao abrir o site
- Backend não está rodando. `docker compose -f docker-compose.prod.yml logs backend` para ver o erro.

### "ERR_CONNECTION_REFUSED"
- DNS ainda não propagou. Espere 2h e teste com `nslookup crm.seudominio.com.br`.

### Backend reinicia em loop
- Verifique se PostgreSQL subiu antes: `docker compose -f docker-compose.prod.yml ps`. Se `otron_postgres` não estiver `healthy`, pode ser que a senha no `.env.production` contenha caracteres especiais que quebram o YAML — coloque entre aspas duplas.

### QR Code do WhatsApp não aparece
- Backend pode estar sem permissão de escrita nos volumes. Rode:
  ```bash
  docker compose -f docker-compose.prod.yml exec backend chmod -R 777 /app/sessions /app/public/uploads
  ```

### Erro 413 ao enviar mídia grande
- Aumente `client_max_body_size` no `nginx/nginx.conf` e reinicie o nginx.

---

## 🎯 Próximos passos

Agora que está rodando:
1. **Leia o `MANUAL_PLATAFORMA.md`** — explica o que cada aba faz (comece pela seção 9, sobre os dois agentes de IA)
2. **Configure sua primeira conexão WhatsApp** (Configurações → WhatsApp → Adicionar)
3. Se ainda não fez, **configure o Provedor de IA** (§10.4.1) e **seu número como admin da Secretária** (§10.4.2)
4. **Cadastre seus serviços reais** no Catálogo de Serviços (§10.8) — é o que a IA usa para responder preço
5. **Customize logos e cores** (super admin → Configurações → Logos)

Bom uso! 🎉
