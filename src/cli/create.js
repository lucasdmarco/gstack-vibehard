import { execSync as defaultExecSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_HARNESSES = ["claude", "codex", "cursor", "windsurf", "cline", "opencode"]

const defaultLogger = {
  info: (message) => console.log(`  ${message}`),
  success: (message) => console.log(`  ✓ ${message}`),
  warn: (message) => console.log(`  ⚠ ${message}`),
  error: (message) => console.error(`  ✗ ${message}`),
}

function getProjectRoot() {
  const __filename = fileURLToPath(import.meta.url)
  let dir = dirname(__filename)
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

function copyRecursive(src, dst) {
  if (!existsSync(src)) return
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const source = join(src, entry.name)
    const target = join(dst, entry.name)
    if (entry.isDirectory()) {
      copyRecursive(source, target)
    } else {
      copyFileSync(source, target)
    }
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function findBinary(name, exec = defaultExecSync) {
  try {
    const whereCmd = process.platform === "win32" ? "where" : "which"
    const out = exec(`${whereCmd} ${name}`, { stdio: "pipe", timeout: 10000 })
    return out.toString().trim().split("\n")[0]
  } catch {
    return null
  }
}

function ensureAtomicInstalled(logger, exec = defaultExecSync) {
  if (process.env.GSTACK_SKIP_PREFLIGHT) {
    logger.info("GSTACK_SKIP_PREFLIGHT set — skipping Atomic CLI check")
    return
  }
  if (findBinary("atomic", exec)) {
    logger.success("Atomic CLI encontrado")
    return
  }

  logger.info("Atomic CLI nao encontrado. Instalando...")
  try {
    if (process.platform === "win32") {
      exec(
        'powershell -c "irm https://atomic-vcs.dev/install.ps1 | iex"',
        { stdio: "pipe", timeout: 120000 },
      )
    } else {
      exec(
        'curl -fsSL https://atomic-vcs.dev/install.sh | sh',
        { stdio: "pipe", timeout: 120000 },
      )
    }
    if (!findBinary("atomic", exec)) {
      throw new Error("instalado mas nao encontrado no PATH")
    }
    logger.success("Atomic CLI instalado")
  } catch (err) {
    logger.error("Falha ao instalar Atomic CLI. Instale manualmente:")
    logger.error("  curl -fsSL https://atomic-vcs.dev/install.sh | sh")
    logger.error("  ou veja https://atomic-vcs.dev/docs/install")
    throw new Error(`Atomic CLI required but not available: ${err.message}`)
  }
}

function ensureAgentHooksInstalled(logger, exec = defaultExecSync) {
  if (process.env.GSTACK_SKIP_PREFLIGHT) {
    logger.info("GSTACK_SKIP_PREFLIGHT set — skipping agent-hooks check")
    return
  }
  const hooksBin = findBinary("agent-hooks", exec)
  if (hooksBin) {
    logger.success(`agent-hooks encontrado: ${hooksBin}`)
    return
  }

  logger.info("agent-hooks (Rust) nao encontrado. Instalando com cargo...")
  try {
    exec("cargo install agent-hooks", { stdio: "pipe", timeout: 300000 })
    if (!findBinary("agent-hooks", exec)) {
      throw new Error("cargo install succeeded but binary not in PATH")
    }
    logger.success("agent-hooks (Rust) instalado via cargo")
  } catch (err) {
    logger.error("Falha ao instalar agent-hooks. Instale manualmente:")
    logger.error("  cargo install agent-hooks")
    logger.error("  ou baixe de https://github.com/anthropics/agent-hooks/releases")
    throw new Error(`agent-hooks (Rust) required but not available: ${err.message}`)
  }
}

function configureAgentHooks(projectDir, logger, exec = defaultExecSync) {
  const hooksBin = findBinary("agent-hooks", exec)
  if (!hooksBin) {
    if (process.env.GSTACK_SKIP_PREFLIGHT) {
      logger.info("GSTACK_SKIP_PREFLIGHT set — skipping agent-hooks configure")
      return
    }
    throw new Error("agent-hooks binary not found after installation")
  }

  for (const harness of DEFAULT_HARNESSES) {
    try {
      exec(`${hooksBin} init ${harness} --dir ${projectDir}`, { stdio: "pipe", timeout: 30000 })
      logger.success(`agent-hooks configurado para ${harness}`)
    } catch (err) {
      logger.warn(`agent-hooks ${harness}: ${err.message}`)
    }
  }

  try {
    exec(`${hooksBin} bridge --output ${join(projectDir, ".gstack", "events.jsonl")}`, { stdio: "pipe", timeout: 15000 })
    logger.success("agent-hooks bridge ativo (events.jsonl)")
  } catch (err) {
    logger.warn(`agent-hooks bridge: ${err.message}`)
  }
}

// ── Pillar 1: ECC 2.0 Control Plane ──

function ensureEcc2Installed(logger, exec = defaultExecSync) {
  if (process.env.GSTACK_SKIP_PREFLIGHT) {
    logger.info("GSTACK_SKIP_PREFLIGHT set — skipping ECC 2.0 check")
    return
  }
  if (findBinary("ecc2", exec)) {
    logger.success("ECC 2.0 Daemon encontrado")
    return
  }
  logger.info("ECC 2.0 Daemon nao encontrado. Instalando...")
  try {
    exec("npm install -g @ecc/ecc2", { stdio: "pipe", timeout: 120000 })
    if (!findBinary("ecc2", exec)) {
      throw new Error("instalado mas nao encontrado no PATH")
    }
    logger.success("ECC 2.0 Daemon instalado")
  } catch (err) {
    logger.error("Falha ao instalar ECC 2.0. Instale manualmente:")
    logger.error("  npm install -g @ecc/ecc2")
    throw new Error(`ECC 2.0 required but not available: ${err.message}`)
  }
}

function startEcc2Daemon(logger, exec = defaultExecSync) {
  try {
    exec("ecc2 daemon start", { stdio: "pipe", timeout: 15000 })
    logger.success("ECC 2.0 Daemon rodando em background")
  } catch (err) {
    const msg = err.message || "failed"
    logger.warn(`ECC 2.0 daemon: ${msg}`)
  }
}

function writeControlPlaneConfig(projectDir, projectName) {
  writeFileSync(join(projectDir, ".gstack", "control-plane.yaml"), `# GStack Control Plane — ECC 2.0
project: ${projectName}
version: 1

daemon:
  enabled: true
  dashboard: true
  sessions: true
  status: true

registration:
  endpoint: "https://ecc2.cloud.gstack.dev"
  heartbeat_interval: 30

observability:
  logs: ".gstack/events.jsonl"
  metrics: [tokens, sessions, errors]
  audit: true
`)
}

// ── Pillar 2: MCP Identity Gateway ──

function writeGatewayMcpConfig(projectDir) {
  writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      "permit-gateway": {
        command: "npx",
        args: ["-y", "@permitio/mcp-gateway"],
        env: {
          PERMIT_API_KEY: "${PERMIT_API_KEY}",
          PERMIT_GATEWAY_POLICY: "abac+rebac",
          PERMIT_FILTER_MODE: "payload",
          GATEWAY_UPSTREAM_SUPABASE: "${SUPABASE_ACCESS_TOKEN}",
          GATEWAY_UPSTREAM_GITHUB: "${GH_TOKEN}",
          GATEWAY_UPSTREAM_COMPOSIO: "${COMPOSIO_API_KEY}",
        },
      },
      mom: {
        command: "mom",
        args: ["mcp"],
        env: {
          MOM_SCOPE: "project",
          MOM_CONSTITUTION: ".gbrain/context.json",
        },
      },
    },
  }, null, 2) + "\n")
}

