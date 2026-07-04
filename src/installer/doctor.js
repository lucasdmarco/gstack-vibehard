import { existsSync, readdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execFileSync, execFile } from "child_process"
import { getHarness, isWindows, isMacOS, getOSLabel } from "../harness/detector.js"
import { checkAlreadyInstalled } from "./check.js"
import { npxArgv } from "./deps.js"
import { detectHarnesses } from "../harness/detector.js"
import { inspectOpenCodeConfig } from "../harness/opencode-config.js"
import { checkInstallIntegrity } from "./integrity.js"
import { repairManifest } from "./repair-manifest.js"
import { resolvePackageManager } from "./package-manager.js"
import { npmArgv } from "./deps.js"
import { buildInstallImpact } from "./impact.js"
import { buildSupplyChainReport } from "./supply-chain.js"
import { planOpenCodeFix, applyOpenCodeFix, diagnoseOpenCode } from "./opencode-jsonc.js"
import { buildOpenCodeDoctorV2 } from "../harness/opencode-doctor.js"
import { buildConformanceReport } from "../harness/conformance.js"
import { buildCandidateReport } from "../harness/candidates.js"
import { buildRufloReport } from "../harness/ruflo.js"
import { section, success, warn, error, info, confirm } from "../cli/index.js"

const HOME = homedir()

// readdir EPERM/EACCES-safe: null = não deu p/ ler (permissão/ausente), nunca crash.
function safeReaddir(dir) { try { return readdirSync(dir) } catch { return null } }
function toolVer(cmd, args = ["--version"]) {
  try { return String(execFileSync(cmd, args, { encoding: "utf-8", stdio: "pipe", timeout: 4000 })).trim() } catch { return null }
}

/** Caminho dos browsers Playwright (env ou default por SO). */
function pwBrowsersPath(home) {
  return process.env.PLAYWRIGHT_BROWSERS_PATH
    || (isWindows() ? join(home, "AppData", "Local", "ms-playwright") : join(home, ".cache", "ms-playwright"))
}
/** true se há chromium instalado; EPERM vira warning (nunca crash). */
function detectChromium(pwBrowsers, warnings) {
  if (!existsSync(pwBrowsers)) return false
  const b = safeReaddir(pwBrowsers)
  if (b === null) { warnings.push(`Playwright: sem permissão p/ ler ${pwBrowsers} (EPERM/EACCES)`); return false }
  return b.some((f) => f.startsWith("chromium"))
}
/** Resumo compacto de conformance de eventos por harness (PRD18 Sprint 3). */
function conformanceSummary() {
  const conf = buildConformanceReport()
  return {
    ok: conf.ok,
    totalViolations: conf.totalViolations,
    harnesses: Object.fromEntries(Object.entries(conf.harnesses).map(([h, r]) => [h, {
      enforcement: r.enforcement,
      enforcedEvents: (r.enforcedEvents || []).length,
      violations: r.violations.length,
    }])),
  }
}

/** Checks obrigatórios OK: Node+Python presentes e (se há manifest) uninstall seguro. */
const requiredOk = (node, python, integrity) =>
  !!node && !!python && (integrity.manifestExists ? integrity.safeToUninstall : true)

/**
 * Coletor estruturado do `doctor` (P0.7) — DETERMINÍSTICO e EPERM-safe. Não imprime
 * nada; retorna o objeto que o `--json` serializa puro. `ok=false` se um check
 * obrigatório falhar (Node/Python ausente, ou manifest com problema).
 */
