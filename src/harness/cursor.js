import { existsSync, readdirSync, cpSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { writeWithBackup, readJsonFile } from "../installer/merge.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = dirname(__dirname)
const HOME = homedir()

const CURSOR_DIR = join(HOME, ".cursor")
const CURSOR_HOOKS_JSON = join(CURSOR_DIR, "hooks.json")
const GSTACK_HOOKS_DIR = join(HOME, ".gstack", "hooks")
const HOOKS_SOURCE = join(PACKAGE_ROOT, "hooks", "hooks")

function resolvePythonCmd() {
  try { execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 3000 }); return "python3" } catch { return "python" }
}

/**
 * Registra os hooks Python no hooks.json do Cursor — formato oficial:
 * { "version": 1, "hooks": { "<evento>": [{ "command": "...", "timeout": N }] } }
 * Eventos: preToolUse, beforeShellExecution, stop, sessionStart.
 * Input chega por stdin JSON; os hooks respondem {"permission": ...} para o
 * Cursor (camada de saida em hooks/hooks/_harness.py).
 * Idempotente: entradas gstack identificadas pelo nome do script no command.
 */
export function registerCursorHooks(report, hooksDir = GSTACK_HOOKS_DIR, hooksJsonPath = CURSOR_HOOKS_JSON) {
  const pyCmd = resolvePythonCmd()
  const hookCommand = (script) => `${pyCmd} "${join(hooksDir, script)}"`

  const GSTACK_EVENTS = {
    beforeShellExecution: { script: "pre_tool_use_security.py", timeout: 30 },
    preToolUse: { script: "pre_tool_use_security.py", timeout: 30 },
    stop: { script: "stop.py", timeout: 600 },
    sessionStart: { script: "session_start.py", timeout: 60 },
  }

  const config = readJsonFile(hooksJsonPath) || {}
  const hooks = { ...(config.hooks || {}) }

  for (const [event, cfg] of Object.entries(GSTACK_EVENTS)) {
    const entries = Array.isArray(hooks[event]) ? [...hooks[event]] : []
    const cleaned = entries.filter((entry) => !(entry?.command || "").includes(cfg.script))
    cleaned.push({ command: hookCommand(cfg.script), timeout: cfg.timeout })
    hooks[event] = cleaned
  }

  const merged = { ...config, version: 1, hooks }
  writeWithBackup(hooksJsonPath, JSON.stringify(merged, null, 2))
  report.updated.push("~/.cursor/hooks.json (hooks registrados)")
}

export async function installCursor(config, report) {
  mkdirSync(CURSOR_DIR, { recursive: true })

  if (config.hooks) {
    // Garante os .py na fonte canonica (caso Step 3 nao tenha rodado)
    if (!existsSync(join(GSTACK_HOOKS_DIR, "stop.py")) && existsSync(HOOKS_SOURCE)) {
      mkdirSync(GSTACK_HOOKS_DIR, { recursive: true })
      for (const f of readdirSync(HOOKS_SOURCE).filter((n) => n.endsWith(".py"))) {
        cpSync(join(HOOKS_SOURCE, f), join(GSTACK_HOOKS_DIR, f), { force: true })
      }
    }
    registerCursorHooks(report)
  }

  return report
}
