#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Deploy de produção — CRM Otron
# ══════════════════════════════════════════════════════════════════════
#
# Uso:
#   ./scripts/deploy.sh              # deploy normal (aborta se CI vermelho)
#   ./scripts/deploy.sh --skip-ci    # pula o gate de CI (emergência, fica logado)
#   ./scripts/deploy.sh --yes        # não pede confirmação interativa (cron/CI)
#
# O QUE ESTE SCRIPT FAZ, NESTA ORDEM:
#   1. Valida pré-condições (repo limpo, branch main, .env.production com
#      permissão restrita)
#   2. git fetch + confere se origin/main tem commits novos
#   3. Gate de CI: consulta a GitHub Actions API pro SHA alvo — só segue
#      se o pipeline passou (Seção VI.5 do CLAUDE.md: "documento vs
#      realidade" — o projeto TEM CI bloqueante em main, então o deploy
#      tem que respeitar esse gate, não confiar cegamente no HEAD remoto)
#   4. Backup do Postgres (scripts/backup.sh) antes de tocar em qualquer
#      coisa — se o deploy sair errado, o dado do cliente não sai junto
#   5. git pull --ff-only (nunca merge/rebase automático — se divergiu,
#      humano decide)
#   6. Rebuild + restart via docker compose, SEMPRE com --env-file
#      .env.production explícito (bug real de 2026-08-19: sem essa flag
#      o compose usa .env, que não existe aqui, e o backend sobe em
#      crash-loop com JWT_SECRET/DB_* vazios)
#   7. Espera o backend estabilizar; se entrar em crash-loop, faz
#      rollback automático pro commit anterior e aborta
#   8. Roda as migrations pendentes dentro do container (a imagem de
#      runtime não carrega .sequelizerc, por isso os paths vão explícitos)
#   9. Health check HTTP + spot-check de exposição de infra (.env, .git —
#      Seção XV.7 do CLAUDE.md)
#
# O QUE ESTE SCRIPT NUNCA FAZ:
#   - Nunca imprime nem loga o conteúdo de .env.production
#   - Nunca faz `git push --force`, `reset --hard` ou merge automático
#   - Nunca segue com o deploy se a working tree tiver mudança não
#     commitada (isso deployaria código que ninguém revisou)
#   - Nunca faz rollback automático de migration (schema change é
#     manual por design — reverter dado é mais arriscado que parar)
# ══════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/deploy.log"
GITHUB_REPO="rithieldoamaral/crm-otron"
BACKEND_URL_LOCAL="http://localhost:8080"

SKIP_CI=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --skip-ci) SKIP_CI=1 ;;
    --yes|-y)  ASSUME_YES=1 ;;
    *) echo "Argumento desconhecido: $arg" >&2; exit 1 ;;
  esac
done

RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'; GREEN=$'\033[0;32m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'

mkdir -p "$LOG_DIR"

# Log estruturado (timestamp + nível + mensagem). Nunca receba aqui
# conteúdo de $ENV_FILE ou variáveis com secret — só metadados de deploy.
log() {
  local level="$1"; shift
  local line="$(date -u +%Y-%m-%dT%H:%M:%SZ) [$level] $*"
  echo "$line" | tee -a "$LOG_FILE" >&2
}

info()  { log INFO  "$*"; }
warn()  { echo "${YELLOW}⚠ $*${NC}"; log WARN "$*"; }
err()   { echo "${RED}✗ $*${NC}"; log ERROR "$*"; }
ok()    { echo "${GREEN}✓ $*${NC}"; log INFO "$*"; }

abort() { err "$1"; exit 1; }

# Rollback automático: volta pro SHA anterior, rebuilda e sobe de novo.
# Só é chamado se o backend novo entrar em crash-loop — nunca por conta
# de falha de migration (ver cabeçalho).
rollback() {
  local prev_sha="$1"
  err "Rollback automático → $prev_sha"
  git checkout --quiet "$prev_sha"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build backend 2>&1 | tee -a "$LOG_FILE"
  err "Rollback concluído. Investigue o commit que falhou ANTES de tentar de novo."
}

echo "${BLUE}══════════════════════════════════════════════${NC}"
echo "${BLUE}  Deploy CRM Otron — $(date -u +%Y-%m-%dT%H:%M:%SZ)${NC}"
echo "${BLUE}══════════════════════════════════════════════${NC}"

# ── 1. Pré-condições ────────────────────────────────────────────────
info "Validando pré-condições..."

[ -f "$COMPOSE_FILE" ] || abort "compose file '$COMPOSE_FILE' não encontrado em $REPO_DIR"
[ -f "$ENV_FILE" ] || abort "'$ENV_FILE' não encontrado — deploy de produção exige as credenciais reais, não vou seguir sem ele"

# .env.production nunca pode ser legível por outros usuários da VPS.
ENV_PERMS="$(stat -c '%a' "$ENV_FILE")"
if [ "$ENV_PERMS" != "600" ]; then
  abort "'$ENV_FILE' está com permissão $ENV_PERMS (esperado 600). Rode 'chmod 600 $ENV_FILE' antes de tentar de novo — não vou deployar com secrets legíveis por outros usuários."
fi

if [ -n "$(git status --porcelain)" ]; then
  abort "Working tree suja. Deploy de produção só roda com árvore limpa — commit, stash ou descarte antes de tentar de novo."
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  abort "Branch atual é '$CURRENT_BRANCH', não 'main'. Deploy de produção só roda a partir de main."
fi

PREV_SHA="$(git rev-parse HEAD)"
ok "Pré-condições OK (branch main, tree limpa, $ENV_FILE com permissão 600)"

# ── 2. Fetch + confere se há commits novos ──────────────────────────
info "Buscando atualizações do GitHub..."
git fetch origin main --quiet

TARGET_SHA="$(git rev-parse origin/main)"

if [ "$PREV_SHA" = "$TARGET_SHA" ]; then
  ok "Já está atualizado (${PREV_SHA:0:7}). Nada para fazer."
  exit 0
fi

# Se main local não é ancestral de origin/main, alguém commitou local ou
# a história divergiu — resolução manual, o script não decide por você.
if ! git merge-base --is-ancestor "$PREV_SHA" "$TARGET_SHA"; then
  abort "Histórico divergiu de origin/main (não é fast-forward). Resolva manualmente — este script nunca faz merge/rebase/reset automático."
fi

info "Novo alvo: ${PREV_SHA:0:7} → ${TARGET_SHA:0:7}"
git log --oneline "$PREV_SHA..$TARGET_SHA" | tee -a "$LOG_FILE"

# ── 3. Gate de CI ────────────────────────────────────────────────────
# O repo é público e não há `gh` CLI instalado nesta VPS — consulta a
# Checks API sem autenticação (rate limit de 60 req/h, suficiente pra
# deploy manual). Se GITHUB_TOKEN estiver no ambiente do operador, usa
# pra evitar rate limit, mas nunca é obrigatório.
#
# IMPORTANTE: a API antiga de "commit status" (/commits/{sha}/status)
# NÃO reflete workflows do GitHub Actions — testado neste repo em
# 2026-08-19 e retornou total_count=0/state=pending pro HEAD atual,
# mesmo com os 4 jobs do CI já verdes. Usar aquela API teria travado
# todo deploy em "pending" pra sempre. O endpoint certo é /check-runs.
if [ "$SKIP_CI" -eq 1 ]; then
  warn "Gate de CI PULADO (--skip-ci). Isso só é aceitável em emergência documentada — registre o motivo em decisions_log.md."
else
  info "Checando status do CI para ${TARGET_SHA:0:7}..."
  AUTH_HEADER=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    AUTH_HEADER=(-H "Authorization: Bearer $GITHUB_TOKEN")
  fi

  CHECK_RUNS_JSON="$(curl -fsSL "${AUTH_HEADER[@]}" \
    "https://api.github.com/repos/${GITHUB_REPO}/commits/${TARGET_SHA}/check-runs?per_page=100")" \
    || abort "Não consegui consultar a Checks API do GitHub — verifique conectividade/rate limit antes de tentar de novo (ou use --skip-ci em emergência real)."

  CI_STATE="$(python3 -c '
import json, sys
data = json.load(sys.stdin)
runs = data.get("check_runs", [])
if not runs:
    print("no_checks")
    sys.exit()
if any(r["status"] != "completed" for r in runs):
    print("pending")
    sys.exit()
bad = {"failure", "timed_out", "cancelled", "action_required", "stale"}
if any(r["conclusion"] in bad for r in runs):
    print("failure")
    sys.exit()
print("success")
' <<< "$CHECK_RUNS_JSON")"

  case "$CI_STATE" in
    success)
      ok "CI verde para ${TARGET_SHA:0:7} ($(python3 -c 'import json,sys;print(len(json.load(sys.stdin)["check_runs"]))' <<< "$CHECK_RUNS_JSON") checks)"
      ;;
    pending)
      abort "CI ainda rodando para ${TARGET_SHA:0:7}. Espere terminar ou rode com --skip-ci se for emergência real."
      ;;
    no_checks)
      abort "Nenhum check-run encontrado pra ${TARGET_SHA:0:7} — o commit ainda não foi processado pelo CI (ou o push é muito recente). Espere alguns segundos e tente de novo."
      ;;
    *)
      abort "CI FALHOU para ${TARGET_SHA:0:7}. Não vou deployar código que não passou no pipeline. Veja https://github.com/${GITHUB_REPO}/commits/${TARGET_SHA} — use --skip-ci só em emergência documentada."
      ;;
  esac
