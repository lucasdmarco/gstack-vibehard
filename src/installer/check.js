import { existsSync, readFileSync, readdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execFileSync } from "child_process"

const HOME = homedir()

const HARNESS_COMPONENTS = {
  codex: [
    { path: join(HOME, ".codex", "hooks", "qg.py"), label: "QG hook" },
    { path: join(HOME, ".codex", "hooks", "gc.py"), label: "GC hook" },
    { path: join(HOME, ".codex", "hooks", "stop.py"), label: "Stop hook" },
    { path: join(HOME, ".codex", "hooks", "session_start.py"), label: "SessionStart hook" },
    { path: join(HOME, ".codex", "hooks", "pre_tool_use_security.py"), label: "PreToolUse security hook" },
    { path: join(HOME, ".codex", "hooks", "post_sprint.py"), label: "PostSprint hook" },
  ],
  claude: [
    { path: join(HOME, ".claude", "rules", "ultracode.md"), label: "Ultracode rule" },
    { path: join(HOME, ".claude", "hooks", "qg.py"), label: "QG hook" },
    { path: join(HOME, ".mcp.json"), label: "MCP config", requiresContent: "headroom" },
  ],
  opencode: [
    { path: join(HOME, ".config", "opencode", "opencode.json"), label: "Main config", requiresContent: "gstack_vibehard" },
  ],
}

export function checkAlreadyInstalled(harnessIds) {
  const installed = []

  for (const harnessId of harnessIds) {
    const hookFile = join(HOME, ".codex", "hooks", "qg.py")
    if (harnessId === "codex" && existsSync(hookFile)) {
      installed.push(harnessId)
    } else if (harnessId === "claude" && existsSync(join(HOME, ".claude", "rules", "ultracode.md"))) {
      // ultracode.md e o marcador definitivo escrito por installClaude
      installed.push(harnessId)
    } else if (harnessId === "opencode") {
      // Integração OpenCode é por diretório (plugins/skills auto-load) OU config.
      // Marca instalado se QUALQUER sinal gstack existir — não exige opencode.json.
      const ocDir = join(HOME, ".config", "opencode")
      const pluginMarks = [
        join(ocDir, "plugins", "gstack-security.js"),
        join(ocDir, "plugins", "gstack-session.js"),
      ]
      // Plugins gstack são arquivos específicos (sinal confiável); o dir skills/
      // é genérico do OpenCode, então NÃO serve de marca. Config conta se tiver "gstack".
      const hasPlugin = pluginMarks.some((p) => existsSync(p))
      let hasConfigMark = false
      for (const name of ["opencode.json", "opencode.jsonc"]) {
        const f = join(ocDir, name)
        if (existsSync(f)) {
          try { if (readFileSync(f, "utf-8").includes("gstack")) hasConfigMark = true } catch { /* ignore */ }
        }
      }
      if (hasPlugin || hasConfigMark) installed.push("opencode")
    }
  }

  return installed
}

export function getInstalledComponents() {
  const result = {}
  for (const [harnessId, components] of Object.entries(HARNESS_COMPONENTS)) {
    result[harnessId] = components.map((c) => ({
      label: c.label,
      present: existsSync(c.path) && (
        !c.requiresContent ||
        (() => { try { return readFileSync(c.path, "utf-8").includes(c.requiresContent) } catch { return false } })()
      ),
    }))
  }
  return result
}

export function getInstalledScripts() {
  const scriptsDir = join(HOME, ".agents", "scripts")
  if (!existsSync(scriptsDir)) return []
  try {
    return readdirSync(scriptsDir).filter((f) => f.endsWith(".ps1") || f.endsWith(".sh"))
  } catch {
    return []
  }
}

export function getInstalledSkills() {
  const skillsDir = join(HOME, ".agents", "skills")
  if (!existsSync(skillsDir)) return []
  try {
    return readdirSync(skillsDir).filter((f) => {
      try { return existsSync(join(skillsDir, f, "SKILL.md")) } catch { return false }
    })
  } catch {
    return []
  }
}

export function isHeadroomInstalled() {
  try {
    execFileSync("headroom", ["--version"], { stdio: "pipe", timeout: 5000 })
    return true
  } catch {
    return false
  }
}
