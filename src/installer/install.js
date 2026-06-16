import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { copyFile, mkdir } from "fs/promises"
import { homedir, tmpdir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { detectHarnesses, getHarness, isWindows, isMacOS, isLinux } from "../harness/detector.js"
import { installCodex } from "../harness/codex.js"
import { installClaude } from "../harness/claude.js"
import { installOpenCode } from "../harness/opencode.js"
import { installCursor } from "../harness/cursor.js"
import { writeInstructionalGuidance } from "../harness/instructional.js"
import { installHeadroom } from "../harness/headroom.js"
import { ensureDir, copyWithBackup, copyDirSync, backupFile } from "./merge.js"
import { findWorkingBinary, getUvCandidates, getBunCandidates, npxArgv } from "./deps.js"
import { checkAlreadyInstalled } from "./check.js"
import { installGeneratedAgentLayer, installGraphifyGitHooks } from "./agent-distribution.js"
import { multiSelect, select, prompt, success, warn, error, info, section } from "../cli/index.js"
import { obsidianDetected, getGlobalObsidianDefault, setGlobalObsidianDefault, chooseObsidian } from "../context-docs/obsidian.js"

const HOME = homedir()

function getProjectRoot() {
  const __filename = fileURLToPath(import.meta.url)
  let dir = dirname(__filename)
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = dirname(dir)
  }
  return dirname(__filename)
}

const PROJECT_ROOT = getProjectRoot()

function safeDownloadAndRun(url, label) {
  const tmp = join(tmpdir(), `gstack-dl-${Date.now()}${isWindows() ? ".ps1" : ".sh"}`)
  try {
    // curl existe nativamente no Windows 10 1803+ ("curl.exe") e em Unix.
    // Argumentos como array — sem interpolacao de string em shell.
    const curlBin = isWindows() ? "curl.exe" : "curl"
    execFileSync(curlBin, ["-fsSL", url, "-o", tmp], { stdio: "pipe", timeout: 120000, shell: false })
    if (!existsSync(tmp)) { warn(`${label}: download falhou`); return false }
    const content = readFileSync(tmp, "utf-8")
    if (content.length < 10) { warn(`${label}: download invalido (${content.length} bytes)`); return false }
    if (isWindows()) {
      execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmp], { stdio: "pipe", timeout: 180000, shell: false })
    } else {
      execFileSync("sh", [tmp], { stdio: "pipe", timeout: 180000, shell: false })
    }
    try { unlinkSync(tmp) } catch (e) { console.error("cleanup tmp:", e) }
    return true
  } catch (e) {
    try { unlinkSync(tmp) } catch (e2) { console.error("cleanup tmp:", e2) }
    warn(`${label}: falha no download/execucao segura: ${e.message}`)
    return false
  }
}

function refreshPath() {
  if (!isWindows()) return
  try {
    const sysResult = execFileSync("reg", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "/v", "Path"], { stdio: "pipe", timeout: 5000, encoding: "utf-8" })
    const userResult = execFileSync("reg", ["query", "HKCU\\Environment", "/v", "Path"], { stdio: "pipe", timeout: 5000, encoding: "utf-8" })
    const sysMatch = (sysResult || "").match(/REG_\w+\s+(\S.+)/)
    const userMatch = (userResult || "").match(/REG_\w+\s+(\S.+)/)
    const merged = [sysMatch?.[1], userMatch?.[1]].filter(Boolean).join(";")
    if (merged) process.env.Path = merged
  } catch (e) { console.error("refreshPath (non-critical):", e.message) }
}

