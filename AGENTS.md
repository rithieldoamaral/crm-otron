# Instruções do Agente — Versão A+++

> **CONTEXTO DO PROJETO:** Antes de qualquer tarefa, leia o arquivo `MEMORY.md` na raiz do projeto. Ele contém o estado atual completo da plataforma, decisões arquiteturais, módulos implementados, tech debt pendente e instruções de continuidade. É o ponto de partida obrigatório para qualquer nova sessão.

> \\\*\\\*Nota de Sistema:\\\*\\\* Este arquivo é espelhado em CLAUDE.md, AGENTS.md e GEMINI.md, garantindo que as mesmas instruções de arquitetura e qualidade de código sejam carregadas em qualquer ambiente de IA (Antigravity ou Claude Code no terminal).

Você opera dentro de uma arquitetura de 3 camadas que separa responsabilidades para maximizar a confiabilidade, a manutenibilidade e a clareza do código. LLMs são probabilísticos, enquanto a maior parte da lógica de negócios é determinística e exige consistência. Este sistema resolve esse descompasso.

\---

## I. Arquitetura de 3 Camadas

### Camada 1: Diretiva (O que fazer)

* Basicamente são SOPs (Standard Operating Procedures) escritos em Markdown, que vivem em `directives/`.
* Definem objetivos, entradas, ferramentas/scripts a usar, saídas e edge cases.
* Instruções em linguagem natural, como você daria a um engenheiro de software de nível pleno/sênior.
* **NOVO**: Cada diretiva deve ter uma seção explícita de "Success Criteria" e "Failure Modes".

### Camada 2: Orquestração (Tomada de decisão)

* É você. Sua função: roteamento inteligente.
* Ler diretivas, chamar ferramentas de execução na ordem correta, lidar com erros, pedir esclarecimentos e atualizar diretivas com novos aprendizados.
* Você é a ponte entre intenção e execução. Exemplo: você não tenta fazer scraping manualmente — você lê `directives/scrape\\\_website.md`, formula entradas/saídas e então roda `execution/scrape\\\_single\\\_site.py`.
* **NOVO**: Mantém um log de decisões em `decisions\\\_log.md` para rastreabilidade.

### Camada 3: Execução (Fazer o trabalho)

* Scripts determinísticos dentro de `execution/`.
* Variáveis de ambiente, tokens de API, etc., vivem no `.env` e NUNCA devem ser commitados no controle de versão.
* Lida com chamadas de API, processamento de dados, operações de arquivos, interações com banco de dados.
* Confiável, testável, rápido. Use scripts em vez de fazer tudo manualmente.
* **NOVO**: Toda execução deve logar em formato estruturado (JSON).

\---

## II. Princípios Rigorosos de QA, TDD e Segurança (INVIOLÁVEIS)

Para garantir que o projeto sobreviva ao tempo e passe por qualquer auditoria sênior, as seguintes regras são obrigatórias.

### 1\. Test-Driven Development (TDD) Rigoroso

* **O Teste Vem ANTES do Código:** Você DEVE escrever o teste automatizado (ex: unitário em Python/Pytest ou Javascript/Jest) antes de escrever qualquer nova função ou lógica de negócios determinística.
* **Proibição de Código Não Testado:** Se você sugerir uma função sem um teste correspondente, o usuário deve recusar. Não escreva código sem cobertura de teste. O teste define o "sucesso" determinístico da lógica probabilística que você criará.
* **Regressão Ativa:** Ao rodar o loop de auto-aperfeiçoamento (self-annealing), os testes novos e existentes devem ser executados para garantir que a correção não quebrou features antigas.
* **NOVO - Cobertura Mínima:** Novo código deve ter cobertura de testes ≥ 80%. Sem exceções.
* **NOVO - Integração \& E2E:** Além de unitários, inclua testes de integração para fluxos críticos (ex: autenticação, pagamento).

### 2\. Validação e Segurança pré-Deploy

* **Código Limpo:** Use scripts determinísticos na Camada 3 para rodar linters (`flake8` ou `eslint`) e validadores de código para eliminar code smells e manter a formatação impecável.
* **Análise de Vulnerabilidades:** Verifique periodicamente as dependências do projeto em busca de falhas de segurança conhecidas e atualize-as conforme necessário, documentando a mudança.
* **NOVO - SAST (Static Application Security Testing):** Rode ferramentas como `bandit` (Python) ou `snyk` (JS) em cada commit.
* **NOVO - Secrets Scanning:** Nenhum token, senha ou chave API pode ser commitado. Use `git-secrets` ou `pre-commit` hooks.
* **NOVO - Type Safety:** Type hints obrigatórios em Python (`mypy` + `pydantic`). TypeScript obrigatório para JS.

### 3\. Documentação e Descrição Exaustiva

* **Nenhuma modificação silenciosa:** Toda alteração de código, refatoração ou criação de nova feature deve ser estritamente documentada.
* **Código Auto-explicativo e Comentado:** Todo código gerado deve conter comentários claros explicando o *porquê* daquela lógica existir, e não apenas o *o quê*.
* **Histórico de Decisões:** Se uma escolha arquitetural complexa for feita, registre-a brevemente no código ou na documentação correspondente.
* **NOVO - Docstrings Obrigatórias:** Toda função/classe deve ter docstring explicando (Google/Sphinx format):

  * Descrição breve
  * Args com tipos
  * Returns com tipos
  * Raises (exceções esperadas)
  * Exemplos de uso
* **NOVO - CHANGELOG.md Estruturado:** Cada mudança é registrada seguindo `keep-a-changelog.com` format.

### 4\. Modularização e Isolamento (Separação de Responsabilidades)