export async function collectDoctorJson(home = HOME) {
  const warnings = []
  const node = toolVer("node")
  const python = toolVer("python") || toolVer("python3")
  const detected = detectHarnesses().map((h) => ({ id: h.id, label: h.label }))
  const gstackInstalled = checkAlreadyInstalled(detected.map((h) => h.id))
  const hooks = safeReaddir(join(home, ".codex", "hooks"))
  const skills = safeReaddir(join(home, ".agents", "skills"))
  const pwBrowsers = pwBrowsersPath(home)
  const chromium = detectChromium(pwBrowsers, warnings)
  const integrity = checkInstallIntegrity(home)
  const impact = buildInstallImpact({ home })
  const oc = inspectOpenCodeConfig(home)
  return {
    ok: requiredOk(node, python, integrity),
    os: getOSLabel(),
    versions: { node, python },
    harnesses: { detected, gstackInstalled },
    components: {
      hooks: hooks ? hooks.filter((f) => f.endsWith(".py")).length : 0,
      skills: skills ? skills.length : 0,
    },
    mcpGlobal: existsSync(join(home, ".mcp.json")),
    opencode: { hasJson: oc.hasJson, hasJsonc: oc.hasJsonc, hasConflict: oc.hasConflict },
    conformance: conformanceSummary(),
    playwright: { browsersPath: pwBrowsers, chromium },
    deps: { bun: !!toolVer("bun"), rust: !!toolVer("rustc"), gbrain: !!toolVer("gbrain"), graphify: !!toolVer("graphify"), headroom: !!toolVer("headroom") },
    integrity: { manifestExists: integrity.manifestExists, items: integrity.items, drift: integrity.drift, safeToUninstall: integrity.safeToUninstall, issues: integrity.issues },
    impactCategories: impact.map((c) => ({ category: c.category, items: c.items.length })),
    warnings,
  }
}

/** Linha humana de um candidato externo (read-only). */
function printCandidate(c) {
  const stat = c.present ? "presente" : "ausente"
  ;(c.delegateBlocked ? warn : info)(`  • ${c.label} [${c.enforcement}] — ${stat}${c.delegateBlocked ? " · delegate BLOQUEADO" : ""}`)
  info(`      risco: modelos externos=${c.externalModelRisk} · rede=${c.networkRequired} · aceite=${c.requiresAcceptance}`)
  for (const d of c.disclosure) info(`      - ${d}`)
  if (c.delegateBlockReason) warn(`      ${c.delegateBlockReason}`)
}

/** `doctor --candidates` — candidatos externos opt-in. READ-ONLY, nunca instala. */
function candidatesReport(json) {
  const rep = buildCandidateReport()
  if (json) { process.stdout.write(JSON.stringify(rep) + "\n"); return }
  section("doctor --candidates — externos opt-in (read-only, nada é instalado)")
  info(`  shell delegate: ${rep.shell.shell} (${rep.shell.ok ? "ok" : "INDISPONÍVEL"}) · node=${rep.env.node} npm=${rep.env.npm} proxy=${rep.env.proxy}`)
  for (const c of rep.candidates) printCandidate(c)
}

/** `doctor --ruflo` — adapter opcional Ruflo. READ-ONLY, full init nunca automático. */
function rufloReport(json) {
  const rep = buildRufloReport()
  if (json) { process.stdout.write(JSON.stringify(rep) + "\n"); return }
  section("doctor --ruflo — adapter opcional (read-only, full init NÃO automático)")
  info(`  CLI: ${rep.present ? "presente" : "ausente"} · role: ${rep.role} · plugin-lite: ${rep.pluginLiteAvailable} · full init recomendado: ${rep.fullInitRecommended}`)
  info(`  canais (default: ${rep.defaultChannels.join(", ") || "—"}):`)
  for (const c of rep.channels) info(`   - ${c.id}: ${c.label}${c.safe ? "" : " [sensível — opt-in]"}`)
  info(`  MCP: default=${rep.mcpPolicy.default} · allow=${rep.mcpPolicy.allow.join(",")}`)
  warn(`  MCP negadas por default: ${rep.mcpPolicy.deny.join(", ")}`)
}

// ── Rotas do doctor (cada flag → um handler dedicado; JSON puro preservado) ──────

/** Emite JSON puro no stdout; `fail=true` marca exit≠0 (usado pelos modos --strict). */
function emitJson(obj, fail) {
  process.stdout.write(JSON.stringify(obj) + "\n")
  if (fail) process.exitCode = 1
}
const orDash = (v) => v || "—"

const sevFn = (r) => (r.violations.length ? error : (r.enforcedEvents || []).length ? success : info)
const enforcedStr = (r) => (r.enforcedEvents || []).join(",") || "nenhum"
const printViolation = (v) => warn(`      ${v.kind}${v.event ? ` (${v.event})` : ""}: ${v.detail}`)
const conformanceMsg = (conf) =>
  conf.ok ? "Sem violações — nenhuma claim falsa de enforcement." : `${conf.totalViolations} violação(ões).`