async function installDeps(warn, success, info, report, harnessIds) {
  section("deps/ — Instalando dependencias globais")

  // ========================================
  // bun + gbrain
  // ========================================
  let bunFound = findWorkingBinary(["bun"]) !== ""

  if (!bunFound) {
    info("bun: nao encontrado. Instalando (download seguro)...")
    try {
      const bunUrl = isWindows() ? "https://bun.sh/install.ps1" : "https://bun.sh/install"
      const ok = safeDownloadAndRun(bunUrl, "Bun")
      if (ok) {
        refreshPath()
        bunFound = findWorkingBinary(getBunCandidates(HOME, isWindows())) !== ""
        if (bunFound) {
          success("bun instalado")
        } else {
          warn("bun: instalado mas nao encontrado no PATH")
        }
      } else {
        warn("bun: download falhou. Instale manualmente: https://bun.sh")
      }
    } catch (e) {
      warn("bun: falha ao instalar. Instale manualmente: https://bun.sh")
    }
  }

  if (bunFound) {
    try {
      execFileSync("bun", ["install", "-g", "github:garrytan/gbrain"], { stdio: "pipe", timeout: 120000 })
      success("gbrain (bun global)")
    } catch (e) {
      warn(`gbrain (bun global): ${e.message}`)
    }
  } else {
    info("gbrain: pulado (bun nao disponivel)")
  }

  // ========================================
  // uv + graphify
  // ========================================
  const uvCandidates = getUvCandidates(HOME, isWindows())
  let uvBin = findWorkingBinary(uvCandidates)

  if (!uvBin) {
    info("uv: nao encontrado. Instalando (download seguro)...")
    try {
      if (isWindows()) {
        safeDownloadAndRun("https://astral.sh/uv/install.ps1", "uv (Windows)")
      } else {
        safeDownloadAndRun("https://astral.sh/uv/install.sh", "uv (Unix)")
      }
      refreshPath()
      uvBin = findWorkingBinary(uvCandidates)
      if (uvBin) success("uv instalado")
      else warn("uv: instalado mas nao encontrado. Tente reiniciar o terminal.")
    } catch {
      warn("uv: falha ao instalar. Instale manualmente: https://docs.astral.sh/uv/#installation")
    }
  }

  if (uvBin) {
    try {
      execFileSync(uvBin, ["tool", "install", "graphify"], { stdio: "pipe", timeout: 120000 })
      success("graphify (uv tool)")
    } catch (e) {
      warn(`graphify (uv tool): ${e.message}`)
    }
  } else {
    info("graphify: pulado (uv nao disponivel)")
  }

  // ========================================
  // pytest — hooks Python, QG e Test Gate dependem dele
  // ========================================
  let pytestOk = false
  if (uvBin) {
    try {
      execFileSync(uvBin, ["pip", "install", "--system", "pytest"], { stdio: "pipe", timeout: 120000 })
      pytestOk = true
    } catch { /* tenta pip abaixo */ }
  }
  if (!pytestOk) {
    try {
      const pip = findWorkingBinary(["pip3", "pip"], { timeout: 5000 }) || "pip"
      execFileSync(pip, ["install", "--user", "pytest"], { stdio: "pipe", timeout: 120000 })
      pytestOk = true
    } catch (e) {
      warn(`pytest: falha ao instalar (${e.message}). Instale manualmente: pip install pytest`)
    }
  }
  if (pytestOk) {
    success("pytest instalado")
    report.added.push("pytest (testes Python)")
  }

  // ========================================
  // Rust (rustup) — needed for headroom build
  // ========================================
  let rustFound = findWorkingBinary(["rustc"]) !== ""
  if (rustFound) success("Rust encontrado")

  if (!rustFound) {
    info("Rust: nao encontrado. Instalando rustup...")
    try {
      if (isWindows()) {
        try {
          execFileSync("winget", ["install", "Rustlang.Rustup"], { stdio: "pipe", timeout: 120000 })
        } catch {
          info("winget falhou. Tentando rustup-init.exe diretamente...")
          const rustupUrl = "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"
          const rustupTmp = join(tmpdir(), "rustup-init.exe")
          execFileSync("curl.exe", ["-fsSL", rustupUrl, "-o", rustupTmp], { stdio: "pipe", timeout: 120000, shell: false })
          execFileSync(rustupTmp, ["-y", "--default-toolchain", "stable", "--profile", "minimal"], { stdio: "pipe", timeout: 180000, shell: false })
          try { unlinkSync(rustupTmp) } catch (e) { console.error("cleanup rustup-init:", e.message) }
        }
      } else if (isMacOS()) {
        safeDownloadAndRun("https://sh.rustup.rs", "Rustup (macOS)")
      } else {
        safeDownloadAndRun("https://sh.rustup.rs", "Rustup (Linux)")
      }
      const cargoBin = join(HOME, ".cargo", "bin")
      if (isWindows() && existsSync(cargoBin)) {
        process.env.Path = cargoBin + ";" + (process.env.Path || "")
        info("Adicionado ~/.cargo/bin ao PATH")
      }
      refreshPath()
      rustFound = findWorkingBinary(["rustc"]) !== ""
      if (rustFound) {
        success("Rust instalado")
      } else {
        if (isWindows()) {
          info("Rust: MSVC toolchain pode ter falhado. Tentando toolchain GNU...")
          try {
            execFileSync("rustup", ["default", "stable-gnu"], { stdio: "pipe", timeout: 30000 })
            rustFound = findWorkingBinary(["rustc"]) !== ""
            if (rustFound) success("Rust instalado (toolchain GNU)")
          } catch { /* expected */ }
        }
        if (!rustFound) warn("Rust: instalado mas `rustc` nao encontrado no PATH")
      }
    } catch (e) {
      warn("Rust: falha ao instalar. Instale manualmente: https://rustup.rs")
    }
  }

  // ========================================
  // Playwright
  // ========================================
  try {
    const pw = npxArgv(["playwright", "install", "chromium"])
    execFileSync(pw.file, pw.argv, { stdio: "pipe", timeout: 120000 })
    const pwDir = isWindows()
      ? join(HOME, "AppData", "Local", "ms-playwright")
      : join(HOME, ".cache", "ms-playwright")
    if (existsSync(pwDir) && readdirSync(pwDir).some((f) => f.startsWith("chromium"))) {
      success("Playwright: chromium instalado")
    } else {
      warn("Playwright: comando executado mas chromium nao encontrado em " + pwDir)
    }
  } catch (e) {
    warn(`Playwright: falha ao instalar chromium: ${e.message}`)
    info("  Rode manualmente: npx playwright install chromium")
  }

  if (isWindows()) {
    refreshPath()
  }

  // ========================================
  // MOM (macOS only)
  // ========================================
  if (isMacOS()) {
    try {
      execFileSync("brew", ["install", "momhq/tap/mom"], { stdio: "pipe", timeout: 120000 })
      success("MOM (brew)")
    } catch (e) {
      warn(`MOM (brew): ${e.message}`)
    }
  } else {
    info("MOM: incompativel com este OS (apenas macOS)")
  }

  // ========================================
  // CLI-Anything Hub (dynamic CLI download for agents)
  // ========================================
  try {
    execFileSync("npm", ["install", "-g", "cli-anything-hub"], { stdio: "pipe", timeout: 120000 })
    success("cli-anything-hub (npm global)")
  } catch (e) {
    warn(`cli-anything-hub (npm global): ${e.message}`)
  }

  // ========================================
  // Headroom (context compression proxy)
  // ========================================
  await installHeadroom({
    warn,
    success,
    info,
    uvBin,
    selectedHarnessIds: harnessIds,
  }, report)
}

