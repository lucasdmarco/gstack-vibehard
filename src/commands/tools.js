import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { ppList, ppSearch, PrintingPressError } from "../printing-press/cli.js"
import { installTool, uninstallTool } from "../printing-press/install.js"
import { enableMcp, disableMcp, listMcp } from "../printing-press/mcp.js"
import { doctorAll } from "../printing-press/doctor.js"
import { buildMcpInventory, renderInventoryHuman } from "../mcp/inventory.js"
import { buildRufloReport } from "../harness/ruflo.js"
import { buildToolCatalog, annotateCatalogEntry, LOCAL_CATALOG } from "../tools/catalog.js"
import { recordToolProvenance } from "../tools/provenance.js"
import { buildReadiness } from "../tools/readiness.js"
import { runCleanMachine } from "../installer/clean-machine.js"
import { agentReachCommand } from "./agent-reach.js"
import { confirm, success, warn, error, info, section } from "../cli/index.js"

/** Catálogo remoto best-effort (nunca lança; vazio se sem rede). */
function tryRemoteCatalog(opts) {
  try { const r = ppList(opts); return r && r.available ? r.items : [] } catch { return [] }
}

/** Confirmação p/ install REMOTO. --yes libera; não-interativo sem --yes recusa. */
async function confirmRemoteInstall(slug, opts, args) {
  if (opts.yes || args.includes("--yes")) return true
  if (!process.stdin.isTTY) { error(`Install de '${slug}' baixa/instala de fonte REMOTA. Confirme com --yes (não-interativo).`); return false }
  return (opts.confirm || confirm)(`Instalar '${slug}' de fonte remota? (baixa e executa binário)`, false)
}

/** Caminho do registry do projeto no cwd. */
function registryPath(cwd = process.cwd()) {
  return join(cwd, ".gstack", "integrations.json")
}

function readRegistry(cwd) {
  const p = registryPath(cwd)
  if (!existsSync(p)) return null
  try {
    return migrateRegistry(JSON.parse(readFileSync(p, "utf-8")))
  } catch (e) {
    warn(`integrations.json ilegivel: ${e.message}`)
    return null
  }
}

/**
 * Migra registries antigos (criados antes desta feature) para o schema atual,
 * garantindo o bloco printingPress com defaults — evita explodir ao mutar
 * reg.printingPress em projetos GStack antigos.
 */
function migrateRegistry(reg) {
  if (!reg || typeof reg !== "object") reg = {}
  reg.printingPress = {
    lane: "local",
    role: "read+longtail",
    enabled: false,
    discoveryInstalled: false,
    installed: [],
    suggested: [],
    mcp: [],
    ...(reg.printingPress || {}),
  }
  // normaliza arrays
  for (const k of ["installed", "suggested", "mcp"]) {
    if (!Array.isArray(reg.printingPress[k])) reg.printingPress[k] = []
  }
  return reg
}

function writeRegistry(cwd, reg) {
  writeFileSync(registryPath(cwd), JSON.stringify(reg, null, 2) + "\n")
}

const itemName = (it) => it.slug || it.name || it.id || "?"
const itemDesc = (it) => it.description || it.summary || ""
function printItem(it) {
  const desc = itemDesc(it)
  info(`  • ${itemName(it)}${desc ? " — " + String(desc).slice(0, 70) : ""}`)
}
function printItems(items) {
  for (const it of items.slice(0, 40)) printItem(it)
  if (items.length > 40) info(`  … e mais ${items.length - 40}`)
}

// ── Sub-handlers de `tools` (registry de subcomandos; --json sempre puro) ────────

/** JSON puro no stdout (contrato de automação dos subcomandos de tools). */
const emitTools = (obj) => process.stdout.write(JSON.stringify(obj) + "\n")

const routingLine = (reg) => `Roteamento: leitura → ${reg.routing?.reads}, escrita → ${reg.routing?.writes}`
function handleSuggested({ cwd }) {
  section("tools — sugeridas para este projeto")
  const reg = readRegistry(cwd)
  if (!reg) return warn("Sem .gstack/integrations.json aqui. Rode dentro de um projeto criado pelo gstack.")
  const suggested = reg.printingPress?.suggested || []
  if (suggested.length === 0) info("  (nenhuma sugestao)")
  else suggested.forEach((s) => info(`  • ${s}`))
  info("")
  info(routingLine(reg))
}