/** Uma linha de conformance por harness. */
function printConformanceHarness(r, h) {
  const icon = r.violations.length ? "✗" : "•"
  sevFn(r)(`  ${icon} ${h} [${r.enforcement}]: enforced=${enforcedStr(r)}`)
  for (const v of r.violations) printViolation(v)
}

/** `doctor --conformance [--json]` (PRD18 S3): eventos por harness + violações. */
function conformanceRoute(json, strict) {
  const conf = buildConformanceReport()
  if (json) return emitJson(conf, strict && !conf.ok)
  section("doctor --conformance — eventos por harness (contrato honesto)")
  for (const [h, r] of Object.entries(conf.harnesses)) printConformanceHarness(r, h)
  ;(conf.ok ? success : error)(conformanceMsg(conf))
}

const catFn = (s) => (s === "error" ? error : s === "warn" ? warn : s === "unknown" ? info : success)
/** Uma linha de categoria do doctor v2 (o helper de cor já prefixa o ícone). */
function printCategory(name, c) {
  catFn(c.status)(`  ${name}: ${c.status}`)
}
/** Corpo humano do `doctor --opencode` (schema v2). */
function renderOpencodeDiagV2(rep) {
  section("doctor --opencode v2 — diagnóstico (read-only, config sagrada preservada)")
  for (const [name, c] of Object.entries(rep.categories)) printCategory(name, c)
  const cfg = rep.categories.config
  info(`  autoridade da config: ${cfg.authority}${cfg.hasJsonc ? " · jsonc é fonte de verdade" : ""}`)
  if (cfg.sensitiveKeys.length) info(`  chaves sensíveis no jsonc (só nomes): ${cfg.sensitiveKeys.join(", ")}`)
  for (const a of rep.recommendedActions) info(`  ação: ${a.id}${a.requiresFlag ? ` (use ${a.requiresFlag})` : " (não automática)"}`)
  info(`  enforcement: ${rep.enforcement} · estratégia: ${rep.strategy}`)
}
/** `doctor --opencode [--json] [--strict]` (PRD24 24.1): diagnóstico READ-ONLY v2. */
function opencodeDiagRoute(json, strict) {
  const rep = buildOpenCodeDoctorV2({ home: HOME, strict })
  process.exitCode = rep.exitCode // 0 ok · 1 error · 2 warn (JSON.exitCode == process.exitCode)
  if (json) return process.stdout.write(JSON.stringify(rep) + "\n")
  renderOpencodeDiagV2(rep)
}

/** confirmação de aplicação: --yes/--apply ou prompt TTY. */
async function confirmApply(args, question) {
  return args.includes("--yes") || args.includes("--apply") || (process.stdin.isTTY && await confirm(question, false))
}
const mergeUserKeys = (plan) => (plan.userKeysPreserved || []).join(", ") || "—"
const applyReason = (r) => r.reason || r.hint || "ação não elegível"