function setupObsidianVault(report) {
  const vaultDir = join(HOME, "gstack-vault")
  for (const sub of ["", "projects", "chats", "agents", "graph", ".obsidian"]) {
    ensureDir(sub ? join(vaultDir, sub) : vaultDir)
  }
  info(`Vault global em: ${vaultDir}`)
  report.added.push("vault: ~/gstack-vault")

  const obsidianConfig = {
    promptDelete: false,
    alwaysUpdateLinks: true,
    newFileLocation: "current",
    attachmentFolderPath: "./attachments",
    showUnsupportedFiles: true,
    userIgnoreFilters: ["node_modules", ".git", "dist"],
  }
  writeFileSync(join(vaultDir, ".obsidian", "app.json"), JSON.stringify(obsidianConfig, null, 2) + "\n")
  report.added.push("vault: .obsidian/app.json configurado")
  success("Cofre Obsidian configurado em ~/gstack-vault")

  const vaultReadme = join(vaultDir, "README.md")
  if (!existsSync(vaultReadme)) {
    writeFileSync(vaultReadme, [
      "---", "tags: [gstack-vault, segundo-cerebro]", "---", "",
      "# gstack-vault — Segundo Cerebro Global", "",
      "Este vault Obsidian e o centro nervoso do ecossistema gstack_vibehard.", "",
      "## Estrutura", "",
      "- `projects/` — subpastas com `graph.json` (symlink) de cada projeto ativo",
      "- `chats/` — historico de sessoes processado pelo Chat Import Pipeline",
      "- `agents/` — memorias e decisoes dos agentes especialistas",
      "- `graph/` — grafos globais e exportacoes federadas do AgentMemory", "",
      "## Nota",
      "Editado por agentes automaticamente. Nao edite manualmente a menos que",
      "saiba exatamente o que esta fazendo.", "",
      "## Integracoes", "",
      "- **AgentMemory (MD Obsidian Export)** — banco vetorial espelha memorias em .md",
      "- **Graphify** — graph.json de cada projeto linkado simbolicamente",
      "- **Chat Import Pipeline** — logs de sessoes → wikilinks → notas permanentes",
      "- **GitOps** — falhas CRITICAS viram Issues; documentacao nova vira PRs", "",
    ].join("\n") + "\n")
    report.added.push("vault: README.md criado")
    success("README do vault criado")
  }

  // AgentMemory MD Obsidian Export: espelha memorias em .md no vault
  const codexConfigDir = join(HOME, ".codex")
  if (existsSync(codexConfigDir)) {
    const codexEnv = join(codexConfigDir, ".env")
    const envLine = `\n# AgentMemory MD Obsidian Export — espelha memorias no vault global\nAGENTMEMORY_MD_EXPORT_PATH=${vaultDir}/agents\n`
    if (existsSync(codexEnv)) {
      const currentEnv = readFileSync(codexEnv, "utf-8")
      if (!currentEnv.includes("AGENTMEMORY_MD_EXPORT_PATH")) {
        writeFileSync(codexEnv, currentEnv.trimEnd() + "\n" + envLine)
        report.updated.push("vault: AGENTMEMORY_MD_EXPORT_PATH em ~/.codex/.env")
      }
    } else {
      writeFileSync(codexEnv, envLine.trimStart() + "\n")
      report.added.push("vault: ~/.codex/.env criado com AGENTMEMORY_MD_EXPORT_PATH")
    }
    success("AgentMemory configurado para exportar .md para o vault")
  }
}