const catalogLine = (e) =>
  `  • ${e.name} [${e.origin}] risco=${e.risk} · install: ${e.installCommand || "(local)"}${e.mcpCompanion ? " · MCP companion (opt-in)" : ""}`
function handleCatalog({ args, opts }) {
  // Catálogo local ANOTADO (origem/risco/enforcement/comando), offline, JSON puro.
  const entries = buildToolCatalog([...LOCAL_CATALOG, ...tryRemoteCatalog(opts)])
  if (args.includes("--json")) return emitTools({ catalog: entries })
  section("tools catalog — catálogo com segurança (nada é instalado)")
  for (const e of entries) info(catalogLine(e))
}

function listSearchResult(sub, args, opts) {
  try { return { result: sub === "list" ? ppList(opts) : ppSearch(args[1], opts) } }
  catch (e) {
    if (e instanceof PrintingPressError) return { err: e.message }
    throw e
  }
}
function renderListSearch(sub, result) {
  section(`tools — ${sub === "list" ? "catalogo Printing Press" : "busca"}`)
  if (!result.available) {
    warn(`Catalogo indisponivel (${result.error}). Verifique a rede ou tente novamente.`)
    return info("Discovery e best-effort e nao altera nenhuma configuracao.")
  }
  if (result.items.length === 0) info("  (nenhum resultado)")
  else printItems(result.items)
}
function handleListSearch({ sub, args, opts }) {
  const json = args.includes("--json")
  const { result, err } = listSearchResult(sub, args, opts)
  if (err) { if (json) return emitTools({ error: err }); return error(err) }
  if (json) {
    const items = (result.available ? result.items : []).map((it) => annotateCatalogEntry({ ...it, origin: "remote" }))
    return emitTools({ available: !!result.available, error: result.error || null, items })
  }
  renderListSearch(sub, result)
}

const installedLine = (t) => `  • ${t.name} [${t.status}]${t.cli ? " → " + t.cli : ""}`
function handleInstalled({ cwd }) {
  section("tools — instaladas neste projeto")
  const installed = readRegistry(cwd)?.printingPress?.installed || []
  if (installed.length === 0) info("  (nenhuma ferramenta instalada)")
  else installed.forEach((t) => info(installedLine(t)))
}

/** Grava no registry o resultado de um install bem-sucedido. */
function applyInstallSuccess(cwd, reg, slug, result) {
  reg.printingPress.enabled = true
  reg.printingPress.discoveryInstalled = true
  reg.printingPress.installed = [
    ...(reg.printingPress.installed || []).filter((t) => t.name !== slug),
    result,
  ]
  writeRegistry(cwd, reg)
  success(`${slug} instalado (${result.cli}). Registry atualizado.`)
  info("Nenhuma credencial pedida. Se a ferramenta precisar de auth, veja `tools doctor`.")
}
function renderInstallResult(cwd, reg, slug, result) {
  if (result.status === "installed") return applyInstallSuccess(cwd, reg, slug, result)
  if (result.status === "needs_go") return warn(result.error)
  error(`Falha ao instalar ${slug}: ${result.error || result.status}`)
}
async function handleInstall({ args, opts, cwd }) {
  const slug = args[1]
  section(`tools — install ${slug || ""}`)
  const reg = readRegistry(cwd)
  if (!reg) return warn("Sem .gstack/integrations.json aqui. Rode dentro de um projeto gstack.")
  // Fonte remota nunca instala por default: exige confirmação (ou --yes).
  if (!(await confirmRemoteInstall(slug, opts, args))) {
    recordToolProvenance(cwd, { slug, origin: "remote", decision: "skip", risk: "medium" })
    info("Instalação cancelada — nada foi baixado.")
    return { status: "declined", slug }
  }
  const result = installTool(slug, opts)
  recordToolProvenance(cwd, { slug, origin: "remote", decision: result.status === "installed" ? "install" : "skip", risk: "medium" })
  renderInstallResult(cwd, reg, slug, result)
}

