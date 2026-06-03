import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execSync } from "child_process"
import { getHarness, isWindows, isMacOS, getOSLabel } from "../harness/detector.js"
import { section, success, warn, error, info } from "../cli/index.js"

const HOME = homedir()

export async function doctor() {
  section("Diagnostico do Ambiente")

  info(`Sistema: ${getOSLabel()}`)

  // Node.js
  try {
    const nodeVer = execSync("node --version", { encoding: "utf-8" }).trim()
    success(`Node.js: ${nodeVer}`)
  } catch {
    error("Node.js: NAO ENCONTRADO")
  }

  // Python
  try {
    const pyVer = execSync("python --version", { encoding: "utf-8" }).trim()
    success(`Python: ${pyVer}`)
  } catch {
    try {
      const py3Ver = execSync("python3 --version", { encoding: "utf-8" }).trim()
      success(`Python: ${py3Ver}`)
    } catch {
      warn("Python: NAO ENCONTRADO (necessario para hooks)")
    }
  }

  // Harnesses
  section("Harnesses Detectados")

  const codexConfig = join(HOME, ".codex", "config.toml")
  const codexHooks = join(HOME, ".codex", "hooks")
  if (existsSync(codexConfig) || existsSync(codexHooks)) {
    success("Codex CLI — detectado")
    info(`  Config: ${codexConfig}`)
    info(`  Hooks: ${codexHooks}`)
  } else {
    warn("Codex CLI — nao detectado")
  }

  const claudeSettings = join(HOME, ".claude", "settings.json")
  const claudeMd = join(HOME, "CLAUDE.md")
  if (existsSync(claudeSettings) || existsSync(claudeMd)) {
    success("Claude Code — detectado")
    info(`  Settings: ${claudeSettings}`)
    if (existsSync(claudeMd)) info("  CLAUDE.md: presente")
  } else {
    warn("Claude Code — nao detectado")
  }

  const opencodeConfig = join(HOME, ".config", "opencode", "opencode.json")
  if (existsSync(opencodeConfig)) {
    success("OpenCode CLI — detectado")
    info(`  Config: ${opencodeConfig}`)
  } else {
    warn("OpenCode CLI — nao detectado")
  }

  // GStack components
  section("Componentes GStack")

  const hooks = join(HOME, ".codex", "hooks")
  if (existsSync(hooks)) {
    const fs = await import("fs")
    const hookFiles = fs.readdirSync(hooks).filter((f) => f.endsWith(".py"))
    success(`${hookFiles.length} hooks Python instalados`)
    info(`  ${hookFiles.join(", ")}`)
  } else {
    warn("Nenhum hook GStack instalado")
  }

  const skillsDir = join(HOME, ".agents", "skills")
  if (existsSync(skillsDir)) {
    const fs = await import("fs")
    const skills = fs.readdirSync(skillsDir).filter((f) => f !== "." && f !== "..")
    success(`${skills.length} skills instaladas`)
  } else {
    warn("Nenhuma skill GStack instalada")
  }

  const chronicleDir = join(HOME, ".codex", "chronicle")
  if (existsSync(chronicleDir)) {
    const fs = await import("fs")
    const sessions = fs.readdirSync(chronicleDir).filter((f) => f.endsWith(".md"))
    success(`Chronicle: ${sessions.length} sessoes registradas`)
  } else {
    info("Chronicle: nenhuma sessao (primeira sessao cria)")
  }

  // MCP
  section("MCP Servers")
  const mcp = join(HOME, ".mcp.json")
  if (existsSync(mcp)) {
    success(".mcp.json presente")
  } else {
    info(".mcp.json: nao configurado")
  }

  section("Diagnostico concluido")
}
