import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execSync } from "child_process"
import { getHarness, isWindows, isMacOS, getOSLabel } from "../harness/detector.js"
import { checkAlreadyInstalled } from "./check.js"
import { detectHarnesses } from "../harness/detector.js"
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
    try {
      const ver = execSync("opencode --version", { encoding: "utf-8", timeout: 3000 }).trim()
      success(`OpenCode CLI — detectado (v${ver}, sem config)`)
    } catch {
      warn("OpenCode CLI — nao detectado")
    }
  }

  // gstack_vibehard status per harness
  const detected = detectHarnesses()
  const ids = detected.map((h) => h.id)
  const gstackInstalled = checkAlreadyInstalled(ids)
  if (gstackInstalled.length > 0) {
    success(`gstack_vibehard instalado: ${gstackInstalled.join(", ")}`)
  } else {
    info("gstack_vibehard: nao instalado em nenhum harness")
  }

  // gstack_vibehard components
  section("Componentes gstack_vibehard")

  const hooks = join(HOME, ".codex", "hooks")
  if (existsSync(hooks)) {
    const fs = await import("fs")
    const hookFiles = fs.readdirSync(hooks).filter((f) => f.endsWith(".py"))
    success(`${hookFiles.length} hooks Python instalados`)
    info(`  ${hookFiles.join(", ")}`)
  } else {
    warn("Nenhum hook gstack_vibehard instalado")
  }

  const skillsDir = join(HOME, ".agents", "skills")
  if (existsSync(skillsDir)) {
    const fs = await import("fs")
    const skills = fs.readdirSync(skillsDir).filter((f) => f !== "." && f !== "..")
    success(`${skills.length} skills instaladas`)
  } else {
    warn("Nenhuma skill gstack_vibehard instalada")
  }

  const chronicleDir = join(HOME, ".codex", "chronicle")
  if (existsSync(chronicleDir)) {
    const fs = await import("fs")
    const sessions = fs.readdirSync(chronicleDir).filter((f) => f.endsWith(".md"))
    success(`Chronicle: ${sessions.length} sessoes registradas`)
  } else {
    info("Chronicle: nenhuma sessao (primeira sessao cria)")
  }

  // Scripts
  const scriptsDir2 = join(HOME, ".agents", "scripts")
  if (existsSync(scriptsDir2)) {
    const fs = await import("fs")
    const scripts = fs.readdirSync(scriptsDir2).filter((f) => f.endsWith(".ps1"))
    success(`${scripts.length} setup scripts em ~/.agents/scripts/`)
  } else {
    info("Setup scripts: nao instalados")
  }

  // Global tools
  section("Ferramentas Globais")
  try {
    const gbrain = (await import("child_process")).execSync("gbrain --version 2>&1", { stdio: "pipe", timeout: 5000 }).toString().trim()
    success(`gbrain: ${gbrain}`)
  } catch { warn("gbrain: nao instalado") }

  try {
    const graphify = (await import("child_process")).execSync("graphify --version 2>&1", { stdio: "pipe", timeout: 5000 }).toString().trim()
    success(`graphify: ${graphify}`)
  } catch { warn("graphify: nao instalado") }

  try {
    if (isMacOS()) {
      (await import("child_process")).execSync("which mom", { stdio: "pipe", timeout: 5000 })
      success("MOM: instalado")
    } else {
      info("MOM: apenas macOS")
    }
  } catch { warn("MOM: nao instalado") }

  // MCP
  section("MCP Servers")
  const mcp = join(HOME, ".mcp.json")
  if (existsSync(mcp)) {
    success(".mcp.json presente")
  } else {
    info(".mcp.json: nao configurado")
  }

  // Playwright
  section("Playwright (browser testing)")
  const pwBrowsers = isWindows()
    ? join(HOME, "AppData", "Local", "ms-playwright")
    : join(HOME, ".cache", "ms-playwright")
  if (existsSync(pwBrowsers)) {
    const fs = await import("fs")
    const browsers = fs.readdirSync(pwBrowsers).filter((f) => f.startsWith("chromium"))
    if (browsers.length > 0) {
      success(`Playwright: chromium instalado (${browsers.join(", ")})`)
    } else {
      warn("Playwright: chromium nao encontrado. Rode: npx playwright install chromium")
    }
  } else {
    warn("Playwright: browsers nao instalados. Rode: npx playwright install chromium")
  }

  section("Diagnostico concluido")
}
