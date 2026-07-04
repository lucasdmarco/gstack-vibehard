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
import { installHermes } from "../harness/hermes.js"
import { generateDevinAssets } from "../harness/devin.js"
import { writeInstructionalGuidance } from "../harness/instructional.js"
import { installHeadroom } from "../harness/headroom.js"
import { trackDegraded, evaluateFullContract } from "./full-contract.js"
import { ensureDir, copyWithBackup, copyDirSync, backupFile } from "./merge.js"
import { buildInstallImpact, renderImpactMarkdown } from "./impact.js"
import { buildSupplyChainReport } from "./supply-chain.js"
import { checkRemoteDownload } from "./remote-policy.js"
import { safeCopyDir, safeCopyFile, safeWriteFile, safeAppendBlock } from "./safe-write.js"
import { findWorkingBinary, getUvCandidates, getBunCandidates, npxArgv, npmArgv, mergeWindowsPath } from "./deps.js"
import { checkAlreadyInstalled } from "./check.js"
import { installGeneratedAgentLayer, installGraphifyGitHooks } from "./agent-distribution.js"
import { multiSelect, select, prompt, confirm, success, warn, error, info, section } from "../cli/index.js"
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

const dlTmpPath = () => join(tmpdir(), `gstack-dl-${Date.now()}${isWindows() ? ".ps1" : ".sh"}`)
const rmTmp = (tmp) => { try { unlinkSync(tmp) } catch (e) { console.error("cleanup tmp:", e) } }
// curl existe nativamente no Windows 10 1803+ ("curl.exe") e em Unix. Args como
// array — sem interpolacao de shell.
function fetchScript(url, tmp) {
  const curlBin = isWindows() ? "curl.exe" : "curl"
  execFileSync(curlBin, ["-fsSL", url, "-o", tmp], { stdio: "pipe", timeout: 120000, shell: false })
}
function runDownloadedScript(tmp) {
  if (isWindows()) execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmp], { stdio: "pipe", timeout: 180000, shell: false })
  else execFileSync("sh", [tmp], { stdio: "pipe", timeout: 180000, shell: false })
}
function safeDownloadAndRun(url, label, opts = {}) {
  // POLÍTICA REMOTA (P0.6): por padrão NÃO executa download remoto — só com
  // --allow-remote-downloads (ou GSTACK_ALLOW_REMOTE_DOWNLOADS=1) e origem na allowlist.
  const policy = checkRemoteDownload(url, opts)
  if (!policy.allowed) { warn(`${label}: download remoto NÃO executado (${policy.reason}). Instale manualmente: ${url}`); return false }
  const tmp = dlTmpPath()
  try {
    fetchScript(url, tmp)
    if (!existsSync(tmp)) { warn(`${label}: download falhou`); return false }
    const content = readFileSync(tmp, "utf-8")
    if (content.length < 10) { warn(`${label}: download invalido (${content.length} bytes)`); return false }
    runDownloadedScript(tmp)
    rmTmp(tmp)
    return true
  } catch (e) {
    rmTmp(tmp)
    warn(`${label}: falha no download/execucao segura: ${e.message}`)
    return false
  }
}

const regPathValue = (out) => ((out || "").match(/REG_\w+\s+(\S.+)/) || [])[1]
const currentWinPath = () => process.env.Path || process.env.PATH || ""
function readRegistryPath() {
  const sys = execFileSync("reg", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "/v", "Path"], { stdio: "pipe", timeout: 5000, encoding: "utf-8" })
  const user = execFileSync("reg", ["query", "HKCU\\Environment", "/v", "Path"], { stdio: "pipe", timeout: 5000, encoding: "utf-8" })
  return [regPathValue(sys), regPathValue(user)].filter(Boolean).join(";")
}
function refreshPath() {
  if (!isWindows()) return
  try {
    const fromReg = readRegistryPath()
    // MESCLA com o PATH atual e expande %VAR% — substituir cru perdia o System32
    // (cmd.exe) porque o registro guarda `%SystemRoot%\system32` não-expandido.
    if (fromReg) process.env.Path = mergeWindowsPath(currentWinPath(), fromReg)
  } catch (e) { console.error("refreshPath (non-critical):", e.message) }
}

// ── deps globais: um bloco por binário (self-contained, degrada explícito) ───────