fi

# ── Confirmação interativa ──────────────────────────────────────────
if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Confirma deploy de ${PREV_SHA:0:7} → ${TARGET_SHA:0:7} em PRODUÇÃO? [y/N] " reply
  case "$reply" in
    y|Y|yes) ;;
    *) abort "Cancelado pelo operador." ;;
  esac
fi

# ── 4. Backup antes de qualquer mudança ─────────────────────────────
info "Rodando backup do Postgres antes do deploy..."
if [ -x "./backup.sh" ]; then
  ./backup.sh 2>&1 | tee -a "$LOG_FILE"
  ok "Backup concluído"
else
  abort "backup.sh não encontrado ou sem permissão de execução — não vou deployar sem backup prévio."
fi

# ── 5. Atualiza o código (fast-forward apenas) ──────────────────────
info "git pull --ff-only origin main..."
git pull --ff-only origin main 2>&1 | tee -a "$LOG_FILE"

# ── 6. Rebuild + restart com env-file explícito ─────────────────────
info "Rebuild + restart via docker compose (--env-file $ENV_FILE)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build 2>&1 | tee -a "$LOG_FILE"

# ── 7. Espera o backend estabilizar ─────────────────────────────────
info "Aguardando backend estabilizar..."
BACKEND_STABLE=0
for i in $(seq 1 12); do
  sleep 5
  STATUS="$(docker inspect otron_backend --format '{{.State.Status}}' 2>/dev/null || echo "missing")"
  RESTARTS="$(docker inspect otron_backend --format '{{.RestartCount}}' 2>/dev/null || echo "0")"
  if [ "$STATUS" = "running" ] && [ "$RESTARTS" -eq 0 ]; then
    BACKEND_STABLE=1
    break
  fi
  info "  tentativa $i/12: status=$STATUS restarts=$RESTARTS"
done

if [ "$BACKEND_STABLE" -ne 1 ]; then
  err "Backend não estabilizou (status=$STATUS restarts=$RESTARTS) — entrando em rollback automático"
  rollback "$PREV_SHA"
  abort "Deploy abortado e revertido. Veja '$LOG_FILE' e 'docker compose logs backend' para a causa raiz."
fi
ok "Backend estável (running, 0 restarts)"

# ── 8. Migrations ────────────────────────────────────────────────────
# A imagem de runtime só copia dist/ e public/ (ver backend/Dockerfile),
# então .sequelizerc não existe dentro do container — paths explícitos.
info "Rodando migrations pendentes..."
if docker compose -f "$COMPOSE_FILE" exec -T backend \
    npx sequelize db:migrate \
    --config dist/config/database.js \
    --migrations-path dist/database/migrations 2>&1 | tee -a "$LOG_FILE"; then
  ok "Migrations aplicadas"
else
  # Migration falhou com o app já no ar rodando código novo contra schema
  # velho. Não fazemos rollback de schema automático (Seção IX: reverter
  # dado é decisão humana) — paramos e alertamos alto.
  abort "FALHA em migrations. Backend está rodando código novo contra schema desatualizado — intervenção manual necessária AGORA (docker compose exec backend npx sequelize db:migrate:status)."
fi

# ── 9. Health check + spot-check de exposição de infra (XV.7) ──────
info "Health check HTTP..."
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BACKEND_URL_LOCAL" || echo "000")"
if [[ "$HTTP_CODE" =~ ^[23] ]] || [ "$HTTP_CODE" = "404" ]; then
  ok "Backend respondendo (HTTP $HTTP_CODE)"
else
  warn "Backend respondeu HTTP $HTTP_CODE em $BACKEND_URL_LOCAL — verifique manualmente, não houve rollback automático (containers subiram, só o health check é inconclusivo)."
fi

# Spot-check leve: infra sensível não pode responder 200 pela web.
FRONTEND_URL="$(grep -E '^FRONTEND_URL=' "$ENV_FILE" | cut -d= -f2- || true)"
if [ -n "$FRONTEND_URL" ]; then
  for path in ".env" ".git/config"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "${FRONTEND_URL%/}/$path" || echo "000")"
    if [ "$code" = "200" ]; then
      warn "EXPOSIÇÃO DE INFRA: ${FRONTEND_URL%/}/$path respondeu 200 — investigue AGORA (CLAUDE.md XV.7)."
    fi
  done
fi

echo "${BLUE}══════════════════════════════════════════════${NC}"
ok "Deploy concluído: ${PREV_SHA:0:7} → ${TARGET_SHA:0:7}"
echo "${BLUE}══════════════════════════════════════════════${NC}"