* **Arquivos Únicos por Contexto:** É terminantemente proibido criar arquivos monolíticos gigantescos. Cada aba, tela, componente visual ou módulo lógico de um aplicativo DEVE ser separado em um arquivo distinto.
* **DRY (Don't Repeat Yourself):** Lógicas repetidas devem ser extraídas para arquivos utilitários ou de serviços (ex: `utils/` ou `services/`).
* **NOVO - Single Responsibility Principle:** Cada arquivo/classe/função tem UMA responsabilidade. Se você consegue descrevê-la com "e/ou", está errado.
* **NOVO - Circular Dependencies:** Proibidas. Mapeie dependências com ferramentas como `madge` (JS) ou `graphviz` (visualmente).

### 5\. Sintoma vs Causa Raiz (INVIOLÁVEL)

* **Identifique a causa raiz ANTES de propor o fix.** Quando aparecer um bug, pergunte "por quê" três vezes até chegar na origem real, não pare no primeiro nível.
* **Sinais de que você está corrigindo o sintoma e não a causa:** o fix exige `try/catch` defensivo só para silenciar erro, retry sem entender por que falha, `setTimeout` "para esperar algo", variável global "para funcionar", ou `if isso então aquilo` para casos que "não deviam acontecer". Se aparecer um desses, PARE e investigue uma camada acima.
* **`catch` silencioso é proibido.** Toda exceção capturada deve ser logada (`logger.error`) com contexto suficiente para diagnosticar — `catch { return null }` esconde bugs que aparecem semanas depois sem rastro.
* **Comentários `TODO: arrumar direito depois` são proibidos.** Ou arrume agora, ou registre formalmente como tech debt em `decisions_log.md` com data, motivo e responsável.
* **Como aplicar:** antes de escrever o fix, verbalize a hipótese de causa raiz. Se não souber explicar em 1-2 frases por que o bug acontece, você ainda está no sintoma.

### 6\. Mínima Mudança Necessária (INVIOLÁVEL)

* **Cada fix/commit deve ser a MENOR mudança que resolve o problema.** Não inclua refatorações adjacentes "já que estou aqui" — isso transforma um diff de 5 linhas revisável em 200 linhas onde o bug se esconde.
* **Refator de código adjacente vai em PR/commit separado**, mesmo que seja só renomear uma função. Mistura de bugfix + refator quebra `git bisect` e dificulta rollback.
* **Sinal de alerta:** se um fix simples está exigindo tocar 3+ arquivos, provavelmente há uma causa raiz mais alta que resolveria com menos mudança. Pare e reinvestigue antes de continuar.
* **Quando em dúvida entre fix de 5 linhas e refator de 50:** faça o de 5 e abra um item em `decisions_log.md` para o refator. O fix entra em produção hoje; o refator quando houver tempo de fazer com calma.
* **Como aplicar:** ao terminar um fix, releia o diff e pergunte "tudo aqui é estritamente necessário para corrigir o bug reportado?". Tudo que não for, sai.

\---

## III. Organização de Arquivos e Nuvem

### Deliverables vs Intermediários

* **Deliverables:** Arquivos finais, aplicativos compilados ou documentos na nuvem que o usuário final acessa.
* **Intermediários:** Arquivos temporários criados durante o processamento de dados.

### Estrutura Base de Diretórios (Expandida)

```text
.tmp/                    # Arquivos intermediários (sempre regeneráveis e descartáveis)

execution/               # Scripts determinísticos de automação/ferramentas
├── api\\\_client.py       # Integrações com APIs externas
├── database.py         # Operações de BD
├── data\\\_processor.py   # ETL, transformação de dados
└── validators.py       # Validações determinísticas

directives/              # SOPs em Markdown (o cérebro procedural)
├── feature\\\_name.md     # Descrição, entradas, saídas, edge cases
└── api\\\_integration.md

src/                     # Código-fonte principal do aplicativo
├── components/         # Componentes visuais isolados e reutilizáveis
│   ├── Button.jsx
│   ├── Modal.jsx
│   └── index.js        # Barrel export
├── screens/            # (ou tabs/) Telas/abas separadas em arquivos únicos
│   ├── HomeScreen.jsx
│   ├── ProfileScreen.jsx
│   └── index.js
├── services/           # Integrações com APIs, banco de dados
│   ├── authService.js
│   ├── userService.js
│   └── apiClient.js    # Cliente HTTP centralizado (axios/fetch wrapper)
├── utils/              # Funções auxiliares e lógicas de negócio puras
│   ├── formatters.js   # Formatação de data, moeda, etc
│   ├── validators.js   # Validações de input
│   ├── constants.js
│   └── helpers.js
├── hooks/              # React Hooks customizados (se aplicável)
│   ├── useAuth.js
│   └── useFetch.js
├── config/             # Configurações globais
│   ├── environment.js
│   └── api.config.js
├── types/              # TypeScript types/interfaces (se aplicável)
│   ├── User.ts
│   └── API.ts
└── App.jsx             # Componente raiz

tests/                   # Suíte de testes automatizados
├── unit/               # Testes unitários para utils/services
│   ├── formatters.test.js
│   ├── validators.test.js
│   └── authService.test.js
├── integration/        # Testes de integração (ex: fluxo completo)
│   ├── auth\\\_flow.test.js
│   └── user\\\_registration.test.js
├── e2e/                # Testes end-to-end (opcional, com Cypress/Playwright)
│   └── user\\\_journey.test.js
└── fixtures/           # Dados mock para testes

scripts/                # CI/CD e automações
├── pre-commit.sh       # Validação antes de commit (testes + linters)
├── deploy.sh           # Script de deploy
├── test.sh             # Rodar testes com coverage
└── lint.sh             # Rodar linters

.env                     # Variáveis de ambiente LOCAIS (não versionar)
.env.example            # Template com placeholders (VERSIONAR isto)
.gitignore              # Inclua .env, node\\\_modules, \\\_\\\_pycache\\\_\\\_, etc
CHANGELOG.md            # Histórico estruturado de mudanças
decisions\\\_log.md        # Log de decisões arquiteturais
README.md               # Documentação geral do projeto
.pre-commit-config.yaml # Pre-commit hooks automáticos
```

\---

## IV. Gestão de Secrets e Variáveis de Ambiente (NOVO)

### 4.1 Arquivo `.env` Local

* **NUNCA commit:** Adicione `.env` ao `.gitignore` imediatamente
* **Template Público:** Crie `.env.example` com placeholders, este SIM é versionado

```env
  DATABASE\\\_URL=postgresql://user:pass@localhost/mydb
  API\\\_KEY\\\_EXTERNAL=your\\\_api\\\_key\\\_here
  JWT\\\_SECRET=super\\\_secret\\\_key\\\_change\\\_in\\\_production
  NODE\\\_ENV=development
  ```

* **Validação em Runtime:** Script de inicialização valida que todas as vars obrigatórias estão presentes

### 4.2 Produção: Estratégia de Secrets

Escolha uma (ou combine):

|Ambiente|Recomendação|Ferramenta|
|-|-|-|
|**Local/Dev**|`.env` file|dotenv|
|**Docker**|Docker Secrets ou volume mapeado|Docker|
|**AWS**|AWS Secrets Manager|boto3|
|**GCP**|Google Secret Manager|google-cloud-secret-manager|
|**Kubernetes**|Secrets objects (encrypted)|kubectl|
|**Self-hosted**|HashiCorp Vault|vault client|

**Padrão Recomendado:**

```python
# config/secrets.py
import os
from typing import Optional

class SecretManager:
    @staticmethod
    def get(key: str, default: Optional\\\[str] = None) -> str:
        """
        Tenta obter secret de:
        1. Variáveis de ambiente
        2. AWS Secrets Manager (se em produção)
        3. Default value
        """
        value = os.getenv(key)
        if not value and os.getenv("ENVIRONMENT") == "production":
            # Buscar de AWS/Vault/etc
            pass
        return value or default

# Uso:
api\\\_key = SecretManager.get("API\\\_KEY\\\_EXTERNAL")
```

### 4.3 Regra de Isolamento de Segredos (Frontend vs Backend)

NUNCA injete variáveis de ambiente que contenham chaves de API sensíveis (como OpenAI, AWS, tokens de banco de dados) em código que será executado no navegador (ex: React, Vue, Next.js client-components). O .env protege o repositório, mas não protege o Build do frontend. Toda comunicação com APIs pagas/sensíveis DEVE ser feita por um Backend intermediário. Chaves no frontend vazam via Source Maps.



```

### 4.4 Checklist de Segurança

\* \\\[ ] Nenhum secret em logs
\* \\\[ ] Nenhum secret em commits (use `git-secrets` pre-commit hook)
\* \\\[ ] Secrets em variáveis de ambiente, nunca hardcoded
\* \\\[ ] `.env` está no `.gitignore`
\* \\\[ ] Acesso a secrets limitado (RBAC)
\* \\\[ ] Rotação de secrets a cada 90 dias (em produção)
\* \\\[ ] Auditoria de who/when/how acessou cada secret

\\---

## V. Logging e Observabilidade (NOVO)

### 5.1 Estrutura de Logs

Todos os logs devem ser \*\*estruturados em JSON\*\* para facilitar parsing:

```python
# Python example
import json
import logging
from datetime import datetime

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log\\\_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "trace\\\_id": getattr(record, "trace\\\_id", None),  # Para rastreamento distribuído
        }
        if record.exc\\\_info:
            log\\\_data\\\["exception"] = self.formatException(record.exc\\\_info)
        return json.dumps(log\\\_data)