// ── Pillar 3: P2P Memory Federation ──

function ensureAgentMemoryFederation(logger, exec = defaultExecSync, projectDir) {
  try {
    exec("npx @agentmemory/agentmemory federate --enable", { cwd: projectDir, stdio: "pipe", timeout: 30000 })
    logger.success("AgentMemory Mesh Federation ativa (BM25 + Vetor + Grafo)")
  } catch (err) {
    logger.warn(`AgentMemory federate: ${err.message || "failed"}`)
  }
}

function writeMemoryFederationConfig(projectDir) {
  writeFileSync(join(projectDir, ".gstack", "federation.toml"), `[mesh]
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

// ── Pillar 4: Ticket Orchestration (Paperclip) ──

function writePaperclipManifest(projectDir, projectName) {
  writeFileSync(join(projectDir, "paperclip.toml"), `[agent]
name = "${projectName}-managed"
orchestrator = "paperclip"

[queue]
provider = "jira"  # ou "linear"
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
    "quality.gate(level=1)",
    "openhands.sandbox",
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
`)

  writeFileSync(join(projectDir, "symphony.yml"), `version: "1.0"
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
    - atomic worktree create
    - delegate supervisor
    - quality gate level 1
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
    harnesses: DEFAULT_HARNESSES,
    vcs: "atomic",
    sandbox: "openhands",
    controlPlane: "ecc2",
    mcpGateway: "permitio",
    meshFederation: true,
    ticketOrchestration: "paperclip",
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
      "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF",
      "COMPOSIO_API_KEY", "PERMIT_API_KEY", "PERMIT_GATEWAY_POLICY",
      "GH_TOKEN", "LITELLM_BASE_URL",
      "AGENTMEMORY_FED_TOKEN",
      "PAPERCLIP_API_KEY",
    ],
  })

  writeFileSync(join(projectDir, "Dockerfile"), `FROM node:20-alpine AS deps
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
  writeFileSync(join(projectDir, ".dockerignore"), `node_modules
.git
.env
.env.*
dist
build
coverage
graphify-out
`)

  const devScript = `#!/usr/bin/env sh
set -eu

pick_port() {
  start="$1"
  port="$start"
  while netstat -an 2>/dev/null | grep -q ":$port "; do
    port=$((port + 1))
  done
  printf '%s' "$port"
}

export WEB_PORT="\${WEB_PORT:-$(pick_port 5173)}"
export API_PORT="\${API_PORT:-$(pick_port 3000)}"
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# Control Plane: ensure ECC 2.0 daemon is running
ecc2 daemon start 2>/dev/null || true

echo "gstack dev: web=$WEB_PORT api=$API_PORT teams=1 control-plane=active"
pnpm dev
`
  writeFileSync(join(scriptsDir, "dev.sh"), devScript)
  try {
    chmodSync(join(scriptsDir, "dev.sh"), 0o755)
  } catch {
    // chmod is best-effort on Windows filesystems.
  }

  for (const script of ["deep_research.py", "team_builder.py"]) {
    const source = join(projectRoot, "scripts", "scripts", script)
    if (existsSync(source)) copyFileSync(source, join(scriptsDir, script))
  }

  // MCP config generated by writeGatewayMcpConfig — no direct connections
}

function writeAtomicConfig(projectDir) {
  writeFileSync(join(projectDir, ".atomicignore"), `node_modules/
dist/
build/
.env
.env.*
coverage/
.git/
__pycache__/
*.pyc
.graphify/
`)

  const atomicDir = join(projectDir, ".atomic")
  mkdirSync(atomicDir, { recursive: true })
  writeFileSync(join(atomicDir, "workspace.toml"), `[workspace]
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
]
`)

  const atomicConfigDir = join(process.env.HOME || process.env.USERPROFILE || "~", ".atomic")
  mkdirSync(atomicConfigDir, { recursive: true })
  const globalConfig = join(atomicConfigDir, "config.toml")
  if (!existsSync(globalConfig)) {
    writeFileSync(globalConfig, `[defaults]
