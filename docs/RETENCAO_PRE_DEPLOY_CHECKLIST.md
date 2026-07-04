# Checklist Pré-Deploy — Módulo de Retenção

> Use este checklist sequencialmente. Marque cada item conforme conclui.
> **Tempo estimado:** 45-60 minutos para um deploy de primeira vez do módulo.

---

## ✅ Validação local (já feito durante desenvolvimento)

- [x] **TypeScript compila sem erros** (`npx tsc --noEmit` → 0 erros)
- [x] **Suite Jest passa 100%** (706 baseline + 160 novos = 866 testes, 65 suites)
- [x] **Frontend build clean** (não validado em build prod, validado em dev)
- [x] **Revisão sênior aplicada** — 3 blockers + 3 high corrigidos (B1, B3, B4, H1, H3/H4, H6)
- [x] **Migrations geradas** — 4 novas: PreventiveTouches, LoyaltyRewards, WinbackAttempts, Referrals (+1 alter Contact)
- [x] **decisions_log.md atualizado** com Fase 3 + Fase 4 + revisão sênior

---

## 🚀 Deploy no Contabo — passos

### 1. Pré-deploy: backup do banco
```bash
ssh root@SEU_IP
cd /opt/crm_otron
./backup.sh   # ou o comando manual do §11 do DEPLOY_DOCKER_CONTABO.md
ls -lh /opt/backups/ | tail -3
```
- [ ] Backup mais recente é deste momento

### 2. Pull do código + rebuild
```bash
cd /opt/crm_otron
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
- [ ] Build completou sem erros TypeScript
- [ ] `docker compose ps` mostra todos os 6 containers `Up`

### 3. Migrations (cria as 4 tabelas novas + adiciona preço aos serviços)
```bash
docker compose -f docker-compose.prod.yml exec backend npx sequelize db:migrate
```
- [ ] Output mostra `== 20260520000001-create-PreventiveTouches: migrated`
- [ ] Output mostra `== 20260520000002-create-LoyaltyRewards: migrated`
- [ ] Output mostra `== 20260520000003-create-WinbackAttempts: migrated`
- [ ] Output mostra `== 20260520000004-create-Referrals: migrated`
- [ ] Output mostra `== 20260521000001-add-price-to-Services: migrated` (Fase 5)
- [ ] Output mostra `== 20260521000002-create-Packages: migrated` (Fase 6)
- [ ] Output mostra `== 20260521000003-create-ClientPackagePurchases: migrated` (Fase 6)
- [ ] Output mostra `== 20260521000004-create-PackageConsumptions: migrated` (Fase 6)

### 3.1 Validação coluna price em Services (Fase 5)
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='Services' AND column_name IN ('price','category');
  "
```
- [ ] Retorna 2 linhas (`price` numeric, `category` character varying)

### 3.2 Validação tabelas Fase 6 (Pacotes)
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('Packages','ClientPackagePurchases','PackageConsumptions');
  "
```
- [ ] Retorna 3 linhas (`Packages`, `ClientPackagePurchases`, `PackageConsumptions`)

### 4. Validação das tabelas criadas
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('PreventiveTouches','LoyaltyRewards','WinbackAttempts','Referrals');
  "
```
- [ ] Retorna 4 linhas

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    SELECT column_name FROM information_schema.columns
    WHERE table_name='Contacts' AND column_name='referralCode';
  "
```
- [ ] Retorna 1 linha (campo `referralCode` adicionado em Contacts)

### 5. Configurar timezone da empresa
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    INSERT INTO \"Settings\" (key, value, \"companyId\", \"createdAt\", \"updatedAt\")
    VALUES ('timezone', 'America/Sao_Paulo', 1, NOW(), NOW())
    ON CONFLICT DO NOTHING;
  "
```
- [ ] Setting `timezone` criado (substitua `1` por outros companyIds se multi-tenant)

### 6. Validar que os crons subiram
```bash
docker compose -f docker-compose.prod.yml logs --since=3m backend | grep -iE "Server started|cron"
```
- [ ] Vê `Server started on port`
- [ ] Sem erros de inicialização de cron