logger = logging.getLogger(\\\_\\\_name\\\_\\\_)
handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logger.addHandler(handler)

# Uso:
logger.info("User login successful", extra={"trace\\\_id": "xyz123", "user\\\_id": 42})
```

```javascript
// JavaScript example
const winston = require('winston');

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: \\\[
    new winston.transports.Console()
  ]
});

// Uso:
logger.info('User login successful', {
  traceId: 'xyz123',
  userId: 42,
  duration: 234  // ms
});
```

### 5.2 Níveis de Log

|Nível|Uso|Exemplo|
|-|-|-|
|**DEBUG**|Informações detalhadas para diagnóstico|Valores de variáveis, fluxo de execução|
|**INFO**|Eventos significativos normais|"User logged in", "API call succeeded"|
|**WARNING**|Algo inesperado mas não crítico|"Retry attempt 3/5", "Cache miss"|
|**ERROR**|Erro que deve ser investigado|"Database connection failed", "Invalid input"|
|**CRITICAL**|Sistema pode cair|"Out of memory", "Database unreachable"|

### 5.3 Trace ID para Correlação

Implemente rastreamento distribuído:

```python
import uuid
from contextvars import ContextVar

trace\\\_id\\\_var: ContextVar\\\[str] = ContextVar('trace\\\_id', default=None)

def generate\\\_trace\\\_id():
    trace\\\_id = str(uuid.uuid4())
    trace\\\_id\\\_var.set(trace\\\_id)
    return trace\\\_id

# Em cada request (Flask/FastAPI):
@app.before\\\_request
def set\\\_trace\\\_id():
    trace\\\_id = request.headers.get('X-Trace-ID') or generate\\\_trace\\\_id()
    trace\\\_id\\\_var.set(trace\\\_id)

# Em logs:
logger.info("User action", extra={"trace\\\_id": trace\\\_id\\\_var.get()})
```

### 5.4 Monitoramento e Alertas

**Ferramentas Recomendadas:**

|Stack|Logging|Métricas|Alertas|
|-|-|-|-|
|**Self-hosted**|ELK (Elasticsearch, Logstash, Kibana)|Prometheus|AlertManager|
|**AWS**|CloudWatch Logs|CloudWatch Metrics|SNS/Lambda|
|**GCP**|Cloud Logging|Cloud Monitoring|Cloud Alerting|
|**SaaS**|Datadog, New Relic, Sentry|(incluído)|(incluído)|

**SLA Mínimo:**

* Logs retidos por 30 dias
* Métricas retidas por 1 ano
* Alertas em tempo real para CRITICAL/ERROR
* Dashboard de saúde do sistema acessível

\---

## VI. CI/CD Pipeline Explícito (NOVO)

### 6.1 Ferramenta Recomendada: GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: \\\[main, develop]
  pull\\\_request:
    branches: \\\[main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: \\\['3.9', '3.10', '3.11']

    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: ${{ matrix.python-version }}
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-cov flake8 black mypy bandit
      
      - name: Lint with flake8
        run: |
          flake8 src/ tests/ --count --select=E9,F63,F7,F82 --show-source --statistics
      
      - name: Format check with black
        run: black --check src/ tests/
      
      - name: Type check with mypy
        run: mypy src/
      
      - name: Security scan with bandit
        run: bandit -r src/
      
      - name: Secrets scan
        uses: trufflesecurity/trufflehog@main
      
      - name: Run tests with coverage
        run: pytest tests/ --cov=src/ --cov-report=xml --cov-report=html
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage.xml
      
      - name: Comment PR with coverage
        if: github.event\\\_name == 'pull\\\_request'
        uses: py-cov-action/python-coverage-comment-action@v3

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main' \\\&\\\& github.event\\\_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to production
        run: |
          # Script de deploy específico
          ./scripts/deploy.sh production
```

### 6.2 Regras de Gating

|Condição|Ação|Bloqueante|
|-|-|-|
|Testes falham|Marcar como failed|✅ SIM|
|Cobertura < 80%|Comentário de aviso|✅ SIM (em main)|
|Linter falha|Listar issues|✅ SIM|
|Secrets detectados|Bloquear push|✅ SIM|
|Type check falha|Marcar como failed|⚠️ AVISO (upgrade)|

### 6.3 Fluxo de Merge

```
Feature Branch
    ↓
Push → CI Pipeline (testes, linters, security)
    ↓
✅ Passar em TODOS checks
    ↓
Code Review (≥ 1 aprovação)
    ↓
Merge to develop
    ↓
Deploy staging (automático)
    ↓
Testes smoke (automático)
    ↓
Manual approval para produção
    ↓
Deploy main (automático)
    ↓
Monitoramento (SLA: disponibilidade > 99.5%)
```

### 6.4 Lockfile e Determinismo de Dependências (INVIOLÁVEL)

**O lockfile (`package-lock.json` / `poetry.lock` / `yarn.lock`) É código. Commite-o sempre.**

* **Nunca coloque lockfile no `.gitignore`.** Sem ele, cada `npm install` resolve as versões de novo e cada ambiente instala um conjunto diferente de dependências. O repositório deixa de descrever o software que roda em produção.
* **Deploy usa `npm ci`, nunca `npm install`.** `ci` instala exatamente o lockfile e falha se ele estiver dessincronizado do `package.json`. `install` reescreve o lockfile silenciosamente e é o vetor por onde entra código que ninguém revisou.
* **Ranges (`^`, `~`) são perigosos em dependências que você acopla profundamente.** Para bibliotecas cuja tipagem ou protocolo você usa de forma acoplada (ex: `baileys`), **fixe a versão exata**. Um `^7.0.0-rc.9` autoriza o npm a instalar `rc13`.
* **O risco real não é o build quebrar** — build quebrado é visível. O risco é a versão nova instalar, compilar e *rodar com comportamento diferente* em produção, sem ninguém saber.
* **Precedente no projeto:** commit `aca9ffa`. `backend/.gitignore` ignorava `package-lock.json` → sem lockfile → `npm install` resolveu `baileys ^7.0.0-rc.9` para `rc13` → tipagem incompatível em `authState.ts`/`wbot.ts` → build de produção quebrado na VPS. Corrigido versionando o lockfile e fixando `baileys` em `7.0.0-rc.9`.

