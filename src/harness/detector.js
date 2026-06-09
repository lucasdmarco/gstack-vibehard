import { existsSync, readFileSync } from "fs"
import { homedir, platform } from "os"
import { join } from "path"
import { execSync, execFileSync } from "child_process"

const HOME = homedir()
const OPENCODE_HOME_DIR = join(HOME, ".opencode")
const OPENCODE_CONFIG_DIR = join(HOME, ".config", "opencode")
const OPENCODE_DIR = existsSync(OPENCODE_HOME_DIR) ? OPENCODE_HOME_DIR : OPENCODE_CONFIG_DIR

const HARNESS_PATHS = {
  codex: {
    label: "OpenAI Codex CLI",
    configDir: join(HOME, ".codex"),
    configFile: join(HOME, ".codex", "config.toml"),
    hooksDir: join(HOME, ".codex", "hooks"),
    detect: () => {
      const cfg = join(HOME, ".codex", "config.toml")
      const hooks = join(HOME, ".codex", "hooks")
      if (existsSync(join(HOME, ".codex")) || existsSync(cfg) || existsSync(hooks)) return true
      try { execFileSync("codex", ["--version"], { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
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
        if (existsSync(join(HOME, ".claude")) || existsSync(settings) || existsSync(claudeMd)) return true
        execFileSync("claude", ["--version"], { stdio: "pipe", timeout: 3000 }); return true
      } catch {
        return false
      }
    },
  },
  cursor: {
    label: "Cursor",
    configDir: join(process.cwd(), ".cursor"),
    configFile: join(process.cwd(), ".cursor", "mcp.json"),
    detect: () => {
      return existsSync(join(process.cwd(), ".cursor"))
    },
  },
  opencode: {
    label: "OpenCode CLI",
    configDir: OPENCODE_DIR,
    configFile: join(OPENCODE_DIR, "opencode.json"),
    detect: () => {
      try {
        const cfg = join(OPENCODE_CONFIG_DIR, "opencode.json")
        if (existsSync(OPENCODE_HOME_DIR) || existsSync(OPENCODE_CONFIG_DIR) || existsSync(cfg)) return true
        execFileSync("opencode", ["--version"], { stdio: "pipe", timeout: 3000 }); return true
      } catch {
        return false
      }
    },
  },
  windsurf: {
    label: "Windsurf",
    configDir: join(HOME, ".codeium", "windsurf"),
    configFile: join(HOME, ".codeium", "windsurf", "config.json"),
    detect: () => {
      const dir = join(HOME, ".codeium", "windsurf")
      if (existsSync(dir)) return true
      try { execFileSync("windsurf", ["--version"], { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
    },
  },
  gemini: {
    label: "Gemini CLI",
    configDir: join(HOME, ".gemini"),
    configFile: join(HOME, ".gemini", "config.json"),
    detect: () => {
      const dir = join(HOME, ".gemini")
      if (existsSync(dir) || existsSync(join(HOME, ".config", "gemini"))) return true
      try { execFileSync("gemini", ["--version"], { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
    },
  },
  kiro: {
    label: "Kiro",
    configDir: join(HOME, ".kiro"),
    configFile: join(HOME, ".kiro", "config.json"),
    detect: () => {
      if (existsSync(join(HOME, ".kiro"))) return true
      try { execFileSync("kiro", ["--version"], { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
    },
  },
  zed: {
    label: "Zed",
    configDir: join(HOME, ".config", "zed"),
    configFile: join(HOME, ".config", "zed", "settings.json"),
    detect: () => {
      if (existsSync(join(HOME, ".config", "zed")) || existsSync(join(HOME, ".config", "zed", "settings.json"))) return true
      try { execFileSync("zed", ["--version"], { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
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
