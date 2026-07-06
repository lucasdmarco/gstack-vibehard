import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { copyFile, mkdir } from "fs/promises"
import { homedir, tmpdir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { detectHarnesses, getHarness, isWindows, isMacOS, isLinux } from "../harness/detector.js"
import { installCodex } from "../harness/codex.js"
import { installClaude } from "../harness/claude.js"
import { installOpenCode, refreshOpenCodePlugins } from "../harness/opencode.js"
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

// ── Parsing de flags do install (deriva todo o comportamento a partir de args) ───

function resolveOnlyHarness(args) {
  const hi = args.indexOf("--harness")
  return hi !== -1 && args[hi + 1] && !args[hi + 1].startsWith("--") ? args[hi + 1] : null
}
const hasYes = (args) => args.includes("--yes") || args.includes("-y")
// --mcp-server <name> (repetível ou CSV): escreve só os escolhidos.
function parseMcpServers(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mcp-server" && args[i + 1] && !args[i + 1].startsWith("--")) {
      out.push(...args[i + 1].split(",").map((s) => s.trim()).filter(Boolean))
    }
  }
  return out.length ? out : null
}
function parseInstallFlags(args) {
  const projectOnly = args.includes("--project-only")
  const yes = hasYes(args)
  return {
    auditOnly: args.includes("--audit-only"),
    projectOnly,
    onlyHarness: resolveOnlyHarness(args),
    // project-only NÃO toca deps globais (impacto global mínimo).
    skipDeps: args.includes("--skip-deps") || projectOnly || process.env.GSTACK_SKIP_DEPS === "1",
    yes,
    // Política remota (P0.6): instaladores remotos (Bun/uv/Rust) só rodam com opt-in.
    allowRemote: args.includes("--allow-remote-downloads"),
    globalConfirmed: args.includes("--global") || yes,
    // MCP global no MODO COMPLETO (PRD 11): escreve por padrão; opt-out `--no-global-mcp`.
    globalMcp: !projectOnly && !args.includes("--no-global-mcp"),
    mcpServers: parseMcpServers(args),
    // Contrato Full (PRD 12 §11): degraded no Full BLOQUEIA, a menos de --allow-degraded.
    allowDegraded: args.includes("--allow-degraded"),
    reinstall: args.includes("--reinstall") || args.includes("--force"),
  }
}

function resolveHarnesses(flags) {
  let harnesses = detectHarnesses()
  if (flags.onlyHarness) harnesses = harnesses.filter((h) => h.id === flags.onlyHarness)
  // Devin é project-scoped: `install --harness devin` gera `.devin/` mesmo sem o CLI.
  if (flags.onlyHarness === "devin" && !harnesses.some((h) => h.id === "devin")) harnesses = [{ id: "devin", label: "Devin CLI" }]
  return harnesses
}

// ── Fase: audit-only (preflight READ-ONLY, AC1/AC2) ──────────────────────────────

