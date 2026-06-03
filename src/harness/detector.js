import { existsSync, readFileSync } from "fs"
import { homedir, platform } from "os"
import { join } from "path"
import { execSync } from "child_process"

const HOME = homedir()

const HARNESS_PATHS = {
  codex: {
    label: "OpenAI Codex CLI",
    configDir: join(HOME, ".codex"),
    configFile: join(HOME, ".codex", "config.toml"),
    hooksDir: join(HOME, ".codex", "hooks"),
    detect: () => {
      const cfg = join(HOME, ".codex", "config.toml")
      const hooks = join(HOME, ".codex", "hooks")
      if (existsSync(cfg) || existsSync(hooks)) return true
      try { execSync("codex --version", { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
    },
  },
  claude: {
    label: "Claude Code",
    configDir: join(HOME),
    configFile: join(HOME, ".claude", "settings.json"),
    claudeMd: join(HOME, "CLAUDE.md"),
    detect: () => {
      try {
        const settings = join(HOME, ".claude", "settings.json")
        const claudeMd = join(HOME, "CLAUDE.md")
        if (existsSync(settings) || existsSync(claudeMd)) return true
        execSync("claude --version", { stdio: "pipe", timeout: 3000 }); return true
      } catch {
        return false
      }
    },
  },
  opencode: {
    label: "OpenCode CLI",
    configDir: join(HOME, ".config", "opencode"),
    configFile: join(HOME, ".config", "opencode", "opencode.json"),
    detect: () => {
      try {
        const cfg = join(HOME, ".config", "opencode", "opencode.json")
        if (existsSync(cfg)) return true
        execSync("opencode --version", { stdio: "pipe", timeout: 3000 }); return true
      } catch {
        return false
      }
    },
  },
}

export function detectHarnesses() {
  const found = []

  for (const [id, harness] of Object.entries(HARNESS_PATHS)) {
    if (harness.detect()) {
      found.push({ id, ...harness })
    }
  }

  return found
}

export function getHarness(id) {
  return HARNESS_PATHS[id] || null
}

export function readJsonFile(filePath) {
  try {
    if (!existsSync(filePath)) return null
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content)
  } catch {
    return null
  }
}

export function isWindows() {
  return platform() === "win32"
}

export function isMacOS() {
  return platform() === "darwin"
}

export function isLinux() {
  return platform() === "linux"
}

export function getOSLabel() {
  if (isWindows()) return "Windows"
  if (isMacOS()) return "macOS"
  if (isLinux()) return "Linux"
  return platform()
}
