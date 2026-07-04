# 🚀 Deploy do CRM Otron na Contabo VPS via Docker

> **Tempo estimado:** 60-90 minutos (primeira vez)
> **Pré-requisitos:** uma VPS Contabo contratada, um domínio (ex: `seudominio.com.br`) e acesso ao painel de DNS desse domínio.

Este guia leva você do zero (VPS recém-comprada) até o CRM Otron rodando em produção com:
- ✅ PostgreSQL (banco de dados)
- ✅ Redis (cache + fila de mensagens)
- ✅ Backend Node.js (API + WhatsApp)
- ✅ Frontend React (interface)
- ✅ Nginx (proxy reverso)
- ✅ SSL/HTTPS automático (Let's Encrypt)
- ✅ Backups automáticos do PostgreSQL

---

## 📋 Checklist rápido (visão geral)

| Etapa | O que vai fazer | Tempo |
|---|---|---|
| 1 | Contratar VPS Contabo e anotar o IP | 10 min |
| 2 | Conectar via SSH | 5 min |
| 3 | Atualizar Linux + instalar Docker | 10 min |
| 4 | Configurar firewall | 5 min |
| 5 | Apontar domínio para a VPS | 10 min (+ até 2h propagação) |
| 6 | Baixar projeto | 5 min |
| 7 | Configurar `.env.production` | 10 min |
| 8 | Gerar certificados SSL | 10 min |
| 9 | Subir os containers | 10 min |
| 10 | Criar primeiro super admin | 5 min |

---

## 1. Contratar VPS Contabo

### Configuração recomendada
- **Plano:** VPS S SSD (mínimo) ou VPS M SSD (recomendado)
- **CPU:** 4 vCPU
- **RAM:** 8 GB (mínimo); 16 GB se for atender muitas conexões WhatsApp simultâneas
- **Disco:** 200 GB SSD
- **Sistema operacional:** Ubuntu 22.04 LTS
- **Região:** Estados Unidos (East) ou Europa Central (latência menor para Brasil que a Ásia)

### Após a compra
A Contabo envia um e-mail com:
- **IP do servidor** (ex: `45.91.123.456`)
- **Usuário:** geralmente `root`
- **Senha:** uma senha aleatória inicial

📝 **Anote esses 3 dados.** Você vai precisar deles no próximo passo.

---

## 2. Conectar via SSH

### No Windows (PowerShell)
```powershell
ssh root@45.91.123.456
```
Substitua `45.91.123.456` pelo IP que você recebeu da Contabo. Quando perguntar a senha, cole a senha inicial (não vai aparecer nada no terminal enquanto digita — é normal).

Na primeira conexão, ele pergunta `Are you sure you want to continue connecting (yes/no)?`. Digite `yes`.

### Trocar a senha imediatamente
```bash
passwd
```
Digite uma senha forte (mínimo 16 caracteres com letras, números e símbolos). Anote em um gerenciador de senhas.

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

### 11.4 — Rotacionar API Keys das LLMs (Claude/OpenAI/Gemini)

Essas ficam no **banco** (não em `.env`), salvas pela tela **CONFIGURAÇÕES → Configurações → Agente IA**:

1. Login como admin
2. Vá em **CONFIGURAÇÕES → Configurações → aba "Agente IA"**
3. Gere nova key no painel do provedor (Anthropic Console, OpenAI Platform, Google AI Studio)
4. Cole a nova key
5. **Revogue a antiga** no painel do provedor

Como cada empresa (tenant) tem sua própria key, repita para cada uma se for multi-empresa.

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
1. **Leia o `MANUAL_PLATAFORMA.md`** — explica o que cada aba faz
2. **Configure sua primeira conexão WhatsApp** (Configurações → WhatsApp → Adicionar)
3. **Configure o Agente IA** (Configurações → Configurações → Agente IA)
4. **Customize logos e cores** (super admin → Configurações → Logos)

Bom uso! 🎉