function printAuditImpact(impact) {
  section("install --audit-only — preflight (nada será escrito)")
  for (const c of impact) {
    info("")
    info(`${c.label}${c.optional ? " (opcional)" : ""}:`)
    for (const it of c.items) info(`  • [${it.action}] ${it.path}`)
  }
}
// Supply chain risk no preflight (PRD14 §4.7) — read-only, offline-first.
function printSupplyChainPreflight() {
  try {
    const sc = buildSupplyChainReport()
    info("")
    ;(sc.risk === "none" ? info : warn)(`Supply chain risk: ${sc.risk}${sc.risk !== "none" ? " — detalhe: `gstack_vibehard doctor --supply-chain`" : " (registry oficial, binários íntegros)"}`)
    for (const c of sc.checks.filter((x) => x.status === "critical")) warn(`  ✗ ${c.id}: ${c.detail}`)
  } catch { /* preflight nunca quebra por causa do supply chain */ }
}
function saveAuditReport(impact, harnesses) {
  try {
    ensureDir(join(HOME, ".gstack_vibehard"))
    const reportPath = join(HOME, ".gstack_vibehard", `install-report-${Date.now()}.md`)
    const md = renderImpactMarkdown(impact, { when: new Date().toISOString(), harnessIds: harnesses.map((h) => h.id) })
    writeFileSync(reportPath, md + "\n")
    info("")
    warn(`--save-report: relatório GRAVADO em ${reportPath} (único efeito colateral).`)
  } catch (e) { warn(`Não consegui salvar o relatório: ${e.message}`) }
}
function runAuditOnly(harnesses, flags, args, report) {
  const impact = buildInstallImpact({ home: HOME, harnessIds: harnesses.map((h) => h.id), withDeps: !flags.skipDeps, projectOnly: flags.projectOnly })
  // `--json` = contrato de automação: JSON PURO (impacto + degradações previstas +
  // supply chain), zero banner/section (gate final do PRD26 pegou a violação).
  if (args.includes("--json")) {
    let supplyChain = null
    try { supplyChain = buildSupplyChainReport() } catch { /* preflight nunca quebra */ }
    const payload = { schemaVersion: "gstack.install-audit.v1", readOnly: true, impact, predictedDegradations: predictFullDegradations(), supplyChain }
    process.stdout.write(JSON.stringify(payload) + "\n")
    return report
  }
  printAuditImpact(impact)
  printSupplyChainPreflight()
  // READ-ONLY por padrão (P0.3): só grava com --save-report.
  if (args.includes("--save-report")) saveAuditReport(impact, harnesses)
  else { info(""); info("(audit-only é READ-ONLY: nada foi escrito. Use `--save-report` p/ salvar o relatório.)") }
  info("")
  info("Para instalar de fato: `gstack_vibehard install` (ou `--project-only` p/ impacto mínimo).")
  return report
}

// ── Fase: garantir harnesses + avisos ────────────────────────────────────────────

function abortNoHarness() {
  error("Nenhum harness detectado.")
  info("Instale um dos harnesses primeiro:")
  info("  • OpenAI Codex CLI — pip install codex-cli")
  info("  • Claude Code     — npm install -g @anthropic-ai/claude-code")
  info("  • Cursor          — instale o Cursor e abra um projeto com .cursor/")
  info("  • OpenCode CLI    — npm install -g opencode")
  process.exit(1)
}
function warnHarnessCaveats(harnesses) {
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
}
function ensureHarnesses(harnesses, flags) {
  info(flags.projectOnly ? "Instalando (modo project-only — impacto global mínimo)..." : "Instalando pacote completo...")
  if (harnesses.length === 0) { abortNoHarness(); return false }
  info(`Harnesses detectados: ${harnesses.map((h) => h.label).join(", ")}`)
  warnHarnessCaveats(harnesses)
  return true
}

// ── Fase: preflight de impacto + confirmação de escrita global (Safe Install) ────

function printMcpPreflight(flags) {
  // Preflight HONESTO: no completo o Headroom configura ~/.mcp.json.
  if (flags.projectOnly) return info("  • MCP global: NÃO será escrito (project-only)")
  if (!flags.skipDeps) info("  • MCP global: Headroom configura `~/.mcp.json` (parte do completo)")
  info(flags.globalMcp
    ? "  • MCP servers do gstack (gateway): SERÃO escritos em `~/.mcp.json` (modo completo; `--no-global-mcp` p/ pular)"
    : "  • MCP servers do gstack (gateway): NÃO serão escritos (project-only)")
}
// ── CM-01 (máquina limpa): preflight-first para deps OBRIGATÓRIAS do Full ────
// Antes: o install confirmava, ESCREVIA global e só no fim descobria que o contrato
// Full falhou. Agora o preflight SONDA os toolchains das deps obrigatórias e, se
// alguma degradaria, exige a decisão (--allow-degraded) ANTES de qualquer escrita.
const MANDATORY_DEP_PROBES = [
  { component: "gbrain", needs: "bun", probe: () => findWorkingBinary(["bun", ...getBunCandidates(HOME, isWindows())]) !== "" },
  { component: "graphify", needs: "uv", probe: () => !!(findWorkingBinary(["graphify"]) || findWorkingBinary(getUvCandidates(HOME, isWindows()))) },
  { component: "headroom", needs: "uv ou pip", probe: () => !!(findWorkingBinary(["headroom"]) || findWorkingBinary(getUvCandidates(HOME, isWindows())) || findWorkingBinary(["pip"])) },
  { component: "pytest", needs: "python", probe: () => findWorkingBinary(["python", "python3"]) !== "" },
]
export function predictFullDegradations(probes = MANDATORY_DEP_PROBES) {
  return probes
    .filter((d) => { try { return !d.probe() } catch { return true } })
    .map(({ component, needs }) => ({ component, needs }))
}
const isFullMode = (flags) => !flags.projectOnly && !flags.auditOnly && !flags.skipDeps
function printPredictedDegradations(predicted) {
  section("Preflight — componentes obrigatórios do Full que DEGRADARIAM")
  for (const p of predicted) warn(`  ✗ ${p.component}: toolchain ausente (${p.needs})`)
}
function blockBeforeAnyWrite() {
  error("Full não pode prosseguir: os componentes acima falhariam DEPOIS das escritas globais.")
  info("  Opções: instale o toolchain ausente, ou rode com `--allow-degraded`,")
  info("  `--skip-deps` (sem deps globais) ou `--project-only` (impacto mínimo).")
  info("  NADA foi escrito — nenhuma config global foi tocada.")
  return false
}
function preflightMandatoryGate(flags) {
  if (!isFullMode(flags)) return true
  const predicted = predictFullDegradations()
  if (predicted.length === 0) return true
  printPredictedDegradations(predicted)
  if (flags.allowDegraded) { warn("  Prosseguindo DEGRADADO (--allow-degraded explícito)."); return true }
  return blockBeforeAnyWrite()
}