function installBun(remoteOpts) {
  let bunFound = findWorkingBinary(["bun"]) !== ""
  if (bunFound) return true
  info("bun: nao encontrado. Instalando (download seguro)...")
  try {
    const bunUrl = isWindows() ? "https://bun.sh/install.ps1" : "https://bun.sh/install"
    if (!safeDownloadAndRun(bunUrl, "Bun", remoteOpts)) { warn("bun: download falhou. Instale manualmente: https://bun.sh"); return false }
    refreshPath()
    bunFound = findWorkingBinary(getBunCandidates(HOME, isWindows())) !== ""
    if (bunFound) success("bun instalado")
    else warn("bun: instalado mas nao encontrado no PATH")
  } catch (e) { warn("bun: falha ao instalar. Instale manualmente: https://bun.sh") }
  return bunFound
}
function installGbrain(report, bunFound) {
  if (!bunFound) { info("gbrain: pulado (bun nao disponivel)"); return trackDegraded(report, "gbrain", "bun não disponível") }
  try {
    execFileSync("bun", ["install", "-g", "github:garrytan/gbrain"], { stdio: "pipe", timeout: 120000 })
    success("gbrain (bun global)")
  } catch (e) { warn(`gbrain (bun global): ${e.message}`); trackDegraded(report, "gbrain", e.message) }
}

const uvLabel = () => (isWindows() ? "uv (Windows)" : "uv (Unix)")
const uvUrl = () => (isWindows() ? "https://astral.sh/uv/install.ps1" : "https://astral.sh/uv/install.sh")
function installUv(remoteOpts) {
  const uvCandidates = getUvCandidates(HOME, isWindows())
  let uvBin = findWorkingBinary(uvCandidates)
  if (uvBin) return uvBin
  info("uv: nao encontrado. Instalando (download seguro)...")
  try {
    safeDownloadAndRun(uvUrl(), uvLabel(), remoteOpts)
    refreshPath()
    uvBin = findWorkingBinary(uvCandidates)
    if (uvBin) success("uv instalado")
    else warn("uv: instalado mas nao encontrado. Tente reiniciar o terminal.")
  } catch { warn("uv: falha ao instalar. Instale manualmente: https://docs.astral.sh/uv/#installation") }
  return uvBin
}
// graphify — indexação AST por commit. O pacote PyPI é `graphifyy` (DOIS "y"; o CLI
// continua `graphify`). Instala GLOBAL via uv tool (ambiente isolado). Pula se já existe.
function installGraphify(report, uvBin) {
  if (findWorkingBinary(["graphify"])) return success("graphify: já instalado")
  if (!uvBin) { info("graphify: pulado (uv não disponível) — `uv tool install graphifyy` ativa a indexação AST global."); return trackDegraded(report, "graphify", "uv não disponível") }
  try {
    execFileSync(uvBin, ["tool", "install", "graphifyy"], { stdio: "pipe", timeout: 180000 })
    refreshPath()
    if (findWorkingBinary(["graphify"])) success("graphify instalado (uv tool: graphifyy) — AST global p/ qualquer projeto")
    else { success("graphify instalado (graphifyy)"); info("  Se `graphify` não aparecer, reinicie o terminal (bin do uv tool no PATH).") }
    report.added.push("graphify (graphifyy — indexação AST)")
  } catch (e) { warn(`graphify (uv tool graphifyy): ${e.message}`); trackDegraded(report, "graphify", e.message) }
}
// ECC (ecc-universal) — otimizador de harness (binário `ecc`). Full = tudo; gstack
// consome como BIBLIOTECA (não injeta o perfil do ECC — ver create.js).
function installEcc(report) {
  if (findWorkingBinary(["ecc"])) return success("ECC: já instalado (ecc-universal)")
  try {
    const { file, argv } = npmArgv(["install", "-g", "ecc-universal"])
    execFileSync(file, argv, { stdio: "pipe", timeout: 180000 })
    success("ECC instalado (ecc-universal) — `ecc` / `npx ecc-agentshield scan` on-demand")
    report.added.push("ECC (ecc-universal)")
  } catch (e) { warn(`ECC (ecc-universal): ${e.message}`); trackDegraded(report, "ECC", e.message) }
}

