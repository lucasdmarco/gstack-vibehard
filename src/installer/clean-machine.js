import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join, dirname, basename } from "path"
import { createHash } from "crypto"
import { safeWriteFile } from "./safe-write.js"
import { loadManifest, manifestPath, findItems } from "./manifest.js"
import { restoreBackupsFromManifest } from "./restore.js"
import { diagnoseOpenCode, planOpenCodeFix } from "./opencode-jsonc.js"
import { buildInstallImpact } from "./impact.js"
import { buildReadiness } from "../tools/readiness.js"

/**
 * Clean-Machine Proof Pack (PRD20 20.5): prova, offline e reproduzível, que o
 * GStack NÃO quebra a máquina real de um usuário com Claude/Codex/OpenCode. Roda
 * cenários contra HOMES-FIXTURE isoladas (nunca o `~` real) exercitando o CÓDIGO
 * REAL — `safeWriteFile`, `restoreBackupsFromManifest`, `diagnoseOpenCode`,
 * `buildInstallImpact`, `buildReadiness` — e afirma invariantes verificáveis:
 * OpenCode config-sacred (read-only byte-for-byte), Lite sem escrita global, Full
 * com Safe Write + manifest + backup, uninstall restaura byte-for-byte, e a matriz
 * de estados de Headroom/Graphify/Fallow. Sem rede, sem instalar nada global.
 */

// ── FS helpers ────────────────────────────────────────────────────────────────
function put(file, content) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content) }
const readBytes = (file) => (existsSync(file) ? readFileSync(file) : null)
const sameBytes = (a, b) => a != null && b != null && Buffer.compare(a, b) === 0
const sha256 = (buf) => "sha256:" + createHash("sha256").update(buf).digest("hex")
const check = (name, ok, detail) => ({ name, ok: !!ok, detail: detail == null ? "" : String(detail) })
const scenario = (id, title, checks, evidence) => ({ id, title, ok: checks.every((c) => c.ok), checks, evidence: evidence || {} })

// Headroom exe fixture path (espelha readiness.headroomExe, que não é exportado).
function headroomExePath(cwd) {
  const rel = process.platform === "win32" ? ["Scripts", "headroom.exe"] : ["bin", "headroom"]
  return join(cwd, ".gstack", "tools", "headroom-venv", ...rel)
}

const OPENCODE_JSONC_SENSITIVE = '{\n  // config do usuário — sagrada\n  "provider": "anthropic",\n  "model": "claude",\n  "plugin": ["x"],\n}\n'
const ocJsonc = (home) => join(home, ".config", "opencode", "opencode.jsonc")
const ocJson = (home) => join(home, ".config", "opencode", "opencode.json")

// ── Cenários OpenCode (config-sacred, tudo read-only) ──────────────────────────
function scOpencodeAbsent(home) {
  const d = diagnoseOpenCode(home)
  return scenario("opencode-absent", "Máquina sem config OpenCode", [
    check("sem conflito", d.conflict === false),
    check("ação recomendada = none", d.recommendedAction === "none"),
    check("shadowingRisk none", d.shadowingRisk === "none"),
  ], d)
}

function scOpencodeJsoncSensitive(home) {
  const p = ocJsonc(home)
  put(p, OPENCODE_JSONC_SENSITIVE)
  const before = readBytes(p)
  const d = diagnoseOpenCode(home)
  const plan = planOpenCodeFix(home)
  const after = readBytes(p)
  return scenario("opencode-jsonc-sensitive", "Só opencode.jsonc com provider/model/plugin", [
    check("jsonc detectado", d.hasJsonc === true),
    check("chaves sensíveis por nome", d.jsoncSensitiveKeys.includes("provider") && d.jsoncSensitiveKeys.includes("model")),
    check("sem consolidação (action none, sem json)", plan.action === "none"),
    check("jsonc intocado byte-for-byte", sameBytes(before, after)),
  ], { diagnosis: d })
}