function printPreflightImpact(allHarnessIds, flags) {
  const impact = buildInstallImpact({ home: HOME, harnessIds: allHarnessIds, withDeps: !flags.skipDeps, withMcp: flags.globalMcp, projectOnly: flags.projectOnly })
  section("Impacto desta instalação (preflight)")
  for (const c of impact) info(`  • ${c.label}${c.optional ? " (opcional)" : ""}: ${c.items.length} item(ns)`)
  printMcpPreflight(flags)
  // CM-07: Printing Press é ON-DEMAND — fora do contrato Full (Go instala sob demanda).
  info("  • Printing Press (geração de CLIs): on-demand via `tools install` — FORA do contrato Full")
  info("")
  info("Detalhe completo sem instalar: `gstack_vibehard install --audit-only`.")
}
async function confirmGlobalWrite(flags) {
  if (flags.globalConfirmed) return true
  if (process.stdin.isTTY) {
    const ok = await confirm("Prosseguir com a instalação? (ou Ctrl-C e use --project-only)", false)
    if (!ok) info("Instalação cancelada. Dica: `--project-only` (impacto mínimo) ou `--audit-only`.")
    return ok
  }
  error("Modo não-interativo: confirme explicitamente o impacto global.")
  info("  gstack_vibehard install --yes            (instalação completa)")
  info("  gstack_vibehard install --project-only --yes  (impacto mínimo)")
  info("  gstack_vibehard install --audit-only     (só o relatório de impacto)")
  return false
}
async function preflightAndConfirm(allHarnessIds, flags) {
  printPreflightImpact(allHarnessIds, flags)
  // CM-01: gate de deps obrigatórias ANTES do confirm — nada é escrito se bloquear.
  if (!preflightMandatoryGate(flags)) return false
  return confirmGlobalWrite(flags)
}

async function maybeInstallDeps(flags, report, allHarnessIds) {
  // Opt-out: --skip-deps ou GSTACK_SKIP_DEPS=1 pula instalacoes pesadas.
  if (flags.skipDeps) { info("Deps globais: puladas (--skip-deps)"); report.skipped.push("deps globais (--skip-deps)"); return }
  await installDeps(warn, success, info, report, allHarnessIds, flags.allowRemote)
}

// ── Fase: resolver quais harnesses configurar (ou finalizar como já-configurado) ─

