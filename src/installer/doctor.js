import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execFileSync, execFile } from "child_process"
import { getHarness, isWindows, isMacOS, getOSLabel } from "../harness/detector.js"
import { checkAlreadyInstalled } from "./check.js"
import { detectHarnesses } from "../harness/detector.js"
import { section, success, warn, error, info } from "../cli/index.js"

const HOME = homedir()

export async function doctor() {
  section("Diagnostico do Ambiente")

  info(`Sistema: ${getOSLabel()}`)

  // Version checks (parallel)
  const [nodeVer, pyVer] = await Promise.all([
    new Promise((r) => execFile("node", ["--version"], { timeout: 5000 }, (e, stdout) => r(e ? null : stdout.trim()))),
    new Promise((r) => {
      execFile("python", ["--version"], { timeout: 5000 }, (e, stdout) => {
        if (!e) return r(stdout.trim())
        execFile("python3", ["--version"], { timeout: 5000 }, (e2, stdout2) => r(e2 ? null : stdout2.trim()))
      })
    }),
  ])
  if (nodeVer) success(`Node.js: ${nodeVer}`)
  else error("Node.js: NAO ENCONTRADO")
  if (pyVer) success(`Python: ${pyVer}`)
  else warn("Python: NAO ENCONTRADO (necessario para hooks)")

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
      const ver = execFileSync("opencode", ["--version"], { encoding: "utf-8", timeout: 3000 }).trim()
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

  const chronicleDir = (() => {
    const primary = join(HOME, ".gstack", "chronicle")
    if (existsSync(primary)) return primary
    return join(HOME, ".codex", "chronicle")
  })()
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
  const pwBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (isWindows()
      ? join(HOME, "AppData", "Local", "ms-playwright")
      : join(HOME, ".cache", "ms-playwright"))
  try {
    const pwVer = execFileSync("npx", ["playwright", "--version"], { encoding: "utf-8", stdio: "pipe", timeout: 10000 }).trim()
    success(`Playwright CLI: ${pwVer}`)
  } catch {
    warn("Playwright CLI: nao disponivel (rode: npx playwright install chromium)")
  }
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

  // Dependencias globais
  section("Dependencias Globais")
  const missingDeps = []

  try {
    const bunVer = execFileSync("bun", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`bun: ${bunVer}`)
  } catch { warn("bun: nao instalado"); missingDeps.push("bun + gbrain") }

  try {
    const gbrainVer = execFileSync("gbrain", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`gbrain: ${gbrainVer}`)
  } catch { warn("gbrain: nao instalado") }

  try {
    const graphifyVer = execFileSync("graphify", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`graphify: ${graphifyVer}`)
  } catch { warn("graphify: nao instalado"); if (!missingDeps.includes("graphify")) missingDeps.push("graphify") }

  try {
    const rustVer = execFileSync("rustc", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`Rust: ${rustVer}`)
  } catch { warn("Rust: nao instalado"); missingDeps.push("Rust") }

  try {
    const headroomVer = execFileSync("headroom", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`headroom: ${headroomVer}`)
  } catch { warn("headroom: nao instalado"); missingDeps.push("headroom") }

  if (isMacOS()) {
    try {
      execFileSync("which", ["mom"], { stdio: "pipe", timeout: 5000 })
      success("MOM: instalado")
    } catch { warn("MOM: nao instalado") }
  } else {
    info("MOM: apenas macOS")
  }

  if (missingDeps.length > 0) {
    section("Acoes Corretivas")
    info(`Dependencias faltando: ${missingDeps.join(", ")}`)
    info("  Rode: gstack_vibehard install")
    info("  O instalador agora instala todas as deps automaticamente.")
  }

  section("Diagnostico concluido")
}
