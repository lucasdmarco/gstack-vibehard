import { mkdirSync, writeFileSync, readFileSync } from "fs"
import { join, basename, isAbsolute } from "path"
import { buildSkillCatalog, skillsDoctor, renderCatalogMarkdown, SKILL_PACKAGE_ROOT } from "../skills/catalog.js"
import { buildGateMatrix, gatesForPhase, renderGateMatrixMarkdown, explainGate } from "../skills/gate-matrix.js"
import { buildHarnessProjection, projectionSummary, renderHarnessProjectionMarkdown, projectGate, KNOWN_HARNESSES } from "../skills/harness-projection.js"
import { buildGateTruth, truthSummary, renderGateTruthMarkdown } from "../skills/gate-truth.js"
import { runDriftDoctor, computeBaseline, defaultBodyIo } from "../skills/drift-doctor.js"
import { auditExternalSkills } from "../skills/external-audit.js"
import { collectMirrorFiles } from "./research.js"
import { buildVendorPlan, renderVendorPlanMarkdown } from "../skills/vendor.js"
import { section, success, warn, error, info } from "../cli/index.js"

/**
 * `gstack_vibehard skills <catalog|doctor>` (PRD29 Sprint 29.0).
 *
 * KNOWLEDGE layer: nunca edita código-fonte. `catalog` grava só os artefatos
 * project-scoped `.gstack/skills/catalog.{json,md}` (mesmo padrão do context
 * index). `--json` = payload puro no stdout, zero banner.
 */

function writeCatalogArtifacts(cwd, catalog) {
  const dir = join(cwd, ".gstack", "skills")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n")
  writeFileSync(join(dir, "catalog.md"), renderCatalogMarkdown(catalog))
  return dir
}

function renderCatalogHuman(catalog, dir) {
  section(`skills catalog — ${catalog.totalSkills} skills (medido, determinístico)`)
  for (const [pack, n] of Object.entries(catalog.byPack)) info(`  • ${pack}: ${n}`)
  if (catalog.missingFrontmatter > 0) warn(`  ⚠ ${catalog.missingFrontmatter} sem frontmatter (veja skills doctor)`)
  success(`Catálogo: ${dir}\\catalog.json (+ catalog.md)`)
}

function catalogCmd(cwd, json) {
  const catalog = buildSkillCatalog()
  const dir = writeCatalogArtifacts(cwd, catalog)
  if (json) { process.stdout.write(JSON.stringify(catalog) + "\n"); return catalog }
  renderCatalogHuman(catalog, dir)
  return catalog
}

const sevIcon = (s) => (s === "problem" ? "✗" : s === "warning" ? "⚠" : "•")
function renderDoctorHuman(report) {
  section(`skills doctor — ${report.totalSkills} skills`)
  if (report.findings.length === 0) { success("Nenhum achado — catálogo saudável."); return }
  for (const f of report.findings) {
    warn(`  ${sevIcon(f.severity)} ${f.id} (${f.severity}): ${f.paths.length} skill(s)`)
    f.paths.slice(0, 3).forEach((p) => info(`      ${p}`))
    if (f.paths.length > 3) info(`      … +${f.paths.length - 3}`)
  }
}

function readBaseline(cwd) {
  try { return JSON.parse(readFileSync(join(cwd, ".gstack", "skills", "baseline.json"), "utf-8")) } catch { return null }
}

function renderSafetyHuman(m) {
  const d = m.drift
  info(`  drift: ${d.hasBaseline ? `${d.drifted.length} alteradas, ${d.added.length} novas, ${d.removed.length} removidas` : "sem baseline (rode 'skills baseline')"}`)
  if (m.stale.length) m.stale.forEach((s) => error(`  ✗ stale: ${s.id} cita comando inexistente: ${s.missingCommands.join(", ")}`))
  else success("  stale: nenhuma skill cita comando inexistente")
  if (m.risk.high.length) warn(`  ⚠ risco alto (destrutivo/rede/secrets): ${m.risk.high.length} skill(s)`)
}

function doctorFailed(merged, report, strict) {
  if (strict) return !merged.ok || report.findings.some((f) => f.severity === "warning")
  return !merged.ok
}