/** Sucesso de uninstall: só esquece do registry quando a remoção REAL deu certo. */
function forgetUninstalled(cwd, reg, slug) {
  if (reg?.printingPress) {
    reg.printingPress.installed = reg.printingPress.installed.filter((t) => t.name !== slug)
    reg.printingPress.mcp = (reg.printingPress.mcp || []).filter((m) => m !== `pp-${slug}`)
    writeRegistry(cwd, reg)
  }
  success(`${slug} removido e registry limpo.`)
}
/** Falha de uninstall: NÃO remove do registry — marca uninstall_failed. */
function markUninstallFailed(cwd, reg, slug, result) {
  const entry = reg?.printingPress?.installed?.find((t) => t.name === slug)
  if (entry) { entry.status = "uninstall_failed"; writeRegistry(cwd, reg) }
  warn(`uninstall ${slug}: ${result.error || result.status} — entrada mantida (marcada uninstall_failed)`)
}
function handleUninstall({ args, opts, cwd }) {
  const slug = args[1]
  section(`tools — uninstall ${slug || ""}`)
  const reg = readRegistry(cwd)
  const result = uninstallTool(slug, opts)
  if (result.status === "uninstalled") forgetUninstalled(cwd, reg, slug)
  else markUninstallFailed(cwd, reg, slug, result)
}

function mcpInventory({ args, opts, cwd }) {
  // inventory ANTES do banner: `--json` exige stdout puro (contrato de automação).
  const inv = buildMcpInventory({ cwd, home: opts.home })
  if (args.includes("--json")) { emitTools(inv); return inv }
  section("tools mcp inventory — servidores MCP por harness")
  renderInventoryHuman(inv, { fragmentedOnly: args.includes("--fragmented"), print: (s) => info(s) })
  return inv
}
function mcpList(cwd) {
  const servers = listMcp(cwd)
  if (servers.length === 0) info("  (nenhum MCP pp-* habilitado neste projeto)")
  else servers.forEach((s) => info(`  • ${s}`))
}
/** Reflete no registry o MCP recém-habilitado (usuário vence em conflito). */
function recordMcpEnabled(cwd, name) {
  const reg = readRegistry(cwd)
  if (reg?.printingPress) {
    reg.printingPress.mcp = [...new Set([...(reg.printingPress.mcp || []), name])]
    writeRegistry(cwd, reg)
  }
}
function renderMcpEnable(cwd, tool, r) {
  if (r.status === "not_installed") return warn(`${tool} nao esta instalada. ${r.hint}`)
  if (r.status === "missing_binary") return error(`MCP nao habilitado: ${r.hint}`)
  if (r.status === "enabled") { success(`MCP ${r.name} habilitado no .mcp.json do projeto.`); return recordMcpEnabled(cwd, r.name) }
  if (r.status === "exists") return warn(`${r.name} ja existe — preservado (usuario vence).`)
  error(`tool invalida: ${tool}`)
}
function mcpEnable(cwd, tool, opts) {
  const installedNames = (readRegistry(cwd)?.printingPress?.installed || []).map((t) => t.name)
  const r = enableMcp(cwd, tool, { installed: installedNames.includes(tool), exec: opts.exec, skipBinaryCheck: opts.skipBinaryCheck })
  renderMcpEnable(cwd, tool, r)
}
function mcpDisable(cwd, tool) {
  const r = disableMcp(cwd, tool)
  if (r.status !== "disabled") return r.status === "not_found" ? warn(`${r.name} nao encontrado.`) : error(`tool invalida: ${tool}`)
  success(`MCP ${r.name} removido do projeto.`)
  const reg = readRegistry(cwd)
  if (reg?.printingPress?.mcp) {
    reg.printingPress.mcp = reg.printingPress.mcp.filter((m) => m !== r.name)
    writeRegistry(cwd, reg)
  }
}
const mcpBanner = (action, tool) => `tools mcp ${action || ""} ${tool || ""}`
function handleMcp(ctx) {
  const { args, opts, cwd } = ctx
  const action = args[1]
  const tool = args[2]
  if (action === "inventory") return mcpInventory(ctx)
  section(mcpBanner(action, tool))
  if (action === "list") return mcpList(cwd)
  if (action === "enable") return mcpEnable(cwd, tool, opts)
  if (action === "disable") return mcpDisable(cwd, tool)
  info("Uso: tools mcp enable|disable|list <tool> · tools mcp inventory [--json] [--fragmented]")
}

function handleEnablePP({ cwd }) {
  const reg = readRegistry(cwd)
  if (!reg) return warn("Sem .gstack/integrations.json aqui.")
  reg.printingPress = reg.printingPress || {}
  reg.printingPress.enabled = true
  reg.printingPress.discoveryInstalled = true
  writeRegistry(cwd, reg)
  success("Printing Press habilitado neste projeto (discovery). Nada foi instalado.")
}

