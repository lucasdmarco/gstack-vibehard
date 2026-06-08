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

function runBestEffort({ cmd, cwd, label, execSync, logger, warnings }) {
  try {
    execSync(cmd, { cwd, stdio: "pipe" })
    return { status: "success" }
  } catch (err) {
    const message = `${label}: ${err?.message || "failed"}`
    warnings.push(message)
    logger.warn(message)
    return { status: "warning", message }
  }
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
  })
  writeJson(join(gstackDir, "services.json"), {
    services: [
      { name: "web", command: "pnpm dev:web", port: 5173, health: "/" },
      { name: "api", command: "pnpm dev:api", port: 3000, health: "/health" },
    ],
  })
  writeJson(join(gstackDir, "secrets.schema.json"), {
    required: ["DATABASE_URL"],
    optional: ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "COMPOSIO_API_KEY", "PERMIT_API_KEY", "LITELLM_BASE_URL"],
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
CMD ["pnpm", "dev"]
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
echo "gstack dev: web=$WEB_PORT api=$API_PORT"
pnpm dev
`
  writeFileSync(join(scriptsDir, "dev.sh"), devScript)
  try {
    chmodSync(join(scriptsDir, "dev.sh"), 0o755)
  } catch {
    // chmod is best-effort on Windows filesystems.
  }

  for (const script of ["workspace_manager.py", "deep_research.py", "team_builder.py"]) {
    const source = join(projectRoot, "scripts", "scripts", script)
    if (existsSync(source)) copyFileSync(source, join(scriptsDir, script))
  }

  const mcpPath = join(projectRoot, "mcp-configs", "base.mcp.json")
  if (existsSync(mcpPath)) copyFileSync(mcpPath, join(projectDir, ".mcp.json"))
}

function writeHarnessFiles(projectDir, projectName) {
  mkdirSync(join(projectDir, ".cursor", "rules"), { recursive: true })
  mkdirSync(join(projectDir, ".windsurf", "rules"), { recursive: true })
  writeFileSync(join(projectDir, ".cursor", "rules", "gstack.mdc"), `# ${projectName}\n\nUse the local GStack runtime files in .gstack/ before changing architecture.\n`)
  writeFileSync(join(projectDir, ".windsurf", "rules", "gstack.md"), `# ${projectName}\n\nRun the project quality gate before final delivery.\n`)
  writeFileSync(join(projectDir, ".clinerules"), `# ${projectName}\n\nRespect AGENTS.md and .gstack/*.json as source of truth.\n`)
  writeFileSync(join(projectDir, "AGENTS.md"), `# ${projectName}\n\n## Runtime\n- GStack Workspace Runtime\n- Omniharness: Claude, Codex, Cursor, Windsurf, Cline, OpenCode\n\n## Commands\n- Dev: pnpm dev\n- Managed dev: scripts/dev.sh\n- Quality gate: python ~/.codex/hooks/qg.py --path . --level 1\n`)
}

export async function createProject(options = {}) {
  const args = options.args || []
  const projectName = args[0]
  const logger = options.logger || defaultLogger
  const cwd = options.cwd || process.cwd()
  const projectRoot = options.projectRoot || getProjectRoot()
  const execSync = options.execSync || defaultExecSync
  const now = options.now || (() => new Date().toISOString())
  const warnings = []

  if (!projectName) {
    throw new Error("Uso: gstack_vibehard create <nome-do-app>")
  }

  const projectDir = join(cwd, projectName)
  if (existsSync(projectDir)) {
    throw new Error(`Diretorio '${projectName}' ja existe.`)
  }

  mkdirSync(projectDir, { recursive: true })
  const templateRoot = join(projectRoot, "templates", "templates", "fullstack-monorepo")
  copyRecursive(templateRoot, projectDir)
  writeRuntimeFiles({ projectDir, projectName, now, projectRoot })
  writeHarnessFiles(projectDir, projectName)

  const postInstall = {}
  for (const harness of DEFAULT_HARNESSES) {
    postInstall[`agentmemory:${harness}`] = runBestEffort({
      cmd: `npx @agentmemory/agentmemory connect ${harness}`,
      cwd: projectDir,
      label: `AgentMemory ${harness}`,
      execSync,
      logger,
      warnings,
    })
  }
  postInstall.graphify = runBestEffort({
    cmd: "npx graphify hook install",
    cwd: projectDir,
    label: "Graphify git hooks",
    execSync,
    logger,
    warnings,
  })

  writeJson(join(projectDir, ".gstack", "post-install.json"), postInstall)
  logger.success(`Projeto '${projectName}' criado`)
  return { projectDir, warnings, postInstall }
}

export async function createCommand(args) {
  try {
    await createProject({ args })
  } catch (err) {
    defaultLogger.error(err?.message || "create failed")
    process.exit(1)
  }
}
