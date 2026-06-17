import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { execFileSync as defaultExecFileSync } from "child_process"
import { homedir } from "os"
import { dirname, join } from "path"
import { loadManifest, recordItem, saveManifest } from "./manifest.js"

const AGENT_NAMESPACE = "gstack-vibehard"

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true })
}

function readJson(filePath) {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

const ALLOWED_HARNESS_IDS = new Set(["claude", "codex", "cursor", "opencode", "windsurf"])

function commandExists(command, exec = defaultExecFileSync) {
  try {
    exec(command, ["--version"], { stdio: "pipe", timeout: 3000 })
    return true
  } catch {
    return false
  }
}

function detectGeneratedAgentHarnesses({ home, cwd, harnessIds, exec = defaultExecFileSync }) {
  const opencodeHome = join(home, ".opencode")
  const opencodeConfig = join(home, ".config", "opencode")
  const opencodeRoot = existsSync(opencodeHome) ? opencodeHome : opencodeConfig
  const selected = harnessIds ? new Set(harnessIds) : null
  const harnesses = []

  if ((!selected || selected.has("claude")) && (existsSync(join(home, ".claude")) || existsSync(join(home, "CLAUDE.md")) || commandExists("claude", exec))) {
    harnesses.push({
      id: "claude",
      label: "Claude Code",
      source: "claude",
      target: join(home, ".claude", "agents", AGENT_NAMESPACE),
    })
  }

  if ((!selected || selected.has("codex")) && (existsSync(join(home, ".codex")) || commandExists("codex", exec))) {
    harnesses.push({
      id: "codex",
      label: "OpenAI Codex CLI",
      source: "codex",
      target: join(home, ".codex", "agents", AGENT_NAMESPACE),
    })
  }

  if ((!selected || selected.has("cursor")) && existsSync(join(cwd, ".cursor"))) {
    harnesses.push({
      id: "cursor",
      label: "Cursor",
      source: "cursor",
      target: join(cwd, ".cursor", "agents", AGENT_NAMESPACE),
    })
  }

  if ((!selected || selected.has("opencode")) && (existsSync(opencodeHome) || existsSync(opencodeConfig) || commandExists("opencode", exec))) {
    harnesses.push({
      id: "opencode",
      label: "OpenCode CLI",
      // OpenCode consome o formato cursor (AGENTS.md + rules/*.mdc) — nao ha
      // formato proprio em agents/generated/ (ver manifest.json outputs).
      source: "cursor",
      target: join(opencodeRoot, "agents", AGENT_NAMESPACE),
    })
  }

  return harnesses
}

function copyGeneratedAgents(sourceDir, targetDir) {
  ensureDir(dirname(targetDir))
  cpSync(sourceDir, targetDir, { recursive: true, force: true })
}

function connectAgentMemory(harnessId, exec = defaultExecFileSync) {
  if (!ALLOWED_HARNESS_IDS.has(harnessId)) {
    return { status: "warning", error: `harnessId invalido: ${harnessId}` }
  }
  try {
    exec("npx", ["@agentmemory/agentmemory", "connect", harnessId], { stdio: "pipe", timeout: 120000 })
    return { status: "success" }
  } catch (e) {
    return { status: "warning", error: e.message }
  }
}

export function installGraphifyGitHooks(options = {}) {
  const {
    cwd = process.cwd(),
    report = { added: [], updated: [], skipped: [], errors: [] },
    info = () => {},
    success = () => {},
    warn = () => {},
    exec = defaultExecFileSync,
  } = options

  if (!cwd || !existsSync(join(cwd, ".git"))) {
    info("Graphify git hooks: pulado (sem .git)")
    report.skipped.push("Graphify git hooks: sem .git")
    return { status: "skipped" }
  }

  try {
    exec("npx", ["graphify", "hook", "install"], { cwd, stdio: "pipe", timeout: 120000 })
    success("Graphify git hooks instalados")
    report.updated.push("Graphify git hooks")
    return { status: "success" }
  } catch (e) {
    warn(`Graphify git hooks: ${e.message}`)
    report.errors.push(`Graphify git hooks: ${e.message}`)
    return { status: "warning", error: e.message }
  }
}

export async function installGeneratedAgentLayer(options = {}) {
  const {
    projectRoot = "",
    home = homedir(),
    cwd = process.cwd(),
    report = { added: [], updated: [], skipped: [], errors: [] },
    info = () => {},
    success = () => {},
    warn = () => {},
    copyDir = copyGeneratedAgents,
    harnessIds = null,
    now = () => new Date().toISOString(),
    exec = defaultExecFileSync,
  } = options

  const resolvedRoot = projectRoot || homedir()
  const generatedRoot = join(resolvedRoot, "agents", "generated")
  if (!existsSync(generatedRoot)) {
    warn("agents/generated/ nao encontrado no pacote")
    report.skipped.push("generated agents: fonte ausente")
    return { detectedHarnesses: [], agentDirectories: {}, agentmemory: {} }
  }

  const sourceManifest = readJson(join(generatedRoot, "manifest.json"))
  const detectedHarnesses = detectGeneratedAgentHarnesses({ home, cwd, harnessIds, exec })
  const agentDirectories = {}
  const agentmemory = {}

  if (detectedHarnesses.length === 0) {
    info("generated agents: nenhum harness detectado")
  }

  for (const harness of detectedHarnesses) {
    const sourceDir = join(generatedRoot, harness.source)
    if (!existsSync(sourceDir)) {
      warn(`generated agents: fonte ausente para ${harness.id}`)
      report.skipped.push(`generated agents: ${harness.id} (fonte ausente)`)
      continue
    }

    try {
      copyDir(sourceDir, harness.target)
    } catch (e) {
      warn(`generated agents ${harness.id}: ${e.message}`)
      report.errors.push(`generated agents: ${harness.id}: ${e.message}`)
      continue
    }

    agentDirectories[harness.id] = harness.target
    report.added.push(`generated agents: ${harness.id}`)
    success(`generated agents: ${harness.id}`)

    const memoryStatus = connectAgentMemory(harness.id, exec)
    agentmemory[harness.id] = memoryStatus
    if (memoryStatus.status === "success") {
      report.updated.push(`AgentMemory: ${harness.id}`)
    } else {
      warn(`AgentMemory ${harness.id}: ${memoryStatus.error}`)
    }
  }

  // Preserva o `items[]` (ownership) já registrado por safe-write/skills/scripts.
  const manifest = loadManifest(home)
  manifest.version = 1
  manifest.installedAt = manifest.installedAt || now()
  manifest.generatedAgents = { source: generatedRoot, manifest: sourceManifest }
  manifest.harnesses = detectedHarnesses.map((harness) => ({ id: harness.id, label: harness.label }))
  manifest.agentDirectories = agentDirectories
  manifest.agentmemory = agentmemory
  for (const dir of Object.values(agentDirectories)) {
    recordItem(manifest, { path: dir, kind: "dir", action: "created", component: "agents", backup: null, restoreOnUninstall: false })
  }
  const manifestPath = join(home, ".gstack_vibehard", "install-manifest.json")
  try {
    ensureDir(dirname(manifestPath))
    saveManifest(manifest, home)
    report.updated.push("~/.gstack_vibehard/install-manifest.json")
  } catch (e) {
    warn(`install manifest: ${e.message}`)
    report.errors.push(`install manifest: ${e.message}`)
  }

  return { ...manifest, manifestPath, detectedHarnesses }
}