function doctorCmd(cwd, json, strict) {
  const catalog = buildSkillCatalog()
  const report = skillsDoctor(catalog)
  const safety = runDriftDoctor({ catalog, baseline: readBaseline(cwd), io: defaultBodyIo(SKILL_PACKAGE_ROOT), strict })
  const merged = { ...report, ok: report.ok && safety.ok, drift: safety.drift, stale: safety.stale, risk: safety.risk }
  if (json) process.stdout.write(JSON.stringify(merged) + "\n")
  else { renderDoctorHuman(merged); renderSafetyHuman(merged) }
  if (doctorFailed(merged, report, strict)) process.exitCode = 1
  return merged
}

function baselineCmd(cwd, json) {
  const baseline = computeBaseline(buildSkillCatalog())
  const dir = join(cwd, ".gstack", "skills")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "baseline.json"), JSON.stringify(baseline, null, 2) + "\n")
  if (json) { process.stdout.write(JSON.stringify(baseline) + "\n"); return baseline }
  success(`Baseline gravado: ${dir}\\baseline.json (${baseline.totalSkills} skills, hash por skill)`)
  return baseline
}

// ── gates (PRD29 29.1): compila matriz + show por fase ───────────────────────────
function writeGateArtifacts(cwd, matrix) {
  const dir = join(cwd, ".gstack", "skills")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "gate-matrix.json"), JSON.stringify(matrix, null, 2) + "\n")
  writeFileSync(join(dir, "gate-matrix.md"), renderGateMatrixMarkdown(matrix))
}

function renderGatesHuman(matrix, phase, shown) {
  section(`skill gates${phase ? ` — fase ${phase}` : ""} (${shown.length}/${matrix.totalGates})`)
  for (const g of shown) {
    info(`  ${g.mode === "blocking" ? "⛔" : "•"} ${g.id} [${g.severity}] — skills: ${g.skills.join(", ")}`)
    g.preconditions.forEach((p) => info(`      requer: ${p}`))
  }
  for (const w of matrix.warnings) warn(`  ⚠ ${w.gate}: skill desconhecida no catálogo: ${w.skills.join(", ")}`)
  if (!matrix.ok) { matrix.conflicts.forEach((c) => error(`  ✗ CONFLITO em ${c.phase}: ${c.path} — ${c.gates.join(" vs ")}`)); process.exitCode = 1 }
}

// ── gates doctor (PRD36 36.0): 5 estados reais — nunca "12/12" só pela matriz ─────
function writeTruthArtifacts(cwd, truth) {
  const dir = join(cwd, ".gstack", "skills")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "gate-truth.json"), JSON.stringify(truth, null, 2) + "\n")
  writeFileSync(join(dir, "gate-truth.md"), renderGateTruthMarkdown(truth))
}

function renderTruthHuman(truth) {
  const s = truthSummary(truth)
  section(`gate truth — declared ${s.declared} · executed ${s.executed} · proved ${s.proved}`)
  for (const r of truth.rows) {
    const prova = r.provedBy ? (r.provedByBroken ? "QUEBRADA" : "✓") : "—"
    info(`  ${r.gate} (${r.event}) — impl ${r.implementedBy ? "✓" : "—"} · prova ${prova} · claude=${r.byHarness.claude.level}`)
  }
  for (const [h, n] of Object.entries(s.enforcedByHarness)) info(`  ${h}: ${n} enforced de ${s.declared} declarados`)
  for (const g of truth.brokenRefs) error(`  ✗ ${g}: provedBy cita teste inexistente — claim sem evidência`)
  warn("  enforced SÓ com implementação + bloqueio + teste negativo. declared ≠ routed ≠ executed ≠ blocking ≠ proved.")
}

function gatesDoctorCmd(cwd, json) {
  const truth = buildGateTruth({ gates: buildGateMatrix().gates })
  writeTruthArtifacts(cwd, truth)
  if (json) process.stdout.write(JSON.stringify({ ...truth, summary: truthSummary(truth) }) + "\n")
  else renderTruthHuman(truth)
  if (!truth.ok) process.exitCode = 1
  return truth
}

