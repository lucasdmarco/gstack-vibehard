import { execSync as defaultExecSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  symlinkSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir, tmpdir } from "node:os"

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

function findBinary(name, exec) {
  try {
    const cmd = process.platform === "win32" ? "where" : "which"
    const out = exec(`${cmd} ${name}`, { stdio: "pipe", timeout: 10000 })
    return out.toString().trim().split("\n")[0]
  } catch { return null }
}

function safeExec(exec, cmd, opts) {
  try { return exec(cmd, { stdio: "pipe", timeout: 30000, ...opts }) }
  catch { return null }
}

function safeDownloadAndRun(url, logger, exec, label) {
  const tmp = join(tmpdir(), `gstack-dl-${Date.now()}${process.platform === "win32" ? ".ps1" : ".sh"}`)
  const safeUrl = JSON.stringify(url)
  const safeTmp = JSON.stringify(tmp)
  try {
    if (process.platform === "win32") {
      safeExec(exec, `powershell -c "irm ${safeUrl} -OutFile ${safeTmp}"`, { timeout: 120000 })
    } else {
      safeExec(exec, `curl -fsSL ${safeUrl} -o ${safeTmp}`, { timeout: 120000 })
    }
    if (!existsSync(tmp)) {
      logger.warn(`${label}: download falhou (arquivo nao criado)`)
      return false
    }
    const content = readFileSync(tmp, "utf-8")
    if (content.length < 10) {
      logger.warn(`${label}: download muito pequeno (${content.length} bytes), possivelmente invalido`)
      try { unlinkSync(tmp) } catch {}
      return false
    }
    if (process.platform === "win32") {
      safeExec(exec, `powershell -c "& ${safeTmp}"`, { timeout: 180000 })
    } else {
      safeExec(exec, `sh ${safeTmp}`, { timeout: 180000 })
    }
    try { unlinkSync(tmp) } catch {}
    return true
  } catch {
    try { unlinkSync(tmp) } catch {}
    logger.warn(`${label}: falha no download/execucao segura`)
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

function startCasdoor(logger, exec, projectDir) {
  if (process.env.GSTACK_SKIP_PREFLIGHT) {
    logger.info("GSTACK_SKIP_PREFLIGHT set — skipping Casdoor")
    return null
  }
  if (!findBinary("docker", exec)) {
    logger.warn("Docker nao encontrado — Casdoor IAM local nao iniciado. Instale Docker para IAM local.")
    return null
  }
  const existing = safeExec(exec, 'docker ps -a --filter "name=casdoor" --format "{{.Names}}"')
  if (existing && existing.toString().trim() === "casdoor") {
    const running = safeExec(exec, 'docker ps --filter "name=casdoor" --format "{{.Names}}"')
    if (running && running.toString().trim() === "casdoor") {
      logger.success("Casdoor IAM ja rodando em localhost:8000")
      return "http://localhost:8000"
    }
    logger.info("Casdoor container existe, reiniciando...")
    safeExec(exec, "docker start casdoor")
    logger.success("Casdoor reiniciado em localhost:8000")
    return "http://localhost:8000"
  }
  logger.info("Iniciando Casdoor IAM local via docker-compose...")
  writeCasdoorCompose(projectDir)
  const composeFile = join(projectDir, ".gstack", "docker-compose.yml")
  let out = safeExec(exec, `docker compose -f "${composeFile}" up -d`, { timeout: 120000 })
  if (!out) {
    logger.info("docker compose (v2) falhou. Tentando docker-compose (v1)...")
    out = safeExec(exec, `docker-compose -f "${composeFile}" up -d`, { timeout: 120000 })
  }
  if (out) {
    logger.success("Casdoor IAM rodando em http://localhost:8000")
    logger.info("  User: admin / Password: 123 (mude apos primeiro login)")
    return "http://localhost:8000"
  }
  logger.warn("Casdoor nao iniciou — IAM local indisponivel. Projeto continua sem gateway de identidade.")
  return null
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

function initAtomic(logger, exec, projectDir) {
  if (process.env.GSTACK_SKIP_PREFLIGHT) {
    logger.info("GSTACK_SKIP_PREFLIGHT set — skipping Atomic init")
    return
  }
  if (!findBinary("atomic", exec)) {
    logger.warn("Atomic CLI nao encontrado. Tentando instalar (download seguro)...")
    const url = process.platform === "win32"
      ? "https://atomic-vcs.dev/install.ps1"
      : "https://atomic-vcs.dev/install.sh"
    const ok = safeDownloadAndRun(url, logger, exec, "Atomic CLI")
    if (!ok) {
      logger.warn("Atomic CLI nao pode ser instalado — continuando sem VCS atomico")
      logger.warn("  Instale manualmente: curl -fsSL https://atomic-vcs.dev/install.sh | sh")
      return
    }
    if (!findBinary("atomic", exec)) {
      logger.warn("Atomic CLI instalado mas nao no PATH — continuando")
      return
    }
  }
  const out = safeExec(exec, "atomic init", { cwd: projectDir })
  if (out) {
    logger.success("Atomic VCS inicializado — views paralelas disponiveis")
  } else {
    logger.warn("atomic init falhou — continuando sem VCS atomico")
  }
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
  writeFileSync(join(atomicDir, "workspace.toml"),
`[workspace]
expose = [
  ".env",
  ".env.local",
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
  safeExec(null, null) // noop: ensure workspace expose is registered
}

// ─────────────────────────────────────────────────────────────
//  PHASE 3: Daemons & Memory (ECC 2.0 + AgentMemory + Graphify)
// ─────────────────────────────────────────────────────────────

function bootEcc2(logger, exec, projectDir) {
  if (process.env.GSTACK_SKIP_PREFLIGHT) {
    logger.info("GSTACK_SKIP_PREFLIGHT set — skipping ECC 2.0")
    return
  }
  if (!findBinary("ecc2", exec)) {
    logger.warn("ECC 2.0 Daemon nao encontrado — tentando compilar do repositorio oficial...")
    const cloneDir = join(tmpdir(), "ecc2-build")
    safeExec(exec, `git clone --depth 1 https://github.com/gstack-dev/ecc2.git "${cloneDir}"`, { timeout: 120000 })
    if (existsSync(join(cloneDir, "Cargo.toml"))) {
      logger.info("Compilando ECC 2.0 via cargo (pode levar alguns minutos)...")
      const buildOk = safeExec(exec, `cargo install --path "${cloneDir}"`, { timeout: 600000 })
      try { safeExec(exec, `rm -rf "${cloneDir}"`, { timeout: 10000 }) } catch {}
      if (buildOk && findBinary("ecc2", exec)) {
        logger.success("ECC 2.0 Daemon compilado e instalado")
      } else {
        logger.warn("ECC 2.0 Daemon nao pode ser compilado — control plane desativado")
        logger.warn("  Instale manualmente: git clone https://github.com/gstack-dev/ecc2.git && cargo install --path ecc2")
        return
      }
    } else {
      try { safeExec(exec, `rm -rf "${cloneDir}"`, { timeout: 10000 }) } catch {}
      logger.warn("Repo ECC 2.0 nao encontrado — control plane desativado")
      return
    }
  }
  safeExec(exec, "ecc2 daemon start", { timeout: 15000 })
  logger.success("ECC 2.0 Daemon iniciado em background")
}

function writeControlPlaneConfig(projectDir, projectName) {
  ensureGstackDir(projectDir)
  writeFileSync(join(projectDir, ".gstack", "control-plane.yaml"),
`# GStack Control Plane — ECC 2.0 (local)
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

function bootAgentMemory(logger, exec, projectDir) {
  const out = safeExec(exec, "npx @agentmemory/agentmemory federate --enable", { cwd: projectDir })
  if (out) logger.success("AgentMemory Mesh Federation ativa (BM25 + Vetor + Grafo)")
  else logger.warn("AgentMemory Federation nao pode ser ativada — continuando sem P2P mesh")
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

function bootGraphify(logger, exec, projectDir) {
  try {
    const out = safeExec(exec, "npx graphify hook install", { cwd: projectDir })
    if (out) {
      logger.success("Graphify hooks instalados — AST gerada a cada commit")
    } else {
      logger.warn("Graphify falhou (sem erro) — AST indexacao desativada")
    }
  } catch (e) {
    logger.warn(`Otimizacao de contexto desativada temporariamente: Graphify — ${e.message}`)
  }
}

function bootHeadroom(logger, exec, projectDir) {
  try {
    const out = safeExec(exec, "npx -y @gstack/headroom-proxy --check", { cwd: projectDir })
    if (out) {
      logger.success("Headroom proxy operacional — compressao de contexto ativa")
    }
  } catch (e) {
    logger.warn(`Otimizacao de contexto desativada temporariamente: Headroom — ${e.message}`)
  }
}

// ─────────────────────────────────────────────────────────────
//  PHASE 4: Omniharness (agent-hooks & Skills)
// ─────────────────────────────────────────────────────────────

function getStandardHooksJson(homeDir) {
  return {
    version: "1.0",
    gstack: true,
    hooks: {
      preToolUse: {
        command: `python ${homeDir}/.codex/hooks/pre_tool_use_security.py`,
        timeout: 5000,
        blocking: true,
      },
      beforeShellExecution: {
        command: `python ${homeDir}/.codex/hooks/before_shell.py`,
        timeout: 3000,
        blocking: true,
      },
      afterToolUse: {
        command: "npx fallow audit --format json",
        timeout: 30000,
        blocking: false,
      },
    },
    qualityGate: {
      onCompletion: "npx fallow audit --format json",
      blockOn: ["CRITICO", "ALTO"],
      autoFixable: true,
    },
  }
}

function getZedInjectSettings() {
  return {
    "telemetry": { "diagnostics": false },
    "lsp": { "gstack": { "binary": { "path": "node", "arguments": ["--experimental-strip-types", "--experimental-transform-types"] } } },
    "gstack_integration": {
      enabled: true,
      hooksEndpoint: "http://localhost:8000",
      auditCommand: "npx fallow audit --format json",
    },
  }
}

function injectOmniharness(logger, exec, projectDir) {
  const hooksBin = findBinary("agent-hooks", exec)
  const homeForHooks = HOME.replace(/\\/g, "/")

  for (const target of OMNIHARNESS_MAP) {
    try {
      switch (target.mode) {
        case "agent-hooks": {
          if (hooksBin) {
            const cmd = `${hooksBin} init ${target.id} --dir ${JSON.stringify(projectDir)}`
            const out = safeExec(exec, cmd)
            if (out) {
              logger.success(`agent-hooks configurado para ${target.label}`)
              break
            }
          }
          if (target.configDir && target.hooksFile) {
            mkdirSync(target.configDir, { recursive: true })
            writeJson(join(target.configDir, target.hooksFile), getStandardHooksJson(homeForHooks))
            logger.success(`hooks injetados em ${target.label} (${join(target.configDir, target.hooksFile)})`)
          } else {
            logger.warn(`${target.label}: sem hooks file definido — pulando`)
          }
          break
        }
        case "direct": {
          if (target.configDir && target.hooksFile) {
            mkdirSync(target.configDir, { recursive: true })
            writeJson(join(target.configDir, target.hooksFile), getStandardHooksJson(homeForHooks))
            logger.success(`hooks injetados em ${target.label}`)
          } else {
            logger.warn(`${target.label}: sem configDir — pulando`)
          }
          break
        }
        case "zed": {
          if (target.hooksFile) {
            mkdirSync(join(HOME, ".zed"), { recursive: true })
            const existing = existsSync(target.hooksFile)
              ? JSON.parse(readFileSync(target.hooksFile, "utf-8"))
              : {}
            const merged = { ...existing, ...getZedInjectSettings() }
            writeJson(target.hooksFile, merged)
            logger.success(`Zed Editor configurado — .zed/settings.json injetado`)
          }
          break
        }
        case "graphify": {
          const platformFlag = target.id === "antigravity"
            ? "antigravity install"
            : `install --platform ${target.id}`
          const gOut = safeExec(exec, `npx graphify ${platformFlag}`, { cwd: projectDir })
          if (gOut) {
            logger.success(`${target.label}: graphify ${platformFlag}`)
          } else {
            if (target.configDir) {
              const absSkills = target.configDir.startsWith(".")
                ? join(projectDir, target.configDir)
                : target.configDir
              mkdirSync(absSkills, { recursive: true })
              const skillsDir = join(projectDir, ".claude", "skills")
              if (existsSync(skillsDir)) copyRecursive(skillsDir, absSkills)
              logger.success(`${target.label}: skills copiadas para ${absSkills}`)
            } else {
              logger.warn(`${target.label}: graphify falhou e sem configDir — pulando`)
            }
          }
          break
        }
      }
    } catch (err) {
      logger.warn(`${target.label}: ${err.message}`)
    }
  }
}

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

function writeRuntimeFiles({ projectDir, projectName, now, projectRoot }) {
  const gstackDir = join(projectDir, ".gstack")
  const scriptsDir = join(projectDir, "scripts")
  mkdirSync(gstackDir, { recursive: true })
  mkdirSync(scriptsDir, { recursive: true })

  writeJson(join(gstackDir, "app.json"), {
    name: projectName,
    runtime: "gstack-workspace",
    createdAt: now(),
    packageManager: "pnpm",
    harnesses: OMNIHARNESS_MAP.map(h => h.id),
    vcs: "atomic",
    sandbox: "openhands",
    controlPlane: "ecc2",
    mcpGateway: "casdoor",
    meshFederation: true,
    ticketOrchestration: "paperclip",
    iam: "casdoor-local",
  })

  writeJson(join(gstackDir, "services.json"), {
    services: [
      { name: "web", command: "pnpm dev:web", port: 5173, health: "/" },
      { name: "api", command: "pnpm dev:api", port: 3000, health: "/health" },
    ],
  })

  writeJson(join(gstackDir, "secrets.schema.json"), {
    required: ["DATABASE_URL"],
    optional: [
      "CASDOOR_CLIENT_SECRET",
      "GH_TOKEN",
      "LITELLM_BASE_URL",
      "AGENTMEMORY_FED_TOKEN",
      "PAPERCLIP_API_KEY",
    ],
  })

  writeFileSync(join(projectDir, "Dockerfile"),
`FROM node:20-alpine AS deps
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
`)

  writeFileSync(join(projectDir, ".dockerignore"),
`node_modules
.git
.env
.env.*
dist
build
coverage
graphify-out
.gstack/casdoor.json
`)

  const devScript =
`#!/usr/bin/env sh
set -eu

export WEB_PORT="\${WEB_PORT:-5173}"
export API_PORT="\${API_PORT:-3000}"
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# Casdoor IAM (if running)
docker start casdoor 2>/dev/null || true

# Control Plane Daemon
ecc2 daemon start 2>/dev/null || true

echo "gstack dev: web=$WEB_PORT api=$API_PORT teams=1 casdoor=http://localhost:8000"
pnpm dev
`
  writeFileSync(join(scriptsDir, "dev.sh"), devScript)
  try { chmodSync(join(scriptsDir, "dev.sh"), 0o755) } catch {}

  for (const script of ["deep_research.py", "team_builder.py"]) {
    const src = join(projectRoot, "scripts", "scripts", script)
    if (existsSync(src)) copyFileSync(src, join(scriptsDir, script))
  }
}

function writeHarnessFiles(projectDir, projectName) {
  mkdirSync(join(projectDir, ".cursor", "rules"), { recursive: true })
  mkdirSync(join(projectDir, ".windsurf", "rules"), { recursive: true })
  mkdirSync(join(projectDir, ".claude", "agents"), { recursive: true })
  mkdirSync(join(projectDir, ".claude", "workflows"), { recursive: true })

  writeFileSync(join(projectDir, ".cursor", "rules", "gstack.mdc"),
`# ${projectName}

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
- VCS: Atomic (token-level isolation)
- Sandbox: OpenHands (headless SDK isolation)
- IAM: Casdoor local (Docker SQLite, localhost:8000)
- Control Plane: ECC 2.0 Daemon (dashboard, sessions, status)
- MCP Gateway: Casdoor (IAM local) + Headroom (compact proxy)
- Mesh Federation: AgentMemory P2P (BM25 + Vector + Graph sync)
- Ticket Orchestration: Paperclip / Symphony (Jira/Linear integration)
- Omniharness: Claude, Cursor, Codex, Windsurf, OpenCode, Gemini, Kiro, Antigravity, Zed, Hermes, Trae
- Coverage Gaps: fallow coverage setup (hot/cold path analysis)
- Workflows: .claude/workflows/ (ativar com /effort ultracode)

## Commands
- Dev: pnpm dev
- Managed dev: scripts/dev.sh
- Quality gate: npx fallow audit --format json
- Coverage gaps: pnpm coverage:gaps
- Tickets: paperclip status
- IAM: http://localhost:8000 (admin/123)
- Workflows: /effort ultracode (para tarefas complexas)

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

function scaffoldVerticalTemplate(templateName, projectDir, projectName, logger) {
  const t = (name) => join(projectDir, name)
  const e = () => ensureGstackDir(projectDir)

  switch (templateName) {
    case "saas-auth-stripe":
      e()
      mkdirSync(t("apps/web"), { recursive: true })
      mkdirSync(t("apps/api"), { recursive: true })
      mkdirSync(t("packages/db"), { recursive: true })
      mkdirSync(t("packages/shared"), { recursive: true })

      writeFileSync(t("package.json"), JSON.stringify({
        name: projectName, private: true, type: "module",
        scripts: { dev: "concurrently \"pnpm dev:web\" \"pnpm dev:api\"", build: "pnpm -r build" },
        dependencies: { "next": "^15", "react": "^19", "react-dom": "^19", "@supabase/supabase-js": "^2", "stripe": "^17", "@stripe/stripe-js": "^5", "trpc": "^11", "@trpc/next": "^11", "@trpc/react-query": "^11", "zod": "^3" },
        devDependencies: { "typescript": "^5", "concurrently": "^9", "@types/react": "^19", "@types/node": "^22" },
      }, null, 2))

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
      mkdirSync(t("apps/mobile"), { recursive: true })
      mkdirSync(t("apps/api"), { recursive: true })
      mkdirSync(t("packages/db"), { recursive: true })

      writeFileSync(t("package.json"), JSON.stringify({
        name: projectName, private: true,
        scripts: {
          "dev:mobile": "cd apps/mobile && npx expo start",
          "dev:api": "cd apps/api && pnpm dev",
          "db:push": "cd packages/db && pnpm drizzle-kit push",
          "db:generate": "cd packages/db && pnpm drizzle-kit generate",
        },
        dependencies: {
          "expo": "~52", "react": "^19", "react-native": "^0.76", "@tanstack/react-query": "^5",
          "@trpc/client": "^11", "@trpc/server": "^11", "zod": "^3",
          "@react-navigation/native": "^7", "@react-navigation/native-stack": "^7",
          "expo-router": "~4", "expo-secure-store": "~14",
        },
        devDependencies: { "typescript": "^5", "@types/react": "^19" },
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
        "  \"langgraph>=0.3\", \"langchain>=0.3\", \"llama-index>=0.12\",",
        "  \"chromadb>=0.6\", \"openai>=1.0\", \"fastapi>=0.115\",",
        "  \"uvicorn[standard]\", \"pydantic>=2\", \"httpx>=0.28\"",
        "]", "",
      ].join("\n"))

      writeFileSync(t("agents/research_agent.py"), [
        "from langgraph.graph import StateGraph, MessagesState",
        "from langchain_openai import ChatOpenAi",
        "",
        "llm = ChatOpenAi(model=\"gpt-4o\")",
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

export async function createProject(options = {}) {
  const args = options.args || []
  const projectName = args[0]
  const logger = options.logger || defaultLogger
  const cwd = options.cwd || process.cwd()
  const projectRoot = options.projectRoot || getProjectRoot()
  const execSync = options.execSync || defaultExecSync
  const now = options.now || (() => new Date().toISOString())

  // Parse --template flag
  const templateFlagIndex = args.findIndex((a) => a === "--template")
  const templateName = templateFlagIndex !== -1 && args[templateFlagIndex + 1]
    ? args[templateFlagIndex + 1]
    : "fullstack-monorepo"

  const VALID_TEMPLATES = {
    "fullstack-monorepo": { label: "Fullstack (React + Express + Supabase)", default: true },
    "saas-auth-stripe": { label: "SaaS (Next.js + Supabase + Stripe)", default: false },
    "mobile-backend": { label: "Mobile (Expo + tRPC + PostgreSQL)", default: false },
    "ai-agent-platform": { label: "AI Agent Platform (LangGraph + Vector DB)", default: false },
  }

  if (!VALID_TEMPLATES[templateName]) {
    throw new Error(
      `Template invalido: "${templateName}". Validos: ${Object.keys(VALID_TEMPLATES).join(", ")}`
    )
  }

  if (!projectName) {
    throw new Error(`Uso: gstack_vibehard create <nome-do-app> [--template ${Object.keys(VALID_TEMPLATES).join("|")}]`)
  }

  const projectDir = join(cwd, projectName)
  if (existsSync(projectDir)) {
    throw new Error(`Diretorio '${projectName}' ja existe.`)
  }

  const phases = {}

  console.log(`\n  === Fase 1/5: IAM Local (Casdoor) ===`)
  mkdirSync(projectDir, { recursive: true })
  const casdoorUrl = startCasdoor(logger, execSync, projectDir)
  phases.casdoor = { status: casdoorUrl ? "online" : "offline", url: casdoorUrl }

  console.log(`\n  === Fase 2/5: Atomic VCS ===`)
  writeAtomicConfig(projectDir)
  initAtomic(logger, execSync, projectDir)
  phases.atomic = { status: "configured" }

  console.log(`\n  === Fase 3/5: Daemons & Memoria ===`)
  bootEcc2(logger, execSync, projectDir)
  writeControlPlaneConfig(projectDir, projectName)
  bootAgentMemory(logger, execSync, projectDir)
  writeMemoryFederationConfig(projectDir)
  bootGraphify(logger, execSync, projectDir)
  phases.daemons = { status: "configured" }

  console.log(`\n  === Fase 4/5: Scaffold ${templateName} (${OMNIHARNESS_MAP.length} IDEs) ===`)
  if (templateName === "fullstack-monorepo") {
    const templateRoot = join(projectRoot, "templates", "templates", "fullstack-monorepo")
    copyRecursive(templateRoot, projectDir)
  } else {
    scaffoldVerticalTemplate(templateName, projectDir, projectName, logger)
  }
  writeRuntimeFiles({ projectDir, projectName, now, projectRoot })
  writeSkillsDir(projectDir)
  injectOmniharness(logger, execSync, projectDir)
  phases.omniharness = { status: "injected", ides: OMNIHARNESS_MAP.length }

  console.log(`\n  === Fase 5/5: Scaffold & Orquestracao Macro ===`)
  writeHarnessFiles(projectDir, projectName)
  writeTeamMatrix(projectDir, projectName)
  writeGatewayMcpConfig(projectDir)
  writePaperclipManifest(projectDir, projectName)
  writeCasdoorProjectConfig(projectDir)

  // ── Boot Headroom (non-critical, wrapped in try/catch) ──
  bootHeadroom(logger, execSync, projectDir)

  // ── Obsidian Vault Global: project subfolder + graph.json symlink ──
  const vaultDir = join(homedir(), "gstack-vault")
  const vaultProjectDir = join(vaultDir, "projects", projectName)
  mkdirSync(vaultProjectDir, { recursive: true })
  logger.info(`Vault project: ${vaultProjectDir}`)

  // Symlink graphify-out/graph.json into vault (if graphify has run)
  const graphSource = join(projectDir, "graphify-out", "graph.json")
  const graphTarget = join(vaultProjectDir, "graph.json")
  try {
    if (existsSync(graphSource)) {
      // Remove stale symlink/file at target before linking
      try { unlinkSync(graphTarget) } catch {}
      try {
        symlinkSync(graphSource, graphTarget, "file")
        logger.success(`Graph symlink: ${graphTarget} → ${graphSource}`)
      } catch {
        // Fallback: copy if symlink not supported (Windows without admin/elevation)
        copyFileSync(graphSource, graphTarget)
        logger.info(`Graph copied: ${graphTarget}`)
      }
    } else {
      // Create placeholder so vault always has the file structure
      writeFileSync(graphTarget, JSON.stringify({ nodes: [], edges: [], project: projectName, created_at: now(), status: "pending" }, null, 2))
      logger.info(`Graph placeholder: ${graphTarget} (aguardando graphify)`)

      // Write a post-init script that will symlink once graphify runs
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

      // Windows variant
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
  } catch (e) {
    logger.warn(`Vault graph symlink: ${e.message} (non-blocking)`)
  }

  logger.success(`Projeto '${projectName}' criado (template: ${templateName})`)
  logger.info(`  Diretorio: ${projectDir}`)
  logger.info(`  Template: ${templateName}`)
  logger.info(`  IAM: http://localhost:8000 (admin/123)`)
  logger.info(`  Vault: ${vaultProjectDir}`)
  logger.info(`  Quality gate: npx fallow audit --format json`)
  logger.info(`  Dev: cd ${projectName} && pnpm dev`)

  return { projectDir, phases, vaultDir: vaultProjectDir, template: templateName }
}

export async function createCommand(args) {
  try {
    await createProject({ args })
  } catch (err) {
    defaultLogger.error(err?.message || "create failed")
    process.exit(1)
  }
}