function printDiagnosis(harnesses, alreadyInstalled) {
  info("")
  info("Diagnostico:")
  for (const h of harnesses) {
    if (alreadyInstalled.includes(h.id)) info(`  ${h.label} — ja instalado (artefatos gerenciados serao atualizados; --reinstall reaplica tudo)`)
    else info(`  ${h.label} — disponivel`)
  }
}
// P2 (máquina limpa): harness "já instalado" era PULADO por inteiro e os plugins
// gerenciados ficavam na versão antiga (doctor: "Plugins gstack: nenhum" mesmo após
// upgrade). Agora os artefatos MANIFEST-OWNED atualizam sempre — como o refreshHooks.
function refreshInstalledHarnessArtifacts(alreadyInstalled, report) {
  if (!alreadyInstalled.includes("opencode")) return
  const n = refreshOpenCodePlugins({}, report)
  if (n > 0) info(`  OpenCode: ${n} plugin(s) gerenciado(s) atualizados (config .json/.jsonc intocada)`)
}
// Nada novo p/ configurar: ainda assim ATUALIZA hooks (idempotente) — substitui
// hooks obsoletos (ex.: qg.py antigo) ao re-rodar `install`.
async function refreshAlreadyConfigured(allHarnessIds, report) {
  section("hooks/ — Atualizando Quality & Security Gates")
  await refreshHooks(allHarnessIds, report)
  section("agents/generated — Distribuicao cross-harness")
  await installGeneratedAgentLayer({ projectRoot: PROJECT_ROOT, report, info, success, warn, harnessIds: allHarnessIds })
  section("graphify/ — Git hooks AST")
  installGraphifyGitHooks({ report, info, success, warn })
  success("\n  Harnesses ja configurados — hooks atualizados para a versao atual.")
  printInstallReport(report)
}
async function promptHarnessSelection(harnesses, availableHarnessIds) {
  const harnessOptions = [
    { label: "Todos detectados", value: "__all__", checked: true },
    ...harnesses.filter((h) => availableHarnessIds.includes(h.id)).map((h) => ({ label: h.label, value: h.id })),
  ]
  const harnessAnswer = await multiSelect("Instalar gstack_vibehard em quais harnesses?", harnessOptions)
  return harnessAnswer.includes("__all__") ? availableHarnessIds : harnessAnswer
}
async function chooseHarnesses(harnesses, availableHarnessIds, flags) {
  // --yes/não-interativo NÃO pergunta: instala em todos os detectados.
  if (flags.yes || !process.stdin.isTTY) {
    info(flags.yes ? "Modo --yes: instalando em todos os harnesses detectados (use --harness <id> p/ subconjunto)" : "Modo nao-interativo: instalando em todos os harnesses detectados")
    return availableHarnessIds
  }
  return promptHarnessSelection(harnesses, availableHarnessIds)
}
async function resolveSelected(harnesses, flags, report, allHarnessIds) {
  // Com --reinstall/--force, trata TODOS como disponíveis (reaplica via Safe Write).
  const alreadyInstalled = flags.reinstall ? [] : checkAlreadyInstalled(allHarnessIds)
  const availableHarnessIds = allHarnessIds.filter((h) => !alreadyInstalled.includes(h))
  if (flags.reinstall) info("Modo --reinstall: reaplicando tudo (hooks/config) com backup + manifest.")
  printDiagnosis(harnesses, alreadyInstalled)
  refreshInstalledHarnessArtifacts(alreadyInstalled, report)
  if (availableHarnessIds.length === 0) {
    report.harnessPlan = { all: allHarnessIds, alreadyInstalled, selected: [] }
    await refreshAlreadyConfigured(allHarnessIds, report)
    return { done: true }
  }
  const selected = await chooseHarnesses(harnesses, availableHarnessIds, flags)
  if (selected.length === 0) { error("Nenhum harness selecionado. Instalacao cancelada."); process.exit(1) }
  info(`Harnesses selecionados: ${selected.join(", ")}`)
  // CM-05: plano rastreável do começo ao fim (impresso no sumário final).
  report.harnessPlan = { all: allHarnessIds, alreadyInstalled, selected }
  return { selected }
}

// ── Fase: instalar componentes (scripts, hooks, skills, template/agents) ──────────

