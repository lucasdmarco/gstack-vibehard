import { execSync as defaultExecSync, execFileSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  symlinkSync,
  rmSync,
} from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir, tmpdir } from "node:os"
import { deepMerge } from "../installer/merge.js"
import { checkRemoteDownload } from "../installer/remote-policy.js"
import { npxArgv, npmArgv } from "../installer/deps.js"
import { buildRuntimeManifest } from "../runtime/manifest.js"
import { nextStepsContent } from "../runtime/workspace.js"
import { buildIntegrationsRegistry } from "../printing-press/registry.js"
import { buildContextRegistry, DOC_SOURCES as CONTEXT_DOC_SOURCES } from "../context-docs/registry.js"
import { DEFAULT_LOOP_BUDGET } from "../loop-budget/policy.js"
import { writeProjectMarker } from "../project/identity.js"

const HOME = resolve(homedir() || process.env.USERPROFILE || process.env.HOME || "/tmp")

const OMNIHARNESS_MAP = [
  { id: "claude", label: "Claude Code", configDir: join(HOME, ".claude"), hooksFile: "settings.json", mode: "agent-hooks" },
  { id: "cursor", label: "Cursor", configDir: join(HOME, ".cursor"), hooksFile: "hooks.json", mode: "agent-hooks" },
  { id: "codex", label: "OpenAI Codex CLI", configDir: join(HOME, ".codex"), hooksFile: "hooks.json", mode: "agent-hooks" },
  { id: "windsurf", label: "Windsurf", configDir: join(HOME, ".codeium", "windsurf"), hooksFile: "hooks.json", mode: "agent-hooks" },
  { id: "opencode", label: "OpenCode CLI", configDir: join(HOME, ".config", "opencode"), hooksFile: "hooks.json", mode: "agent-hooks" },
  { id: "gemini", label: "Gemini CLI", configDir: join(HOME, ".gemini"), hooksFile: "hooks.json", mode: "direct" },
  { id: "kiro", label: "Kiro", configDir: join(HOME, ".kiro"), hooksFile: "hooks.json", mode: "direct" },
  { id: "antigravity", label: "Antigravity (Google)", configDir: join(".agent", "skills"), hooksFile: null, mode: "graphify" },
  { id: "zed", label: "Zed Editor", configDir: join(HOME, ".zed"), hooksFile: "settings.json", mode: "zed" },
  { id: "hermes", label: "Hermes CLI", configDir: join(HOME, ".hermes", "skills"), hooksFile: null, mode: "graphify" },
  { id: "trae", label: "Trae", configDir: null, hooksFile: null, mode: "graphify" },
]

const defaultLogger = {
  info:   (m) => console.log(`  ${m}`),
  success:(m) => console.log(`  \u2713 ${m}`),
  warn:   (m) => console.log(`  \u26A0 ${m}`),
  error:  (m) => console.error(`  \u2717 ${m}`),
}

function getProjectRoot() {
  const __filename = fileURLToPath(import.meta.url)
  let dir = dirname(__filename)
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = dirname(dir)
  }
  return dirname(__filename)
}

function copyRecursive(src, dst) {
  if (!existsSync(src)) return
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const t = join(dst, entry.name)
    if (entry.isDirectory()) copyRecursive(s, t)
    else copyFileSync(s, t)
  }
}

function writeJson(fp, val) {
  writeFileSync(fp, `${JSON.stringify(val, null, 2)}\n`)
}

function findBinary(name) {
  try {
    const cmd = process.platform === "win32" ? "where" : "which"
    const out = execFileSync(cmd, [name], { stdio: "pipe", timeout: 10000 })
    return out.toString().trim().split("\n")[0]
  } catch { return null }
}

function safeExec(file, args, opts) {
  // Side-effects OFF (testes/CI): não spawna processos externos (npx/docker/git),
  // evitando handles presos no projectDir (EBUSY na limpeza no Windows).
  if (process.env.GSTACK_SKIP_SIDE_EFFECTS === "1") return null
  try { return execFileSync(file, args, { stdio: "pipe", timeout: 30000, ...opts }) }
  catch { return null }
}

// curl existe nativamente no Windows 10 1803+ ("curl.exe") e em Unix.
const curlBinary = () => (process.platform === "win32" ? "curl.exe" : "curl")
const scriptExt = () => (process.platform === "win32" ? ".ps1" : ".sh")
// Baixa o script p/ `tmp` e valida (arquivo criado + tamanho mínimo). @returns bool.
function fetchRemoteScript(url, tmp, logger, label) {
  execFileSync(curlBinary(), ["-fsSL", url, "-o", tmp], { stdio: "pipe", timeout: 120000, shell: false })
  if (!existsSync(tmp)) { logger.warn(`${label}: download falhou (arquivo nao criado)`); return false }
  const content = readFileSync(tmp, "utf-8")
  if (content.length < 10) { logger.warn(`${label}: download muito pequeno (${content.length} bytes), possivelmente invalido`); return false }
  return true
}
function execRemoteScript(tmp) {
  if (process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmp], { stdio: "pipe", timeout: 180000, shell: false })
  else execFileSync("sh", [tmp], { stdio: "pipe", timeout: 180000, shell: false })
}
function safeDownloadAndRun(url, logger, label, opts = {}) {
  // POLÍTICA REMOTA (P0.6): por padrão NÃO baixa/executa script remoto — sugere o
  // comando manual. Só prossegue com opt-in explícito + origem na allowlist HTTPS.
  const policy = checkRemoteDownload(url, opts)
  if (!policy.allowed) {
    logger.warn(`${label}: download remoto NÃO executado (${policy.reason}).`)
    logger.warn(`  Para instalar manualmente: veja ${url} (ou rode com --allow-remote-downloads).`)
    return false
  }
  // Diretório PRIVADO por download (mkdtemp → nome imprevisível, permissão 0700 no
  // POSIX). Evita TOCTOU/symlink-swap num /tmp compartilhado: nome fixo previsível
  // (Date.now) permitiria a outro usuário pré-criar/trocar o arquivo antes do exec.
  const dir = mkdtempSync(join(tmpdir(), "gstack-dl-"))
  const tmp = join(dir, `script${scriptExt()}`)
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* cleanup */ } }
  try {
    if (!fetchRemoteScript(url, tmp, logger, label)) { cleanup(); return false }
    execRemoteScript(tmp)
    cleanup()
    return true
  } catch (e) {
    cleanup()
    logger.warn(`${label}: falha no download/execucao segura: ${e.message || e}`)
    return false
  }
}

// ─────────────────────────────────────────────────────────────
//  PHASE 1: Identity & IAM Local (Casdoor)
// ─────────────────────────────────────────────────────────────

function writeCasdoorCompose(projectDir) {
  const composeDir = join(projectDir, ".gstack")
  mkdirSync(composeDir, { recursive: true })
  writeFileSync(join(composeDir, "docker-compose.yml"),
`version: "3.8"
services:
  casdoor:
    image: casbin/casdoor:latest
    container_name: casdoor
    ports:
      - "8000:8000"
    environment:
      driver: "sqlite"
      dataSource: "/var/lib/casdoor/casdoor.db"
    volumes:
      - casdoor-data:/var/lib/casdoor
    restart: unless-stopped

volumes:
  casdoor-data:
`)
}

const casdoorExists = (name) => !!name && name.toString().trim() === "casdoor"
// Container casdoor já existe: reusa se rodando, senão reinicia. @returns URL.
function reuseCasdoor(logger) {
  const running = safeExec("docker", ["ps", "--filter", "name=casdoor", "--format", "{{.Names}}"])
  if (casdoorExists(running)) {
    logger.success("Casdoor IAM ja rodando em localhost:8000")
    return "http://localhost:8000"
  }
  logger.info("Casdoor container existe, reiniciando...")
  safeExec("docker", ["start", "casdoor"])
  logger.success("Casdoor reiniciado em localhost:8000")
  return "http://localhost:8000"
}
// Sobe o Casdoor via compose (v2 → fallback v1). @returns URL ou null.
function composeCasdoorUp(logger, projectDir) {
  logger.info("Iniciando Casdoor IAM local via docker-compose...")
  writeCasdoorCompose(projectDir)
  const composeFile = join(projectDir, ".gstack", "docker-compose.yml")
  let out = safeExec("docker", ["compose", "-f", composeFile, "up", "-d"], { timeout: 120000 })
  if (!out) {
    logger.info("docker compose (v2) falhou. Tentando docker-compose (v1)...")
    out = safeExec("docker-compose", ["-f", composeFile, "up", "-d"], { timeout: 120000 })
  }
  if (out) {
    logger.success("Casdoor IAM rodando em http://localhost:8000")
    logger.info("  User: admin / Password: 123 (mude apos primeiro login)")
    return "http://localhost:8000"
  }
  logger.warn("Casdoor nao iniciou — IAM local indisponivel. Projeto continua sem gateway de identidade.")
  return null
}
function startCasdoor(logger, projectDir) {
  if (process.env.GSTACK_SKIP_PREFLIGHT) {
    logger.info("GSTACK_SKIP_PREFLIGHT set — skipping Casdoor")
    return null
  }
  if (!findBinary("docker")) {
    logger.warn("Docker nao encontrado — Casdoor IAM local nao iniciado. Instale Docker para IAM local.")
    return null
  }
  const existing = safeExec("docker", ["ps", "-a", "--filter", "name=casdoor", "--format", "{{.Names}}"])
  if (casdoorExists(existing)) return reuseCasdoor(logger)
  return composeCasdoorUp(logger, projectDir)
}