/** Rollback de .jsonc.gstack-disabled deixado por versões anteriores. */
async function restoreJsoncRoute(args) {
  const diag = diagnoseOpenCode(HOME)
  if (!diag.disabledResidue) return success("OpenCode: nenhum .jsonc.gstack-disabled para restaurar.")
  info(`  Vai restaurar ${diag.disabledResidue} → ${diag.jsoncPath} (o .jsonc ativo, se houver, é feito backup).`)
  if (!(await confirmApply(args, "Restaurar o opencode.jsonc agora?"))) return info("Cancelado (use --apply/--yes em modo não-interativo).")
  const r = applyOpenCodeFix(HOME, { restoreJsonc: true })
  if (r.restored) success(`OpenCode: ${r.jsoncPath} restaurado. Reabra o OpenCode e confira provider/OAuth.`)
  else warn(`Não restaurado: ${r.reason}`)
}
/** action === "preserve": .jsonc é fonte de verdade — nada é consolidado. */
function fixPreserve(plan) {
  warn("Conflito: opencode.json + opencode.jsonc coexistem, MAS o .jsonc é fonte de verdade.")
  warn(`  O .jsonc contém: ${plan.sensitiveKeys.join(", ")} (OAuth/provider/model/plugin).`)
  info("  Config is sacred: o GStack NÃO vai consolidar nem renomear o .jsonc.")
  info(`  Se quiser remover o shadowing, mova você mesmo ${plan.jsonPath} (com o OpenCode fechado).`)
}
/** action === "merge": jsonc SEM chaves sensíveis — merge preservando o do usuário. */
async function fixMerge(plan, args) {
  info("Conflito: opencode.json + opencode.jsonc coexistem (jsonc sem chaves sensíveis).")
  info(`  Plano: merge preservando o que é do usuário (${mergeUserKeys(plan)}).`)
  info(`  → escreveria o merge em ${plan.jsonPath}; renomearia o .jsonc para .gstack-disabled (reversível).`)
  if (!args.includes("--apply")) return info("(dry-run é o default: nada foi alterado. Use --apply para consolidar.)")
  if (!(await confirmApply(args, "Aplicar o merge agora?"))) return info("Cancelado (use --yes em modo não-interativo).")
  const r = applyOpenCodeFix(HOME, { apply: true })
  if (r.applied) return success("OpenCode: merge aplicado. Reverta com `doctor --fix opencode --restore-jsonc` se precisar.")
  warn(`Não aplicado (${applyReason(r)}).`)
}
/** `doctor --fix` — correção assistida do drift OpenCode. DRY-RUN é o default. */
async function fixRoute(args) {
  section("doctor --fix — OpenCode config (config is sacred)")
  if (args.includes("--restore-jsonc")) return restoreJsoncRoute(args)
  const plan = planOpenCodeFix(HOME)
  if (plan.action === "none") return success("OpenCode: sem conflito json+jsonc — nada a corrigir.")
  if (plan.action === "manual") { warn("Conflito detectado, mas o parse automático falhou (ajuste manual):"); warn(`  ${plan.parseError}`); return }
  if (plan.action === "preserve") return fixPreserve(plan)
  return fixMerge(plan, args)
}

const supplyFn = (status) => (status === "ok" ? success : status === "critical" ? error : warn)
const supplyIcon = (status) => (status === "ok" ? "✓" : status === "critical" ? "✗" : "⚠")
const printSupplyCheck = (c) => supplyFn(c.status)(`  ${supplyIcon(c.status)} ${c.id}: ${c.detail}`)

/** `doctor --supply-chain [--json]` (PRD14 §4.7): cadeia de suprimento, read-only. */
function supplyChainRoute(json, strict) {
  const report = buildSupplyChainReport()
  if (json) return emitJson(report, strict && report.risk === "high")
  section("doctor --supply-chain — cadeia de suprimento")
  for (const c of report.checks) printSupplyCheck(c)
  info("")
  info(`  Fontes oficiais: npm ${report.officialSources.npm} · GitHub ${report.officialSources.github}`)
  ;(report.risk === "none" ? success : warn)(`  Risco agregado: ${report.risk}`)
  if (report.risk === "high") process.exitCode = 1
}

/** Um componente global ativo (impact). */
function printImpactCategory(c) {
  const present = c.items.filter((it) => it.action === "modify")
  if (c.category === "deps") return
  if (present.length === 0) { info(`${c.label}: nenhum instalado`); return }
  const tag = c.category === "mcp-global" || c.category === "harness-config"
    ? " — AFETA QUALQUER PROJETO deste harness/usuário" : ""
  warn(`${c.label}: ${present.length} ativo(s)${tag}`)
  for (const it of present) info(`  • ${it.path}`)
}
/** `doctor --impact [--json]`: componentes GLOBAIS ativos nesta máquina. */
function impactRoute(json) {
  if (json) { process.stdout.write(JSON.stringify(buildInstallImpact({ home: HOME })) + "\n"); return }
  section("doctor --impact — componentes globais ativos")
  for (const c of buildInstallImpact({ home: HOME })) printImpactCategory(c)
  const ocPlugins = join(HOME, ".config", "opencode", "plugins")
  info("")
  info(existsSync(ocPlugins)
    ? "OpenCode plugins globais ATIVOS: carregam em qualquer sessão OpenCode deste usuário."
    : "OpenCode plugins globais: nenhum.")
  info("")
  info("Output Guard: pós-resposta (auditoria via hooks) — detecção, não prevenção.")
  info("  Redação EM TRÂNSITO (opt-in): `gstack_vibehard proxy` · estado: `gstack_vibehard proxy status`.")
  info("Rollback: `gstack_vibehard uninstall --dry-run` · Integridade: `--install-integrity`.")
}