// pytest — hooks Python, QG e Test Gate dependem dele. Tenta uv, depois pip.
function tryUvPytest(uvBin) {
  if (!uvBin) return false
  try { execFileSync(uvBin, ["pip", "install", "--system", "pytest"], { stdio: "pipe", timeout: 120000 }); return true } catch { return false }
}
function tryPipPytest() {
  try {
    const pip = findWorkingBinary(["pip3", "pip"], { timeout: 5000 }) || "pip"
    execFileSync(pip, ["install", "--user", "pytest"], { stdio: "pipe", timeout: 120000 })
    return true
  } catch (e) { warn(`pytest: falha ao instalar (${e.message}). Instale manualmente: pip install pytest`); return false }
}
function installPytest(report, uvBin) {
  const pytestOk = tryUvPytest(uvBin) || tryPipPytest()
  if (pytestOk) { success("pytest instalado"); report.added.push("pytest (testes Python)") }
}

// Rust (rustup) — needed for headroom build.
const rustupLabel = () => (isMacOS() ? "Rustup (macOS)" : "Rustup (Linux)")
function installRustWindows() {
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
}
function addCargoBinToPath() {
  const cargoBin = join(HOME, ".cargo", "bin")
  if (isWindows() && existsSync(cargoBin)) {
    process.env.Path = cargoBin + ";" + (process.env.Path || "")
    info("Adicionado ~/.cargo/bin ao PATH")
  }
}
function tryRustGnuToolchain() {
  info("Rust: MSVC toolchain pode ter falhado. Tentando toolchain GNU...")
  try {
    execFileSync("rustup", ["default", "stable-gnu"], { stdio: "pipe", timeout: 30000 })
    if (findWorkingBinary(["rustc"]) !== "") { success("Rust instalado (toolchain GNU)"); return true }
  } catch { /* expected */ }
  return false
}
function finalizeRust() {
  addCargoBinToPath()
  refreshPath()
  let rustFound = findWorkingBinary(["rustc"]) !== ""
  if (rustFound) return success("Rust instalado")
  if (isWindows()) rustFound = tryRustGnuToolchain()
  if (!rustFound) warn("Rust: instalado mas `rustc` nao encontrado no PATH")
}
function installRust(remoteOpts) {
  if (findWorkingBinary(["rustc"]) !== "") return success("Rust encontrado")
  info("Rust: nao encontrado. Instalando rustup...")
  try {
    if (isWindows()) installRustWindows()
    else safeDownloadAndRun("https://sh.rustup.rs", rustupLabel(), remoteOpts)
    finalizeRust()
  } catch (e) { warn("Rust: falha ao instalar. Instale manualmente: https://rustup.rs") }
}

function installPlaywright() {
  try {
    const pw = npxArgv(["playwright", "install", "chromium"])
    execFileSync(pw.file, pw.argv, { stdio: "pipe", timeout: 120000 })
    const pwDir = isWindows() ? join(HOME, "AppData", "Local", "ms-playwright") : join(HOME, ".cache", "ms-playwright")
    if (existsSync(pwDir) && readdirSync(pwDir).some((f) => f.startsWith("chromium"))) success("Playwright: chromium instalado")
    else warn("Playwright: comando executado mas chromium nao encontrado em " + pwDir)
  } catch (e) { warn(`Playwright: falha ao instalar chromium: ${e.message}`); info("  Rode manualmente: npx playwright install chromium") }
}
function installMom() {
  if (!isMacOS()) return info("MOM: incompativel com este OS (apenas macOS)")
  try { execFileSync("brew", ["install", "momhq/tap/mom"], { stdio: "pipe", timeout: 120000 }); success("MOM (brew)") }
  catch (e) { warn(`MOM (brew): ${e.message}`) }
}
// Printing Press: catálogo via `@mvanhorn/printing-press-library` compila o gerador
// Go SOB DEMANDA (`gstack_vibehard tools`). Aqui só sinalizamos, sem forçar ~150MB.
function reportPrintingPressDep() {
  if (findWorkingBinary(["cli-printing-press"]) || findWorkingBinary(["printing-press"])) success("Printing Press (gerador de CLIs): já instalado")
  else info("Printing Press (gerador de CLIs): disponível via `gstack_vibehard tools` (instala sob demanda, compila via Go).")
}