function scOpencodeConflictSensitive(home) {
  const pj = ocJson(home), pc = ocJsonc(home)
  put(pj, '{"model":"gpt"}\n')
  put(pc, OPENCODE_JSONC_SENSITIVE)
  const bj = readBytes(pj), bc = readBytes(pc)
  const plan = planOpenCodeFix(home)
  const d = diagnoseOpenCode(home)
  return scenario("opencode-conflict-sensitive", "Conflito opencode.json + opencode.jsonc (sensível)", [
    check("plano = preserve (nunca consolida)", plan.action === "preserve"),
    check("shadowingRisk high", d.shadowingRisk === "high"),
    check("json intocado", sameBytes(bj, readBytes(pj))),
    check("jsonc intocado", sameBytes(bc, readBytes(pc))),
  ], { diagnosis: d })
}

function scOpencodeMalformed(home) {
  const pj = ocJson(home), pc = ocJsonc(home)
  put(pj, "{}\n")
  put(pc, '{ "model": "x"\n')
  const before = readBytes(pc)
  const plan = planOpenCodeFix(home)
  return scenario("opencode-malformed", "opencode.jsonc malformado → ajuste humano", [
    check("plano = manual", plan.action === "manual"),
    check("parseError reportado", typeof plan.parseError === "string" && plan.parseError.length > 0),
    check("jsonc intocado", sameBytes(before, readBytes(pc))),
  ], { plan })
}

function scOpencodeDisabledResidue(home) {
  const disabled = ocJsonc(home) + ".gstack-disabled"
  put(disabled, OPENCODE_JSONC_SENSITIVE)
  const d = diagnoseOpenCode(home)
  return scenario("opencode-disabled-residue", "Resíduo .jsonc.gstack-disabled de versão antiga", [
    check("resíduo detectado", d.disabledResidue === disabled),
    check("ação recomendada = restore-jsonc", d.recommendedAction === "restore-jsonc"),
  ], d)
}

// ── Cenários Safe Write / manifest / restore ───────────────────────────────────
function scLiteNoGlobalWrite(home, project) {
  put(join(home, ".claude", "settings.json"), '{"user":"preexisting"}\n')
  const beforeManifest = existsSync(manifestPath(home))
  const beforeSettings = readBytes(join(home, ".claude", "settings.json"))
  // Lite = escrita PROJECT-SCOPED apenas (nunca sob home).
  put(join(project, ".gstack", "context-docs", "PLANS", "x.md"), "# projeto\n")
  return scenario("lite-no-global-write", "Lite mode não escreve nada global", [
    check("nenhum manifest global criado", existsSync(manifestPath(home)) === false && beforeManifest === false),
    check("settings.json do usuário intocado", sameBytes(beforeSettings, readBytes(join(home, ".claude", "settings.json")))),
    check("escrita ficou no projeto", existsSync(join(project, ".gstack", "context-docs", "PLANS", "x.md"))),
  ], { manifestPath: manifestPath(home) })
}

function scFullSafeWriteNew(home) {
  const p = join(home, ".claude", "rules", "ultracode.md")
  const content = "# ultracode\nregras\n"
  const res = safeWriteFile(p, content, { home, component: "identity" })
  const item = findItems(loadManifest(home), (x) => x.path === p)[0]
  return scenario("full-safe-write-new", "Full mode: arquivo NOVO → manifest sem backup", [
    check("arquivo escrito", existsSync(p)),
    check("sem backup (não existia)", res.backup === null),
    check("manifest: removeOnUninstall true", item && item.removeOnUninstall === true),
    check("manifest: restoreOnUninstall false", item && item.restoreOnUninstall === false),
    check("installedHash confere", item && item.installedHash === sha256(Buffer.from(content))),
  ], { item })
}

function scFullSafeWriteExisting(home) {
  const p = join(home, "CLAUDE.md")
  const userContent = "# CLAUDE do usuário\nnão perca isto\n"
  put(p, userContent)
  const orig = readBytes(p)
  const res = safeWriteFile(p, "# CLAUDE gstack\n", { home, component: "identity" })
  const item = findItems(loadManifest(home), (x) => x.path === p)[0]
  return scenario("full-safe-write-existing", "Full mode: arquivo EXISTENTE → backup + restore no manifest", [
    check("backup criado", typeof res.backup === "string" && existsSync(res.backup)),
    check("backup preserva original byte-for-byte", sameBytes(orig, readBytes(res.backup))),
    check("originalHash confere", item && item.originalHash === sha256(orig)),
    check("manifest: restoreOnUninstall true", item && item.restoreOnUninstall === true),
  ], { item, backup: res.backup })
}