const toolDoctorIcon = (status) => (status === "ok" ? "✓" : status === "warning" ? "⚠" : "✗")
function handleToolsDoctor({ cwd, opts }) {
  section("tools doctor — ferramentas instaladas")
  const reg = readRegistry(cwd)
  if (!reg) return warn("Sem .gstack/integrations.json aqui.")
  const results = doctorAll(reg, opts)
  if (results.length === 0) return info("  (nenhuma ferramenta instalada)")
  for (const r of results) info(`  ${toolDoctorIcon(r.status)} ${r.tool} — binary:${r.binary} version:${r.version} auth:${r.auth} mcp:${r.mcp} [${r.status}]`)
}

const rufloChannelLine = (c) => `   - [${c.default ? "x" : " "}] ${c.id}: ${c.label}${c.safe ? "" : " (sensível)"}`
const rufloHeadLine = (rep) =>
  `  CLI: ${rep.present ? "presente" : "ausente"} · executor · plugin-lite: ${rep.pluginLiteAvailable} · full init: ${rep.fullInitRecommended ? "recomendado" : "NÃO recomendado"}`
function handleRuflo({ args }) {
  // Ruflo (PRD18 Sprint 7): adapter opcional READ-ONLY. Nunca instala; canais opt-in.
  const rep = buildRufloReport()
  if (args.includes("--json")) return emitTools(rep)
  section("tools ruflo — adapter opcional (read-only, nada é instalado)")
  info(rufloHeadLine(rep))
  info("  canais (você escolhe ao ativar):")
  for (const c of rep.channels) info(rufloChannelLine(c))
  warn(`  MCP default-deny · negadas: ${rep.mcpPolicy.deny.join(", ")}`)
}

function handleGenerate() {
  // O gerador cli-printing-press ainda nao foi publicado. Stub honesto: orienta.
  section("tools generate — geracao via HAR (cauda-longa)")
  warn("Gerador indisponivel: o pacote cli-printing-press ainda nao foi publicado.")
  info("Quando disponivel, este comando forjara CLI+MCP de sistemas sem API a partir de capturas HAR.")
  info("Por ora, use o catalogo: gstack_vibehard tools list / search / install")
}

function handleToolsHelp() {
  section("tools — integracoes (Composio nuvem + Printing Press local)")
  info("  Descoberta:")
  info("    tools suggested               Sugeridas para este projeto")
  info("    tools list                    Catalogo Printing Press")
  info("    tools search <termo>          Buscar no catalogo")
  info("    tools enable-printing-press   Habilitar discovery no projeto")
  info("  Instalacao (opt-in):")
  info("    tools install <tool>          Instalar (instala Go sob demanda se faltar)")
  info("    tools uninstall <tool>        Remover")
  info("    tools installed               Listar instaladas")
  info("  MCP (project-scoped):")
  info("    tools mcp enable <tool>       Registrar pp-<tool> no .mcp.json do projeto")
  info("    tools mcp disable <tool>      Remover o pp-<tool>")
  info("    tools mcp list                Listar MCPs pp-* do projeto")
  info("    tools mcp inventory [--json] [--fragmented]  Inventario MCP por harness (read-only, secrets redigidos)")
  info("  Agent Reach (leitura/pesquisa na internet, opt-in):")
  info("    tools agent-reach enable [--core|--channels a,b|--dry-run|--safe]  Seletor de canais com consentimento")
  info("    tools agent-reach channels|doctor [--json]   Catalogo e estado por canal")
  info("  Qualidade:")
  info("    tools readiness [--json] [--write] [--clean-machine]  Estado REAL das ferramentas (Fallow/Graphify/Headroom/context)")
  info("    tools clean-machine [--json] [--no-write] [--keep]    Proof pack offline: OpenCode sacred, backup/restore byte-for-byte, matriz de tools")
  info("    tools doctor                  Validar binario/auth/MCP das instaladas")
  info("    tools generate                Gerar CLI de cauda-longa via HAR (em breve)")
  info("")
  info("  Leitura de alta frequencia → Printing Press (CLI local + SQLite)")
  info("  Escrita / OAuth / apps padrao → Composio (nuvem)")
}