### 7. Smoke test do frontend
1. Abra `https://crm.seudominio.com.br`
2. Login como admin
3. - [ ] Menu lateral GESTÃO mostra **💎 Retenção** (entre Relatórios e Etiquetas)
4. Clique em Retenção
5. - [ ] Página abre sem erros, com 9 abas visíveis
6. Navegue por cada aba — todas devem carregar (vazias se não há dados é OK)
7. - [ ] Aba **Adormecidos** carrega
8. - [ ] Aba **Aniversários** carrega
9. - [ ] Aba **Preventivo** carrega
10. - [ ] Aba **Fidelidade** carrega
11. - [ ] Aba **Win-back** carrega
12. - [ ] Aba **RFM** carrega
13. - [ ] Aba **Cross-sell** carrega
14. - [ ] Aba **Indicações** carrega
15. - [ ] Aba **Cupons** carrega

### 7.1 Smoke test do Catálogo de Serviços (Fase 5)

1. Menu lateral → **Catálogo de Serviços** (na seção CONFIGURAÇÕES, após Filas)
2. - [ ] Página abre sem erros
3. Clique em **Novo Serviço** → preencha nome, categoria, preço (ex: R$ 40,00), duração
4. - [ ] Serviço criado aparece na lista com preço formatado
5. - [ ] Chip verde exibe "R$ 40,00" (serviços sem preço exibem "A combinar")
6. Edite o serviço → altere o preço
7. - [ ] Preço atualizado corretamente
8. Toggle "Ativo" → desative o serviço
9. - [ ] Serviço some da lista (reaparecer ao marcar "Mostrar inativos")

**Teste da tool da secretária:**
```
Usuário WhatsApp: "Quais são os serviços e preços de vocês?"
```
- [ ] Agente responde listando os serviços com preços (tool `consultar_catalogo` acionada)

### 7.2 Smoke test de Pacotes de Sessões (Fase 6)

1. Menu lateral → **Pacotes de Sessões** (logo abaixo de Catálogo de Serviços)
2. - [ ] Página abre sem erros
3. Clique em **Novo Pacote** → preencha: nome "Pacote 10 Sessões Laser", sessões 10, preço R$ 300,00, serviço vinculado (se cadastrado)
4. - [ ] Pacote criado aparece na tabela
5. - [ ] Chip de preço exibe "R$ 300,00"
6. - [ ] Se serviço tiver preço (ex: R$ 40,00 × 10 = R$ 400,00), chip verde mostra "-25%"
7. Clique no ícone de carrinho 🛒 (vender) → informe ID de um contato de teste
8. - [ ] Toast "Pacote vendido com sucesso! Mensagem WhatsApp enviada"
9. - [ ] ServiceHistory criado com source='package_purchase' (verificar via query ou logs)

**Teste das tools da secretária:**
```
Usuário WhatsApp: "Quais pacotes de sessões vocês têm?"
```
- [ ] Agente responde com lista de pacotes (tool `listar_pacotes` acionada)

```
Usuário WhatsApp: "Quantas sessões ainda tenho disponíveis?"
```
- [ ] Agente responde com saldo do pacote do cliente (tool `ver_saldo_pacote` acionada)

### 8. Habilitar features (opcional — comece com 1 ou 2)

Recomendado: comece com **Aniversário** apenas, valide com 1-2 aniversariantes próximos, depois habilite Fidelidade e Preventivo. Win-back e Indicações por último (mais visibilidade).

```bash
# Aniversário (essencial — captura datas existentes)
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    INSERT INTO \"Settings\" (key, value, \"companyId\", \"createdAt\", \"updatedAt\") VALUES
    ('birthdayReminderEnabled', 'enabled', 1, NOW(), NOW()),
    ('birthdayReminderTime',    '09:00',   1, NOW(), NOW()),
    ('birthdayMessage', 'Feliz aniversário, {{name}}! 🎂 Use {{coupon}} no seu próximo serviço.', 1, NOW(), NOW())
    ON CONFLICT DO NOTHING;
  "
```
- [ ] Settings de Aniversário criados