/** instala o pnpm ausente (opt-in) quando `--fix` e o PM é pnpm sem binário. */
async function pmFix(r, args) {
  if (r.state === "missing_binary" && r.pm === "pnpm") {
    if (!(await confirmApply(args, "Instalar o pnpm agora (`npm install -g pnpm`)?"))) return info("Cancelado (use --yes em modo não-interativo).")
    try {
      const { file, argv } = npmArgv(["install", "-g", "pnpm"])
      execFileSync(file, argv, { stdio: "inherit", timeout: 120000 })
      success("pnpm instalado. Rode `doctor --package-manager` de novo p/ confirmar.")
    } catch (e) { warn(`Falha ao instalar pnpm: ${e.message}. Manual: npm install -g pnpm`) }
    return
  }
  info("  (--fix não aplica reparo destrutivo automaticamente: lockfile/node_modules exigem sua confirmação manual — siga o passo acima.)")
}
/** `doctor --package-manager|--pm [--json] [--fix]` (PRD12 PR2). */
async function pmRoute(args, json, strict) {
  const r = resolvePackageManager(process.cwd())
  if (json) return emitJson(r, strict && r.state !== "ok")
  section("doctor --package-manager — resolver do gerenciador do projeto")
  info(`  ${r.state === "ok" ? "✓" : "⚠"} PM: ${r.pm} · estado: ${r.state}`)
  info(`    ${r.detail}`)
  if (r.state === "ok") return success("Package manager OK.")
  warn(`  Reparo: ${r.repair}`)
  if (args.includes("--fix")) return pmFix(r, args)
}

/** uma ação do plano de reparo do manifest. */
function repairActionTag(action) {
  if (action === "prune") return "PODAR"
  if (action === "mark-unrestorable") return "MARCAR não-restaurável"
  if (action === "migrate") return "MIGRAR schema"
  return "RELATAR"
}
const repairStrictFail = (r) => r.manifestExists && r.mutating > 0 && !r.applied
/** Corpo humano do `doctor --repair-manifest`. */
function renderRepair(r, apply) {
  section("doctor --repair-manifest — limpeza/migração segura do manifest")
  if (!r.manifestExists) return warn(r.note)
  if (r.plan.length === 0) return success("Manifest íntegro — nada a reparar.")
  info(`${r.plan.length} item(ns) no plano (${r.mutating} mutação(ões); restante é só relato):`)
  for (const a of r.plan) info(`  • [${repairActionTag(a.action)}] ${a.path} — ${a.reason}`)
  info("Backups do usuário são SEMPRE preservados (nunca apagados).")
  if (!apply) return info("(--dry-run: nada foi alterado) — para aplicar: `gstack_vibehard doctor --repair-manifest --yes`")
  if (r.applied) success(`Manifest reparado (${r.before.items} → ${r.after.items} itens). Backup do manifest: ${orDash(r.backup)}`)
  else info("Nada a aplicar (apenas relatos).")
}
/** `doctor --repair-manifest [--json] [--yes]`: limpeza/migração segura do manifest. */
function repairRoute(args, json, strict) {
  const apply = args.includes("--yes") && !args.includes("--dry-run")
  const r = repairManifest(HOME, { dryRun: !apply })
  if (json) return emitJson(r, strict && repairStrictFail(r))
  renderRepair(r, apply)
}

const integrityStrictFail = (r) => r.manifestExists && !r.safeToUninstall
/** `doctor --install-integrity [--json]`: manifest/backups/hashes + uninstall seguro. */
function integrityRoute(json, strict) {
  const r = checkInstallIntegrity(HOME)
  if (json) return emitJson(r, strict && integrityStrictFail(r))
  section("Integridade da Instalacao (manifest/backups/hashes)")
  if (!r.manifestExists) return warn("Manifest ausente — nada a verificar (instale com `gstack_vibehard install`).")
  success(`Manifest presente — ${r.items} item(ns) registrados`)
  info(`Backups OK: ${r.backupsOk}`)
  if (r.drift > 0) warn(`Drift: ${r.drift} arquivo(s) alterado(s) desde a instalacao (editado por voce/outro)`)
  if (r.issues.length === 0) return success("Sem problemas — uninstall seria SEGURO")
  error(`${r.issues.length} problema(s):`)
  r.issues.forEach((i) => warn(`  ${i}`))
  warn("Rode `gstack_vibehard uninstall --dry-run` para ver o plano de rollback.")
}

