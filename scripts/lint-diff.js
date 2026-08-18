#!/usr/bin/env node
/**
 * Lint das LINHAS alteradas — não do arquivo inteiro.
 *
 * POR QUE ESTE ARQUIVO EXISTE:
 *
 * A primeira versão do portão de lint rodava o ESLint nos arquivos
 * alterados por inteiro. Parecia razoável até a primeira tentativa real de
 * commit: uma correção de segurança de 6 linhas em `app.ts` foi bloqueada
 * por 125 erros de formatação preexistentes naquele arquivo — nenhum deles
 * introduzido pela mudança.
 *
 * Esse é o caminho mais curto para alguém adotar `--no-verify` como hábito
 * e desativar, junto, as checagens de credencial que realmente importam.
 *
 * A base é um fork do Whaticket com 12.449 problemas de lint em 711
 * arquivos (74% formatação), porque o `npm run lint` estava quebrado desde
 * o commit inicial e nunca rodou. Nesse cenário só existem três posturas:
 *
 *   ✗ Reformatar tudo: diff de 711 arquivos, `git blame` inutilizado,
 *     revisão impossível — viola CLAUDE.md II.6.
 *   ✗ Cobrar o arquivo inteiro: pune quem encosta em código legado e
 *     treina o time a contornar o hook.
 *   ✓ Cobrar as linhas escritas: você responde pelo que escreveu. O
 *     legado é limpo aos poucos, sem travar o trabalho de hoje.
 *
 * USO:
 *   node scripts/lint-diff.js --staged          # pre-commit
 *   node scripts/lint-diff.js --base origin/main  # CI
 *
 * Saída 0 = nenhum erro NAS LINHAS ALTERADAS. Saída 1 = há erro a corrigir.
 */

const { execFileSync } = require("child_process");
const path = require("path");

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8"
}).trim();

/** Arquivos .ts do backend que a comparação escolhida marcou como alterados. */
function getChangedFiles(diffArgs) {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", ...diffArgs, "--", "backend/src"],
    { encoding: "utf8", cwd: REPO_ROOT }
  );
  return out
    .split("\n")
    .map(f => f.trim())
    .filter(f => f.endsWith(".ts"));
}

/**
 * Números das linhas ADICIONADAS ou MODIFICADAS em um arquivo.
 *
 * Usa `-U0` para que o diff traga só as linhas tocadas, sem contexto —
 * contexto entraria no conjunto e voltaríamos a cobrar linhas alheias.
 * Do cabeçalho `@@ -a,b +c,d @@` interessa apenas o lado `+`.
 */
function getChangedLines(file, diffArgs) {
  const diff = execFileSync(
    "git",
    ["diff", "-U0", ...diffArgs, "--", file],
    { encoding: "utf8", cwd: REPO_ROOT }
  );

  const lines = new Set();
  const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

  for (const line of diff.split("\n")) {
    const match = hunkHeader.exec(line);
    if (!match) continue;

    const start = parseInt(match[1], 10);
    // Contagem ausente no cabeçalho significa 1 linha.
    const count = match[2] === undefined ? 1 : parseInt(match[2], 10);

    for (let i = 0; i < count; i += 1) lines.add(start + i);
  }

  return lines;
}

function main() {
  const args = process.argv.slice(2);
  const staged = args.includes("--staged");
  const baseIndex = args.indexOf("--base");

  let diffArgs;
  if (staged) {
    diffArgs = ["--cached"];
  } else if (baseIndex !== -1 && args[baseIndex + 1]) {
    const base = args[baseIndex + 1];
    let mergeBase = base;
    try {
      mergeBase = execFileSync("git", ["merge-base", "HEAD", base], {
        encoding: "utf8",
        cwd: REPO_ROOT
      }).trim();
    } catch (err) {
      // Ref desconhecida (branch nova, clone raso): comparar com o topo
      // informado ainda é melhor que não comparar nada. Avisa e segue.
      console.error(
        `aviso: merge-base com '${base}' falhou (${err.message.split("\n")[0]}); comparando direto.`
      );
    }
    diffArgs = [mergeBase, "HEAD"];
  } else {
    console.error("uso: lint-diff.js --staged | --base <ref>");
    process.exit(2);
  }

  const files = getChangedFiles(diffArgs);
  if (files.length === 0) {
    console.log("Nenhum .ts do backend alterado — lint dispensado.");
    return;
  }

  const changedLinesByFile = new Map();
  for (const file of files) {
    changedLinesByFile.set(file, getChangedLines(file, diffArgs));
  }

  // O ESLint precisa rodar a partir de backend/ para achar .eslintrc.json
  // e os plugins instalados em backend/node_modules.
  const backendDir = path.join(REPO_ROOT, "backend");
  const relativeFiles = files.map(f => f.replace(/^backend\//, ""));

  // Chama o entrypoint JS do ESLint com o próprio Node em vez de `npx`.
  // No Windows, spawnar `npx.cmd` falha com EINVAL a partir do Node 20
  // (arquivos .cmd exigem shell), e usar shell abriria espaço para
  // interpretação de metacaracteres em nomes de arquivo.
  const eslintBin = path.join(
    backendDir,
    "node_modules",
    "eslint",
    "bin",
    "eslint.js"
  );

  let report;
  try {
    const raw = execFileSync(
      process.execPath,
      [eslintBin, "--format", "json", ...relativeFiles],
      { encoding: "utf8", cwd: backendDir, maxBuffer: 64 * 1024 * 1024 }
    );
    report = JSON.parse(raw);
  } catch (err) {
    // O eslint sai com código 1 quando encontra erro — o relatório JSON
    // ainda vem no stdout e é exatamente o que precisamos analisar.
    if (err.stdout) {
      try {
        report = JSON.parse(err.stdout);
      } catch (parseErr) {
        console.error("Falha ao interpretar a saída do ESLint:", parseErr.message);
        console.error(err.stdout.slice(0, 2000));
        process.exit(1);
      }
    } else {
      console.error("Falha ao executar o ESLint:", err.message);
      process.exit(1);
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  let ignoredPreexisting = 0;

  for (const result of report) {
    const relative = path
      .relative(REPO_ROOT, result.filePath)
      .split(path.sep)
      .join("/");
    const changed = changedLinesByFile.get(relative);
    if (!changed) continue;

    const relevant = result.messages.filter(m => m.line && changed.has(m.line));
    ignoredPreexisting += result.messages.length - relevant.length;

    if (relevant.length === 0) continue;

    console.log(`\n${relative}`);
    for (const m of relevant) {
      const kind = m.severity === 2 ? "erro   " : "aviso  ";
      if (m.severity === 2) errorCount += 1;
      else warningCount += 1;
      console.log(
        `  ${String(m.line).padStart(5)}:${String(m.column).padEnd(4)} ${kind} ${m.message}  (${m.ruleId || "—"})`
      );
    }
  }

  console.log("");
  if (ignoredPreexisting > 0) {
    console.log(
      `${ignoredPreexisting} problema(s) preexistente(s) fora das linhas alteradas: ignorado(s).`
    );
  }

  if (errorCount > 0) {
    console.error(
      `✗ ${errorCount} erro(s) e ${warningCount} aviso(s) NAS LINHAS ALTERADAS.`
    );
    console.error("  Corrija com: cd backend && npx eslint --fix <arquivo>");
    process.exit(1);
  }

  console.log(
    `✓ Lint OK nas linhas alteradas${warningCount > 0 ? ` (${warningCount} aviso(s))` : ""}.`
  );
}

main();
