import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { copyFile, mkdir } from "fs/promises"
import { homedir, tmpdir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execSync, execFileSync } from "child_process"
import { detectHarnesses, isWindows, isMacOS, isLinux } from "../harness/detector.js"
import { installCodex } from "../harness/codex.js"
import { installClaude } from "../harness/claude.js"
import { installOpenCode } from "../harness/opencode.js"
import { installHeadroom } from "../harness/headroom.js"
import { ensureDir, copyWithBackup, copyDirSync, backupFile } from "./merge.js"
import { checkAlreadyInstalled } from "./check.js"
import { installGeneratedAgentLayer, installGraphifyGitHooks } from "./agent-distribution.js"
import { multiSelect, success, warn, error, info, section } from "../cli/index.js"

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
  const safeUrl = url.replace(/'/g, "'\\''")
  try {
    if (isWindows()) {
      execFileSync("powershell", ["-c", `irm '${safeUrl}' -OutFile '${tmp}'`], { stdio: "pipe", timeout: 120000, shell: false })
    } else {
      execFileSync("curl", ["-fsSL", url, "-o", tmp], { stdio: "pipe", timeout: 120000, shell: false })
    }
    if (!existsSync(tmp)) { warn(`${label}: download falhou`); return false }
    const content = readFileSync(tmp, "utf-8")
    if (content.length < 10) { warn(`${label}: download invalido (${content.length} bytes)`); return false }
    if (isWindows()) {
      execFileSync("powershell", ["-c", `& '${tmp}'`], { stdio: "pipe", timeout: 180000, shell: false })
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

function run(cmd, label) {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 120000 })
    success(label)
  } catch (e) {
    warn(`${label}: ${e.message}`)
  }
}

function refreshPath() {
  if (!isWindows()) return
  try {
    const sysPath = execSync(
      'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path 2>&1 | findstr /i "Path"',
      { stdio: "pipe", timeout: 5000 }
    ).toString().trim()
    const userPath = execSync(
      'reg query "HKCU\\Environment" /v Path 2>&1 | findstr /i "Path"',
      { stdio: "pipe", timeout: 5000 }
    ).toString().trim()
    const sysMatch = sysPath.match(/REG_\w+\s+(\S.+)/)
    const userMatch = userPath.match(/REG_\w+\s+(\S.+)/)
    const merged = [sysMatch?.[1], userMatch?.[1]].filter(Boolean).join(";")
    if (merged) process.env.Path = merged
  } catch (e) { console.error("refreshPath (non-critical):", e.message) }
}