engine = "atomic"

[workspace]
default_expose = [".env", ".claude/", ".gstack/"]
`)
  }
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
      coordinator: {
        strategy: "round-robin",
        validation: "reviewer-approves",
      },
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

  writeFileSync(join(teamsDir, "README.md"), `# ${projectName} — Claude Agent Teams

This project uses Claude Code's experimental agent teams feature.

Set \`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1\` in your environment.

Available team patterns (revfactory/harness):
- **supervisor** — coordinator delegates to sub-agents
- **pipeline** — sequential stages with validation gates
- **producer-reviewer** — pair production with mandatory review
- **validator** — quality gates before progression

Enable a team:
  export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
  export CLAUDE_TEAM=supervisor   # or pipeline, producer-reviewer, validator
`)
}

function writeHarnessFiles(projectDir, projectName) {
  mkdirSync(join(projectDir, ".cursor", "rules"), { recursive: true })
  mkdirSync(join(projectDir, ".windsurf", "rules"), { recursive: true })
  mkdirSync(join(projectDir, ".claude", "skills"), { recursive: true })
  mkdirSync(join(projectDir, ".claude", "agents"), { recursive: true })
  writeFileSync(join(projectDir, ".cursor", "rules", "gstack.mdc"), `# ${projectName}\n\nUse the local GStack runtime files in .gstack/ before changing architecture.\n`)
  writeFileSync(join(projectDir, ".windsurf", "rules", "gstack.md"), `# ${projectName}\n\nRun the project quality gate before final delivery.\n`)
  writeFileSync(join(projectDir, ".clinerules"), `# ${projectName}\n\nRespect AGENTS.md and .gstack/*.json as source of truth.\n`)
  writeFileSync(join(projectDir, "AGENTS.md"), `# ${projectName}

## Superpowers Cycle (obrigatorio)
Siga este ciclo para toda tarefa:
1. Plan — documente o plano antes de codificar
2. TDD — escreva o teste antes da implementacao
3. Implement — codigo minimo que faz o teste passar
4. Verify — rode todos os testes e linter
5. Review — auto-review ou review externo
6. Ship — merge apenas com aprovacao

## Runtime
- GStack Workspace Runtime
- VCS: Atomic (token-level isolation)
- Sandbox: OpenHands (headless SDK isolation)
- Agent Teams: Claude Code experimental teams (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)
- Control Plane: ECC 2.0 Daemon (dashboard, sessions, status)
- MCP Gateway: Permit.io (ABAC/ReBAC identity gateway)
- Mesh Federation: AgentMemory P2P (BM25 + Vector + Graph sync)
- Ticket Orchestration: Paperclip / Symphony (Jira/Linear integration)
- Omniharness: Claude, Codex, Cursor, Windsurf, Cline, OpenCode

## Commands
- Dev: pnpm dev
- Managed dev: scripts/dev.sh
- Quality gate: python ~/.codex/hooks/qg.py --path . --level 1
- Build agents: node scripts/scripts/build_agents.js
- Control plane: ecc2 daemon status
- Federation: npx @agentmemory/agentmemory federate --status
- Tickets: paperclip status
`)

  writeFileSync(join(projectDir, ".claude", "skills", "superpowers-cycle.md"), `---
name: superpowers-cycle
description: Ciclo obrigatorio Plan → TDD → Implement → Verify → Review → Ship
---
# Superpowers Cycle

Este skill forca o ciclo de desenvolvimento disciplinado para toda tarefa.

## Etapas
1. **Plan** — documente o plano antes de codificar
2. **TDD** — escreva o teste antes da implementacao
3. **Implement** — codigo minimo que faz o teste passar
4. **Verify** — rode todos os testes e linter
5. **Review** — auto-review ou review externo
6. **Ship** — merge apenas com aprovacao

## Padroes de Harness (revfactory/harness)
- Supervisor: coordena subagentes
- Pipeline: executa etapas sequenciais
- Validator: verifica saida antes de prosseguir
- Reflector: analiza resultados e ajusta plano
- Generator: produz artefatos estaveis
- Reviewer: revisa codigo antes de merge
`)

  writeFileSync(join(projectDir, ".claude", "skills", "quality-gate.md"), `---
name: quality-gate
description: Quality Gate deterministico antes de entregar
---
# Quality Gate

## Nivel 1 (padrao)
Rode antes de todo commit:
\`\`\`
python ~/.codex/hooks/qg.py --path . --level 1
\`\`\`

## Nivel 2 (bloqueante)
Rode antes de merge/deploy:
\`\`\`
python ~/.codex/hooks/qg.py --path . --level 2
\`\`\`

## Regras
- CRITICO/ALTO blocking → corrija antes de prosseguir
- MEDIO/BAIXO → documente e entregue com notas
- Security Gate rodado automaticamente em detectar deploy
`)

  writeFileSync(join(projectDir, ".claude", "agents", ".gitkeep"), "")
}