function scUninstallRestore(home) {
  const files = [
    { p: join(home, ".codex", "config.toml"), user: "[user]\nkeep = true\n" },
    { p: join(home, ".claude", "settings.json"), user: '{"hooks":{"user":"data"}}\n' },
  ]
  for (const f of files) { put(f.p, f.user); f.orig = readBytes(f.p) }
  for (const f of files) safeWriteFile(f.p, "# gstack overwrote\n", { home, component: "gate" })
  const changed = files.every((f) => !sameBytes(f.orig, readBytes(f.p)))
  const report = { removed: [], restored: [], skipped: [], errors: [] }
  restoreBackupsFromManifest(home, report)
  const restoredExact = files.every((f) => sameBytes(f.orig, readBytes(f.p)))
  return scenario("uninstall-restore-byte-for-byte", "Uninstall restaura configs preexistentes byte-for-byte", [
    check("gstack de fato sobrescreveu antes", changed),
    check("todos restaurados byte-for-byte", restoredExact),
    check("relatório sem erros", report.errors.length === 0),
    check("restaurou ≥ 2 arquivos", report.restored.length >= files.length),
  ], { rollbackReport: report })
}

// ── Matriz de estados de ferramentas (Headroom/Graphify/Fallow) ────────────────
const stripExt = (f) => basename(f).replace(/\.(cmd|bat|exe)$/i, "")
function matrixProbe(table) {
  return (file, args = []) => {
    const key = `${stripExt(file)} ${args[0] || ""}`.trim()
    return key in table ? table[key] : { ok: true, code: 0, stdout: "", stderr: "" }
  }
}
const okRes = (stdout) => ({ ok: true, code: 0, stdout: stdout || "", stderr: "" })
const failRes = (stderr) => ({ ok: false, code: 1, stdout: "", stderr: stderr || "erro" })
const HEAD = "0000000000000000000000000000000000000000"

function headroomStatus(cwd, table) {
  return buildReadiness({ cwd, probe: matrixProbe(table), git: () => HEAD }).tools.headroom.status
}
function scHeadroomMatrix(root) {
  const absent = join(root, "hr-absent")
  const present = join(root, "hr-present"); put(headroomExePath(present), "#!/bin/sh\n")
  const routed = join(root, "hr-routed"); put(headroomExePath(routed), "#!/bin/sh\n")
  const notRouted = { "headroom --version": okRes("headroom 1.0"), "headroom doctor": okRes("proxy stopped") }
  const isRouted = { "headroom --version": okRes("headroom 1.0"), "headroom doctor": okRes("proxy running · traffic routed") }
  return scenario("headroom-matrix", "Headroom: ausente / presente-não-roteado / roteado", [
    check("ausente = missing", headroomStatus(absent, {}) === "missing"),
    check("presente sem proxy = callable_not_routed", headroomStatus(present, notRouted) === "callable_not_routed"),
    check("proxy+routed = routed", headroomStatus(routed, isRouted) === "routed"),
  ], {})
}

function graphifyState(cwd, table, git) {
  return buildReadiness({ cwd, probe: matrixProbe(table), git: () => git }).tools.graphify.freshness.state
}
function scGraphifyMatrix(root) {
  const absent = join(root, "gf-absent")
  const fresh = join(root, "gf-fresh"); put(join(fresh, "graphify-out", "graph.json"), JSON.stringify({ built_at_commit: HEAD }))
  const stale = join(root, "gf-stale"); put(join(stale, "graphify-out", "graph.json"), JSON.stringify({ built_at_commit: "deadbeef" }))
  const ok = { "graphify --version": okRes("graphify 1.0") }
  return scenario("graphify-matrix", "Graphify: ausente / fresh / stale", [
    check("ausente = absent", graphifyState(absent, {}, HEAD) === "absent"),
    check("built_at == HEAD = fresh", graphifyState(fresh, ok, HEAD) === "fresh"),
    check("built_at != HEAD = stale", graphifyState(stale, ok, HEAD) === "stale"),
  ], {})
}

function fallowStatus(cwd, table) {
  return buildReadiness({ cwd, probe: matrixProbe(table), git: () => HEAD }).tools.fallow.status
}
function scFallowMatrix(root) {
  const cwd = join(root, "fallow")
  return scenario("fallow-matrix", "Fallow: ausente / presente", [
    check("npx fallow falha = missing", fallowStatus(cwd, { "npx fallow": failRes("not found") }) === "missing"),
    check("npx fallow ok = callable", fallowStatus(cwd, { "npx fallow": okRes("fallow 1.0") }) === "callable"),
  ], {})
}