async function copyOneScript(script, scriptsSource, scriptsDir, report) {
  const src = join(scriptsSource, script)
  const dst = join(scriptsDir, script)
  ensureDir(dirname(dst))
  // safe-write: backup (se existir) + registro de ownership no manifest.
  safeCopyFile(src, dst, { component: "scripts", kind: "script" })
  if (!isWindows()) {
    try { execFileSync("chmod", ["+x", dst], { stdio: "pipe", timeout: 5000 }) }
    catch (e) { console.error("chmod (non-critical):", e.message) }
  }
  report.added.push(`script: ${script}`)
}
async function copySetupScripts(report) {
  section("scripts/ — Copiando scripts de setup")
  const scriptsDir = join(HOME, ".agents", "scripts")
  ensureDir(scriptsDir)
  const scriptsSource = join(PROJECT_ROOT, "scripts", "scripts")
  if (!existsSync(scriptsSource)) return warn("scripts/scripts/ nao encontrado no pacote")
  const ext = isWindows() ? ".ps1" : ".sh"
  const scripts = readdirSync(scriptsSource).filter((f) => f.endsWith(ext))
  await Promise.all(scripts.map((script) => copyOneScript(script, scriptsSource, scriptsDir, report)))
  success(`${scripts.length} scripts copiados para ~/.agents/scripts/`)
}
function installOneSkill(skill, skillsSource, skillsDir, report) {
  const src = join(skillsSource, skill.name)
  const dst = join(skillsDir, skill.name)
  // NÃO sobrescreve skill pré-existente do usuário — e não registra ownership.
  if (!existsSync(dst)) { safeCopyDir(src, dst, { component: "skills", kind: "skill" }); report.added.push(`skill: ${skill.name}`) }
  else report.skipped.push(`skill: ${skill.name} (ja existe)`)
}
function installSkills(report) {
  section("skills/ — Frontend Design, Chronicle, Init e mais")
  const skillsDir = join(HOME, ".agents", "skills")
  ensureDir(skillsDir)
  const skillsSource = join(PROJECT_ROOT, "skills", "skills")
  if (!existsSync(skillsSource)) return
  const skillDirs = readdirSync(skillsSource, { withFileTypes: true }).filter((d) => d.isDirectory())
  for (const skill of skillDirs) installOneSkill(skill, skillsSource, skillsDir, report)
  success(`${skillDirs.length} skills instaladas em ~/.agents/skills/`)
}
function printTemplateAndAgentsInfo(report) {
  section("template/ — Fullstack Monorepo (Express)")
  const templateSource = join(PROJECT_ROOT, "templates", "templates", "fullstack-monorepo")
  if (existsSync(templateSource)) {
    info("Template disponivel para copia:")
    info(`  cp -r "${templateSource}" ./meu-projeto`)
    report.added.push("template: fullstack-monorepo (express)")
    success("Template pronto para uso")
  }
  section("agents/ — 21 Especialistas com QG Gate")
  if (existsSync(join(PROJECT_ROOT, "agents"))) {
    info("Agentes disponiveis em: agents/")
    report.added.push("agentes: 21 especialistas com QG gate")
    success("Agentes prontos para uso")
  }
}
async function installComponents(selectedHarnessIds, report) {
  await copySetupScripts(report)
  section("hooks/ — Quality & Security Gates")
  await refreshHooks(selectedHarnessIds, report)
  installSkills(report)
  printTemplateAndAgentsInfo(report)
}

// ── Fase: configurar cada harness selecionado ────────────────────────────────────

const HARNESS_INSTALLERS = {
  codex: (flags, report) => installCodex({ hooks: false, template: true, mcp: flags.globalMcp, mcpServers: flags.mcpServers }, report),
  claude: (flags, report) => installClaude({ hooks: true, claudeMd: true, ultracode: true, mcp: flags.globalMcp }, report),
  opencode: (flags, report) => installOpenCode({ hooks: true }, report),
  cursor: (flags, report) => installCursor({ hooks: true }, report),
  hermes: (flags, report) => installHermes({ mcp: flags.globalMcp, skills: true }, report, { projectRoot: PROJECT_ROOT }),
  devin: (flags, report) => configureDevin(report),
}
// Project-scoped: gera `.devin/` da Policy DSL (nunca escrita global).
async function configureDevin(report) {
  const dv = generateDevinAssets(process.cwd())
  dv.written.forEach((p) => report.added.push(p))
  info(`devin: ${dv.written.length} arquivo(s) em .devin/ (policy: ${dv.policyLayers.join(" ← ")})`)
  if (dv.skipped.length) info(`devin: preservado(s) ${dv.skipped.join(", ")}`)
}
// Harness sem API de hooks: integracao instrucional honesta. Retorna "continue" p/
// o loop pular a mensagem de "configurado" (não há config real).
async function configureInstructional(harnessId, report) {
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
  return "continue"
}
async function configureOneHarness(harnessId, flags, report) {
  const installer = HARNESS_INSTALLERS[harnessId]
  if (installer) return installer(flags, report)
  return configureInstructional(harnessId, report)
}
async function configureHarnesses(selectedHarnessIds, flags, report) {
  section("harness/ — Configurando ambientes selecionados")
  for (const harnessId of selectedHarnessIds) {
    section(`Configurando ${harnessId}...`)
    try {
      if ((await configureOneHarness(harnessId, flags, report)) === "continue") continue
      success(`${harnessId} configurado`)
    } catch (e) { report.errors.push(`${harnessId}: ${e.message}`); warn(`Falha ao configurar ${harnessId}: ${e.message}`) }
  }
}
async function installCrossHarnessLayer(selectedHarnessIds, report) {
  section("agents/generated — Distribuicao cross-harness")
  await installGeneratedAgentLayer({ projectRoot: PROJECT_ROOT, report, info, success, warn, harnessIds: selectedHarnessIds })
  section("graphify/ — Git hooks AST")
  installGraphifyGitHooks({ report, info, success, warn })
}