const readyIcon = (s) => (s === "routed" || s === "callable" ? "✓" : s === "callable_not_routed" ? "▲" : s === "missing" ? "–" : "⚠")
const freshnessNote = (f) => (f ? ` · graph ${f.state}${f.state === "stale" ? ` (built ${String(f.builtAtCommit || "?").slice(0, 7)} ≠ HEAD ${String(f.head || "?").slice(0, 7)})` : ""}` : "")
function renderReadinessTool(name, t) {
  info(`  ${readyIcon(t.status)} ${name}: ${t.status}${freshnessNote(t.freshness)}`)
  if (t.exitCode !== null && t.exitCode !== 0 && t.stderr) info(`      exit ${t.exitCode} · ${t.stderr}`)
}
function renderReadiness(report) {
  section(`tools readiness — estado real (read-only${report.cleanMachine ? ", clean-machine" : ""})`)
  const e = report.env
  info(`  OS ${e.os} · Node ${e.node || "?"} · npm ${e.npm || "?"} · Python ${e.python || "?"} · PATH ${e.pathSummary.entries} entradas`)
  for (const [name, t] of Object.entries(report.tools)) renderReadinessTool(name, t)
  const h = report.harnessDiscovery
  info(`  Harness discovery (instrucional): codex=${h.codex.present} claude=${h.claude.present} opencode=${h.opencode.present}`)
  info("  Read-only: nada foi escrito (use --write para gerar .gstack/tool-readiness.json).")
}
// `--write` só grava o registry PROJECT-SCOPED (.gstack/); nunca toca global/.env.
// Silencioso (retorna o path) — o log fica no modo humano, p/ não sujar o --json.
function writeReadiness(cwd, report) {
  const dir = join(cwd, ".gstack")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "tool-readiness.json")
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n")
  return path
}
function handleReadiness({ args, opts, cwd }) {
  const report = buildReadiness({ cwd, home: opts.home, probe: opts.probe, git: opts.git, now: opts.now, cleanMachine: args.includes("--clean-machine") })
  const wrote = args.includes("--write") ? writeReadiness(cwd, report) : null
  if (args.includes("--json")) return emitTools(wrote ? { ...report, writtenTo: wrote } : report)
  renderReadiness(report)
  if (wrote) success(`tool-readiness.json gerado em ${wrote} (project-scoped).`)
  return report
}

const cmIcon = (ok) => (ok ? "✓" : "✗")
function renderCleanMachine(rep) {
  section(`tools clean-machine — proof pack (${rep.passed}/${rep.total} cenários)`)
  for (const s of rep.scenarios) {
    info(`  ${cmIcon(s.ok)} ${s.id}: ${s.title}`)
    for (const c of s.checks.filter((x) => !x.ok)) warn(`      falhou: ${c.name}${c.detail ? " — " + c.detail : ""}`)
  }
  if (rep.writtenTo) success(`Artefatos gravados em ${rep.writtenTo}`)
  if (rep.ok) success("Clean-machine: todas as invariantes provadas offline.")
  else error("Clean-machine: há invariantes NÃO provadas — não publicar.")
}
// Proof pack offline (PRD20 20.5): homes-fixture isoladas, nunca ~ real; artefatos
// project-scoped em .gstack/reports/clean-machine/<runId>/ com --write (default on).
function handleCleanMachine({ args, cwd }) {
  const write = !args.includes("--no-write")
  const reportsDir = join(cwd, ".gstack", "reports", "clean-machine")
  const rep = runCleanMachine({ reportsDir, write, keep: args.includes("--keep") })
  if (args.includes("--json")) return emitTools(rep)
  renderCleanMachine(rep)
  return rep
}

const TOOLS_HANDLERS = {
  suggested: handleSuggested,
  readiness: handleReadiness,
  "clean-machine": handleCleanMachine,
  catalog: handleCatalog,
  list: handleListSearch,
  search: handleListSearch,
  installed: handleInstalled,
  install: handleInstall,
  uninstall: handleUninstall,
  // Agent Reach controla o próprio output (--json puro); sem section() antes.
  "agent-reach": ({ args, opts, cwd }) => agentReachCommand(args.slice(1), { ...opts, cwd }),
  mcp: handleMcp,
  "enable-printing-press": handleEnablePP,
  doctor: handleToolsDoctor,
  ruflo: handleRuflo,
  generate: handleGenerate,
}

export async function toolsCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const ctx = { args, opts, cwd, sub: args[0] }
  const handler = TOOLS_HANDLERS[ctx.sub]
  if (handler) return handler(ctx)
  return handleToolsHelp()
}
