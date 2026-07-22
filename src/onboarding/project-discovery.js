/**
 * PRD48 S48.2 — discovery READ-ONLY de projeto existente. Compõe `classifyWorkspace`
 * (PRD28) + `resolvePackageManager` (PRD12) — não duplica nenhum dos dois — e acrescenta
 * o que faltava: linguagem, monorepo, comandos dev/test/build por nome conhecido, e git
 * branch/dirty via `git` real (read-only). NUNCA lê `.env*`, NUNCA executa script do
 * repositório. Projeto sem sinal nenhum recebe `recognized:false` — diagnóstico honesto,
 * nunca chute.
 */
import { existsSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { stripBom } from "../util/json.js"
import { classifyWorkspace } from "../runtime/workspace.js"
import { resolvePackageManager } from "../installer/package-manager.js"

export const PROJECT_DISCOVERY_SCHEMA = "gstack.project-discovery.v1"

const LANGUAGE_SIGNALS = Object.freeze([
  { language: "javascript", files: ["package.json"] },
  { language: "python", files: ["requirements.txt", "pyproject.toml", "setup.py"] },
  { language: "go", files: ["go.mod"] },
  { language: "rust", files: ["Cargo.toml"] },
])

function readJson(p) {
  try { return JSON.parse(stripBom(readFileSync(p, "utf-8"))) } catch { return null }
}

function detectLanguages(cwd) {
  return LANGUAGE_SIGNALS.filter((s) => s.files.some((f) => existsSync(join(cwd, f)))).map((s) => s.language)
}

function detectMonorepo(cwd, pkg) {
  if (pkg && Array.isArray(pkg.workspaces)) return true
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return true
  if (existsSync(join(cwd, "lerna.json"))) return true
  return false
}

const KNOWN_SCRIPT_NAMES = Object.freeze({ dev: ["dev", "start"], test: ["test"], build: ["build"] })
function commandFor(scripts, names) {
  const hit = names.find((n) => scripts && typeof scripts[n] === "string")
  return hit ? scripts[hit] : null
}
function detectCommands(pkg) {
  const scripts = pkg?.scripts || null
  return {
    dev: commandFor(scripts, KNOWN_SCRIPT_NAMES.dev),
    test: commandFor(scripts, KNOWN_SCRIPT_NAMES.test),
    build: commandFor(scripts, KNOWN_SCRIPT_NAMES.build),
  }
}

// git real, read-only. Nunca lança: repo ausente/git indisponível vira isRepo:false honesto.
function gitFacts(cwd, exec) {
  try {
    const branch = exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim()
    const porcelain = exec("git", ["status", "--porcelain"], cwd)
    return { isRepo: true, branch, dirty: porcelain.trim() !== "" }
  } catch {
    return { isRepo: false, branch: null, dirty: false }
  }
}

const defaultExec = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf-8", stdio: "pipe", timeout: 10000 })

/**
 * Descobre fatos de UM projeto existente — 100% read-only. `exec` é injetável (testes não
 * tocam git real se não quiserem). NUNCA lê `.env*`, NUNCA roda script do repositório.
 */
const RECOGNIZED_WORKSPACE_STATES = new Set(["node_app", "gstack_project"])

export function discoverProject(cwd, { exec = defaultExec } = {}) {
  const workspace = classifyWorkspace(cwd)
  const pkg = existsSync(join(cwd, "package.json")) ? readJson(join(cwd, "package.json")) : null
  const languages = detectLanguages(cwd)
  const packageManager = pkg ? resolvePackageManager(cwd) : null
  return {
    schemaVersion: PROJECT_DISCOVERY_SCHEMA,
    // "reconhecido" = há EVIDÊNCIA real de projeto — pasta vazia/neutra nunca conta,
    // mesmo sendo um estado honesto e seguro do workspace classifier.
    recognized: languages.length > 0 || RECOGNIZED_WORKSPACE_STATES.has(workspace.state),
    languages,
    monorepo: detectMonorepo(cwd, pkg),
    packageManager,
    commands: detectCommands(pkg),
    git: gitFacts(cwd, exec),
    gstackActivated: workspace.signals.hasGstackApp || workspace.signals.hasRuntimeManifest,
    workspaceState: workspace.state,
  }
}