// ── Fase: launcher, vault, obsidian, contrato, banner ────────────────────────────

function installLauncherFile(src, dst, addLabel, successMsg, report) {
  if (!existsSync(src)) return
  copyWithBackup(src, dst)
  report.added.push(addLabel)
  success(successMsg)
}
function installLauncher(report) {
  section("os/ — Instalando launcher para este sistema")
  if (isWindows()) return installLauncherFile(join(PROJECT_ROOT, "launchers", "windows", "install.bat"), join(HOME, "gstack_vibehard-install.bat"), "launcher: gstack_vibehard-install.bat", "Launcher Windows copiado para ~/gstack_vibehard-install.bat", report)
  if (isMacOS()) {
    info("macOS: instalacao via npm — npm install -g @gstack-vibehard/installer")
    info("  (formula Homebrew disponivel em launchers/macos/gstack_vibehard.rb)")
    report.added.push("launcher: instrucoes npm/Homebrew (macOS)")
    return
  }
  if (isLinux()) installLauncherFile(join(PROJECT_ROOT, "launchers", "cross", "install.sh"), join(HOME, "gstack_vibehard-install.sh"), "launcher: gstack_vibehard-install.sh", "Launcher Linux copiado para ~/gstack_vibehard-install.sh", report)
}
function setupVault(flags, report) {
  if (flags.projectOnly) { info("Vault global: pulado (--project-only)"); report.skipped.push("vault global (--project-only)"); return }
  section("vault/ — Obsidian Vault Global (Segundo Cerebro)")
  setupObsidianVault(report)
}
// Full = tudo: tenta instalar o APP Obsidian (winget/brew). Degraded se não der
// (o VAULT já existe em markdown). Opt-out: --no-obsidian.
function installObsidianApp(args, flags, report) {
  const wantApp = !flags.projectOnly && !args.includes("--no-obsidian")
  if (wantApp && tryInstallObsidianApp(report)) return success("Obsidian app instalado (vault em ~/gstack-vault).")
  info("Obsidian app: nao instalado nesta maquina (degraded/opcional — o vault e markdown). Manual: `winget install Obsidian.Obsidian` / `brew install --cask obsidian`.")
  if (wantApp) trackDegraded(report, "obsidian-app", "winget/brew indisponível ou falhou (vault markdown segue funcional)", { optional: true })
}
async function chooseObsidianVault(report) {
  const chosen = await chooseObsidian({ select, prompt })
  if (!chosen) return info("Obsidian: pulado. Configure depois com `context obsidian set <pasta>`.")
  setGlobalObsidianDefault(chosen)
  success(`Obsidian default global: ${chosen} (read-only; indexado via \`context index\`)`)
  report.added.push(`obsidian default: ${chosen}`)
}
// Detecção lê só obsidian.json; NUNCA indexa aqui.
async function handleObsidianChoice(args, flags, report) {
  section("obsidian/ — Document Graph (escolha do vault)")
  if (!obsidianDetected()) return installObsidianApp(args, flags, report)
  if (getGlobalObsidianDefault()) return info(`Obsidian ja configurado (default global): ${getGlobalObsidianDefault()}`)
  if (!process.stdin.isTTY) return info("Obsidian detectado, mas modo nao-interativo — rode `gstack_vibehard context obsidian set <pasta>`.")
  await chooseObsidianVault(report)
}
// ── CM-05 (máquina limpa): estado por harness legível de ponta a ponta ───────
// O transcript mostrou install configurando uns, pulando outros e o doctor dizendo
// coisa diferente. Uma linha por harness com RAZÃO única elimina a contradição.
const HARNESS_KIND = Object.freeze({
  claude: "hooks reais", cursor: "hooks reais", opencode: "plugins (config sagrada, nunca reescrita)",
  codex: "instrucional (AGENTS.md; sem bloqueio por API)", windsurf: "instrucional", gemini: "instrucional",
  kiro: "instrucional", devin: "condicional (hooks se o Devin os carregar)", vscode: "detecção apenas", hermes: "instrucional",
})
function harnessStateLine(id, plan) {
  if (plan.alreadyInstalled.includes(id)) return `já instalado — artefatos gerenciados ATUALIZADOS (use --reinstall p/ reaplicar tudo)`
  if (plan.selected.includes(id)) return `configurado — ${HARNESS_KIND[id] || "integração"}`
  return "pulado (não selecionado nesta execução)"
}
function printHarnessStateSummary(report) {
  const plan = report.harnessPlan
  if (!plan) return
  section("Estado por harness (o doctor vai bater com isto)")
  for (const id of plan.all) info(`  ${id}: ${harnessStateLine(id, plan)}`)
}