/** `doctor --json` completo (diagnóstico estruturado, JSON puro). */
async function fullJsonRoute(strict) {
  const report = await collectDoctorJson(HOME)
  emitJson(report, strict && !report.ok)
}

// Flags que têm seu PRÓPRIO --json abaixo → o --json completo não deve capturá-las.
const SPECIALIZED_FLAGS = ["--impact", "--install-integrity", "--fix", "--repair-manifest", "--package-manager", "--pm", "--supply-chain"]
function hasSpecializedFlag(args) { return SPECIALIZED_FLAGS.some((f) => args.includes(f)) }

// Ordem PRESERVADA do dispatcher original (precedência entre flags combinadas).
function doctorRoutes() {
  return [
    { match: (a) => a.includes("--conformance"), run: (a, j, s) => conformanceRoute(j, s) },
    { match: (a) => a.includes("--candidates"), run: (a, j) => candidatesReport(j) },
    { match: (a) => a.includes("--ruflo"), run: (a, j) => rufloReport(j) },
    { match: (a) => a.includes("--opencode"), run: (a, j, s) => opencodeDiagRoute(j, s) },
    { match: (a, j) => j && !hasSpecializedFlag(a), run: (a, j, s) => fullJsonRoute(s) },
    { match: (a) => a.includes("--fix"), run: (a) => fixRoute(a) },
    { match: (a) => a.includes("--supply-chain"), run: (a, j, s) => supplyChainRoute(j, s) },
    { match: (a) => a.includes("--impact"), run: (a, j) => impactRoute(j) },
    { match: (a) => a.includes("--package-manager") || a.includes("--pm"), run: (a, j, s) => pmRoute(a, j, s) },
    { match: (a) => a.includes("--repair-manifest"), run: (a, j, s) => repairRoute(a, j, s) },
    { match: (a) => a.includes("--install-integrity"), run: (a, j, s) => integrityRoute(j, s) },
  ]
}

export async function doctor(args = []) {
  const json = args.includes("--json")
  const strict = args.includes("--strict")
  for (const r of doctorRoutes()) if (r.match(args, json)) return r.run(args, json, strict)
  return doctorEnvReport()
}

// ── Relatório humano do ambiente (default, sem flags) ────────────────────────────

/** Node/Python em paralelo. Retorna a versão do Python (usada no check do pytest). */
async function reportVersions() {
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
  return pyVer
}