function ensureGstackDir(projectDir) {
  mkdirSync(join(projectDir, ".gstack"), { recursive: true })
}

function writeCasdoorProjectConfig(projectDir) {
  ensureGstackDir(projectDir)
  writeFileSync(join(projectDir, ".gstack", "casdoor.json"), JSON.stringify({
    endpoint: "http://localhost:8000",
    clientId: "gstack-local",
    orgName: "gstack-vibehard",
    appName: "gstack-workspace",
    iamMode: "local-sqlite",
  }, null, 2) + "\n")
}

// ─────────────────────────────────────────────────────────────
//  PHASE 2: Parallelism (Atomic VCS)
// ─────────────────────────────────────────────────────────────

// Atomic VCS real = github.com/atomicdotdev/atomic (Rust), instalado via cargo do
// código-fonte (não há pacote npm/PyPI/Homebrew). @returns "installed" | "degraded".
function installAtomicViaCargo(logger) {
  if (!findBinary("cargo")) {
    logger.warn("Atomic VCS nao instalado — requer Rust/cargo (instale o stack completo ou rustup).")
    return "degraded"
  }
  logger.info("Atomic VCS nao encontrado — instalando via cargo de github.com/atomicdotdev/atomic (compila Rust, pode levar minutos)...")
  const cloneDir = join(tmpdir(), `atomic-build-${Date.now()}`)
  const cloned = safeExec("git", ["clone", "--depth", "1", "https://github.com/atomicdotdev/atomic.git", cloneDir], { timeout: 120000 })
  if (cloned !== null && existsSync(join(cloneDir, "atomic-cli"))) {
    safeExec("cargo", ["install", "--path", join(cloneDir, "atomic-cli")], { timeout: 600000 })
  }
  try { rmSync(cloneDir, { recursive: true, force: true }) } catch { /* cleanup */ }
  if (!findBinary("atomic")) {
    logger.warn("Atomic VCS nao pode ser instalado/compilado — continuando sem VCS atomico (Git permanece).")
    logger.warn("  Manual: git clone https://github.com/atomicdotdev/atomic && cargo install --path atomic/atomic-cli")
    return "degraded"
  }
  logger.success("Atomic VCS instalado (cargo: atomicdotdev/atomic)")
  return "installed"
}
// Retorna o STATUS honesto do componente: "installed" | "degraded" | "skipped".
function initAtomic(logger, projectDir, opts = {}) {
  if (process.env.GSTACK_SKIP_PREFLIGHT) {
    logger.info("GSTACK_SKIP_PREFLIGHT set — skipping Atomic init")
    return "skipped"
  }
  if (!findBinary("atomic") && installAtomicViaCargo(logger) === "degraded") return "degraded"
  const out = safeExec("atomic", ["init"], { cwd: projectDir })
  if (out) {
    logger.success("Atomic VCS inicializado — views paralelas disponiveis")
    return "installed"
  }
  logger.warn("atomic init falhou — continuando sem VCS atomico")
  return "degraded"
}

function writeAtomicConfig(projectDir) {
  writeFileSync(join(projectDir, ".atomicignore"),
`node_modules/
dist/
build/
.env
.env.*
coverage/
.git/
__pycache__/
*.pyc
.graphify/
.gstack/casdoor.json
`)

  const atomicDir = join(projectDir, ".atomic")
  mkdirSync(atomicDir, { recursive: true })
  // Secrets Broker (PRD 12 §10): `.env`/`.env.local` NÃO são expostos às views do
  // Atomic — segredo vive no keychain (`gstack_vibehard secrets`), não em arquivo.
  writeFileSync(join(atomicDir, "workspace.toml"),
`[workspace]
expose = [
  ".claude/",
  ".cursor/",
  ".windsurf/",
  ".vscode/",
  ".idea/",
  ".gstack/",
  ".mcp.json",
  ".agent/",
]
`)

  const globalAtomicDir = join(HOME, ".atomic")
  mkdirSync(globalAtomicDir, { recursive: true })
  const globalCfg = join(globalAtomicDir, "config.toml")
  if (!existsSync(globalCfg)) {
    writeFileSync(globalCfg,
`[defaults]
engine = "atomic"

[workspace]
default_expose = [".env", ".claude/", ".gstack/", ".agent/"]
`)
  }
  safeExec("node", ["--version"]) // noop: ensure workspace expose is registered
}

// ─────────────────────────────────────────────────────────────
//  PHASE 3: Daemons & Memory (ECC/ecc-universal + AgentMemory + Graphify)
// ─────────────────────────────────────────────────────────────

// Retorna o STATUS honesto: "installed" | "degraded" | "skipped".
function bootEcc(logger, projectDir) {
  if (process.env.GSTACK_SKIP_PREFLIGHT) {
    logger.info("GSTACK_SKIP_PREFLIGHT set — skipping ECC")
    return "skipped"
  }
  // ECC real = pacote npm `ecc-universal` (otimizador de performance de harness:
  // agents/skills/hooks/AgentShield; binário `ecc`). NÃO é o daemon Rust `ecc2`
  // (apenas protótipo alfa in-tree). Antes o código clonava github.com/gstack-dev/
  // ecc2 (404) e compilava via cargo — dependência fantasma que travava o create.
  if (findBinary("ecc")) {
    logger.success("ECC: já instalado (ecc-universal)")
    return "installed"
  }
  const { file, argv } = npmArgv(["install", "-g", "ecc-universal"])
  const out = safeExec(file, argv, { timeout: 180000 })
  // gstack consome o ECC como BIBLIOTECA on-demand (decisão b+c): mantém seu
  // próprio namespace de skills/hooks/agentes e NÃO injeta o perfil do ECC (evita
  // clobber). As capacidades do ECC ficam disponíveis quando VOCÊ quiser: `ecc`,
  // `npx ecc-agentshield scan` (prompt-injection), `npx ecc-install --profile <p>`.
  if (out !== null && findBinary("ecc")) {
    logger.success("ECC instalado (ecc-universal) — biblioteca on-demand (`ecc`, `npx ecc-agentshield scan`)")
    return "installed"
  } else if (out !== null) {
    logger.success("ECC instalado (ecc-universal)")
    return "installed"
  }
  logger.warn("ECC (ecc-universal) nao instalado — opcional. `npm i -g ecc-universal` p/ ativar.")
  return "degraded"
}

function writeControlPlaneConfig(projectDir, projectName) {
  ensureGstackDir(projectDir)
  writeFileSync(join(projectDir, ".gstack", "control-plane.yaml"),
`# GStack Control Plane — ECC (ecc-universal, local)
project: ${projectName}
version: 1

daemon:
  enabled: true
  dashboard: true
  sessions: true
  status: true

registration:
  endpoint: "http://localhost:9000"
  heartbeat_interval: 30

observability:
  logs: ".gstack/events.jsonl"
  metrics: [tokens, sessions, errors]
  audit: true
`)
}

// Retorna o STATUS honesto: "installed" | "degraded".
function bootAgentMemory(logger, projectDir) {
  const { file, argv } = npxArgv(["--yes", "@agentmemory/agentmemory", "federate", "--enable"])
  const out = safeExec(file, argv, { cwd: projectDir })
  if (out) {
    logger.success("AgentMemory Mesh Federation ativa (BM25 + Vetor + Grafo)")
    return "installed"
  }
  logger.warn("AgentMemory Federation nao pode ser ativada — continuando sem P2P mesh")
  return "degraded"
}

function writeMemoryFederationConfig(projectDir) {
  ensureGstackDir(projectDir)
  writeFileSync(join(projectDir, ".gstack", "federation.toml"),
`[mesh]
enabled = true
protocol = "https"
auth = "bearer-token"

sync = ["episodic", "semantic", "procedural"]
push_interval = 15
pull_interval = 30

[storage]
hybrid = ["bm25", "vector", "graph"]
vector_dim = 1536
index = "hnsw"

[peers]
# Adicione os peers da equipe:
# "dev-a" = "https://mesh.dev-a.team:8443"
# "dev-b" = "https://mesh.dev-b.team:8443"
`)
}