const warnDegradedFull = (contract, report, flags) => contract.isFull && report.degraded.length && flags.allowDegraded
// "Full = tudo" não pode concluir com degradação silenciosa. Bloqueia (exit 1) a
// menos de --allow-degraded. Retorna { blocked }.
function finalizeContract(report, flags) {
  printHarnessStateSummary(report)
  printInstallReport(report)
  const contract = evaluateFullContract({ degraded: report.degraded, projectOnly: flags.projectOnly, auditOnly: flags.auditOnly, skipDeps: flags.skipDeps, allowDegraded: flags.allowDegraded })
  if (report.degraded.length) {
    section("Contrato Full — componentes degradados")
    for (const d of report.degraded) warn(`  ✗ ${d.component}: ${d.reason}`)
  }
  if (contract.block) {
    error(contract.message)
    // CM-01: falha TARDIA (imprevista pelo preflight) — o estado é recuperável:
    // tudo que foi escrito tem backup+manifest; um comando restaura.
    report.state = "partial_with_restore_available"
    warn("  Estado: partial_with_restore_available — as escritas têm backup + manifest.")
    info("  Reverter AGORA (restaura configs preexistentes byte-for-byte):")
    info("      gstack_vibehard uninstall --restore-only")
    info("  Ou: conserte os componentes acima e rode de novo, ou aceite com `--allow-degraded`.")
    report.blocked = true
    process.exitCode = 1
    return { blocked: true }
  }
  if (warnDegradedFull(contract, report, flags)) warn(contract.message)
  return { blocked: false }
}
function printSuccessBanner(selectedHarnessIds, projectOnly) {
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

// `--json` = stdout PURO (contrato de automação) — banner só no modo humano.
const printInstallBanner = (args) => { if (!args.includes("--json")) section("gstack_vibehard Installer") }
async function runFullInstall(selected, args, flags, report) {
  await installComponents(selected, report)
  await configureHarnesses(selected, flags, report)
  await installCrossHarnessLayer(selected, report)
  installLauncher(report)
  setupVault(flags, report)
  await handleObsidianChoice(args, flags, report)
}
export async function install(args = []) {
  const flags = parseInstallFlags(args)
  const report = { added: [], updated: [], skipped: [], errors: [], degraded: [] }
  printInstallBanner(args)
  const harnesses = resolveHarnesses(flags)
  if (flags.auditOnly) return runAuditOnly(harnesses, flags, args, report)
  if (!ensureHarnesses(harnesses, flags)) return report
  const allHarnessIds = harnesses.map((h) => h.id)
  if (!(await preflightAndConfirm(allHarnessIds, flags))) return report
  await maybeInstallDeps(flags, report, allHarnessIds)
  const sel = await resolveSelected(harnesses, flags, report, allHarnessIds)
  if (sel.done) return report
  await runFullInstall(sel.selected, args, flags, report)
  if (finalizeContract(report, flags).blocked) return report
  printSuccessBanner(sel.selected, flags.projectOnly)
  return report
}