function gatesCmd(cwd, args, json) {
  if (args.filter((a) => !a.startsWith("-"))[1] === "doctor") return gatesDoctorCmd(cwd, json)
  const phaseIdx = args.indexOf("--phase")
  const phase = phaseIdx >= 0 ? args[phaseIdx + 1] : null
  const matrix = buildGateMatrix()
  writeGateArtifacts(cwd, matrix)
  const shown = phase ? gatesForPhase(matrix, phase) : matrix.gates
  if (json) {
    process.stdout.write(JSON.stringify(phase ? { ...matrix, gates: shown, phaseFilter: phase } : matrix) + "\n")
    if (!matrix.ok) process.exitCode = 1
    return matrix
  }
  renderGatesHuman(matrix, phase, shown)
  return matrix
}

// ── harness (PRD29 29.6): projeção honesta de enforcement por harness ────────────
function writeHarnessArtifacts(cwd, projection) {
  const dir = join(cwd, ".gstack", "skills")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "harness-projection.json"), JSON.stringify(projection, null, 2) + "\n")
  writeFileSync(join(dir, "harness-projection.md"), renderHarnessProjectionMarkdown(projection))
}

const levelIcon = (l) => (l === "enforced" ? "🔒" : l === "advisory" ? "📎" : "—")
function renderHarnessHuman(projection) {
  const summary = projectionSummary(projection)
  section(`harness gate projection — enforcement REAL (${projection.harnesses.join(", ")})`)
  for (const h of projection.harnesses) {
    const s = summary[h]
    info(`  ${h}: 🔒 ${s.enforced} enforced · 📎 ${s.advisory} advisory · — ${s.unsupported} unsupported`)
    for (const r of projection.matrix[h]) info(`      ${levelIcon(r.level)} ${r.gate} (${r.event}) → ${r.level}`)
  }
  warn("  'enforced' em PRE-WRITE só onde há hook pre-tool; senão o gate é advisory nesse harness.")
}

function harnessCmd(cwd, args, json) {
  const hIdx = args.indexOf("--harness")
  const only = hIdx >= 0 ? args[hIdx + 1] : null
  const matrix = buildGateMatrix()
  const harnesses = only ? [only] : KNOWN_HARNESSES
  const projection = buildHarnessProjection(matrix.gates, harnesses)
  writeHarnessArtifacts(cwd, projection)
  if (json) { process.stdout.write(JSON.stringify(projection) + "\n"); return projection }
  renderHarnessHuman(projection)
  return projection
}

// ── vendor (PRD29 29.10): vendoring de skills externas (dry-run default) ─────────
const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const safeReadFile = (p) => { try { return readFileSync(p, "utf-8") } catch { return "" } }
const firstLine = (t) => t.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "UNKNOWN"

function detectLicense(dir) {
  for (const f of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    const t = safeReadFile(join(dir, f))
    if (t) return firstLine(t)
  }
  return "UNKNOWN"
}

function loadMappings(file) {
  if (!file) return {}
  try { return JSON.parse(readFileSync(file, "utf-8")) } catch { return {} }
}

function applyVendor(cwd, mirrorDir, plan) {
  for (const e of plan.entries) {
    const targetAbs = join(cwd, e.targetDir)
    mkdirSync(targetAbs, { recursive: true })
    writeFileSync(join(targetAbs, "vendor.json"), JSON.stringify(e.manifest, null, 2) + "\n")
    writeFileSync(join(targetAbs, basename(e.originPath)), safeReadFile(join(mirrorDir, e.originPath)))
  }
}

function vendorApply(cwd, abs, args, plan) {
  const wants = args.includes("--apply")
  if (wants && plan.canApply) { applyVendor(cwd, abs, plan); return true }
  if (wants) error("skills vendor --apply bloqueado: mapeie gate+agente para todas (veja needsMapping)")
  return false
}

function writeVendorPlanArtifact(cwd, plan) {
  const dir = join(cwd, ".gstack", "research")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "vendor-plan.json"), JSON.stringify(plan, null, 2) + "\n")
  writeFileSync(join(dir, "vendor-plan.md"), renderVendorPlanMarkdown(plan))
}

function renderVendorHuman(p) {
  const c = p.counts
  section(`vendoring — ${p.source} (${p.applied ? "APLICADO" : "dry-run"})`)
  info(`  planned ${c.planned} · avoid excluídas ${c.excludedAvoid} · sem mapeamento ${c.needsMapping}`)
  if (p.needsMapping.length) warn(`  ⚠ mapeie gate+agente antes de aplicar: ${p.needsMapping.join(", ")}`)
  if (p.applied) success("  vendado em skills/vendor/ (advisory até ter teste)")
  else info("  nada escrito em skills/ (dry-run; use --apply após mapear tudo)")
}