export async function createProject(options = {}) {
  const args = options.args || []
  const projectName = args[0]
  const logger = options.logger || defaultLogger
  const cwd = options.cwd || process.cwd()
  const projectRoot = options.projectRoot || getProjectRoot()
  const execSync = options.execSync || defaultExecSync
  const now = options.now || (() => new Date().toISOString())

  if (!projectName) {
    throw new Error("Uso: gstack_vibehard create <nome-do-app>")
  }

  // ── Pre-flight: ensure SOTA tooling exists ──
  ensureAtomicInstalled(logger, execSync)
  ensureAgentHooksInstalled(logger, execSync)
  ensureEcc2Installed(logger, execSync)

  const projectDir = join(cwd, projectName)
  if (existsSync(projectDir)) {
    throw new Error(`Diretorio '${projectName}' ja existe.`)
  }

  // ── Scaffold ──
  mkdirSync(projectDir, { recursive: true })
  const templateRoot = join(projectRoot, "templates", "templates", "fullstack-monorepo")
  copyRecursive(templateRoot, projectDir)
  writeRuntimeFiles({ projectDir, projectName, now, projectRoot })
  writeHarnessFiles(projectDir, projectName)
  writeAtomicConfig(projectDir)
  writeTeamMatrix(projectDir, projectName)

  // ── Pillar 1: Control Plane ──
  startEcc2Daemon(logger, execSync)
  writeControlPlaneConfig(projectDir, projectName)
  logger.success("Control Plane ativo: .gstack/control-plane.yaml")

  // ── Pillar 2: MCP Gateway ──
  writeGatewayMcpConfig(projectDir)
  logger.success("MCP Gateway (Permit.io) configurado: todas as ferramentas passam pelo gateway ABAC/ReBAC")

  // ── Pillar 3: P2P Memory Federation ──
  ensureAgentMemoryFederation(logger, execSync, projectDir)
  writeMemoryFederationConfig(projectDir)
  logger.success("Mesh Federation ativa: .gstack/federation.toml")

  // ── Pillar 4: Ticket Orchestration ──
  writePaperclipManifest(projectDir, projectName)
  logger.success("Orquestracao por Tickets: paperclip.toml + symphony.yml")

  // ── Atomic init ──
  try {
    execSync("atomic init", { cwd: projectDir, stdio: "pipe", timeout: 30000 })
    logger.success("Atomic VCS initialized")
  } catch (err) {
    throw new Error(`Atomic VCS init failed: ${err.message}`)
  }

  // ── agent-hooks configure ──
  configureAgentHooks(projectDir, logger, execSync)

  // ── AgentMemory (best-effort, non-blocking) ──
  const postInstall = {}
  for (const harness of DEFAULT_HARNESSES) {
    try {
      execSync(`npx @agentmemory/agentmemory connect ${harness}`, { cwd: projectDir, stdio: "pipe", timeout: 30000 })
      postInstall[`agentmemory:${harness}`] = { status: "success" }
    } catch (err) {
      postInstall[`agentmemory:${harness}`] = { status: "warning", message: err.message }
      logger.warn(`AgentMemory ${harness}: ${err.message}`)
    }
  }

  try {
    execSync("npx graphify hook install", { cwd: projectDir, stdio: "pipe", timeout: 30000 })
    postInstall.graphify = { status: "success" }
    logger.success("Graphify hooks installed")
  } catch (err) {
    postInstall.graphify = { status: "warning", message: err.message }
    logger.warn(`Graphify git hooks: ${err.message}`)
  }

  writeJson(join(projectDir, ".gstack", "post-install.json"), postInstall)
  logger.success(`Projeto '${projectName}' criado`)
  return { projectDir, postInstall }
}

export async function createCommand(args) {
  try {
    await createProject({ args })
  } catch (err) {
    defaultLogger.error(err?.message || "create failed")
    process.exit(1)
  }
}