### 6.5 Documento vs Realidade (INVIOLÁVEL)

**Um portão descrito neste documento mas ausente do repositório não é um portão — é uma ficção que dá falsa sensação de cobertura.**

* As Seções VI (CI/CD) e VII.1 (pre-commit) descrevem pipelines em detalhe. **Verifique se eles existem de fato** antes de assumir que qualquer validação automática está acontecendo.
* **Se este documento exige um controle que o repositório não implementa, você DEVE apontar isso ao usuário** em vez de operar como se o controle existisse. Não é "fora de escopo" — é a diferença entre achar que se está protegido e estar.
* **Como aplicar:** ao terminar qualquer trabalho, a pergunta não é "meus testes passaram na minha máquina?" e sim "existe algum portão automático entre a minha máquina e a produção?". Se não existe, diga isso explicitamente ao entregar.

**Estado atual (atualizado em 2026-07-27):**

| Controle | Arquivo | Situação |
|---|---|---|
| CI/CD | `.github/workflows/ci.yml` | ✅ Ativo — 4 jobs bloqueantes em `main` |
| Pre-commit | `.githooks/pre-commit` | ✅ Ativo — instalar com `bash scripts/install-hooks.sh` |
| Scan de secrets (profundo) | job `security` do CI | ✅ TruffleHog, bloqueante |
| Lint | `scripts/lint-changed.sh` | ⚠️ Incremental — só arquivos alterados (base legada tem 12.449 problemas) |
| `npm audit` | job `security` do CI | ⚠️ Relatório, não bloqueante (decisão registrada) |
| Cobertura mínima ≥ 80% (II.1) | — | ❌ Não medida ainda; tech debt |

**Um ponto de honestidade sobre o pre-commit:** a Seção VII.1 propõe `.pre-commit-config.yaml`, que exige Python (`pip install pre-commit`). Este projeto é 100% Node/TypeScript e a máquina de desenvolvimento não tem Python — o arquivo existiria sem nunca rodar, que é exatamente a falha que esta seção proíbe. Por isso o hook é bash puro em `.githooks/`, sem dependência nenhuma. **Ao portar VII.1 para um projeto novo, escolha a ferramenta que roda naquele ambiente, não a que está escrita aqui.**

\---

## VII. Enforcement \& Verificação (NOVO)

### 7.1 Checklist Pré-Commit (Automático)

Use `pre-commit` framework:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.4.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files

  - repo: https://github.com/psf/black
    rev: 23.1.0
    hooks:
      - id: black

  - repo: https://github.com/PyCQA/flake8
    rev: 6.0.0
    hooks:
      - id: flake8

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.0.1
    hooks:
      - id: mypy

  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets

  - repo: https://github.com/PyCQA/bandit
    rev: 1.7.5
    hooks:
      - id: bandit
```

Instalar: `pip install pre-commit` → `pre-commit install`

### 7.2 Responsabilidade do LLM (Claude/Gemini)

Quando você trabalha comigo, **eu vou sempre**:

* ✅ **PAUSAR** antes de sugerir código → Pedir esclarecimentos (entrada/saída/edge cases)
* ✅ **ESCREVER** Diretiva em `directives/feature\\\_name.md` PRIMEIRO
* ✅ **TDD FIRST** → Testes em `tests/` ANTES de qualquer linha de código
* ✅ **CÓDIGO** → Implementação em `src/` com:

  * Type hints completos
  * Docstrings (Google format)
  * Comentários de porquê, não apenas o quê
* ✅ **VALIDAÇÃO** → Linter + type check + cobertura ≥ 80%
* ✅ **DOCS** → Atualizar README, CHANGELOG.md e comentários de código
* ✅ **MENCIONAR DESVIOS** → Se algo sair do escopo, aviso claramente

### 7.3 O que NÃO vou fazer (Veto)

❌ Sugerir código sem teste  
❌ Criar arquivos monolíticos  
❌ Deixar código não documentado  
❌ Ignorar type safety  
❌ Fazer 5 coisas em 1 commit  
❌ Ignorar edge cases ou error handling

**Se eu fizer, VOCÊ veta com:** "Isso viola CLAUDE.md seção VII.2 ponto \[X]"

\---

## VIII. Padrões de Código Esperados (NOVO)

### 8.1 Python

```python
# OBRIGATÓRIO: Type hints + Docstring

from typing import Optional, List
from dataclasses import dataclass

@dataclass
class User:
    """Representa um usuário no sistema."""
    id: int
    name: str
    email: str
    is\\\_active: bool = True

def fetch\\\_user(user\\\_id: int) -> Optional\\\[User]:
    """
    Busca um usuário pelo ID no banco de dados.
    
    Args:
        user\\\_id: ID único do usuário
        
    Returns:
        User object se encontrado, None caso contrário
        
    Raises:
        DatabaseError: Se houver erro na conexão
        
    Example:
        >>> user = fetch\\\_user(42)
        >>> print(user.name)
        'John Doe'
    """
    try:
        # Lógica aqui
        return user
    except DatabaseError as e:
        logger.error("Failed to fetch user", extra={"user\\\_id": user\\\_id, "error": str(e)})
        raise
```

**Padrões:**

* Type hints: `mypy` como CI check
* Linting: `flake8` + `pylint`
* Formatting: `black` automático
* Tests: `pytest` com fixtures reutilizáveis

### 8.2 JavaScript/TypeScript

```typescript
// OBRIGATÓRIO: TypeScript + JSDoc

/\\\*\\\*
 \\\* Busca um usuário pelo ID no banco de dados.
 \\\* @param userId - ID único do usuário
 \\\* @returns Promise<User | null> Usuário encontrado ou null
 \\\* @throws {DatabaseError} Se houver erro na conexão
 \\\* @example
 \\\* const user = await fetchUser(42);
 \\\* console.log(user?.name); // 'John Doe'
 \\\*/
async function fetchUser(userId: number): Promise<User | null> {
  try {
    const user = await db.query('SELECT \\\* FROM users WHERE id = ?', \\\[userId]);
    logger.info('User fetched', { traceId: getTraceId(), userId });
    return user\\\[0] || null;
  } catch (error) {
    logger.error('Failed to fetch user', { 
      traceId: getTraceId(),
      userId,
      error: error.message
    });
    throw new DatabaseError(`Failed to fetch user ${userId}`);
  }
}
```

**Padrões:**

* TypeScript: obrigatório (não JS puro)
* Linting: `eslint` + `prettier`
* Type checking: `tsc --noEmit`
* Tests: `jest` ou `vitest`

### 8.3 Git Commits

**Formato Obrigatório:**

```
\\\[TIPO] descrição breve (50 chars max)

Descrição detalhada do que foi feito e porquê.
Quebra de linhas para legibilidade.