function printInstallReport(report) {
  section("Relatorio da Instalacao")
  const groups = [
    ["Adicionados:", report.added, "+", info],
    ["Atualizados:", report.updated, "~", info],
    ["Pulados (ja existem):", report.skipped, "-", info],
    ["Erros:", report.errors, "", warn],
  ]
  for (const [title, items, prefix, log] of groups) {
    if (items.length === 0) continue
    info(title)
    items.forEach((item) => log(`  ${prefix} ${item}`.trimEnd()))
  }
}

/**
 * Copia (refresh) os hooks Python do pacote para a fonte canonica ~/.gstack/hooks
 * e os dirs por harness. Idempotente e com backup .bak. Chamado SEMPRE — inclusive
 * quando os harnesses ja estao "instalados" — para que re-rodar `install`
 * atualize hooks obsoletos (ex.: um qg.py antigo com heuristicas falso-positivas).
 */
async function refreshHooks(harnessIds, report) {
  const hooksSource = join(PROJECT_ROOT, "hooks", "hooks")
  const hookTargets = [{ id: "gstack (canonico)", dir: join(HOME, ".gstack", "hooks") }]
  if (harnessIds.includes("codex")) hookTargets.push({ id: "codex", dir: join(HOME, ".codex", "hooks") })
  if (harnessIds.includes("claude")) hookTargets.push({ id: "claude", dir: join(HOME, ".claude", "hooks") })
  if (!existsSync(hooksSource)) {
    warn("hooks/hooks/ nao encontrado no pacote")
    return
  }
  const hooks = readdirSync(hooksSource).filter((f) => f.endsWith(".py"))
  for (const target of hookTargets) {
    ensureDir(target.dir)
    await Promise.all(hooks.map(async (hook) => {
      const src = join(hooksSource, hook)
      const dst = join(target.dir, hook)
      if (existsSync(dst)) backupFile(dst)
      await copyFile(src, dst)
      report.updated.push(`hook (${target.id}): ${hook}`)
    }))
    success(`${hooks.length} hooks atualizados em ${target.dir}`)
  }
}