> SQL para as demais features (Fidelidade, Win-back, Indicações, Preventivo) estão no §10.6 do `DEPLOY_DOCKER_CONTABO.md`.

### 9. Validar Tag de "Venda Concluída" (para Kanban auto-tracking)

1. Frontend → **Etiquetas** → editar ou criar nova
2. Marque o checkbox **"Marcar como Venda Concluída"**
3. - [ ] Apenas 1 tag por empresa deve ter isso marcado (constraint no banco)
4. Mova um card no Kanban para a coluna dessa tag
5. - [ ] No banco, deve aparecer um novo registro em `ServiceHistories` com `source='kanban_completion'`

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    SELECT id, \"contactId\", source, \"occurredAt\"
    FROM \"ServiceHistories\"
    ORDER BY \"createdAt\" DESC LIMIT 5;
  "
```

### 10. Monitoramento pós-deploy (primeiras 24h)

```bash
# Acompanhe logs em tempo real
docker compose -f docker-compose.prod.yml logs -f backend | grep -iE "birthday|preventive|winback|loyalty|referral"
```
- [ ] Procure por logs de disparo no horário configurado (ex: 09:00 BR para aniversário)
- [ ] Sem erros `[ERROR]` repetidos relacionados aos módulos de retenção

```bash
# Confirme que cupons estão sendo gerados (se houve aniversariante hoje)
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    SELECT code, reason, \"createdAt\" FROM \"Coupons\"
    WHERE reason IN ('birthday','loyalty','reactivation','referral')
    ORDER BY \"createdAt\" DESC LIMIT 10;
  "
```

---

## 🔥 Rollback (se algo der errado)

Se aparecer erro grave nos logs ou comportamento estranho:

```bash
# 1. Desabilita TODAS as features de retenção rapidamente
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U otron_user -d otron_db -c "
    UPDATE \"Settings\"
    SET value='disabled'
    WHERE key IN ('birthdayReminderEnabled', 'preventiveReminderEnabled',
                  'loyaltyEnabled', 'winbackEnabled', 'referralEnabled');
  "

# 2. Se quiser reverter o código:
cd /opt/crm_otron
git log --oneline -5     # identifica o commit antes do deploy
git checkout <hash_antes>
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 3. As 4 tabelas novas não vão atrapalhar (ficam vazias e idle)
# 4. NÃO faça `db:migrate:undo` em produção sem backup recente
```

---

## 📊 KPIs para acompanhar nas primeiras 2 semanas

| KPI | Onde olhar | Meta inicial |
|---|---|---|
| Toques de aniversário enviados | Aba Aniversários → "Toques enviados" | ≥ 80% dos aniversariantes elegíveis |
| Taxa de resgate de cupons | Aba Cupons → "Taxa de resgate" | ≥ 15% (benchmark de mercado SMB) |
| Toques preventivos → retorno | Aba Preventivo → "Taxa de retorno" | ≥ 25% (proativo é o de maior conversão) |
| Cupons de fidelidade entregues | Aba Fidelidade → "Recompensas entregues" | depende da base — alvo: ≥ 5% dos clientes ativos |
| Tentativas win-back → conversão | Aba Win-back → "Taxa de conversão" | ≥ 10% |
| Indicações registradas | Aba Indicações → "Total indicações" | ≥ 1 por semana inicial |
| Distribuição RFM "Champions" | Aba RFM → linha "Campeões" | manter ≥ 10% da base ativa |

Se algum KPI estiver muito abaixo da meta após 2 semanas:
- Revisar o template de mensagem (pode estar com tom errado)
- Revisar o threshold/cooldown (pode estar muito conservador)
- Verificar logs para erros silenciosos

---

## 📞 Suporte / Dúvidas

- **Documentação técnica do módulo:** `docs/RETENCAO_REVISAO_SENIOR.md`
- **Manual do usuário:** `docs/MANUAL_PLATAFORMA.md` § 5.3 Retenção
- **Diretiva original:** `docs/PROPOSTA_RETENCAO.md`
- **Log de decisões arquiteturais:** `decisions_log.md`