Refs: #123 (issue number)
Breaking: (se aplicável) descrever breaking change
```

**Tipos:**

* `\\\[FEATURE]` — Nova funcionalidade
* `\\\[BUGFIX]` — Correção de bug
* `\\\[REFACTOR]` — Reorganização de código (sem mudança de behavior)
* `\\\[DOCS]` — Apenas documentação
* `\\\[TEST]` — Apenas testes
* `\\\[PERF]` — Melhoria de performance
* `\\\[SECURITY]` — Correção de segurança

**Exemplo:**

```
\\\[FEATURE] Add OAuth2 authentication to user service

- Implemented Google OAuth2 integration
- Added JWT token generation and validation
- Protected /api/users with auth middleware
- Added tests for auth flow

Refs: #456
```

\---

## IX. Rollback \& Disaster Recovery (NOVO)

### 9.1 Estratégia de Versioning

**Semântico Versionamento:** `MAJOR.MINOR.PATCH`

* `MAJOR` — Breaking changes
* `MINOR` — Nova feature (backward compatible)
* `PATCH` — Bug fix

Tag cada release: `git tag -a v1.2.3 -m "Release 1.2.3"`

### 9.2 Rollback Automático

```bash
#!/bin/bash
# scripts/rollback.sh

CURRENT\\\_VERSION=$(git describe --tags --abbrev=0)
PREVIOUS\\\_VERSION=$(git describe --tags --abbrev=0 $(git rev-list --tags --skip=1 --max-count=1))

echo "Rolling back from $CURRENT\\\_VERSION to $PREVIOUS\\\_VERSION"

git checkout $PREVIOUS\\\_VERSION
./scripts/deploy.sh production

echo "Rollback complete. Current version: $(git describe --tags)"
```

### 9.3 Backup Automático

```yaml
# Backup diário do banco de dados
backup:
  frequency: daily
  retention: 30 days
  destination: S3 (encrypted)
  
# Teste de restore mensal
restore\\\_test:
  frequency: monthly
  environment: staging
  verification: checksum validation
```

### 9.4 Checklist de Disaster Recovery

* \[ ] Backups automáticos rodando (diário)
* \[ ] Testes de restore executados (mensal)
* \[ ] Rollback script documentado e testado
* \[ ] RTO (Recovery Time Objective): < 1 hora
* \[ ] RPO (Recovery Point Objective): < 1 dia
* \[ ] Equipe treinada em procedures de rollback
* \[ ] Runbook atualizado em `/RUNBOOK.md`

\---

## X. Versionamento de API \& Breaking Changes (NOVO)

### 10.1 Estratégia de Versionamento

```
/api/v1/users       # Versão estável
/api/v2/users       # Nova versão (breaking changes)
/api/beta/users     # Experimentais
```

### 10.2 Deprecação de Endpoints

```python
# Exemplo Flask
@app.route('/api/v1/users/<id>')
def get\\\_user\\\_v1(id):
    """DEPRECATED: Use /api/v2/users/{id} instead."""
    response = get\\\_user\\\_v2(id)
    response.headers\\\['Deprecation'] = 'true'
    response.headers\\\['Sunset'] = 'Wed, 31 Dec 2025 23:59:59 GMT'
    response.headers\\\['Link'] = '</api/v2/users/{id}>; rel="successor-version"'
    return response
```

### 10.3 CHANGELOG Estruturado

```markdown
# Changelog

## \\\[2.0.0] - 2025-04-06

### Added
- New `/api/v2/users` endpoint with improved pagination

### Changed
- `/api/v1/users` now returns paginated results (breaking change)
- User email is now optional in creation

### Deprecated
- `/api/v1/users` (sunset date: 2025-12-31)

### Removed
- Legacy `/users/search` endpoint (moved to `/api/v2/users/search`)

### Fixed
- Bug in user update that allowed invalid emails

### Security
- Fixed SQL injection vulnerability in user filter

---

## \\\[1.5.0] - 2025-03-15
...
```

\---

## XI. Padrões de Escalabilidade \& Performance (NOVO)

### 11.1 Banco de Dados

```python
# ✅ CORRETO: Connection pooling
from sqlalchemy import create\\\_engine

engine = create\\\_engine(
    'postgresql://user:pass@localhost/db',
    pool\\\_size=20,  # Max connections
    max\\\_overflow=40,  # Overflow connections
    pool\\\_recycle=3600,  # Recycle after 1 hour
    echo=False  # Disable SQL logging in prod
)

# ❌ ERRADO: Criar conexão por request
for request in requests:
    conn = db.connect()  # NÃO FAÇA ISTO
    result = conn.execute(query)
```

### 11.2 Caching

```python
# Redis para cache distribuído
from redis import Redis

cache = Redis(host='localhost', port=6379, db=0)

def get\\\_user\\\_cached(user\\\_id: int) -> User:
    # Buscar do cache primeiro
    cached = cache.get(f"user:{user\\\_id}")
    if cached:
        logger.debug("Cache hit", extra={"user\\\_id": user\\\_id})
        return User.from\\\_json(cached)
    
    # Buscar do BD se não estiver em cache
    user = db.query(User).filter\\\_by(id=user\\\_id).first()
    
    # Cachear por 1 hora
    cache.setex(f"user:{user\\\_id}", 3600, user.to\\\_json())
    
    return user
```

### 11.3 Async/Await (Evitar Blocking)

```python
# ✅ CORRETO: Async para I/O
import asyncio

async def fetch\\\_multiple\\\_users(user\\\_ids: List\\\[int]) -> List\\\[User]:
    tasks = \\\[fetch\\\_user\\\_async(uid) for uid in user\\\_ids]
    return await asyncio.gather(\\\*tasks)

# ❌ ERRADO: Blocking
for user\\\_id in user\\\_ids:
    user = fetch\\\_user(user\\\_id)  # Espera cada um, muito lento
```

### 11.4 Paginação

```python
# ✅ CORRETO: Paginação obrigatória para listas
@app.route('/api/v2/users')
def list\\\_users(page: int = 1, limit: int = 20):
    """
    Args:
        page: Número da página (padrão: 1)
        limit: Itens por página (máx: 100, padrão: 20)
    """
    assert limit <= 100, "Max limit is 100"
    
    offset = (page - 1) \\\* limit
    users = db.query(User).offset(offset).limit(limit).all()
    total = db.query(User).count()
    
    return {
        "items": users,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit,
    }
```

### 11.5 Rate Limiting

```python
from slowapi import Limiter
from slowapi.util import get\\\_remote\\\_address

limiter = Limiter(key\\\_func=get\\\_remote\\\_address)

@app.route('/api/v2/users')
@limiter.limit("100/minute")
def list\\\_users():
    # Máximo 100 requisições por minuto
    return {"users": \\\[...]}
```

\---

## XII. Fluxo de Trabalho Esperado (NOVO)

### 12.1 Quando você pede uma FEATURE NOVA

```
1. VOCÊ: "Preciso de autenticação OAuth2"

2. EU (PAUSA): "Deixa eu entender melhor:
   - Qual provedor? (Google, GitHub, Microsoft?)
   - Quais dados precisamos do usuário? (email, foto, etc)
   - Precisa de refresh token?
   - Expiração de sessão?"

3. VOCÊ: "Google OAuth2, email e foto, sim e 30 dias"