function bootGit(logger, projectDir, exec = safeExec) {
  // Lite usa git como VCS (app.json `vcs: "git"`): inicializa o repo para o projeto
  // nascer versionado e permitir que o graphify instale os hooks de commit.
  // Idempotente (pula se já houver `.git`); não-bloqueante; honesto se git faltar.
  // `exec` é injetável (DI): testes verificam o `git init` sem spawnar processo real.
  if (existsSync(join(projectDir, ".git"))) return true
  if (!findBinary("git")) {
    logger.info("Git nao encontrado — projeto criado sem versionamento (instale git para versionar e ativar o graphify).")
    return false
  }
  const out = exec("git", ["init"], { cwd: projectDir })
  if (out !== null) {
    logger.success("Git inicializado — projeto versionado")
    return true
  }
  logger.info("Git presente, mas `init` nao retornou — projeto sem versionamento (opcional).")
  return false
}

function bootGraphify(logger, projectDir) {
  // Opcional: só roda se o binário `graphify` JÁ estiver instalado (não baixa via
  // npx — evita lentidão/ruído num PC sem graphify). Mensagens honestas.
  if (!findBinary("graphify")) {
    logger.info("Graphify nao instalado — indexacao AST por commit e opcional (instale `graphify` para ativar).")
    return
  }
  try {
    const out = safeExec("graphify", ["hook", "install"], { cwd: projectDir })
    if (out) logger.success("Graphify hooks instalados — AST gerada a cada commit")
    else logger.info("Graphify presente, mas `hook install` nao retornou — indexacao AST por commit desativada (opcional).")
  } catch (e) {
    logger.info(`Graphify (opcional) nao configurado: ${e.message}`)
  }
}

function bootHeadroom(logger, projectDir) {
  // Opcional: idem — só se o binário existir; sem fetch remoto.
  if (!findBinary("headroom")) {
    logger.info("Headroom nao instalado — compressao de contexto e opcional.")
    return
  }
  try {
    const out = safeExec("headroom", ["--check"], { cwd: projectDir })
    if (out) logger.success("Headroom proxy operacional — compressao de contexto ativa")
  } catch (e) {
    logger.info(`Headroom (opcional) nao configurado: ${e.message}`)
  }
}

// ─────────────────────────────────────────────────────────────
//  PHASE 4: Omniharness (agent-hooks & Skills)
// ─────────────────────────────────────────────────────────────

function writeSkillsDir(projectDir) {
  const skillsDir = join(projectDir, ".claude", "skills")
  mkdirSync(skillsDir, { recursive: true })

  writeFileSync(join(skillsDir, "superpowers-cycle.md"),
`---
name: superpowers-cycle
description: Ciclo obrigatorio Plan -> TDD -> Implement -> Verify -> Review -> Ship
---
# Superpowers Cycle

1. **Plan** — documente o plano antes de codificar
2. **TDD** — escreva o teste antes da implementacao
3. **Implement** — codigo minimo que faz o teste passar
4. **Verify** — rode todos os testes e linter
5. **Review** — auto-review ou review externo
6. **Ship** — merge apenas com aprovacao

## Padroes de Harness
- Supervisor: coordena subagentes
- Pipeline: executa etapas sequenciais
- Validator: verifica saida antes de prosseguir
- Producer-Reviewer: par producao com revisao obrigatoria
`)

  writeFileSync(join(skillsDir, "quality-gate.md"),
`---
name: quality-gate
description: Quality Gate deterministico com fallow audit
---
# Quality Gate

## Nivel 1 (padrao)
\`\`\`
npx fallow audit --format json
\`\`\`

## Nivel 2 (bloqueante)
\`\`\`
npx fallow audit --format json --level 2
\`\`\`

## Regras
- CRITICO/ALTO com auto_fixable=true -> IA corrige automaticamente
- CRITICO/ALTO sem auto_fixable -> bloqueia entrega
- MEDIO/BAIXO -> documenta e entrega com notas
`)

  return skillsDir
}

// ─────────────────────────────────────────────────────────────
//  PHASE 5: Scaffold & Macro Orchestration
// ─────────────────────────────────────────────────────────────

function writeGatewayMcpConfig(projectDir) {
  writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      "casdoor-gateway": {
        command: "docker",
        args: ["exec", "-i", "casdoor", "casdoor", "mcp"],
        env: {
          CASDOOR_ENDPOINT: "http://localhost:8000",
          CASDOOR_CLIENT_ID: "gstack-local",
          GATEWAY_MODE: "local-iam",
        },
      },
      headroom: {
        command: "npx",
        args: ["-y", "@gstack/headroom-proxy"],
        env: {
          HEADROOM_CACHE_SIZE: "500mb",
          HEADROOM_COMPRESSION: "gzip",
          HEADROOM_MODE: "compact",
        },
      },
    },
  }, null, 2) + "\n")
}

function writePaperclipManifest(projectDir, projectName) {
  writeFileSync(join(projectDir, "paperclip.toml"),
`[meta]
name = "${projectName}-managed"
orchestrator = "paperclip"

[queue]
provider = "jira"
project_key = "${projectName}"
sync_interval = 60
default_status = "In Progress"

[teams]
map.ai = ["supervisor", "pipeline", "producer-reviewer", "validator"]

[ticket_workflow]
on_transition = "In Progress"
  then = [
    "atomic.worktree.create",
    "ai.delegate(supervisor)",
    "quality.gate(level=1, auto_fixable=true)",
    "openhands.validate",
    "review",
    "pr.create",
  ]

[audit]
trail_file = ".gstack/audit.jsonl"
token_budget = 128000
max_agents = 4

[fallow]
gate = "npx fallow audit --format json"
block_on = ["CRITICO", "ALTO"]
auto_fixable = true
`)

  writeFileSync(join(projectDir, "symphony.yml"),
`version: "1.0"
orchestrator: symphony
project: ${projectName}

ticket_provider:
  type: jira
  project: ${projectName}
  sync_every: 60

teams:
  - harness/supervisor
  - harness/pipeline
  - harness/producer-reviewer
  - harness/validator

workflow:
  on_ticket_in_progress:
    - delegate supervisor
    - quality gate (level 1, auto_fixable=true)
    - openhands validate
    - create pr

audit:
  trail: .gstack/audit.jsonl
  token_budget: 128000
`)
}