function vendorImport(cwd, args, json) {
  const dir = flagValue(args, "--path")
  if (!dir) { error("skills vendor import: informe --path <mirror>"); process.exitCode = 1; return null }
  const abs = isAbsolute(dir) ? dir : join(cwd, dir)
  const source = flagValue(args, "--source") || basename(abs)
  const audit = auditExternalSkills({ source, files: collectMirrorFiles(abs) })
  const plan = buildVendorPlan({ audit, source, license: detectLicense(abs), mappings: loadMappings(flagValue(args, "--map")) })
  const applied = vendorApply(cwd, abs, args, plan)
  writeVendorPlanArtifact(cwd, plan)
  const payload = { ...plan, applied }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  renderVendorHuman(payload)
  return payload
}

function vendorCmd(cwd, args, json) {
  const sub = args.filter((a) => !a.startsWith("-"))
  if (sub[1] === "import") return vendorImport(cwd, args, json)
  printUsage()
  return null
}

// ── why (PRD29 29.8): explica um gate (por que existe e como satisfazê-lo) ────────
function gateEnforcement(gate) {
  const out = {}
  for (const h of KNOWN_HARNESSES) out[h] = projectGate(gate, h)
  return out
}

function renderWhyHuman(x) {
  section(`por que: ${x.gate} [${x.severity} · ${x.mode}]`)
  info(`  fase: ${x.phase}`)
  info(`  ${x.why}`)
  info(`  skills que aconselham: ${x.skills.join(", ")}`)
  x.preconditions.forEach((p) => info(`  precondição: ${p}`))
  info(`  como satisfazer: ${x.howToSatisfy}`)
  info(`  se falhar: ${x.fallbackMeaning} · verifier: ${x.verifier}`)
  info(`  enforcement: ${Object.entries(x.enforcement).map(([h, l]) => `${h}=${l}`).join(" · ")}`)
}

function whyCmd(cwd, args, json) {
  const gateId = args.filter((a) => !a.startsWith("-"))[1]
  const gate = buildGateMatrix().gates.find((g) => g.id === gateId)
  if (!gate) { error(`skills why: gate desconhecido: ${gateId || "(vazio)"} — veja 'skills gates show'`); process.exitCode = 1; return null }
  const explanation = { ...explainGate(gate), enforcement: gateEnforcement(gate) }
  if (json) { process.stdout.write(JSON.stringify(explanation) + "\n"); return explanation }
  renderWhyHuman(explanation)
  return explanation
}

function printUsage() {
  section("skills")
  info("  skills catalog [--json]                     inventário determinístico (hash/provenance/fase)")
  info("  skills doctor [--json] [--strict]           saúde do catálogo (frontmatter/duplicatas/risco)")
  info("  skills gates show [--phase <fase>] [--json] matriz de gates por fase (a skill aconselha; o gate decide)")
  info("  skills gates doctor [--json]                verdade dos gates: declared/routed/executed/blocking/proved por harness")
  info("  skills harness [--harness <nome>] [--json]  enforcement REAL por harness (enforced/advisory/unsupported)")
  info("  skills baseline [--json]                    grava hash baseline p/ detecção de drift")
  info("  skills vendor import --path <mirror> [--apply]  vendora skills externas (dry-run default; avoid excluído; advisory)")
  info("  skills why <gate> [--json]                  explica um gate: por que existe e como satisfazê-lo")
}

// Tabela de subcomandos (mantém o dispatcher com cc baixa conforme cresce).
const SUBCOMMANDS = Object.freeze({
  catalog: (cwd, args, json) => catalogCmd(cwd, json),
  doctor: (cwd, args, json) => doctorCmd(cwd, json, args.includes("--strict")),
  gates: (cwd, args, json) => gatesCmd(cwd, args, json),
  harness: (cwd, args, json) => harnessCmd(cwd, args, json),
  baseline: (cwd, args, json) => baselineCmd(cwd, json),
  vendor: (cwd, args, json) => vendorCmd(cwd, args, json),
  why: (cwd, args, json) => whyCmd(cwd, args, json),
})

/** Dispatcher do `skills`. */
export async function skillsCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(cwd, args, json)
  return printUsage()
}