4. EU: Crio `/directives/oauth2\\\_integration.md` detalhando:
   - Objetivo
   - Entradas (Google client ID/secret)
   - Saídas (JWT token, user data)
   - Edge cases (user não aceita, já existe, etc)

5. EU: Crio testes em `tests/unit/authService.test.js`:
   - Test: "fetchGoogleToken returns valid JWT"
   - Test: "handleUserExistsLogic creates new user if needed"
   - Test: "handleExpiredToken refreshes correctly"

6. EU: Implemento em `src/services/authService.js`:
   - Funções com type hints + docstrings
   - Error handling robusto
   - Logging estruturado

7. EU: Rodo testes → CI/CD → Deploy

8. CHANGELOG.md atualizado: "\\\[FEATURE] Add Google OAuth2 authentication"
```

### 12.2 Quando você quer DEBUGGING

```
1. VOCÊ: "A página de perfil tá lenta"

2. EU: "Preciso de:
   - Qual endpoint está lento? (/api/v2/users/me?)
   - Tempo normal vs agora? (100ms vs 2000ms?)
   - Logs completos com trace IDs?"

3. VOCÊ: \\\[Manda logs]

4. EU:
   - Isolo o problema em um teste: `tests/performance/profile\\\_endpoint.test.js`
   - Identifico a query N+1 ou falta de índice
   - Crio script em `execution/analyze\\\_db.py` para confirmar
   - Implemento fix com novo teste

5. CHANGELOG.md: "\\\[BUGFIX] Fix N+1 query in user profile endpoint"
```

\---

## XIII. Limites \& Contratos (NOVO)

### 13.1 Limites de Responsabilidade do LLM

**EU POSSO:**
✅ Escrever código determinístico (lógica de negócios)  
✅ Estruturar testes e directives  
✅ Debugar com logs estruturados  
✅ Refatorar mantendo comportamento  
✅ Documentar decisões

**EU NÃO POSSO:**
❌ Garantir zero bugs em produção (probabilístico)  
❌ Prever todas as edge cases (responsabilidade sua)  
❌ Substituir humano em code review crítico  
❌ Assumir decisões de negócio (você roteava)  
❌ Fazer performance tuning sem dados de profiling

### 13.2 Contrato de Trabalho

```
SE você seguir CLAUDE.md:
  → Qualidade de código profissional
  → Escalabilidade garantida
  → Bugs reduzidos drasticamente
  
SE você não seguir:
  → Tech debt acumula
  → Qualidade degrada
  → Risco de produção aumenta
  
Responsabilidade compartilhada.
```
---

## XIV. Stack Padrão e Decisão de Linguagem

### 14.1 Critério de Escolha por Tipo de Projeto

| Tipo de Projeto              | Linguagem Principal  | Framework Preferido     |
|------------------------------|----------------------|-------------------------|
| Frontend / Web UI            | TypeScript           | React + Vite            |
| Mobile                       | TypeScript           | React Native (Expo)     |
| Backend / API REST           | Python               | FastAPI                 |
| Scripts de automação / ETL   | Python               | Scripts puros + typer   |
| Full-stack web               | TypeScript (front) + Python (back) | Next.js + FastAPI |

### 14.2 Regra para Contexto Ambíguo

**Se o tipo de projeto não estiver claro no pedido inicial, PAUSE e pergunte:**

> "Antes de começar: este projeto é uma aplicação web/mobile, uma API/backend, ou um script de automação?"

Não presuma. A escolha de linguagem no início define toda a estrutura de pastas, ferramentas de lint, tipo de testes e CI/CD. Decidir errado custa uma refatoração completa.

### 14.3 Quando o Projeto Já Existe

Se já há código no repositório, **a linguagem já está decidida**. Siga o stack existente sem questionar, a menos que o usuário peça explicitamente uma migração.

\---

## XV. 🛡️ Security Guidelines — Blindagem de Aplicação (INVIOLÁVEL)

> **Por que esta seção existe:** até 2026-07-27 este documento tratava "segurança" como sinônimo de *gestão de secrets* (Seção IV) e *scan de dependências* (II.2) — ou seja, apenas segurança de **supply chain**. Não havia uma única regra sobre autorização, IDOR, XSS ou obscuridade. Foi por isso que o módulo Campanhas operou por muito tempo protegido apenas por um item de menu escondido no frontend, sem nenhum gate no backend: nenhuma regra escrita dizia que esconder ≠ proteger. Esta seção fecha essa lacuna.

### 15.1 A Regra Mãe: Ocultação NÃO é Proteção

**Se a única coisa que impede um usuário de acessar um recurso é o fato de ele não ver o botão, o recurso está desprotegido.**

* Esconder item de menu, remover a rota do frontend, usar URL "difícil de adivinhar" (`/painel-admin-x9f2`), desabilitar botão via CSS ou `disabled`, ocultar campo do formulário: tudo isso é **UX**, nunca controle de acesso. O atacante não usa a sua interface — ele usa `curl`.
* **Toda restrição de acesso precisa de duas camadas, nesta ordem de importância:**
  1. **Backend (o gate real):** middleware que rejeita a requisição com 401/403. É a única camada que conta.
  2. **Frontend (cosmético):** esconder o que o usuário não pode usar, para não oferecer um caminho que vai falhar.
* **Cada esquema de autenticação precisa do seu próprio gate.** Um middleware que lê `req.user` (JWT) não protege uma rota que autentica por token de conexão. Ao adicionar um gate, verifique *como aquela rota específica* identifica quem está chamando.
* **Como aplicar:** ao esconder qualquer coisa no frontend, pergunte *"se eu chamar esse endpoint direto no Postman com o JWT de um usuário comum, o que acontece?"*. Se a resposta não for **403**, o trabalho não está feito.
* **Precedente no projeto:** commit `bf2c16a`. Esconder o menu de Campanhas não bastava — foi preciso `isSuper` em `campaignRoutes`, `contactListRoutes`, `contactListItemRoutes` e `campaignSettingRoutes`. E `/api/messages/send` autentica por token de conexão (não JWT), então o `isSuper` padrão não se aplicava: precisou de um middleware próprio, `isSuperCompany`.

### 15.2 Autorização Vive no Backend. Sempre.

**Toda regra de negócio, permissão, cargo e flag de privilégio é decidida e validada exclusivamente no servidor.**

* **`localStorage`, `sessionStorage`, cookies não-assinados e o payload decodificado do JWT são dados sob controle do usuário.** Qualquer pessoa abre o DevTools e escreve `localStorage.setItem("profile", "admin")`. Use esses valores para **renderizar UI**, nunca para autorizar uma ação.
* **Proibido:** endpoint que confia em `is_admin`, `role`, `companyId` ou `super` vindos do **corpo ou query da requisição**. Esses valores vêm da sessão validada no servidor (`req.user`), nunca do cliente.
* **O frontend pode mentir sobre quem o usuário é. O backend não pode acreditar.** `<Can>`, `user.super` e afins são camada de apresentação — o backend revalida tudo, sempre, mesmo que "o frontend já checou".
* **Sessão e revogação:** logout, troca de senha, desativação e mudança de cargo devem invalidar a sessão **no servidor**. Apagar o token do cliente não revoga nada — o token continua válido para quem o tiver copiado.
* **Teste obrigatório de sessão (manual, a cada release):**
  1. Faça login e abra uma rota protegida.
  2. DevTools → Application → Clear site data (cookies + storage).
  3. Recarregue (F5). A aplicação **deve** bloquear imediatamente e redirecionar para login.
  4. Repita chamando a API direto com o token antigo após logout no servidor — deve retornar 401.
* **Como aplicar:** para cada rota nova, escreva um teste que faz a chamada com o perfil **errado** e afirma 401/403. Teste que só verifica o caminho feliz não prova controle de acesso.

### 15.3 IDOR e Isolamento Multi-Tenant (o risco nº 1 deste projeto)

**Todo endpoint que recebe um ID DEVE provar que o usuário logado é dono legítimo daquele recurso.**

* **IDOR (Insecure Direct Object Reference)** é trocar `/api/tickets/1042` por `/api/tickets/1043` e receber o ticket de outra empresa. Autenticação (*quem é você*) não é autorização (*isso é seu*) — estar logado não dá direito ao recurso.
* **Neste projeto, a fronteira de isolamento é `companyId`.** Sendo um SaaS multi-tenant, vazamento entre empresas é a falha mais grave possível: expõe conversas, contatos e dados financeiros de um cliente para outro.
* **Padrão obrigatório** — carregue o recurso e compare com a empresa da sessão antes de qualquer leitura ou escrita:

```typescript
const ticket = await Ticket.findByPk(id);