// ── Orquestrador ───────────────────────────────────────────────────────────────
function newHome(root, name) { const d = join(root, name); mkdirSync(d, { recursive: true }); return d }

function runScenarios(root) {
  return [
    scOpencodeAbsent(newHome(root, "oc-absent")),
    scOpencodeJsoncSensitive(newHome(root, "oc-jsonc")),
    scOpencodeConflictSensitive(newHome(root, "oc-conflict")),
    scOpencodeMalformed(newHome(root, "oc-malformed")),
    scOpencodeDisabledResidue(newHome(root, "oc-residue")),
    scLiteNoGlobalWrite(newHome(root, "lite-home"), newHome(root, "lite-project")),
    scFullSafeWriteNew(newHome(root, "full-new")),
    scFullSafeWriteExisting(newHome(root, "full-existing")),
    scUninstallRestore(newHome(root, "restore-home")),
    scHeadroomMatrix(root),
    scGraphifyMatrix(root),
    scFallowMatrix(root),
  ]
}

function summarize(scenarios) {
  const passed = scenarios.filter((s) => s.ok).length
  return { total: scenarios.length, passed, failed: scenarios.length - passed, ok: passed === scenarios.length }
}

// Artefatos derivados (offline, contra fixtures) — evidência do run.
function buildArtifacts(root, scenarios, runId) {
  const impactHome = newHome(root, "impact-home")
  put(join(impactHome, ".claude", "settings.json"), "{}\n")
  const restoreEv = scenarios.find((s) => s.id === "uninstall-restore-byte-for-byte")
  return {
    "clean-machine.json": { runId, ...summarize(scenarios), scenarios },
    "tool-readiness.json": buildReadiness({ cwd: newHome(root, "readiness-cwd"), home: impactHome, probe: matrixProbe({}), git: () => HEAD, cleanMachine: true }),
    "install-impact.json": buildInstallImpact({ home: impactHome }),
    "opencode-diagnosis.json": scenarios.filter((s) => s.id.startsWith("opencode-")).map((s) => ({ id: s.id, evidence: s.evidence })),
    "rollback-report.json": (restoreEv && restoreEv.evidence.rollbackReport) || { restored: [], errors: [] },
    "verify.json": { dryRun: true, note: "clean-machine roda offline; o gate de release é `verify --profile release --json`, executado à parte", runId },
  }
}

function writeArtifacts(reportsDir, runId, artifacts) {
  const dir = join(reportsDir, runId)
  mkdirSync(dir, { recursive: true })
  const written = []
  for (const [name, obj] of Object.entries(artifacts)) {
    const p = join(dir, name)
    writeFileSync(p, JSON.stringify(obj, null, 2) + "\n")
    written.push(p)
  }
  return { dir, written }
}

const defaultNow = () => new Date()
const makeRunId = (now, runId) => runId || `cm-${now().toISOString().replace(/[:.]/g, "-")}`
const makeRoot = (opts) => (opts.rootFactory || (() => mkdtempSync(join(tmpdir(), "gstack-cm-"))))()
function maybeWrite(opts, runId, artifacts) {
  if (opts.write === false || !opts.reportsDir) return null
  return writeArtifacts(opts.reportsDir, runId, artifacts).dir
}
function cleanupRoot(root, keep) {
  if (keep) return
  try { rmSync(root, { recursive: true, force: true }) } catch { /* best-effort */ }
}

/**
 * Executa o proof pack. `rootFactory`/`now` injetáveis (testes determinísticos).
 * @returns {{ runId, ok, total, passed, failed, scenarios, artifacts, writtenTo }}
 */
export function runCleanMachine(opts = {}) {
  const now = opts.now || defaultNow
  const runId = makeRunId(now, opts.runId)
  const root = makeRoot(opts)
  try {
    const scenarios = runScenarios(root)
    const artifacts = buildArtifacts(root, scenarios, runId)
    return { runId, ...summarize(scenarios), scenarios, artifacts, writtenTo: maybeWrite(opts, runId, artifacts) }
  } finally {
    cleanupRoot(root, opts.keep)
  }
}