function reportCodex() {
  const codexConfig = join(HOME, ".codex", "config.toml")
  const codexHooks = join(HOME, ".codex", "hooks")
  if (!existsSync(codexConfig) && !existsSync(codexHooks)) return warn("Codex CLI — nao detectado")
  success("Codex CLI — detectado")
  info(`  Config: ${codexConfig}`)
  info(`  Hooks: ${codexHooks}`)
}
function reportClaude() {
  const claudeSettings = join(HOME, ".claude", "settings.json")
  const claudeMd = join(HOME, "CLAUDE.md")
  if (!existsSync(claudeSettings) && !existsSync(claudeMd)) return warn("Claude Code — nao detectado")
  success("Claude Code — detectado")
  info(`  Settings: ${claudeSettings}`)
  if (existsSync(claudeMd)) info("  CLAUDE.md: presente")
}
function reportOpenCodeConfigPresent(oc) {
  success("OpenCode CLI — detectado")
  if (oc.hasJson) info(`  Config JSON:  ${oc.jsonPath}`)
  if (oc.hasJsonc) info(`  Config JSONC: ${oc.jsoncPath}`)
  if (oc.hasConflict) {
    warn("  Conflito: opencode.json E opencode.jsonc coexistem (config SUA, pre-existente).")
    warn("  Pode sombrear plugins/OAuth do Desktop. O gstack NAO altera esses arquivos.")
    info("  Remedio em 1 comando (com o OpenCode fechado): `gstack_vibehard doctor --fix`")
    info("    → merge assistido preservando OAuth/provider/plugins, com backup de ambos. `--dry-run` mostra o plano.")
  }
  const ocPlugins = join(HOME, ".config", "opencode", "plugins")
  const gstackPlugins = ["gstack-security.js", "gstack-session.js", "gstack-prompt.js"].filter((f) => existsSync(join(ocPlugins, f)))
  if (gstackPlugins.length > 0) success(`  Plugins gstack: ${gstackPlugins.length} (auto-load)`)
  else info("  Plugins gstack: nenhum (rode `gstack_vibehard install`)")
}
function reportOpenCodeHarness() {
  const oc = inspectOpenCodeConfig(HOME)
  if (oc.hasJson || oc.hasJsonc) return reportOpenCodeConfigPresent(oc)
  try {
    const ver = execFileSync("opencode", ["--version"], { encoding: "utf-8", timeout: 3000 }).trim()
    success(`OpenCode CLI — detectado (v${ver}, sem config — integracao por plugins/skills)`)
  } catch { warn("OpenCode CLI — nao detectado") }
}
function harnessLevel(id, instructionFile) {
  if (new Set(["claude", "cursor", "opencode"]).has(id)) return "hooks reais"
  return instructionFile ? "instrucional" : "deteccao apenas"
}
function reportOtherHarnesses(detected) {
  const otherDetected = detected.filter((h) => !["codex", "claude", "opencode"].includes(h.id))
  if (otherDetected.length === 0) return
  info("Outros harnesses detectados:")
  for (const h of otherDetected) info(`  ${h.label} — ${harnessLevel(h.id, h.instructionFile)}`)
}
function reportGstackStatus(detected) {
  const gstackInstalled = checkAlreadyInstalled(detected.map((h) => h.id))
  if (gstackInstalled.length > 0) success(`gstack_vibehard instalado: ${gstackInstalled.join(", ")}`)
  else info("gstack_vibehard: nao instalado em nenhum harness")
}
function reportHarnesses() {
  section("Harnesses Detectados")
  reportCodex()
  reportClaude()
  reportOpenCodeHarness()
  const detected = detectHarnesses()
  reportOtherHarnesses(detected)
  reportGstackStatus(detected)
}

/** Conta entradas de um diretório com um filtro; null se ausente/ilegível. */
function countDir(dir, filter) {
  if (!existsSync(dir)) return null
  return (safeReaddir(dir) || []).filter(filter)
}
function reportHooks() {
  const files = countDir(join(HOME, ".codex", "hooks"), (f) => f.endsWith(".py"))
  if (!files) return warn("Nenhum hook gstack_vibehard instalado")
  success(`${files.length} hooks Python instalados`)
  info(`  ${files.join(", ")}`)
}
function reportSkills() {
  const skills = countDir(join(HOME, ".agents", "skills"), (f) => f !== "." && f !== "..")
  if (!skills) return warn("Nenhuma skill gstack_vibehard instalada")
  success(`${skills.length} skills instaladas`)
}
function reportChronicle() {
  const primary = join(HOME, ".gstack", "chronicle")
  const dir = existsSync(primary) ? primary : join(HOME, ".codex", "chronicle")
  const sessions = countDir(dir, (f) => f.endsWith(".md"))
  if (!sessions) return info("Chronicle: nenhuma sessao (primeira sessao cria)")
  success(`Chronicle: ${sessions.length} sessoes registradas`)
}
function reportScripts() {
  const scripts = countDir(join(HOME, ".agents", "scripts"), (f) => f.endsWith(".ps1"))
  if (!scripts) return info("Setup scripts: nao instalados")
  success(`${scripts.length} setup scripts em ~/.agents/scripts/`)
}
function reportComponents() {
  section("Componentes gstack_vibehard")
  reportHooks()
  reportSkills()
  reportChronicle()
  reportScripts()
}

function reportMcp() {
  section("MCP Servers")
  if (existsSync(join(HOME, ".mcp.json"))) success(".mcp.json presente")
  else info(".mcp.json: nao configurado")
}