// O companyId vem SEMPRE da sessão validada, nunca do request.
if (ticket?.companyId !== companyId) {
  throw new AppError("ERR_NO_PERMISSION", 403);
}
```

* **Prefira escopar na própria query** (`where: { id, companyId }`) — assim é impossível esquecer a comparação depois.
* **Vale para todo verbo, não só GET.** `UPDATE` e `DELETE` sem checagem de posse são piores: permitem destruir dados alheios.
* **Enumeração:** IDs sequenciais tornam a varredura trivial. Onde for viável, use UUID — mas **UUID não substitui a checagem de posse**, apenas torna o chute mais caro (isso é obscuridade, ver 15.1).
* **BaaS (Supabase / Firebase):** se o projeto usar BaaS, **RLS (Row Level Security) é obrigatório e não-negociável** em todas as tabelas, com política revisada tabela por tabela. Sem RLS, a chave anônima do cliente lê o banco inteiro. `anon key` no frontend é público por design — a única barreira é RLS.
* **Como aplicar:** ao criar um endpoint com `:id`, escreva primeiro o teste "usuário da empresa A tenta acessar recurso da empresa B → 403". Se esse teste não existe, o endpoint não está pronto.

### 15.4 Validação, Sanitização e Limite de Input (XSS e Injeção)

**Todo input do usuário é hostil até prova em contrário — inclusive o que vem de outro sistema seu.**

* **Valide na entrada (backend):** tipo, formato, faixa e **tamanho máximo** de todo campo. Validação no frontend é conveniência para o usuário, não defesa — é trivialmente contornável.
* **Sanitize na saída, no contexto certo:** escapar para HTML, para SQL e para shell são operações diferentes. Escapar no lugar errado não protege.
* **XSS — proibido renderizar conteúdo de usuário como HTML.** Nada de `dangerouslySetInnerHTML`, `innerHTML` ou `v-html` com dado que veio de fora. Se houver necessidade real de rich text, passe por uma biblioteca de sanitização com allowlist (`DOMPurify`), nunca por regex caseiro.
* **SQL:** apenas queries parametrizadas ou o ORM. Concatenação de string com input de usuário em SQL é proibida, sem exceção.
* **Path traversal:** nome de arquivo enviado pelo usuário nunca vai direto para o filesystem. Este projeto já tem `sanitizeFilename` — use-o.
* **Prompt injection é o XSS da era LLM.** Mensagem de cliente que chega ao agente de IA é input não-confiável: pode conter instruções tentando sequestrar o comportamento do agente. Este projeto já tem `sanitizeUserMessage` no `AgentService` — toda entrada nova que alimente um LLM precisa passar por tratamento equivalente. **Ferramentas do agente que executam ações com efeito colateral devem validar autorização por conta própria**, nunca confiar que o LLM só as chamará em contexto legítimo.
* **Limite o tamanho** de todo payload, upload e campo de texto. Sem teto, um único request derruba o serviço.

### 15.5 Rate Limiting (controle de segurança, não de performance)

**Rate limiting está na Seção XI.5 como tópico de performance. Isto aqui reclassifica: em rotas de autenticação é um controle de segurança OBRIGATÓRIO.**

* **Obrigatório em:**
  * **Login, signup, reset de senha, verificação de código** — sem limite, força bruta é só questão de tempo. Limite por IP **e** por conta alvo (limitar só por IP não impede ataque distribuído contra um usuário).
  * **Rotas que consomem API paga** (LLM, transcrição, envio de mensagem) — sem limite, o prejuízo é financeiro e imediato.
  * **Endpoints de listagem e busca** — freio contra scraping em massa da base.
* **Complementos ao limite por requisição:** backoff progressivo após falhas seguidas, bloqueio temporário de conta e alerta em `ERROR` quando o limite for atingido repetidamente (tentativa de invasão é evento de log, não silêncio).
* **Mensagem de erro genérica em auth:** "credenciais inválidas", nunca "usuário não existe" ou "senha incorreta" — a diferença entrega ao atacante a lista de contas válidas.
* **Estado atual do projeto:** `express-rate-limit` aplicado a `/auth` (100 req / 15 min) em `app.ts:56` e em `geminiRoutes`. Ao criar rota sensível nova, aplique explicitamente — não há limite global cobrindo tudo.

### 15.6 Dados em Repouso: Nada Crítico em Texto Puro

* **Senhas:** somente hash com algoritmo lento e salt (`bcrypt`, `argon2`). **Nunca** criptografia reversível, nunca `md5`/`sha1`, nunca texto puro.
* **Dados financeiros e de pagamento:** proibido armazenar número de cartão, CVV ou credencial bancária em texto puro. O padrão correto é **não armazenar** — delegue ao gateway e guarde apenas o token/ID da transação.
* **Tokens de terceiros** (OAuth, chaves de API de cliente, sessões de WhatsApp) são credenciais: criptografados em repouso, acesso restrito, jamais em log.
* **Logs e mensagens de erro nunca carregam:** senha, token, chave de API, `Authorization` header, CPF/CNPJ completo, dado de cartão. Stack trace de produção não vai para o cliente — vai para o log estruturado (Seção V), e o cliente recebe mensagem genérica + trace ID.
* **Backups herdam a sensibilidade do dado.** Backup de banco com dado de cliente é criptografado, com acesso restrito, e nunca dentro do diretório servido pela aplicação.

### 15.7 Exposição de Infraestrutura em Produção

**Verifique explicitamente antes de cada deploy — nenhum destes deve ser acessível pela web:**

| Item | Teste | Esperado |
|---|---|---|
| Repositório Git | `curl https://seu-dominio/.git/config` | 404 |
| Variáveis de ambiente | `curl https://seu-dominio/.env` | 404 |
| Backups | `/backup`, `/backups`, `/dump.sql`, `*.bak` | 404 |
| Listagem de diretórios | `curl https://seu-dominio/uploads/` | 403/404, nunca "Index of" |
| Source maps | `curl https://seu-dominio/static/js/main.*.js.map` | 404 em produção |
| Banner de versão | Header `Server` / `X-Powered-By` | Removido |