async function installDeps(warn, success, info, report, harnessIds, allowRemote = false) {
  const remoteOpts = { allowRemote }
  section("deps/ — Instalando dependencias globais")
  const bunFound = installBun(remoteOpts)
  installGbrain(report, bunFound)
  const uvBin = installUv(remoteOpts)
  installGraphify(report, uvBin)
  installEcc(report)
  installPytest(report, uvBin)
  installRust(remoteOpts)
  installPlaywright()
  if (isWindows()) refreshPath()
  installMom()
  reportPrintingPressDep()
  // Headroom (context compression proxy).
  await installHeadroom({ warn, success, info, uvBin, selectedHarnessIds: harnessIds }, report)
  // Full = tudo: se o headroom não ficou disponível, é degradação (não silêncio).
  if (!findWorkingBinary(["headroom"])) trackDegraded(report, "headroom", "binário ausente após instalar (sem uv/permissão?)")
}

// Full = tudo: tenta instalar o app Obsidian (winget no Windows / brew no mac).
// Retorna true se o comando rodou sem erro; false (degraded) se não houver
// gerenciador/permissão. NÃO bloqueia — o vault markdown funciona sem o app.
function tryInstallObsidianApp(report) {
  try {
    if (isWindows()) {
      execFileSync("winget", ["install", "-e", "--id", "Obsidian.Obsidian", "--silent", "--accept-source-agreements", "--accept-package-agreements"], { stdio: "pipe", timeout: 240000 })
    } else if (isMacOS()) {
      execFileSync("brew", ["install", "--cask", "obsidian"], { stdio: "pipe", timeout: 240000 })
    } else {
      return false
    }
    report.added.push("Obsidian app (instalado)")
    return true
  } catch {
    return false
  }
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
  // Vault: registrado no manifest (ownership/integridade) mas PRESERVADO no
  // uninstall (removeOnUninstall:false) — só sai com --remove-vault.
  safeWriteFile(join(vaultDir, ".obsidian", "app.json"), JSON.stringify(obsidianConfig, null, 2) + "\n", { component: "vault", removeOnUninstall: false })
  report.added.push("vault: .obsidian/app.json configurado")
  success("Cofre Obsidian configurado em ~/gstack-vault")

  const vaultReadme = join(vaultDir, "README.md")
  if (!existsSync(vaultReadme)) {
    safeWriteFile(vaultReadme, [
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
    ].join("\n") + "\n", { component: "vault", removeOnUninstall: false })
    report.added.push("vault: README.md criado")
    success("README do vault criado")
  }

  // AgentMemory MD Obsidian Export: espelha memorias em .md no vault
  const codexConfigDir = join(HOME, ".codex")
  if (existsSync(codexConfigDir)) {
    const codexEnv = join(codexConfigDir, ".env")
    // Bloco MARCADO via safe-write: backup + manifest; no uninstall só o bloco sai.
    safeAppendBlock(codexEnv, `AGENTMEMORY_MD_EXPORT_PATH=${vaultDir}/agents`, {
      beginMarker: "# >>> gstack_vibehard:agentmemory",
      endMarker: "# <<< gstack_vibehard:agentmemory",
      component: "codex",
    })
    report.updated.push("vault: AGENTMEMORY_MD_EXPORT_PATH (bloco) em ~/.codex/.env")
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
    for (const hook of hooks) {
      // safeCopyFile: backup versionado + registro no MANIFEST → todo hook
      // instalado/refrescado é rastreável e o `uninstall` sempre o reverte.
      safeCopyFile(join(hooksSource, hook), join(target.dir, hook), { home: HOME, component: "hooks" })
      report.updated.push(`hook (${target.id}): ${hook}`)
    }
    success(`${hooks.length} hooks atualizados em ${target.dir} (manifest-owned)`)
  }
}