function reportComposio() {
  const composioEnv = process.env.COMPOSIO_API_KEY || process.env.COMPOSIO_TOKEN
  let cli = false
  try { execFileSync("composio", ["--version"], { stdio: "pipe", timeout: 3000 }); cli = true } catch { /* opcional */ }
  if (composioEnv) success("Composio (nuvem): token presente — escrita/OAuth disponivel")
  else if (cli) info("Composio (nuvem): CLI presente, sem token (rode `composio login`)")
  else info("Composio (nuvem): nao configurado (opcional — para acoes de escrita/OAuth)")
}
function reportPrintingPress() {
  let goOk = false
  try { execFileSync("go", ["version"], { stdio: "pipe", timeout: 3000 }); goOk = true } catch { /* opcional */ }
  if (goOk) success("Printing Press (local): Go presente — `tools install` disponivel")
  else info("Printing Press (local): Go ausente — discovery funciona; `tools install` instala Go sob demanda")
  info("Por projeto: veja .gstack/integrations.json e `gstack_vibehard tools`")
}
function reportIntegrations() {
  section("Integracoes (Composio + Printing Press)")
  reportComposio()
  reportPrintingPress()
}

function reportPlaywrightCli() {
  try {
    const pwd = npxArgv(["playwright", "--version"])
    const pwVer = execFileSync(pwd.file, pwd.argv, { encoding: "utf-8", stdio: "pipe", timeout: 10000 }).trim()
    success(`Playwright CLI: ${pwVer}`)
  } catch { warn("Playwright CLI: nao disponivel (rode: npx playwright install chromium)") }
}
function reportPlaywrightBrowsers(pwBrowsers) {
  if (!existsSync(pwBrowsers)) return warn("Playwright: browsers nao instalados. Rode: npx playwright install chromium")
  const entries = safeReaddir(pwBrowsers)
  if (entries === null) return warn(`Playwright: sem permissao p/ ler ${pwBrowsers} (EPERM) — ignorado, sem crash`)
  const browsers = entries.filter((f) => f.startsWith("chromium"))
  if (browsers.length > 0) success(`Playwright: chromium instalado (${browsers.join(", ")})`)
  else warn("Playwright: chromium nao encontrado. Rode: npx playwright install chromium")
}
function reportPlaywright() {
  section("Playwright (browser testing)")
  reportPlaywrightCli()
  reportPlaywrightBrowsers(pwBrowsersPath(HOME))
}

/** Um binário global: sucesso com versão, ou warning + push opcional no faltantes. */
function checkDep(cmd, label, missing, missLabel) {
  try {
    const v = execFileSync(cmd, ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`${label}: ${v}`)
  } catch { warn(`${label}: nao instalado`); if (missLabel) missing.push(missLabel) }
}
function reportMom() {
  if (!isMacOS()) return info("MOM: apenas macOS")
  try { execFileSync("which", ["mom"], { stdio: "pipe", timeout: 5000 }); success("MOM: instalado") }
  catch { warn("MOM: nao instalado") }
}
function reportPytest(pyVer, missing) {
  const pyBin = pyVer && pyVer.toLowerCase().includes("python 3") ? "python" : "python3"
  try { execFileSync(pyBin, ["-m", "pytest", "--version"], { stdio: "pipe", timeout: 5000 }); return success("pytest: instalado") }
  catch { /* tenta python3 abaixo */ }
  try { execFileSync("python3", ["-m", "pytest", "--version"], { stdio: "pipe", timeout: 5000 }); success("pytest: instalado") }
  catch { warn("pytest: nao instalado"); missing.push("pytest") }
}
function reportGlobalDeps(pyVer) {
  section("Dependencias Globais")
  const missing = []
  checkDep("bun", "bun", missing, "bun + gbrain")
  checkDep("gbrain", "gbrain", missing, null)
  checkDep("graphify", "graphify", missing, "graphify")
  checkDep("rustc", "Rust", missing, "Rust")
  checkDep("headroom", "headroom", missing, "headroom")
  reportMom()
  reportPytest(pyVer, missing)
  if (missing.length > 0) {
    section("Acoes Corretivas")
    info(`Dependencias faltando: ${missing.join(", ")}`)
    info("  Rode: gstack_vibehard install")
    info("  O instalador agora instala todas as deps automaticamente.")
  }
}

/** `doctor` (sem flags): diagnóstico humano completo do ambiente. */
async function doctorEnvReport() {
  section("Diagnostico do Ambiente")
  info(`Sistema: ${getOSLabel()}`)
  const pyVer = await reportVersions()
  reportHarnesses()
  reportComponents()
  reportMcp()
  reportIntegrations()
  reportPlaywright()
  reportGlobalDeps(pyVer)
  section("Diagnostico concluido")
}