async function installDeps(run, warn, success, info, report, harnessIds) {
  section("deps/ — Instalando dependencias globais")

  // ========================================
  // bun + gbrain
  // ========================================
  let bunFound = false
  try {
    execSync("bun --version", { stdio: "pipe", timeout: 5000 })
    bunFound = true
  } catch { /* bun not found, expected */ }

  if (!bunFound) {
    info("bun: nao encontrado. Instalando (download seguro)...")
    try {
      const bunUrl = isWindows() ? "https://bun.sh/install.ps1" : "https://bun.sh/install"
      const ok = safeDownloadAndRun(bunUrl, "Bun")
      if (ok) {
        refreshPath()
        const bunPaths = isWindows()
          ? [join(HOME, ".bun", "bin", "bun.exe")]
          : [join(HOME, ".bun", "bin", "bun")]
        for (const p of [...bunPaths, "bun"]) {
          try {
            execSync(`${p} --version`, { stdio: "pipe", timeout: 5000 })
            bunFound = true
            break
          } catch { /* bun path not found, expected */ }
        }
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
    run("bun install -g github:garrytan/gbrain", "gbrain (bun global)")
  } else {
    info("gbrain: pulado (bun nao disponivel)")
  }

  // ========================================
  // uv + graphify
  // ========================================
  let uvBin = ""
  const possiblePaths = isWindows()
    ? [join(HOME, ".local", "bin", "uv.exe"), join(HOME, "AppData", "Local", "uv", "uv.exe")]
    : [join(HOME, ".local", "bin", "uv"), join(HOME, ".cargo", "bin", "uv"), "/usr/local/bin/uv"]

  for (const p of [...possiblePaths, "uv"]) {
    try {
      execSync(`${p} --version`, { stdio: "pipe", timeout: 5000 })
      uvBin = p
      break
    } catch { /* expected */ }
  }

  if (!uvBin) {
    info("uv: nao encontrado. Instalando (download seguro)...")
    try {
      if (isWindows()) {
        safeDownloadAndRun("https://astral.sh/uv/install.ps1", "uv (Windows)")
      } else {
        safeDownloadAndRun("https://astral.sh/uv/install.sh", "uv (Unix)")
      }
      refreshPath()
      for (const p of possiblePaths) {
        try {
          execSync(`${p} --version`, { stdio: "pipe", timeout: 5000 })
          uvBin = p
          success("uv instalado")
          break
        } catch { /* expected */ }
      }
      if (!uvBin) {
        try {
          execSync("uv --version", { stdio: "pipe", timeout: 5000 })
          uvBin = "uv"
          success("uv instalado")
        } catch { /* expected */ }
      }
      if (!uvBin) warn("uv: instalado mas nao encontrado. Tente reiniciar o terminal.")
    } catch {
      warn("uv: falha ao instalar. Instale manualmente: https://docs.astral.sh/uv/#installation")
    }
  }

  if (uvBin) {
    run(`${uvBin} tool install graphify`, "graphify (uv tool)")
  } else {
    info("graphify: pulado (uv nao disponivel)")
  }

  // ========================================
  // Rust (rustup) — needed for headroom build
  // ========================================
  let rustFound = false
  try {
    execSync("rustc --version", { stdio: "pipe", timeout: 5000 })
    rustFound = true
    success("Rust encontrado")
  } catch { /* expected */ }

  if (!rustFound) {
    info("Rust: nao encontrado. Instalando rustup...")
    try {
      if (isWindows()) {
        try {
          execSync("winget install Rustlang.Rustup 2>&1", { stdio: "pipe", timeout: 120000 })
        } catch {
          info("winget falhou. Tentando rustup-init.exe diretamente...")
          execFileSync("powershell", ["-c", `$url = 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe'; $tmp = "$env:TEMP\rustup-init.exe"; iwr -Uri $url -OutFile $tmp; & $tmp -y --default-toolchain stable --profile minimal`], { stdio: "pipe", timeout: 180000, shell: false })
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
      try {
        execSync("rustc --version", { stdio: "pipe", timeout: 5000 })
        rustFound = true
        success("Rust instalado")
      } catch {
        if (isWindows()) {
          info("Rust: MSVC toolchain pode ter falhado. Tentando toolchain GNU...")
          try {
            execSync("rustup default stable-gnu 2>&1", { stdio: "pipe", timeout: 30000 })
            execSync("rustc --version", { stdio: "pipe", timeout: 5000 })
            rustFound = true
            success("Rust instalado (toolchain GNU)")
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
    execSync("npx playwright install chromium 2>&1", { stdio: "pipe", timeout: 120000 })
    const pwDir = isWindows()
      ? join(HOME, "AppData", "Local", "ms-playwright")
      : join(HOME, ".cache", "ms-playwright")
    const { readdirSync } = await import("fs")
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
    run("brew install momhq/tap/mom", "MOM (brew)")
  } else {
    info("MOM: incompativel com este OS (apenas macOS)")
  }

  // ========================================
  // CLI-Anything Hub (dynamic CLI download for agents)
  // ========================================
  run("npm install -g cli-anything-hub", "cli-anything-hub (npm global)")

  // ========================================
  // Headroom (context compression proxy)
  // ========================================
  await installHeadroom({
    run,
    warn,
    success,
    info,
    uvBin,
    selectedHarnessIds: harnessIds,
  }, report)
}

export async function install() {
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

  // Step 1: Install global deps ALWAYS — before harness check
  await installDeps(run, warn, success, info, report, allHarnessIds)

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

  // If nothing to install for harnesses
  if (availableHarnessIds.length === 0) {
    section("agents/generated — Distribuicao cross-harness")
    await installGeneratedAgentLayer({ projectRoot: PROJECT_ROOT, report, info, success, warn, harnessIds: allHarnessIds })
    section("graphify/ — Git hooks AST")
    installGraphifyGitHooks({ report, info, success, warn })
    success("\n  Todos os harnesses ja configurados. Deps globais ja verificadas.")
    info("  Para forcar reinstalação, remova manualmente:")
    for (const h of alreadyInstalled) {
      if (h === "codex") info("    rm ~/.codex/hooks/qg.py")
      if (h === "claude") info("    rm ~/.claude/rules/ultracode.md")
      if (h === "opencode") info("    rm ~/.config/opencode/opencode.json")
    }
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

  // Step 3: Install hooks
  section("hooks/ — Quality & Security Gates")
  const hooksDir = join(HOME, ".codex", "hooks")
  ensureDir(hooksDir)
  const hooksSource = join(PROJECT_ROOT, "hooks", "hooks")
  if (existsSync(hooksSource)) {
    const hooks = readdirSync(hooksSource).filter((f) => f.endsWith(".py"))
    await Promise.all(hooks.map(async (hook) => {
      const src = join(hooksSource, hook)
      const dst = join(hooksDir, hook)
      ensureDir(dirname(dst))
      if (existsSync(dst)) backupFile(dst)
      await copyFile(src, dst)
      report.added.push(`hook: ${hook}`)
    }))
    success(`${hooks.length} hooks instalados em ~/.codex/hooks/`)
  } else {
    warn("hooks/hooks/ nao encontrado no pacote")
  }

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
          await installClaude({ hooks: true, claudeMd: true, ultracode: true, mcp: true }, report)
          break
        case "opencode":
          await installOpenCode({ hooks: true }, report)
          break
        case "cursor":
          report.skipped.push("cursor: configuracao legacy nao requerida")
          break
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
    info("macOS: brew install gstack_vibehard (via Homebrew tap)")
    report.added.push("launcher: Homebrew formula gstack_vibehard")
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
  const vaultDir = join(HOME, "gstack-vault")
  ensureDir(vaultDir)
  ensureDir(join(vaultDir, "projects"))
  ensureDir(join(vaultDir, "chats"))
  ensureDir(join(vaultDir, "agents"))
  ensureDir(join(vaultDir, "graph"))
  ensureDir(join(vaultDir, ".obsidian"))
  info(`Vault global em: ${vaultDir}`)
  report.added.push("vault: ~/gstack-vault")

  // .obsidian/app.json — configuracoes basicas do vault
  const obsidianConfig = {
    "promptDelete": false,
    "alwaysUpdateLinks": true,
    "newFileLocation": "current",
    "attachmentFolderPath": "./attachments",
    "showUnsupportedFiles": true,
    "userIgnoreFilters": ["node_modules", ".git", "dist"]
  }
  const obsidianAppJson = join(vaultDir, ".obsidian", "app.json")
  writeFileSync(obsidianAppJson, JSON.stringify(obsidianConfig, null, 2) + "\n")
  report.added.push("vault: .obsidian/app.json configurado")
  success("Cofre Obsidian configurado em ~/gstack-vault")

  // Vault README de boas-vindas
  const vaultReadme = join(vaultDir, "README.md")
  if (!existsSync(vaultReadme)) {
    writeFileSync(vaultReadme, [
      "---",
      "tags: [gstack-vault, segundo-cerebro]",
      "---",
      "",
      "# gstack-vault — Segundo Cerebro Global",
      "",
      "Este vault Obsidian e o centro nervoso do ecossistema gstack_vibehard.",
      "",
      "## Estrutura",
      "",
      "- `projects/` — subpastas com `graph.json` (symlink) de cada projeto ativo",
      "- `chats/` — historico de sessoes processado pelo Chat Import Pipeline",
      "- `agents/` — memorias e decisoes dos agentes especialistas",
      "- `graph/` — grafos globais e exportacoes federadas do AgentMemory",
      "",
      "## Nota",
      "Editado por agentes automaticamente. Nao edite manualmente a menos que",
      "saiba exatamente o que esta fazendo.",
      "",
      "## Integracoes",
      "",
      "- **AgentMemory (MD Obsidian Export)** — banco vetorial espelha memorias em .md",
      "- **Graphify** — graph.json de cada projeto linkado simbolicamente",
      "- **Chat Import Pipeline** — logs de sessoes → wikilinks → notas permanentes",
      "- **GitOps** — falhas CRITICAS viram Issues; documentacao nova vira PRs",
      "",
    ].join("\n") + "\n")
    report.added.push("vault: README.md criado")
    success("README do vault criado")
  }

  // AgentMemory MD Obsidian Export: configura export path para o vault
  // AgentMemory suporta AGENTMEMORY_MD_EXPORT_PATH para espelhar memorias em .md
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

  // Report
  section("Relatorio da Instalacao")
  if (report.added.length > 0) {
    info("Adicionados:")
    report.added.forEach((item) => info(`  + ${item}`))
  }
  if (report.updated.length > 0) {
    info("Atualizados:")
    report.updated.forEach((item) => info(`  ~ ${item}`))
  }
  if (report.skipped.length > 0) {
    info("Pulados (ja existem):")
    report.skipped.forEach((item) => info(`  - ${item}`))
  }
  if (report.errors.length > 0) {
    info("Erros:")
    report.errors.forEach((item) => warn(`  ${item}`))
  }

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
