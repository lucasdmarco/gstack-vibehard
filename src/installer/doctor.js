import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execFileSync, execFile } from "child_process"
import { getHarness, isWindows, isMacOS, getOSLabel } from "../harness/detector.js"
import { checkAlreadyInstalled } from "./check.js"
import { npxArgv } from "./deps.js"
import { detectHarnesses } from "../harness/detector.js"
import { inspectOpenCodeConfig } from "../harness/opencode-config.js"
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

  const oc = inspectOpenCodeConfig(HOME)
  if (oc.hasJson || oc.hasJsonc) {
    success("OpenCode CLI — detectado")
    if (oc.hasJson) info(`  Config JSON:  ${oc.jsonPath}`)
    if (oc.hasJsonc) info(`  Config JSONC: ${oc.jsoncPath}`)
    if (oc.hasConflict) {
      warn("  Conflito: opencode.json E opencode.jsonc coexistem.")
      warn("  Pode sombrear plugins/OAuth do Desktop. O gstack NAO altera esses arquivos.")
      info("  Remediacao (OpenCode fechado): renomeie opencode.json -> opencode.json.gstack-bak")
    }
    const ocPlugins = join(HOME, ".config", "opencode", "plugins")
    const gstackPlugins = ["gstack-security.js", "gstack-session.js", "gstack-prompt.js"]
      .filter((f) => existsSync(join(ocPlugins, f)))
    if (gstackPlugins.length > 0) success(`  Plugins gstack: ${gstackPlugins.length} (auto-load)`)
    else info("  Plugins gstack: nenhum (rode `gstack_vibehard install`)")
  } else {
    try {
      const ver = execFileSync("opencode", ["--version"], { encoding: "utf-8", timeout: 3000 }).trim()
      success(`OpenCode CLI — detectado (v${ver}, sem config — integracao por plugins/skills)`)
    } catch {
      warn("OpenCode CLI — nao detectado")
    }
  }

  // Todos os harnesses detectados (inclui Cursor, Windsurf, Gemini, Kiro, Zed,
  // Copilot CLI, Droid, KiloCLI, Kimi, VS Code) com nivel de integracao
  const detected = detectHarnesses()
  const HOOKS_HARNESSES = new Set(["claude", "cursor", "opencode"])
  const otherDetected = detected.filter((h) => !["codex", "claude", "opencode"].includes(h.id))
  if (otherDetected.length > 0) {
    info("Outros harnesses detectados:")
    for (const h of otherDetected) {
      const level = HOOKS_HARNESSES.has(h.id)
        ? "hooks reais"
        : (h.instructionFile ? "instrucional" : "deteccao apenas")
      info(`  ${h.label} — ${level}`)
    }
  }

  // gstack_vibehard status per harness
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

  // Integracoes — dupla via (Composio nuvem + Printing Press local)
  section("Integracoes (Composio + Printing Press)")
  // Composio (nuvem): auth/escrita
  const composioEnv = process.env.COMPOSIO_API_KEY || process.env.COMPOSIO_TOKEN
  let composioCli = false
  try { execFileSync("composio", ["--version"], { stdio: "pipe", timeout: 3000 }); composioCli = true } catch { /* opcional */ }
  if (composioEnv) success("Composio (nuvem): token presente — escrita/OAuth disponivel")
  else if (composioCli) info("Composio (nuvem): CLI presente, sem token (rode `composio login`)")
  else info("Composio (nuvem): nao configurado (opcional — para acoes de escrita/OAuth)")
  // Printing Press (local): leitura/cauda-longa
  let goOk = false
  try { execFileSync("go", ["version"], { stdio: "pipe", timeout: 3000 }); goOk = true } catch { /* opcional */ }
  if (goOk) success("Printing Press (local): Go presente — `tools install` disponivel")
  else info("Printing Press (local): Go ausente — discovery funciona; `tools install` instala Go sob demanda")
  info("Por projeto: veja .gstack/integrations.json e `gstack_vibehard tools`")

  // Playwright
  section("Playwright (browser testing)")
  const pwBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (isWindows()
      ? join(HOME, "AppData", "Local", "ms-playwright")
      : join(HOME, ".cache", "ms-playwright"))
  try {
    const pwd = npxArgv(["playwright", "--version"])
    const pwVer = execFileSync(pwd.file, pwd.argv, { encoding: "utf-8", stdio: "pipe", timeout: 10000 }).trim()
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

  // pytest — necessario para hooks Python, QG e Test Gate
  try {
    const pyBin = pyVer && pyVer.toLowerCase().includes("python 3") ? "python" : "python3"
    execFileSync(pyBin, ["-m", "pytest", "--version"], { stdio: "pipe", timeout: 5000 })
    success("pytest: instalado")
  } catch {
    try {
      execFileSync("python3", ["-m", "pytest", "--version"], { stdio: "pipe", timeout: 5000 })
      success("pytest: instalado")
    } catch { warn("pytest: nao instalado"); missingDeps.push("pytest") }
  }

  if (missingDeps.length > 0) {
    section("Acoes Corretivas")
    info(`Dependencias faltando: ${missingDeps.join(", ")}`)
    info("  Rode: gstack_vibehard install")
    info("  O instalador agora instala todas as deps automaticamente.")
  }

  section("Diagnostico concluido")
}