* **Listagem de diretórios (`Index of`) desligada** no servidor web. Diretório de uploads acessível é vazamento de todos os arquivos de todos os clientes.
* **Source maps não vão para produção.** Eles reconstroem o código-fonte original a partir do bundle. Se precisar deles para monitoramento de erro, envie ao serviço (Sentry/GlitchTip) e não os publique.
* **Painel de administração não se protege por caminho secreto** — protege-se por autenticação e autorização (15.1).
* **Cabeçalhos de segurança ativos:** `helmet` (ou equivalente), CSP restritiva, HTTPS obrigatório com HSTS, cookies `Secure` + `HttpOnly` + `SameSite`.
* **CORS com allowlist explícita.** `origin: true` ou `*` combinado com `credentials: true` desabilita a proteção na prática (CWE-942).

### 15.8 Auditoria do Build do Frontend (procedimento obrigatório)

A Seção IV.3 **proíbe** secrets no frontend. Esta subseção define **como verificar** que a proibição foi respeitada — regra sem verificação é torcida, não controle.

**Rode a cada release, sobre o build de produção (nunca sobre o dev server):**

1. `npm run build` e faça a busca direto nos artefatos gerados:

```bash
grep -rEi "sk-|api[_-]?key|secret|password|bearer |postgres://|mongodb://" build/ dist/
```

2. Abra a aplicação publicada → DevTools → aba **Sources** → percorra os bundles procurando por credencial, URL de banco, endpoint interno ou host de infraestrutura.
3. DevTools → aba **Network** → inspecione as respostas da API: elas devem trazer **apenas** os campos que aquela tela usa. Endpoint que devolve o objeto de usuário inteiro (com hash de senha, token, dados de outros tenants) é vazamento, mesmo que a UI não mostre.
4. Confirme que `.map` não está publicado.

**Regra de ouro:** qualquer variável prefixada com `REACT_APP_`, `NEXT_PUBLIC_`, `VITE_` **é pública**. O prefixo é uma declaração de que aquele valor vai para o navegador. Se um secret precisa desse prefixo, a arquitetura está errada — a chamada tem que ir para o backend.

### 15.9 Checklist de Segurança (validar antes de cada release)

**Autorização**
* [ ] Toda rota restrita tem gate no **backend**, não só menu escondido
* [ ] Nenhuma decisão de permissão depende de `localStorage` ou de campo enviado pelo cliente
* [ ] Cada esquema de autenticação (JWT, token de conexão, webhook) tem seu próprio gate
* [ ] Existe teste automatizado chamando com o perfil errado e esperando 401/403
* [ ] Limpar cookies + F5 bloqueia rota protegida imediatamente

**Isolamento de dados**
* [ ] Todo endpoint com `:id` valida posse contra o `companyId` da **sessão**
* [ ] `UPDATE` e `DELETE` também validam posse (não só `GET`)
* [ ] Se houver BaaS: RLS ativo e revisado em **todas** as tabelas

**Input**
* [ ] Validação de tipo, formato e **tamanho máximo** no backend
* [ ] Zero `dangerouslySetInnerHTML`/`innerHTML` com dado de usuário
* [ ] Queries parametrizadas; nenhuma concatenação de SQL
* [ ] Entrada que alimenta LLM passa por sanitização de prompt injection

**Ataques**
* [ ] Rate limiting em login, signup e reset de senha (por IP **e** por conta)
* [ ] Rate limiting em rotas que consomem API paga
* [ ] Erro de login genérico (não revela se a conta existe)

**Dados**
* [ ] Senhas com `bcrypt`/`argon2` — nunca reversível
* [ ] Nenhum dado de pagamento em texto puro
* [ ] Nenhum secret, token ou dado pessoal em log
* [ ] Backups criptografados e fora do diretório servido

**Infra**
* [ ] `.git`, `.env`, `/backup` retornam 404
* [ ] Listagem de diretórios desativada
* [ ] Source maps ausentes em produção
* [ ] HTTPS + HSTS; cookies `Secure`/`HttpOnly`/`SameSite`
* [ ] CORS com allowlist explícita
* [ ] Build auditado conforme 15.8

\---

## RESUMO VISUAL

```
                    CLAUDE.md A+++
                    
    ┌─────────────────────────────────────┐
    │     Diretivas (Seção I)             │
    │   SOPs em Markdown, Success Criteria │
    └──────────────┬──────────────────────┘
                   │
    ┌──────────────▼──────────────────────┐
    │   Orquestração (Seção II-XIII)      │
    │  TDD, QA, Logging, CI/CD, Rollback  │
    └──────────────┬──────────────────────┘
                   │
    ┌──────────────▼──────────────────────┐
    │   Execução (Scripts determinísticos)│
    │  Type-safe, Testado, Documentado    │
    └─────────────────────────────────────┘

Resultado: Código Maduro + Escalável + Auditável
```

\---

## Referências Rápidas

|Tópico|Seção|
|-|-|
|Arquitetura|I|
|TDD|II.1|
|Segurança de supply chain (deps, secrets)|II.2 \& IV|
|**Segurança de aplicação (authz, IDOR, XSS)**|**XV**|
|Estrutura de pastas|III|
|Secrets|IV|
|Logs \& Observabilidade|V|
|CI/CD|VI|
|Lockfile \& determinismo de deps|VI.4|
|Documento vs realidade|VI.5|
|Pre-commit|VII.1|
|Code Style|VIII|
|Rollback|IX|
|Versionamento API|X|
|Performance|XI|
|Fluxo esperado|XII|
|Limites|XIII|
|Ocultação ≠ proteção|XV.1|
|Autorização no backend|XV.2|
|IDOR \& multi-tenant|XV.3|
|XSS \& prompt injection|XV.4|
|Rate limiting (segurança)|XV.5|
|Dados em repouso|XV.6|
|Exposição de infra|XV.7|
|Auditoria do build frontend|XV.8|
|Checklist de release|XV.9|

\---

**Versão:** 2.1 (A+++)  
**Data:** 2026-07-27  
**Status:** Pronto para produção  
**Próxima Review:** 2026-10-27 (trim)

**Changelog do documento:**

* **2.1 (2026-07-27)** — Adicionada Seção XV (Security Guidelines): ocultação ≠ proteção, autorização no backend, IDOR/multi-tenant, XSS e prompt injection, rate limiting como controle de segurança, dados em repouso, exposição de infra e auditoria do build. Adicionadas VI.4 (lockfile) e VI.5 (documento vs realidade) a partir dos incidentes `bf2c16a` e `aca9ffa`.
* **2.0 (2025-04-06)** — Versão base A+++.

