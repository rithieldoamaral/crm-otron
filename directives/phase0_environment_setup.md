# Diretiva: Fase 0 — Configuração do Ambiente Local

**Status:** ✅ Concluída em 2026-04-19
**Data:** 2026-04-19
**Responsável:** Claude Code + Usuário

---

## Objetivo

Garantir que o ambiente de desenvolvimento local esteja 100% funcional antes de qualquer nova feature. O critério de sucesso é: backend rodando, frontend abrindo no browser, um número WhatsApp conectado via QR Code, e uma mensagem de teste circulando pelo sistema.

---

## Pré-requisitos (verificar antes de iniciar)

- [ ] Docker Desktop instalado e rodando
- [ ] Node.js >= 18 instalado (`node --version`)
- [ ] npm instalado (`npm --version`)
- [ ] Git instalado
- [ ] Arquivo `backend/.env` existente (já confirmado ✅)
- [ ] `docker-compose.yml` configurado (já confirmado ✅)
- [ ] Um número de WhatsApp disponível para testes (chip separado recomendado)

---

## Entradas

- Projeto em `c:/Users/rithi/OneDrive/Documentos/Aplicativos/crm_otron/`
- `backend/.env` com credenciais do banco (já configurado)
- `docker-compose.yml` com PostgreSQL 15 + Redis 7 (já configurado)

---

## Passos de Execução

### Passo 1 — Subir banco de dados e Redis
```bash
cd crm_otron
docker-compose up -d
```
**Verificação:** `docker ps` deve mostrar `crm_otron_postgres` e `crm_otron_redis` com status `Up`

### Passo 2 — Instalar dependências do backend
```bash
cd backend
npm install
```
**Verificação:** Sem erros fatais. Warnings são aceitáveis.

### Passo 3 — Rodar migrações do banco
```bash
cd backend
npm run db:migrate
```
**Verificação:** Todas as migrations aplicadas sem erro.

### Passo 4 — Iniciar o backend em modo dev
```bash
cd backend
npm run dev
```
**Verificação:** Console mostra `Server started on port 8080` sem erros de conexão com banco/Redis.

### Passo 5 — Instalar dependências do frontend
```bash
cd frontend
npm install
```
**Verificação:** Sem erros fatais.

### Passo 6 — Iniciar o frontend
```bash
cd frontend
npm start
```
**Verificação:** Browser abre em `http://localhost:3000` mostrando a tela de login.

### Passo 7 — Criar empresa e usuário admin
Via interface web ou via seed, criar:
- Empresa de teste
- Usuário admin com email e senha

### Passo 8 — Conectar WhatsApp
- Acessar configurações de WhatsApp no painel
- Escanear QR Code com o celular de teste
- Status deve mudar para `CONNECTED`

### Passo 9 — Teste de fumaça (smoke test)
- Enviar mensagem do celular de teste para o número conectado
- Verificar se o ticket é criado no painel
- Responder pelo painel e verificar se chega no celular

---

## Saídas Esperadas

- Backend rodando em `http://localhost:8080`
- Frontend rodando em `http://localhost:3000`
- PostgreSQL acessível em `localhost:5432`
- Redis acessível em `localhost:6379`
- Pelo menos 1 conexão WhatsApp com status `CONNECTED`
- Fluxo básico de mensagem → ticket → resposta funcionando

---

## Edge Cases e Troubleshooting

| Problema | Causa Provável | Solução |
|---|---|---|
| `ECONNREFUSED` ao iniciar backend | PostgreSQL não subiu | `docker ps` → reiniciar container |
| Erro de migration `relation already exists` | Migration já rodada | Normal, ignorar |
| QR Code não aparece | Baileys não inicializou | Reiniciar backend |
| Frontend não conecta no backend | CORS ou porta errada | Verificar `REACT_APP_BACKEND_URL` no `frontend/.env` |
| `Cannot find module` no backend | node_modules ausente | `npm install` novamente |

---

## Success Criteria

✅ Backend inicia sem erros críticos
✅ Frontend carrega a tela de login
✅ Migrações aplicadas sem erro
✅ WhatsApp conectado (status CONNECTED)
✅ Mensagem de teste cria ticket no painel
✅ Resposta pelo painel chega no celular

---

## Failure Modes

❌ Backend não conecta no PostgreSQL → Docker não está rodando
❌ Migration falha com erro de coluna → Conflito de versão do schema — investigar migration específica
❌ WhatsApp bana o número → Usar chip dedicado para testes, nunca número pessoal principal
❌ node_modules com conflito de versão → Deletar `node_modules` e `package-lock.json`, reinstalar

---

## Próximo Passo após Fase 0

Fase 1A — Agente de Atendimento ao Cliente (ver `directives/phase1a_agent_atendimento.md`)
