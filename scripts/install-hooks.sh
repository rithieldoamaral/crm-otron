#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Instala os git hooks do projeto
# ══════════════════════════════════════════════════════════════════════
#
# Rode UMA VEZ por clone do repositório:
#   bash scripts/install-hooks.sh
#
# Hooks vivem em .githooks/ (versionado) em vez de .git/hooks/ (local e
# nunca versionado). O `core.hooksPath` aponta o git para o diretório
# versionado, então todo mundo no time recebe os mesmos hooks pelo próprio
# clone — sem passo manual de cópia que alguém esquece.
# ══════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [ ! -d .githooks ]; then
  echo "erro: diretório .githooks não encontrado em $REPO_ROOT" >&2
  exit 1
fi

git config core.hooksPath .githooks

# No Windows o bit de execução costuma se perder; o Git Bash executa o
# hook mesmo assim, mas em macOS/Linux ele é obrigatório.
chmod +x .githooks/* 2>/dev/null || true

echo "✓ Hooks instalados (core.hooksPath = .githooks)"
echo
echo "Ativos:"
echo "  pre-commit → bloqueia .env, credenciais, arquivo grande e"
echo "               lockfile no .gitignore; roda eslint no que mudou."
echo
echo "Para desinstalar: git config --unset core.hooksPath"