export async function install(args = []) {
  const auditOnly = args.includes("--audit-only")
  const projectOnly = args.includes("--project-only")
  const hi = args.indexOf("--harness")
  const onlyHarness = hi !== -1 && args[hi + 1] && !args[hi + 1].startsWith("--") ? args[hi + 1] : null
  // project-only NÃO toca deps globais (impacto global mínimo).
  const skipDeps = args.includes("--skip-deps") || projectOnly || process.env.GSTACK_SKIP_DEPS === "1"
  const yes = args.includes("--yes") || args.includes("-y")
  // Política remota (P0.6): instaladores remotos (Bun/uv/Rust) só rodam com opt-in.
  const allowRemote = args.includes("--allow-remote-downloads")
  const globalConfirmed = args.includes("--global") || yes
  // MCP global no MODO COMPLETO (PRD 11: "Full = tudo"): escreve por padrão; opt-out
  // com `--no-global-mcp`. project-only/lite NUNCA escreve. (Antes era opt-in via
  // --global-mcp; mantido como sinônimo explícito.)
  const globalMcp = !projectOnly && !args.includes("--no-global-mcp")
  // --mcp-server <name> (repetível ou CSV): com --global-mcp, escreve só os escolhidos.
  const mcpServers = (() => {
    const out = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--mcp-server" && args[i + 1] && !args[i + 1].startsWith("--")) {
        out.push(...args[i + 1].split(",").map((s) => s.trim()).filter(Boolean))
      }
    }
    return out.length ? out : null
  })()
  // Contrato Full (PRD 12 §11): `degraded` rastreia componentes do completo que
  // falharam. No fim, no modo Full, isso BLOQUEIA — a menos de `--allow-degraded`.
  const allowDegraded = args.includes("--allow-degraded")
  const report = { added: [], updated: [], skipped: [], errors: [], degraded: [] }

  section("gstack_vibehard Installer")

  // Detect harnesses
  let harnesses = detectHarnesses()
  if (onlyHarness) harnesses = harnesses.filter((h) => h.id === onlyHarness)
  // Devin é project-scoped: `install --harness devin` gera `.devin/` mesmo sem o
  // Devin CLI instalado (scaffolding seguro do projeto, não escrita global).
  if (onlyHarness === "devin" && !harnesses.some((h) => h.id === "devin")) {
    harnesses = [{ id: "devin", label: "Devin CLI" }]
  }

  // SAFE INSTALL — preflight de impacto (AC1/AC2): com --audit-only NÃO escreve
  // nada; apenas lista, por categoria, os caminhos globais que seriam tocados.
  if (auditOnly) {
    const impact = buildInstallImpact({ home: HOME, harnessIds: harnesses.map((h) => h.id), withDeps: !skipDeps, projectOnly })
    section("install --audit-only — preflight (nada será escrito)")
    for (const c of impact) {
      info("")
      info(`${c.label}${c.optional ? " (opcional)" : ""}:`)
      for (const it of c.items) info(`  • [${it.action}] ${it.path}`)
    }
    // Supply chain risk no preflight (PRD14 §4.7) — read-only, offline-first.
    try {
      const sc = buildSupplyChainReport()
      info("")
      ;(sc.risk === "none" ? info : warn)(`Supply chain risk: ${sc.risk}${sc.risk !== "none" ? " — detalhe: `gstack_vibehard doctor --supply-chain`" : " (registry oficial, binários íntegros)"}`)
      for (const c of sc.checks.filter((x) => x.status === "critical")) warn(`  ✗ ${c.id}: ${c.detail}`)
    } catch { /* preflight nunca quebra por causa do supply chain */ }
    // READ-ONLY por padrão (P0.3): NÃO escreve nada. Só com --save-report grava.
    if (args.includes("--save-report")) {
      try {
        ensureDir(join(HOME, ".gstack_vibehard"))
        const reportPath = join(HOME, ".gstack_vibehard", `install-report-${Date.now()}.md`)
        const md = renderImpactMarkdown(impact, { when: new Date().toISOString(), harnessIds: harnesses.map((h) => h.id) })
        writeFileSync(reportPath, md + "\n")
        info("")
        warn(`--save-report: relatório GRAVADO em ${reportPath} (único efeito colateral).`)
      } catch (e) { warn(`Não consegui salvar o relatório: ${e.message}`) }
    } else {
      info("")
      info("(audit-only é READ-ONLY: nada foi escrito. Use `--save-report` p/ salvar o relatório.)")
    }
    info("")
    info("Para instalar de fato: `gstack_vibehard install` (ou `--project-only` p/ impacto mínimo).")
    return report
  }

  info(projectOnly ? "Instalando (modo project-only — impacto global mínimo)..." : "Instalando pacote completo...")
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

  // PREFLIGHT-FIRST (Safe Install / Codex AC1): mostra o impacto global por
  // categoria e EXIGE confirmação antes de qualquer escrita global. Interativo →
  // confirma; não-interativo → exige --yes/--global (senão aborta com orientação).
  {
    const impact = buildInstallImpact({ home: HOME, harnessIds: allHarnessIds, withDeps: !skipDeps, withMcp: globalMcp, projectOnly })
    section("Impacto desta instalação (preflight)")
    for (const c of impact) info(`  • ${c.label}${c.optional ? " (opcional)" : ""}: ${c.items.length} item(ns)`)
    // MCP global — preflight HONESTO (corrige a contradição: o preflight dizia "NÃO
    // será escrito" enquanto o Headroom configura ~/.mcp.json no modo completo).
    if (projectOnly) {
      info("  • MCP global: NÃO será escrito (project-only)")
    } else {
      if (!skipDeps) info("  • MCP global: Headroom configura `~/.mcp.json` (parte do completo)")
      info(globalMcp
        ? "  • MCP servers do gstack (gateway): SERÃO escritos em `~/.mcp.json` (modo completo; `--no-global-mcp` p/ pular)"
        : "  • MCP servers do gstack (gateway): NÃO serão escritos (project-only)")
    }
    info("")
    info("Detalhe completo sem instalar: `gstack_vibehard install --audit-only`.")
    if (!globalConfirmed) {
      if (process.stdin.isTTY) {
        const ok = await confirm("Prosseguir com a instalação? (ou Ctrl-C e use --project-only)", false)
        if (!ok) { info("Instalação cancelada. Dica: `--project-only` (impacto mínimo) ou `--audit-only`."); return report }
      } else {
        error("Modo não-interativo: confirme explicitamente o impacto global.")
        info("  gstack_vibehard install --yes            (instalação completa)")
        info("  gstack_vibehard install --project-only --yes  (impacto mínimo)")
        info("  gstack_vibehard install --audit-only     (só o relatório de impacto)")
        return report
      }
    }
  }

  // Step 1: Install global deps (bun, uv, Rust, Playwright, headroom...)
  // Opt-out: --skip-deps ou GSTACK_SKIP_DEPS=1 pula instalacoes pesadas
  if (skipDeps) {
    info("Deps globais: puladas (--skip-deps)")
    report.skipped.push("deps globais (--skip-deps)")
  } else {
    await installDeps(warn, success, info, report, allHarnessIds, allowRemote)
  }

  // Check which harnesses already have gstack_vibehard. Com --reinstall/--force,
  // tratamos TODOS como disponíveis → reaplica config completa via Safe Write
  // (conserta install antigo sem manifest).
  const reinstall = args.includes("--reinstall") || args.includes("--force")
  const alreadyInstalled = reinstall ? [] : checkAlreadyInstalled(allHarnessIds)
  const availableHarnessIds = allHarnessIds.filter((h) => !alreadyInstalled.includes(h))
  if (reinstall) info("Modo --reinstall: reaplicando tudo (hooks/config) com backup + manifest.")

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
  if (yes || !process.stdin.isTTY) {
    // --yes (modo completo) NÃO pergunta: instala em todos os detectados.
    // Para um subconjunto, use --harness <id>. (Antes o prompt aparecia mesmo com --yes.)
    info(yes ? "Modo --yes: instalando em todos os harnesses detectados (use --harness <id> p/ subconjunto)" : "Modo nao-interativo: instalando em todos os harnesses detectados")
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
      // safe-write: backup (se existir) + registro de ownership no manifest.
      safeCopyFile(src, dst, { component: "scripts", kind: "script" })
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
        // safe-write: copia + registra ownership (uninstall só remove o que criamos).
        safeCopyDir(src, dst, { component: "skills", kind: "skill" })
        report.added.push(`skill: ${skill.name}`)
      } else {
        // NÃO sobrescreve skill pré-existente do usuário — e não registra ownership.
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
          await installCodex({ hooks: false, template: true, mcp: globalMcp, mcpServers }, report)
          break
        case "claude":
          // hooks: true = REGISTRO no settings.json (Step 3 ja copiou os .py)
          // MCP global é OPT-IN (--global-mcp/--global); senão não escreve.
          await installClaude({ hooks: true, claudeMd: true, ultracode: true, mcp: globalMcp }, report)
          break
        case "opencode":
          await installOpenCode({ hooks: true }, report)
          break
        case "cursor":
          await installCursor({ hooks: true }, report)
          break
        case "hermes":
          // Hermes fala MCP nas duas direções: skills + guidance (garantidos) +
          // registro dos MCP servers via `hermes mcp add` (best-effort).
          await installHermes({ mcp: globalMcp, skills: true }, report, { projectRoot: PROJECT_ROOT })
          break
        case "devin": {
          // Project-scoped: gera `.devin/` da Policy DSL (nunca escrita global).
          const dv = generateDevinAssets(process.cwd())
          dv.written.forEach((p) => report.added.push(p))
          info(`devin: ${dv.written.length} arquivo(s) em .devin/ (policy: ${dv.policyLayers.join(" ← ")})`)
          if (dv.skipped.length) info(`devin: preservado(s) ${dv.skipped.join(", ")}`)
          break
        }
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

  // Step 11: Obsidian Vault Global (Segundo Cerebro) — pulado em project-only
  if (projectOnly) {
    info("Vault global: pulado (--project-only)")
    report.skipped.push("vault global (--project-only)")
  } else {
    section("vault/ — Obsidian Vault Global (Segundo Cerebro)")
    setupObsidianVault(report)
  }

  // Step 12: Obsidian detectado → escolha obrigatória (com 'pular') do vault a
  // indexar no Document Graph. Detecção lê só obsidian.json; NUNCA indexa aqui.
  section("obsidian/ — Document Graph (escolha do vault)")
  if (!obsidianDetected()) {
    // Full = tudo (PRD 11): tenta instalar o APP Obsidian (winget/brew). Honesto:
    // degraded se não der (sem winget/admin/cask). O VAULT já existe (markdown) e
    // abre em qualquer editor — o app é só o visualizador. Opt-out: --no-obsidian.
    if (!projectOnly && !args.includes("--no-obsidian") && tryInstallObsidianApp(report)) {
      success("Obsidian app instalado (vault em ~/gstack-vault).")
    } else {
      info("Obsidian app: nao instalado nesta maquina (degraded/opcional — o vault e markdown). Manual: `winget install Obsidian.Obsidian` / `brew install --cask obsidian`.")
      // Full = tudo: app ausente conta como degradação (opt-out explícito: --no-obsidian).
      if (!projectOnly && !args.includes("--no-obsidian")) trackDegraded(report, "obsidian-app", "winget/brew indisponível ou falhou (vault markdown segue funcional)")
    }
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

  // Contrato Full (PRD 12 §11): "Full = tudo" não pode terminar como concluído com
  // componentes degradados em silêncio. Bloqueia (exit 1) a menos de --allow-degraded.
  const contract = evaluateFullContract({ degraded: report.degraded, projectOnly, auditOnly, skipDeps, allowDegraded })
  if (report.degraded.length) {
    section("Contrato Full — componentes degradados")
    for (const d of report.degraded) warn(`  ✗ ${d.component}: ${d.reason}`)
  }
  if (contract.block) {
    error(contract.message)
    info("  Conserte os componentes acima, ou rode novamente com `--allow-degraded` para aceitar o estado parcial.")
    report.blocked = true
    process.exitCode = 1
    return report
  }
  if (contract.isFull && report.degraded.length && allowDegraded) warn(contract.message)

  section("Instalacao Concluida!")
  section("Ativacao POR PROJETO (importante)")
  info("O gstack vem ATIVO por padrao para projetos NOVOS (criados com")
  info("`gstack_vibehard create`), e DESATIVADO para projetos em andamento.")
  info("")
  info("  • Para ATIVAR num projeto em andamento: entre na pasta dele e digite")
  info("      gstack_vibehard enable")
  info("  • Para DESLIGAR num projeto:  gstack_vibehard disable")
  info("  • Para VER o estado:          gstack_vibehard status")
  info("")
  info("Os GATES PESADOS do gstack so agem em projetos com `.gstack/`. Ainda assim,")
  info("esta instalacao registrou COMPONENTES GLOBAIS do harness (hooks, skills/scripts,")
  info(projectOnly ? "config dos harnesses) — em modo project-only (sem MCP global/vault/deps)." : "config, e — em modo completo — MCP global/vault/deps).")
  info("Projetos que voce NAO ativar ficam intocados (so o bloqueio de comando")
  info("destrutivo continua global, como rede de seguranca).")
  info("")
  info("Auditar o impacto e o rollback:")
  info("  gstack_vibehard doctor --install-integrity   (manifest/backups/hashes)")
  info("  gstack_vibehard uninstall --dry-run          (plano de remocao)")
  info("")
  info("Comandos uteis:")
  info("  gstack_vibehard doctor    — diagnosticar ambiente")
  info("  gstack_vibehard uninstall — remover gstack_vibehard do ambiente")
  info("  gstack_vibehard init      — criar novo projeto com estrutura completa")
  if (selectedHarnessIds.includes("claude")) {
    info("")
    info("Claude Code: regras gstack ativam na proxima sessao SOMENTE em projetos .gstack/")
  }

  console.log()
}