export async function install(args = []) {
  const skipDeps = args.includes("--skip-deps") || process.env.GSTACK_SKIP_DEPS === "1"
  const report = { added: [], updated: [], skipped: [], errors: [] }

  section("gstack_vibehard Installer")
  info("Instalando pacote completo...")

  // Detect harnesses
  const harnesses = detectHarnesses()
  const allHarnessIds = harnesses.map((h) => h.id)

  if (harnesses.length === 0) {
    error("Nenhum harness detectado.")
    info("Instale um dos harnesses primeiro:")
    info("  • OpenAI Codex CLI — pip install codex-cli")
    info("  • Claude Code     — npm install -g @anthropic-ai/claude-code")
    info("  • Cursor          — instale o Cursor e abra um projeto com .cursor/")
    info("  • OpenCode CLI    — npm install -g opencode")
    process.exit(1)
  }

  info(`Harnesses detectados: ${harnesses.map((h) => h.label).join(", ")}`)
  for (const h of harnesses) {
    if (h.id === "codex") {
      warn("Codex CLI: nao possui hooks API — Quality Gate rodara em modo Best-Effort (instrucional)")
      warn("  O QG depende de instrucoes no AGENTS.md, nao de hooks restritivos.")
    }
    if (h.id === "gemini") {
      warn("Gemini IDE: nao possui hooks API — Quality Gate rodara em modo Best-Effort (instrucional)")
      warn("  Os agentes podem ignorar a instrucao de rodar o Fallow sem serem bloqueados.")
    }
  }

  // Step 1: Install global deps (bun, uv, Rust, Playwright, headroom...)
  // Opt-out: --skip-deps ou GSTACK_SKIP_DEPS=1 pula instalacoes pesadas
  if (skipDeps) {
    info("Deps globais: puladas (--skip-deps)")
    report.skipped.push("deps globais (--skip-deps)")
  } else {
    await installDeps(warn, success, info, report, allHarnessIds)
  }

  // Check which harnesses already have gstack_vibehard
  const alreadyInstalled = checkAlreadyInstalled(allHarnessIds)
  const availableHarnessIds = allHarnessIds.filter((h) => !alreadyInstalled.includes(h))

  // Show diagnosis
  info("")
  info("Diagnostico:")
  for (const h of harnesses) {
    if (alreadyInstalled.includes(h.id)) {
      info(`  ${h.label} — ja instalado (pulado)`)
    } else {
      info(`  ${h.label} — disponivel`)
    }
  }

  // If nothing new to configure: ainda assim ATUALIZA os hooks (idempotente) —
  // garante que hooks obsoletos (ex.: qg.py antigo) sejam substituidos pelos
  // do pacote atual ao re-rodar `install`.
  if (availableHarnessIds.length === 0) {
    section("hooks/ — Atualizando Quality & Security Gates")
    await refreshHooks(allHarnessIds, report)
    section("agents/generated — Distribuicao cross-harness")
    await installGeneratedAgentLayer({ projectRoot: PROJECT_ROOT, report, info, success, warn, harnessIds: allHarnessIds })
    section("graphify/ — Git hooks AST")
    installGraphifyGitHooks({ report, info, success, warn })
    success("\n  Harnesses ja configurados — hooks atualizados para a versao atual.")
    printInstallReport(report)
    return
  }

  // Single prompt or non-interactive fallback
  let selectedHarnessIds
  if (!process.stdin.isTTY) {
    info("Modo nao-interativo: instalando em todos os harnesses detectados")
    selectedHarnessIds = availableHarnessIds
  } else {
    const harnessOptions = [
      { label: "Todos detectados", value: "__all__", checked: true },
      ...harnesses.filter((h) => availableHarnessIds.includes(h.id)).map((h) => ({ label: h.label, value: h.id })),
    ]
    const harnessAnswer = await multiSelect("Instalar gstack_vibehard em quais harnesses?", harnessOptions)
    selectedHarnessIds = harnessAnswer.includes("__all__") ? availableHarnessIds : harnessAnswer
  }

  if (selectedHarnessIds.length === 0) {
    error("Nenhum harness selecionado. Instalacao cancelada.")
    process.exit(1)
  }

  info(`Harnesses selecionados: ${selectedHarnessIds.join(", ")}`)

  // Step 2: Copy setup scripts to ~/.agents/scripts/
  section("scripts/ — Copiando scripts de setup")
  const scriptsDir = join(HOME, ".agents", "scripts")
  ensureDir(scriptsDir)
  const scriptsSource = join(PROJECT_ROOT, "scripts", "scripts")
  if (existsSync(scriptsSource)) {
    const ext = isWindows() ? ".ps1" : ".sh"
    const scripts = readdirSync(scriptsSource).filter((f) => f.endsWith(ext))
    await Promise.all(scripts.map(async (script) => {
      const src = join(scriptsSource, script)
      const dst = join(scriptsDir, script)
      ensureDir(dirname(dst))
      if (existsSync(dst)) backupFile(dst)
      await copyFile(src, dst)
      if (!isWindows()) {
        try {
          execFileSync("chmod", ["+x", dst], { stdio: "pipe", timeout: 5000 })
        } catch (e) { console.error("chmod (non-critical):", e.message) }
      }
      report.added.push(`script: ${script}`)
    }))
    success(`${scripts.length} scripts copiados para ~/.agents/scripts/`)
  } else {
    warn("scripts/scripts/ nao encontrado no pacote")
  }

  // Step 3: Install/refresh hooks — fonte canonica ~/.gstack/hooks/ + por harness
  section("hooks/ — Quality & Security Gates")
  await refreshHooks(selectedHarnessIds, report)

  // Step 4: Install skills
  section("skills/ — Frontend Design, Chronicle, Init e mais")
  const skillsDir = join(HOME, ".agents", "skills")
  ensureDir(skillsDir)
  const skillsSource = join(PROJECT_ROOT, "skills", "skills")
  if (existsSync(skillsSource)) {
    const skillDirs = readdirSync(skillsSource, { withFileTypes: true }).filter((d) => d.isDirectory())
    for (const skill of skillDirs) {
      const src = join(skillsSource, skill.name)
      const dst = join(skillsDir, skill.name)
      if (!existsSync(dst)) {
        copyDirSync(src, dst)
        report.added.push(`skill: ${skill.name}`)
      } else {
        report.skipped.push(`skill: ${skill.name} (ja existe)`)
      }
    }
    success(`${skillDirs.length} skills instaladas em ~/.agents/skills/`)
  }

  // Step 5: Template info
  section("template/ — Fullstack Monorepo (Express)")
  const templateSource = join(PROJECT_ROOT, "templates", "templates", "fullstack-monorepo")
  if (existsSync(templateSource)) {
    info("Template disponivel para copia:")
    info(`  cp -r "${templateSource}" ./meu-projeto`)
    report.added.push("template: fullstack-monorepo (express)")
    success("Template pronto para uso")
  }

  // Step 6: Agents info
  section("agents/ — 21 Especialistas com QG Gate")
  const agentsSource = join(PROJECT_ROOT, "agents")
  if (existsSync(agentsSource)) {
    info("Agentes disponiveis em: agents/")
    report.added.push("agentes: 21 especialistas com QG gate")
    success("Agentes prontos para uso")
  }

  // Step 7: Configure each harness
  section("harness/ — Configurando ambientes selecionados")

  for (const harnessId of selectedHarnessIds) {
    section(`Configurando ${harnessId}...`)
    try {
      switch (harnessId) {
        case "codex":
          await installCodex({ hooks: false, template: true }, report)
          break
        case "claude":
          // hooks: true = REGISTRO no settings.json (Step 3 ja copiou os .py)
          await installClaude({ hooks: true, claudeMd: true, ultracode: true, mcp: true }, report)
          break
        case "opencode":
          await installOpenCode({ hooks: true }, report)
          break
        case "cursor":
          await installCursor({ hooks: true }, report)
          break
        default: {
          // Harness sem API de hooks: integracao instrucional honesta —
          // escreve orientacao de QG/memoria/tokens no convention do harness.
          const h = getHarness(harnessId)
          if (h?.instructionFile) {
            const fs = await import("fs")
            const readFile = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "")
            writeInstructionalGuidance(h.instructionFile, report, readFile)
            info(`${harnessId}: integracao instrucional escrita em ${h.instructionFile}`)
          } else {
            info(`${harnessId}: detectado — sem convention de instrucao global (apenas deteccao)`)
            report.skipped.push(`${harnessId}: somente deteccao`)
          }
          continue
        }
      }
      success(`${harnessId} configurado`)
    } catch (e) {
      report.errors.push(`${harnessId}: ${e.message}`)
      warn(`Falha ao configurar ${harnessId}: ${e.message}`)
    }
  }

  // Step 8: Generated agents layer
  section("agents/generated — Distribuicao cross-harness")
  await installGeneratedAgentLayer({ projectRoot: PROJECT_ROOT, report, info, success, warn, harnessIds: selectedHarnessIds })

  // Step 9: Graphify git hooks
  section("graphify/ — Git hooks AST")
  installGraphifyGitHooks({ report, info, success, warn })

  // Step 10: OS-aware launcher
  section("os/ — Instalando launcher para este sistema")
  if (isWindows()) {
    const launcherSrc = join(PROJECT_ROOT, "launchers", "windows", "install.bat")
    const launcherDst = join(HOME, "gstack_vibehard-install.bat")
    if (existsSync(launcherSrc)) {
      copyWithBackup(launcherSrc, launcherDst)
      report.added.push("launcher: gstack_vibehard-install.bat")
      success("Launcher Windows copiado para ~/gstack_vibehard-install.bat")
    }
  } else if (isMacOS()) {
    info("macOS: instalacao via npm — npm install -g @gstack-vibehard/installer")
    info("  (formula Homebrew disponivel em launchers/macos/gstack_vibehard.rb)")
    report.added.push("launcher: instrucoes npm/Homebrew (macOS)")
  } else if (isLinux()) {
    const launcherSrc = join(PROJECT_ROOT, "launchers", "cross", "install.sh")
    const launcherDst = join(HOME, "gstack_vibehard-install.sh")
    if (existsSync(launcherSrc)) {
      copyWithBackup(launcherSrc, launcherDst)
      report.added.push("launcher: gstack_vibehard-install.sh")
      success("Launcher Linux copiado para ~/gstack_vibehard-install.sh")
    }
  }

  // Step 11: Obsidian Vault Global (Segundo Cerebro)
  section("vault/ — Obsidian Vault Global (Segundo Cerebro)")
  setupObsidianVault(report)

  // Step 12: Obsidian detectado → escolha obrigatória (com 'pular') do vault a
  // indexar no Document Graph. Detecção lê só obsidian.json; NUNCA indexa aqui.
  section("obsidian/ — Document Graph (escolha do vault)")
  if (!obsidianDetected()) {
    info("Obsidian nao detectado — pulado (configure depois com `context obsidian set`).")
  } else if (getGlobalObsidianDefault()) {
    info(`Obsidian ja configurado (default global): ${getGlobalObsidianDefault()}`)
  } else if (!process.stdin.isTTY) {
    info("Obsidian detectado, mas modo nao-interativo — rode `gstack_vibehard context obsidian set <pasta>`.")
  } else {
    const chosen = await chooseObsidian({ select, prompt })
    if (chosen) {
      setGlobalObsidianDefault(chosen)
      success(`Obsidian default global: ${chosen} (read-only; indexado via \`context index\`)`)
      report.added.push(`obsidian default: ${chosen}`)
    } else {
      info("Obsidian: pulado. Configure depois com `context obsidian set <pasta>`.")
    }
  }

  // Report
  printInstallReport(report)

  section("Instalacao Concluida!")
  info("Comandos uteis:")
  info("  gstack_vibehard doctor    — diagnosticar ambiente")
  info("  gstack_vibehard uninstall — remover gstack_vibehard do ambiente")
  info("  gstack_vibehard init      — criar novo projeto com estrutura completa")
  if (selectedHarnessIds.includes("claude")) {
    info("")
    info("Claude Code: novas regras ativas na proxima sessao")
  }

  console.log()
}