const TEMPLATE_MANIFEST = {
  "fullstack-monorepo": {
    run_command: "pnpm dev",
    build_command: "pnpm build",
    env: { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/project", NEXT_PUBLIC_SUPABASE_URL: "change-me", NEXT_PUBLIC_SUPABASE_ANON_KEY: "change-me" },
    ports: [
      { name: "web", port: 5173, protocol: "http", health: "/" },
      { name: "api", port: 3000, protocol: "http", health: "/health" },
    ],
    services: [
      { name: "web", command: "pnpm dev:web", port: 5173, health: "/" },
      { name: "api", command: "pnpm dev:api", port: 3000, health: "/health" },
    ],
  },
  "saas-auth-stripe": {
    run_command: "concurrently \"pnpm dev:web\" \"pnpm dev:api\"",
    build_command: "pnpm build",
    env: { NEXT_PUBLIC_SUPABASE_URL: "change-me", NEXT_PUBLIC_SUPABASE_ANON_KEY: "change-me", STRIPE_SECRET_KEY: "sk_test_change-me", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_change-me" },
    ports: [
      { name: "web", port: 3000, protocol: "http", health: "/" },
      { name: "api", port: 3001, protocol: "http", health: "/api/health" },
    ],
    services: [
      { name: "web", command: "pnpm dev:web", port: 3000, health: "/" },
      { name: "api", command: "pnpm dev:api", port: 3001, health: "/api/health" },
    ],
  },
  "mobile-backend": {
    run_command: "concurrently \"pnpm dev:api\" \"pnpm dev:mobile\"",
    build_command: "pnpm build",
    env: { API_URL: "http://localhost:3000", DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/project", EXPO_PUBLIC_API_URL: "http://localhost:3000" },
    ports: [
      { name: "api", port: 3000, protocol: "http", health: "/health" },
      { name: "mobile", port: 8081, protocol: "http", health: "/" },
    ],
    services: [
      { name: "api", command: "pnpm dev:api", port: 3000, health: "/health" },
    ],
  },
  "ai-agent-platform": {
    run_command: "uvicorn api.main:app --host 0.0.0.0 --port 8000",
    build_command: null,
    env: { OPENAI_API_KEY: "change-me", ANTHROPIC_API_KEY: "change-me", CHROMA_DB_PATH: "./chroma_db" },
    ports: [
      { name: "api", port: 8000, protocol: "http", health: "/health" },
    ],
    services: [
      { name: "api", command: "uvicorn api.main:app --host 0.0.0.0 --port 8000", port: 8000, health: "/health" },
    ],
  },
}

const resolvePort = (tpl) =>
  (tpl.ports.length === 1 ? tpl.ports[0].port : (tpl.ports.find((p) => p.name === "web")?.port || tpl.ports[0].port))
// app.json reflete as CAPACIDADES REAIS (P0.5): em lite não há Atomic/Casdoor/ECC.
function buildAppManifest({ projectName, now, isLite, tpl }) {
  return {
    name: projectName,
    runtime: "gstack-workspace",
    mode: isLite ? "lite" : "full",
    createdAt: now(),
    packageManager: "pnpm",
    harnesses: OMNIHARNESS_MAP.map((h) => h.id),
    vcs: isLite ? "git" : "atomic",
    sandbox: "openhands",
    controlPlane: isLite ? null : "ecc-universal",
    mcpGateway: isLite ? null : "casdoor",
    meshFederation: !isLite,
    ticketOrchestration: "paperclip",
    iam: isLite ? "none" : "casdoor-local",
    run_command: tpl.run_command,
    build_command: tpl.build_command,
    env: tpl.env,
    port: resolvePort(tpl),
  }
}
// Secrets schema v2 (PRD 12 §10): nomes + metadados, NUNCA valores (valor no keychain).
const SECRETS_SCHEMA = {
  schemaVersion: 2,
  provider: "os-keychain",
  required: [
    { name: "DATABASE_URL", scope: "runtime", services: ["api"], sensitive: true },
  ],
  optional: [
    "CASDOOR_CLIENT_SECRET",
    "GH_TOKEN",
    "LITELLM_BASE_URL",
    "AGENTMEMORY_FED_TOKEN",
    "PAPERCLIP_API_KEY",
  ],
}
function writeGstackManifests(gstackDir, { projectName, now, isLite, tpl, templateName }) {
  writeJson(join(gstackDir, "app.json"), buildAppManifest({ projectName, now, isLite, tpl }))
  writeJson(join(gstackDir, "services.json"), { services: tpl.services })
  writeJson(join(gstackDir, "ports.json"), { version: 1, ports: tpl.ports })
  // Runtime Manifest V2 (PRD 12 PR3): contrato consumido pelo supervisor (`dev`).
  writeJson(join(gstackDir, "runtime.json"), buildRuntimeManifest({ services: tpl.services }))
  writeJson(join(gstackDir, "secrets.schema.json"), SECRETS_SCHEMA)
  // Registry declarativo (dual-lane Composio + Printing Press); NÃO instala nada.
  writeJson(join(gstackDir, "integrations.json"), buildIntegrationsRegistry(templateName))
  // Context docs + loop budget (governança de workflows agênticos; delegação opt-in).
  writeJson(join(gstackDir, "context.json"), buildContextRegistry())
  writeJson(join(gstackDir, "loop-budget.json"), DEFAULT_LOOP_BUDGET)
  // Marcador CANÔNICO (P0.3): projeto NOVO já nasce ATIVO de verdade — sem ele os
  // hooks Python veriam este `.gstack/` como inerte (o falso-verde que o P0.3 mata).
  writeProjectMarker(dirname(gstackDir), { mode: isLite ? "lite" : "full", createdBy: "gstack_vibehard:create" })
}
function writeContextDocDirs(projectDir) {
  for (const rel of Object.values(CONTEXT_DOC_SOURCES)) {
    const d = join(projectDir, rel)
    mkdirSync(d, { recursive: true })
    const keep = join(d, ".gitkeep")
    if (!existsSync(keep)) writeFileSync(keep, "")
  }
}

// Dockerfile por stack: AI = Python (uvicorn); demais = Node multi-stage.
// Mobile (Expo) não é containerizado — Docker cobre apenas a API.
const PY_DOCKERFILE = `FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY pyproject.toml ./
RUN pip install --no-cache-dir uv && uv pip install --system .
COPY . .
RUN useradd -m gstack && chown -R gstack /app
USER gstack
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
`
const NODE_DOCKERFILE = `FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S gstack && adduser -S gstack -G gstack
COPY --from=build --chown=gstack:gstack /app /app
USER gstack
CMD ["node", "apps/api/dist/index.js"]
`
const pickDockerfile = (isPython) => (isPython ? PY_DOCKERFILE : NODE_DOCKERFILE)

const DOCKERIGNORE = `node_modules
.git
.env
.env.*
dist
build
coverage
graphify-out
.gstack/casdoor.json
`
const GITIGNORE = `# Dependências
node_modules/

# Build / saída
dist/
build/
.next/
coverage/
graphify-out/

# Monorepo / ferramentas
.turbo/
.vercel/
*.local

# Secrets — NUNCA commitar (mantém apenas o exemplo)
.env
.env.*
!.env.example

# Estado local do gstack
.gstack/*.local
.gstack/casdoor.json
.gstack/runtime/

# SO / logs
.DS_Store
*.log
`
// .gitignore SEMPRE gerado em runtime (não empacotado): o npm faz strip de qualquer
// `.gitignore` do tarball. Como o create roda `git init`, sem isto um `git add -A`
// estagiaria node_modules e — pior — o `.env` com secrets. Só escreve se não houver.
function writeGitignoreIfAbsent(projectDir) {
  const gitignorePath = join(projectDir, ".gitignore")
  if (existsSync(gitignorePath)) return
  writeFileSync(gitignorePath, GITIGNORE)
}

// Comando de dev por stack: AI = uvicorn; mobile = dev:api + dev:mobile; demais = pnpm dev.
function pickDevCommand(isPython, templateName) {
  if (isPython) return "uv run uvicorn api.main:app --reload --port \"${API_PORT:-8000}\""
  if (templateName === "mobile-backend") return "pnpm dev:api & pnpm dev:mobile"
  return "pnpm dev"
}
function writeDevScript(scriptsDir, devCommand) {
  const devScript =
`#!/usr/bin/env sh
set -eu

export WEB_PORT="\${WEB_PORT:-5173}"
export API_PORT="\${API_PORT:-3000}"
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# Casdoor IAM (if running)
docker start casdoor 2>/dev/null || true

echo "gstack dev: web=$WEB_PORT api=$API_PORT teams=1"
${devCommand}
`
  writeFileSync(join(scriptsDir, "dev.sh"), devScript)
  try { chmodSync(join(scriptsDir, "dev.sh"), 0o755) } catch { /* chmod best-effort */ }
}
function copyHelperScripts(projectRoot, scriptsDir) {
  for (const script of ["deep_research.py", "team_builder.py"]) {
    const src = join(projectRoot, "scripts", "scripts", script)
    if (existsSync(src)) copyFileSync(src, join(scriptsDir, script))
  }
}

export function writeRuntimeFiles({ projectDir, projectName, now, projectRoot, templateName, isLite = false }) {
  const gstackDir = join(projectDir, ".gstack")
  const scriptsDir = join(projectDir, "scripts")
  mkdirSync(gstackDir, { recursive: true })
  mkdirSync(scriptsDir, { recursive: true })
  const tpl = TEMPLATE_MANIFEST[templateName] || TEMPLATE_MANIFEST["fullstack-monorepo"]

  writeGstackManifests(gstackDir, { projectName, now, isLite, tpl, templateName })
  writeContextDocDirs(projectDir)

  const isPython = templateName === "ai-agent-platform"
  writeFileSync(join(projectDir, "Dockerfile"), pickDockerfile(isPython))
  writeFileSync(join(projectDir, ".dockerignore"), DOCKERIGNORE)
  writeGitignoreIfAbsent(projectDir)
  writeDevScript(scriptsDir, pickDevCommand(isPython, templateName))
  copyHelperScripts(projectRoot, scriptsDir)
}

async function writeJsonMerge(targetPath, newConfig, opts) {
  let existing = {}
  try {
    const raw = readFileSync(targetPath, "utf8")
    existing = JSON.parse(raw)
  } catch (e) {
    console.warn(`writeJsonMerge: config existente ignorado (${e.message || e})`)
  }
  const merged = deepMerge(existing, newConfig)
  await writeFile(targetPath, JSON.stringify(merged, null, 2) + "\n", "utf8")
}

function resolvePythonCmd() {
  try {
    execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 5000 })
    return "python3"
  } catch {
    return "python"
  }
}

async function writeRealHarnessBridge(cwd, opts) {
  console.log("🔗 Integrando Harness Bridge Universal...")
  try {
    const cursorRulesDir = join(cwd, ".cursor", "rules")
    await mkdir(cursorRulesDir, { recursive: true })
    await writeFile(join(cursorRulesDir, "gstack-vibehard.mdc"), `---
description: GStack VibeHard 2.0 Universal Bridge
globs: ["**/*"]
alwaysApply: true
---
Sempre passe pelo Quality Gate local antes de finalizar o codigo.
Eventos de ferramentas devem ser logados via agent-hooks.
`)

    // NOTA: `create` é PROJECT-SCOPED. A config GLOBAL de harness (Claude
    // settings.json, OpenCode plugins) é responsabilidade do `install` — não do
    // create. Escrever em ~/.config/opencode ou ~/.claude aqui causava EPERM e
    // tocava o ambiente global do usuário sem manifest/backup. Removido.
    const pyCmd = resolvePythonCmd()
    const gstackHooksDir = join(homedir(), ".gstack", "hooks")
    const codexHooksDir = join(homedir(), ".codex", "hooks")
    const hooksDir = existsSync(gstackHooksDir) ? gstackHooksDir : codexHooksDir

    // Cursor: hooks.json em nivel de projeto (formato oficial version: 1)
    const cursorHooksPath = join(cwd, ".cursor", "hooks.json")
    const cursorConfig = {
      version: 1,
      hooks: {
        beforeShellExecution: [{ command: `${pyCmd} "${join(hooksDir, "pre_tool_use_security.py")}"`, timeout: 30 }],
        stop: [{ command: `${pyCmd} "${join(hooksDir, "stop.py")}"`, timeout: 600 }],
      },
    }
    await writeJsonMerge(cursorHooksPath, cursorConfig, opts)
  } catch (e) {
    console.warn(`  ⚠ Harness Bridge: ${e.message || e} (non-blocking)`)
  }
}

export function writeHarnessFiles(projectDir, projectName, { isLite = false } = {}) {
  mkdirSync(join(projectDir, ".cursor", "rules"), { recursive: true })
  mkdirSync(join(projectDir, ".windsurf", "rules"), { recursive: true })
  mkdirSync(join(projectDir, ".claude", "agents"), { recursive: true })
  mkdirSync(join(projectDir, ".claude", "workflows"), { recursive: true })

  writeFileSync(join(projectDir, ".cursor", "rules", "gstack.mdc"),
`---
description: GStack project rules for ${projectName}
globs: 
---

# ${projectName}

Use the local GStack runtime files in .gstack/ before changing architecture.
Quality gate: npx fallow audit --format json
`)

  writeFileSync(join(projectDir, ".windsurf", "rules", "gstack.md"),
`# ${projectName}

Run the project quality gate before final delivery:
  npx fallow audit --format json
`)

  writeFileSync(join(projectDir, ".claude", "workflows", "deploy.js"),
`// ${projectName} — Deploy workflow (Claude Code /effort ultracode)
// Use /effort ultracode to activate this workflow for complex tasks.
// GStack deploy checklist: security gate -> build -> qg -> ship

const workflow = {
  name: "deploy",
  description: "Deploy pipeline with security gate, build, QG, and ship",
  triggers: ["deploy", "release", "publish"],
  steps: [
    { action: "run security gate", expected: "all checks pass" },
    { action: "build project", expected: "exit code 0" },
    { action: "run quality gate", expected: "no CRITICO/ALTO blockers" },
    { action: "deploy to production", expected: "deploy URL" },
  ],
  recovery: [
    { when: "security gate fails", action: "fix all CRITICO/ALTO items before retry" },
    { when: "build fails", action: "check build logs and fix compilation errors" },
    { when: "QG blocks", action: "fix blocking items or mark auto_fixable for AI correction" },
  ],
};

export default workflow;
`)

  writeFileSync(join(projectDir, ".clinerules"),
`# ${projectName}

Respect AGENTS.md and .gstack/*.json as source of truth.
Quality gate before shipping: npx fallow audit --format json
For complex multi-step tasks, use /effort ultracode to activate dynamic JS workflows.
`)

  writeFileSync(join(projectDir, "AGENTS.md"),
`# ${projectName}

## Superpowers Cycle (obrigatorio)
1. Plan  2. TDD  3. Implement  4. Verify  5. Review  6. Ship

## Runtime
- Sandbox: OpenHands (headless SDK isolation)
${isLite ? "" : "- VCS: Atomic (token-level isolation, github.com/atomicdotdev/atomic)\n- IAM: Casdoor local (Docker SQLite, localhost:8000)\n- Harness Optimizer: ECC (ecc-universal — agents/skills/hooks/AgentShield)\n- MCP Gateway: Casdoor (IAM local) + Headroom (compact proxy)\n- Mesh Federation: AgentMemory P2P (BM25 + Vector + Graph sync)\n"}- Ticket Orchestration: Paperclip / Symphony (Jira/Linear integration)
- Omniharness: Claude, Cursor, Codex, Windsurf, OpenCode, Gemini, Kiro, Antigravity, Zed, Hermes, Trae
- Coverage Gaps: fallow coverage setup (hot/cold path analysis)
- Workflows: .claude/workflows/ (ativar com /effort ultracode)
${isLite ? "\n> Modo lite: sem Casdoor/IAM, Atomic VCS, ECC (ecc-universal) ou AgentMemory Federation.\n" : ""}
## Commands
- Dev: pnpm dev
- Managed dev: scripts/dev.sh
- Quality gate: npx fallow audit --format json
- Coverage gaps: pnpm coverage:gaps
- Tickets: paperclip status
${isLite ? "" : "- IAM: http://localhost:8000 (admin/123)\n"}- Workflows: /effort ultracode (para tarefas complexas)

## auto_fixable
A IA corrige automaticamente bugs estruturais detectados pelo fallow.
`)
}

function writeTeamMatrix(projectDir, projectName) {
  const teamsDir = join(projectDir, ".claude", "teams")
  mkdirSync(teamsDir, { recursive: true })

  writeFileSync(join(teamsDir, "supervisor.json"), JSON.stringify({
    team: {
      name: `${projectName}-supervisor`,
      pattern: "supervisor",
      description: "Supervisor team: coordinator delegates to sub-agents and validates outputs",
      agents: [
        { role: "planner", model: "inherit", tools: ["Read", "Write", "Bash"] },
        { role: "implementer", model: "inherit", tools: ["Read", "Write", "Edit", "Bash"] },
        { role: "reviewer", model: "inherit", tools: ["Read", "Grep", "Glob"] },
      ],
      coordinator: { strategy: "round-robin", validation: "reviewer-approves" },
    },
  }, null, 2) + "\n")

  writeFileSync(join(teamsDir, "pipeline.json"), JSON.stringify({
    team: {
      name: `${projectName}-pipeline`,
      pattern: "pipeline",
      description: "Pipeline team: sequential stages with gates between each step",
      stages: [
        { name: "analyze", agent: "planner", gate: "plan-approved" },
        { name: "implement", agent: "implementer", gate: "tests-pass" },
        { name: "review", agent: "reviewer", gate: "review-approved" },
        { name: "ship", agent: "deployer", gate: "security-pass" },
      ],
    },
  }, null, 2) + "\n")

  writeFileSync(join(teamsDir, "producer-reviewer.json"), JSON.stringify({
    team: {
      name: `${projectName}-producer-reviewer`,
      pattern: "producer-reviewer",
      description: "Producer-Reviewer pair: one produces artifacts, another validates before integration",
      pairs: [
        { producer: "implementer", reviewer: "reviewer", artifacts: ["code", "tests"] },
        { producer: "planner", reviewer: "product-owner", artifacts: ["spec", "plan"] },
      ],
      validation: "reviewer-must-approve",
    },
  }, null, 2) + "\n")

  writeFileSync(join(teamsDir, "validator.json"), JSON.stringify({
    team: {
      name: `${projectName}-validator`,
      pattern: "validator",
      description: "Validator team: verifies output quality before proceeding to next phase",
      checks: [
        { name: "quality-gate", level: 1, blocking: true },
        { name: "security-scan", severity: "CRITICO", blocking: true },
        { name: "typecheck", blocking: true },
      ],
    },
  }, null, 2) + "\n")

  writeFileSync(join(teamsDir, "README.md"),
`# ${projectName} — Claude Agent Teams

Set \`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1\` in your environment.

Available patterns:
- **supervisor** — coordinator delegates to sub-agents
- **pipeline** — sequential stages with validation gates
- **producer-reviewer** — pair production with mandatory review
- **validator** — quality gates before progression

Enable a team:
  export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
  export CLAUDE_TEAM=supervisor
`)
}

// ─────────────────────────────────────────────────────────────
//  Vertical Templates
// ─────────────────────────────────────────────────────────────

export function scaffoldVerticalTemplate(templateName, projectDir, projectName, logger) {
  const t = (name) => join(projectDir, name)
  const e = () => ensureGstackDir(projectDir)

  switch (templateName) {
    case "saas-auth-stripe":
      e()
      mkdirSync(t("apps/web"), { recursive: true })
      mkdirSync(t("apps/api/src"), { recursive: true })
      mkdirSync(t("packages/db"), { recursive: true })
      mkdirSync(t("packages/shared"), { recursive: true })

      writeFileSync(t("package.json"), JSON.stringify({
        name: projectName, private: true,
        workspaces: ["apps/*", "packages/*"],
        scripts: {
          dev: "concurrently \"pnpm dev:web\" \"pnpm dev:api\"",
          "dev:web": "pnpm --filter web dev",
          "dev:api": "pnpm --filter api dev",
          build: "pnpm -r build",
        },
        devDependencies: { "typescript": "^5", "concurrently": "^9", "@types/node": "^22" },
      }, null, 2))

      // apps/web — Next.js (script dev real)
      writeFileSync(t("apps/web/package.json"), JSON.stringify({
        name: "web", private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { "next": "^15", "react": "^19", "react-dom": "^19", "@supabase/supabase-js": "^2", "@stripe/stripe-js": "^5", "@trpc/next": "^11", "@trpc/react-query": "^11", "zod": "^3" },
        devDependencies: { "typescript": "^5", "@types/react": "^19" },
      }, null, 2))
      mkdirSync(t("apps/web/app"), { recursive: true })
      writeFileSync(t("apps/web/app/page.tsx"), [
        "export default function Home() {",
        "  return <main><h1>SaaS — Next.js + Supabase + Stripe</h1></main>",
        "}",
      ].join("\n"))

      // apps/api — tsx watch (script dev real)
      writeFileSync(t("apps/api/package.json"), JSON.stringify({
        name: "api", private: true, type: "module",
        scripts: { dev: "tsx watch src/index.ts", build: "tsc -p ." },
        dependencies: { "@supabase/supabase-js": "^2", "stripe": "^17", "zod": "^3" },
        devDependencies: { "typescript": "^5", "tsx": "^4", "@types/node": "^22" },
      }, null, 2))
      writeFileSync(t("apps/api/src/index.ts"), [
        "import { createServer } from 'node:http'",
        "const port = Number(process.env.API_PORT ?? 3000)",
        "createServer((req, res) => {",
        "  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'ok' })); return }",
        "  res.writeHead(404); res.end()",
        "}).listen(port, () => console.log(`api on http://localhost:${port}`))",
      ].join("\n"))

      writeFileSync(t(".env.example"), [
        "# Supabase", "NEXT_PUBLIC_SUPABASE_URL=change-me", "NEXT_PUBLIC_SUPABASE_ANON_KEY=change-me",
        "# Stripe", "STRIPE_SECRET_KEY=sk_test_change-me", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_change-me", "STRIPE_WEBHOOK_SECRET=whsec_change-me",
        "# App", "APP_URL=http://localhost:3000", "",
      ].join("\n"))

      writeFileSync(t("apps/api/src/auth.ts"), [
        "import { createClient } from '@supabase/supabase-js'",
        "import Stripe from 'stripe'",
        `const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)`,
        `const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)`,
        "export async function createCheckoutSession(userId: string, priceId: string) {",
        "  const session = await stripe.checkout.sessions.create({",
        "    mode: 'subscription', line_items: [{ price: priceId, quantity: 1 }],",
        "    client_reference_id: userId,",
        "    success_url: `${process.env.APP_URL}/dashboard`, cancel_url: `${process.env.APP_URL}/pricing`,",
        "  })",
        "  return session",
        "}",
        "export async function handleStripeWebhook(rawBody: Buffer, signature: string) {",
        "  const event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!)",
        "  if (event.type === 'checkout.session.completed') {",
        "    const userId = event.data.object.client_reference_id",
        "    await supabase.from('subscriptions').upsert({ user_id: userId, status: 'active' })",
        "  }",
        "  return event",
        "}",
      ].join("\n"))

      logger.success(`Template SaaS (Next.js + Supabase + Stripe) scaffolded`)
      break

    case "mobile-backend":
      e()
      mkdirSync(t("apps/mobile/lib"), { recursive: true })
      mkdirSync(t("apps/api/src"), { recursive: true })
      mkdirSync(t("packages/db"), { recursive: true })

      writeFileSync(t("package.json"), JSON.stringify({
        name: projectName, private: true,
        workspaces: ["apps/*", "packages/*"],
        scripts: {
          "dev:mobile": "pnpm --filter mobile start",
          "dev:api": "pnpm --filter api dev",
          "db:push": "cd packages/db && pnpm drizzle-kit push",
          "db:generate": "cd packages/db && pnpm drizzle-kit generate",
        },
        devDependencies: { "typescript": "^5" },
      }, null, 2))

      // apps/mobile — Expo (script start real)
      writeFileSync(t("apps/mobile/package.json"), JSON.stringify({
        name: "mobile", private: true,
        scripts: { start: "expo start", android: "expo start --android", ios: "expo start --ios" },
        dependencies: {
          "expo": "~52", "react": "^19", "react-native": "^0.76", "@tanstack/react-query": "^5",
          "@trpc/client": "^11", "@trpc/react": "^11", "zod": "^3",
          "@react-navigation/native": "^7", "@react-navigation/native-stack": "^7",
          "expo-router": "~4", "expo-secure-store": "~14",
        },
        devDependencies: { "typescript": "^5", "@types/react": "^19" },
      }, null, 2))

      // apps/api — tRPC standalone (script dev real)
      writeFileSync(t("apps/api/package.json"), JSON.stringify({
        name: "api", private: true, type: "module",
        scripts: { dev: "tsx watch src/index.ts", build: "tsc -p ." },
        dependencies: { "@trpc/server": "^11", "zod": "^3" },
        devDependencies: { "typescript": "^5", "tsx": "^4", "@types/node": "^22" },
      }, null, 2))

      mkdirSync(t("apps/mobile/app"), { recursive: true })
      writeFileSync(t("apps/mobile/app/_layout.tsx"), [
        "import { Stack } from 'expo-router'",
        "import { QueryClient, QueryClientProvider } from '@tanstack/react-query'",
        "import { trpc, trpcClient } from '../lib/trpc'",
        "const queryClient = new QueryClient()",
        "export default function RootLayout() {",
        "  return (",
        "    <trpc.Provider client={trpcClient} queryClient={queryClient}>",
        "      <QueryClientProvider client={queryClient}>",
        "        <Stack />",
        "      </QueryClientProvider>",
        "    </trpc.Provider>",
        "  )",
        "}",
      ].join("\n"))

      writeFileSync(t("apps/api/src/index.ts"), [
        "import { initTRPC } from '@trpc/server'",
        "import { z } from 'zod'",
        "import { createHTTPServer } from '@trpc/server/adapters/standalone'",
        "",
        "const t = initTRPC.create()",
        "const appRouter = t.router({",
        "  health: t.procedure.query(() => ({ status: 'ok', timestamp: new Date().toISOString() })),",
        "  hello: t.procedure.input(z.object({ name: z.string() })).query(({ input }) => ({ message: `Hello ${input.name}` })),",
        "})",
        "",
        "export type AppRouter = typeof appRouter",
        "createHTTPServer({ router: appRouter, port: 3000 }).listen()",
        "console.log('tRPC API running on http://localhost:3000')",
      ].join("\n"))

      writeFileSync(t("apps/mobile/lib/trpc.ts"), [
        "import { createTRPCReact } from '@trpc/react'",
        "import type { AppRouter } from '../../api/src/index'",
        "export const trpc = createTRPCReact<AppRouter>()",
        "export const trpcClient = trpc.createClient({ url: 'http://localhost:3000' })",
      ].join("\n"))

      writeFileSync(t(".env.example"), [
        "# API", "API_URL=http://localhost:3000",
        "# Database", "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/project",
        "# Expo", "EXPO_PUBLIC_API_URL=http://localhost:3000", "",
      ].join("\n"))

      logger.success(`Template Mobile (Expo + tRPC + PostgreSQL) scaffolded`)
      break

    case "ai-agent-platform":
      e()
      mkdirSync(t("agents"), { recursive: true })
      mkdirSync(t("tools"), { recursive: true })
      mkdirSync(t("memory"), { recursive: true })
      mkdirSync(t("api"), { recursive: true })

      writeFileSync(t("pyproject.toml"), [
        "[project]", `name = "${projectName}"`, "version = \"0.1.0\"",
        "requires-python = \">=3.11\"",
        "dependencies = [",
        "  \"langgraph>=0.3\", \"langchain>=0.3\", \"langchain-openai>=0.2\", \"llama-index>=0.12\",",
        "  \"chromadb>=0.6\", \"openai>=1.0\", \"fastapi>=0.115\",",
        "  \"uvicorn[standard]\", \"pydantic>=2\", \"httpx>=0.28\"",
        "]", "",
      ].join("\n"))

      writeFileSync(t("agents/research_agent.py"), [
        "from langgraph.graph import StateGraph, MessagesState",
        "from langchain_openai import ChatOpenAI",
        "",
        "llm = ChatOpenAI(model=\"gpt-4o\")",
        "",
        "def research_node(state: MessagesState) -> MessagesState:",
        '    """Pesquisa e sintetiza informacao sobre um topico."""',
        "    response = llm.invoke(state[\"messages\"])",
        "    return {\"messages\": [response]}",
        "",
        "graph = StateGraph(MessagesState)",
        "graph.add_node(\"research\", research_node)",
        "graph.add_edge(\"__start__\", \"research\")",
        "graph.add_edge(\"research\", \"__end__\")",
        "app = graph.compile()",
        "",
        'if __name__ == \"__main__\":',
        '    result = app.invoke({\"messages\": [(\"user\", \"Pesquise sobre gVisor e Firecracker\")]})',
        "    print(result[\"messages\"][-1].content)",
      ].join("\n"))

      writeFileSync(t("agents/supervisor.py"), [
        "from langgraph.graph import StateGraph, MessagesState",
        "from typing import Literal",
        "",
        "def supervisor(state: MessagesState) -> Literal[\"research\", \"code\", \"end\"]:",
        "    last = state[\"messages\"][-1].content.lower()",
        "    if \"pesquis\" in last or \"search\" in last:",
        '        return "research"',
        "    if \"cod\" in last or \"code\" in last or \"implement\" in last:",
        '        return "code"',
        '    return "end"',
        "",
      ].join("\n"))

      writeFileSync(t("memory/vector_store.py"), [
        "from chromadb import PersistentClient",
        "from chromadb.utils import embedding_functions",
        "",
        "client = PersistentClient(path=\"./chroma_db\")",
        "ef = embedding_functions.DefaultEmbeddingFunction()",
        "collection = client.get_or_create_collection(name=\"agent_memory\", embedding_function=ef)",
        "",
        "def store_memory(key: str, content: str, metadata: dict | None = None):",
        "    collection.add(documents=[content], ids=[key], metadatas=[metadata])",
        "",
        "def query_memory(query: str, n: int = 5):",
        "    return collection.query(query_texts=[query], n_results=n)",
        "",
      ].join("\n"))

      writeFileSync(t("api/main.py"), [
        "from fastapi import FastAPI",
        "from pydantic import BaseModel",
        "",
        "app = FastAPI(title=\"AI Agent Platform\")",
        "",
        "class Query(BaseModel):",
        "    message: str",
        "    thread_id: str | None = None",
        "",
        "@app.post(\"/chat\")",
        "async def chat(query: Query):",
        '    return {\"response\": \"Processed\", \"thread\": query.thread_id}',
        "",
        "@app.get(\"/health\")",
        "async def health():",
        '    return {\"status\": \"ok\"}',
        "",
      ].join("\n"))

      writeFileSync(t(".env.example"), [
        "# LLM", "OPENAI_API_KEY=change-me", "ANTHROPIC_API_KEY=change-me",
        "# Vector DB", "CHROMA_DB_PATH=./chroma_db",
        "# API", "API_PORT=8000",
        "# LangSmith (observability)", "LANGSMITH_TRACING=true", "LANGSMITH_API_KEY=change-me", "",
      ].join("\n"))

      logger.success(`Template AI Agent Platform (LangGraph + ChromaDB + FastAPI) scaffolded`)
      break
  }
}

// ─────────────────────────────────────────────────────────────
//  createProject — DAG Boot Sequencial Estrito
// ─────────────────────────────────────────────────────────────

const VALID_TEMPLATES = {
  "fullstack-monorepo": { label: "Fullstack (React + Express + Supabase)", default: true },
  "saas-auth-stripe": { label: "SaaS (Next.js + Supabase + Stripe)", default: false },
  "mobile-backend": { label: "Mobile (Expo + tRPC + PostgreSQL)", default: false },
  "ai-agent-platform": { label: "AI Agent Platform (LangGraph + Vector DB)", default: false },
}
const resolveTemplateName = (args) => {
  const i = args.findIndex((a) => a === "--template")
  return i !== -1 && args[i + 1] ? args[i + 1] : "fullstack-monorepo"
}
function createRuntime(options) {
  return {
    logger: options.logger || defaultLogger,
    cwd: options.cwd || process.cwd(),
    projectRoot: options.projectRoot || getProjectRoot(),
    execSync: options.execSync || defaultExecSync,
    now: options.now || (() => new Date().toISOString()),
  }
}
function resolveCreateCtx(options) {
  const args = options.args || []
  return {
    args, options,
    projectName: args[0],
    // DEFAULT = LITE (P0.5): sem `--full`, é project-scoped; em conflito lite vence.
    isLite: args.includes("--lite") || !args.includes("--full"),
    templateName: resolveTemplateName(args),
    ...createRuntime(options),
  }
}
function validateCreate(projectName, templateName) {
  if (!VALID_TEMPLATES[templateName]) throw new Error(`Template invalido: "${templateName}". Validos: ${Object.keys(VALID_TEMPLATES).join(", ")}`)
  if (!projectName) throw new Error(`Uso: gstack_vibehard create <nome-do-app> [--template ${Object.keys(VALID_TEMPLATES).join("|")}]`)
  // C1: allowlist estrito. C1b: rejeita ".", ".." e dotfiles (traversal/clobber de .git/.gstack).
  if (!/^[a-zA-Z0-9._-]+$/.test(projectName)) throw new Error(`Nome de projeto invalido: "${projectName}". Use apenas letras, numeros, ponto, hifen e underline.`)
  if (/^\.+$/.test(projectName) || projectName.startsWith(".")) throw new Error(`Nome de projeto invalido: "${projectName}". Nao use "." , ".." nem nomes iniciados por ponto.`)
}

function buildDryRunReport(c, projectDir) {
  const { isLite, projectName, templateName } = c
  return {
    project: projectName, template: templateName, mode: isLite ? "lite" : "full", dir: projectDir,
    writes: { projectScoped: [projectDir], global: isLite ? [] : [join(HOME, ".atomic")] },
    provisions: isLite ? [] : ["Casdoor (Docker)", "Atomic VCS", "ECC (ecc-universal)", "AgentMemory federation"],
    note: "dry-run: nada foi escrito",
  }
}
// DRY-RUN (P0.5): mostra o impacto e NÃO escreve nada. Com --json, JSON puro.
function createDryRun(c, projectDir) {
  const report = buildDryRunReport(c, projectDir)
  if (c.args.includes("--json")) process.stdout.write(JSON.stringify(report) + "\n")
  else console.log(`\n  create --dry-run (${report.mode}): criaria ${projectDir} (escrita global: ${report.writes.global.length ? report.writes.global.join(", ") : "nenhuma"})`)
  return report
}

// Fases 1-3 do Full (Casdoor/Atomic/ECC/AgentMemory). STATUS honesto por componente.
function runFullProvisioning(c, projectDir) {
  const { logger, args, projectName } = c
  const phases = {}
  console.log(`\n  === Fase 1/5: IAM Local (Casdoor) ===`)
  mkdirSync(projectDir, { recursive: true })
  const casdoorUrl = startCasdoor(logger, projectDir)
  phases.casdoor = { status: casdoorUrl ? "online" : "degraded", url: casdoorUrl }
  console.log(`\n  === Fase 2/5: Atomic VCS ===`)
  writeAtomicConfig(projectDir)
  phases.atomic = { status: initAtomic(logger, projectDir, { allowRemote: args.includes("--allow-remote-downloads") }) }
  console.log(`\n  === Fase 3/5: Daemons & Memoria ===`)
  phases.ecc = { status: bootEcc(logger, projectDir) }
  writeControlPlaneConfig(projectDir, projectName)
  phases.agentmemory = { status: bootAgentMemory(logger, projectDir) }
  writeMemoryFederationConfig(projectDir)
  return phases
}
function scaffoldTemplate(c, projectDir) {
  const { templateName, projectRoot, projectName, logger } = c
  console.log(`\n  === Fase 4/5: Scaffold ${templateName} (${OMNIHARNESS_MAP.length} IDEs) ===`)
  if (templateName === "fullstack-monorepo") copyRecursive(join(projectRoot, "templates", "templates", "fullstack-monorepo"), projectDir)
  else scaffoldVerticalTemplate(templateName, projectDir, projectName, logger)
  writeRuntimeFiles({ projectDir, projectName, now: c.now, projectRoot, templateName, isLite: c.isLite })
  writeSkillsDir(projectDir)
}
async function tryHarnessBridge(projectDir, options, logger) {
  try { await writeRealHarnessBridge(projectDir, options) }
  catch (e) { logger.warn(`Harness Bridge nao pode ser escrito: ${e.message || e} (non-blocking)`) }
}
async function scaffoldOrchestration(c, projectDir) {
  const { projectName, isLite, options, logger } = c
  console.log(`\n  === Fase 5/5: Scaffold & Orquestracao Macro ===`)
  writeHarnessFiles(projectDir, projectName, { isLite })
  if (!isLite) await tryHarnessBridge(projectDir, options, logger)
  writeTeamMatrix(projectDir, projectName)
  writeGatewayMcpConfig(projectDir)
  writePaperclipManifest(projectDir, projectName)
  // Casdoor/IAM não existe em lite — não escrever config apontando p/ serviço offline.
  if (!isLite) writeCasdoorProjectConfig(projectDir)
  bootHeadroom(logger, projectDir) // non-critical, try/catch interno
}

function writeLinkVaultScripts(projectDir, vaultProjectDir) {
  const postInitScript = join(projectDir, "scripts", "link-vault.sh")
  mkdirSync(dirname(postInitScript), { recursive: true })
  writeFileSync(postInitScript, [
    "#!/bin/sh",
    `# Auto-generated: link graph.json to ${vaultProjectDir}`,
    `VAULT_TARGET="${vaultProjectDir}/graph.json"`,
    `GRAPH_SOURCE="${projectDir}/graphify-out/graph.json"`,
    'if [ -f "$GRAPH_SOURCE" ]; then',
    '  ln -sf "$GRAPH_SOURCE" "$VAULT_TARGET" 2>/dev/null || cp "$GRAPH_SOURCE" "$VAULT_TARGET"',
    '  echo "Vault graph link: $VAULT_TARGET"',
    'fi',
  ].join("\n") + "\n")
  const postInitPs1 = join(projectDir, "scripts", "link-vault.ps1")
  writeFileSync(postInitPs1, [
    "# Auto-generated: link graph.json to vault",
    `$vaultTarget = "${vaultProjectDir.replace(/\\/g, '\\\\')}\\graph.json"`,
    `$graphSource = "${projectDir.replace(/\\/g, '\\\\')}\\graphify-out\\graph.json"`,
    "if (Test-Path $graphSource) {",
    "  Remove-Item -Force $vaultTarget -ErrorAction SilentlyContinue",
    "  New-Item -ItemType SymbolicLink -Path $vaultTarget -Target $graphSource -ErrorAction SilentlyContinue | Out-Null",
    '  if (-not (Test-Path $vaultTarget)) { Copy-Item $graphSource $vaultTarget -Force }',
    '  Write-Host "Vault graph link: $vaultTarget"',
    "}",
  ].join("\n") + "\n")
}
function linkExistingGraph(graphSource, graphTarget, logger) {
  try { unlinkSync(graphTarget) } catch { /* sem stale */ }
  try { symlinkSync(graphSource, graphTarget, "file"); logger.success(`Graph symlink: ${graphTarget} → ${graphSource}`) }
  catch { copyFileSync(graphSource, graphTarget); logger.info(`Graph copied: ${graphTarget}`) } // Windows sem admin
}
function writeGraphPlaceholder(graphTarget, projectDir, vaultProjectDir, projectName, logger, now) {
  writeFileSync(graphTarget, JSON.stringify({ nodes: [], edges: [], project: projectName, created_at: now(), status: "pending" }, null, 2))
  logger.info(`Graph placeholder: ${graphTarget} (aguardando graphify)`)
  writeLinkVaultScripts(projectDir, vaultProjectDir)
}
function linkVaultGraph(projectDir, vaultProjectDir, projectName, logger, now) {
  const graphSource = join(projectDir, "graphify-out", "graph.json")
  const graphTarget = join(vaultProjectDir, "graph.json")
  try {
    if (existsSync(graphSource)) linkExistingGraph(graphSource, graphTarget, logger)
    else writeGraphPlaceholder(graphTarget, projectDir, vaultProjectDir, projectName, logger, now)
  } catch (e) { logger.warn(`Vault graph symlink: ${e.message} (non-blocking)`) }
}
// Vault Global (P0.5): só em --full ou --vault. Em LITE nada global é escrito.
function setupVault(c, projectDir) {
  if (!(!c.isLite || c.args.includes("--vault"))) return null
  const vaultProjectDir = join(homedir(), "gstack-vault", "projects", c.projectName)
  mkdirSync(vaultProjectDir, { recursive: true })
  c.logger.info(`Vault project: ${vaultProjectDir}`)
  linkVaultGraph(projectDir, vaultProjectDir, c.projectName, c.logger, c.now)
  return vaultProjectDir
}

const compIcon = (st) => ((st === "online" || st === "installed") ? "✓" : st === "degraded" ? "⚠" : "–")
const phaseStatus = (phases, key) => (phases[key] ? phases[key].status : undefined)
// STATUS HONESTO por componente do Full (installed/online vs degraded).
function printFullComponents(phases, logger) {
  logger.info("  Componentes do Full (status real nesta maquina):")
  const comps = [
    ["Casdoor IAM", phaseStatus(phases, "casdoor")],
    ["Atomic VCS", phaseStatus(phases, "atomic")],
    ["ECC (otimizador)", phaseStatus(phases, "ecc")],
    ["AgentMemory mesh", phaseStatus(phases, "agentmemory")],
  ]
  for (const [name, st] of comps) logger.info(`    ${compIcon(st)} ${name}: ${st || "n/a"}`)
  if (comps.some(([, s]) => s === "degraded")) logger.info("    (⚠ degraded = nao instalado nesta maquina; veja os avisos acima p/ o reparo — Git/projeto seguem funcionais)")
}
function printCreateSummary(c, projectDir, phases, vaultProjectDir) {
  const { logger, projectName, templateName, isLite } = c
  logger.success(`Projeto '${projectName}' criado (template: ${templateName})`)
  logger.info(`  Diretorio: ${projectDir}`)
  logger.info(`  Template: ${templateName}`)
  if (!isLite) printFullComponents(phases, logger)
  if (!isLite) logger.info(`  IAM: http://localhost:8000 (admin/123)`)
  if (vaultProjectDir) logger.info(`  Vault: ${vaultProjectDir}`)
  else logger.info(`  Modo lite: projeto isolado em ./${projectName} (sem escrita global). Use --full ou --vault para o vault Obsidian.`)
  logger.info(`  Quality gate: npx fallow audit --format json`)
  // PRD28 28.0: a trilha principal do usuário é `gstack_vibehard dev` (supervisor,
  // logs, readiness) — npm/pnpm cru não é a primeira instrução do produto.
  logger.info("")
  logger.info("  Próximos comandos:")
  logger.info(`    1. cd ${projectName}`)
  logger.info("    2. gstack_vibehard dev              # sobe o runtime")
  logger.info("    3. gstack_vibehard proof --json     # está pronto?")
  logger.info(`  (trilha completa em ${projectName}/.gstack/NEXT_STEPS.md)`)
}

// Next-step contract (PRD28 §11.3): o projeto criado carrega a própria trilha.
function writeNextSteps(projectDir, projectName, logger) {
  try {
    mkdirSync(join(projectDir, ".gstack"), { recursive: true })
    writeFileSync(join(projectDir, ".gstack", "NEXT_STEPS.md"), nextStepsContent(projectName))
  } catch (e) { logger.warn(`NEXT_STEPS.md: ${e.message} (non-blocking)`) }
}

export async function createProject(options = {}) {
  const c = resolveCreateCtx(options)
  validateCreate(c.projectName, c.templateName)
  const projectDir = join(c.cwd, c.projectName)
  if (c.args.includes("--dry-run")) return createDryRun(c, projectDir)
  if (existsSync(projectDir)) throw new Error(`Diretorio '${c.projectName}' ja existe.`)
  if (c.isLite) console.log(`\n  Modo lite ativado — pulando: Casdoor, Atomic VCS, ECC (ecc-universal), AgentMemory Federation`)
  const phases = c.isLite ? {} : runFullProvisioning(c, projectDir)
  // Em lite, o VCS é o git: garante o dir e inicializa o repo ANTES do graphify
  // (hooks de commit sem `git init` manual). Em full, o VCS é o Atomic.
  if (c.isLite) { mkdirSync(projectDir, { recursive: true }); bootGit(c.logger, projectDir, options.gitExec) }
  bootGraphify(c.logger, projectDir)
  scaffoldTemplate(c, projectDir)
  await scaffoldOrchestration(c, projectDir)
  const vaultProjectDir = setupVault(c, projectDir)
  writeNextSteps(projectDir, c.projectName, c.logger)
  printCreateSummary(c, projectDir, phases, vaultProjectDir)
  return { projectDir, phases, vaultDir: vaultProjectDir, template: c.templateName }
}

export async function createCommand(args) {
  try {
    await createProject({ args })
  } catch (err) {
    defaultLogger.error(err?.message || "create failed")
    process.exit(1)
  }
}
