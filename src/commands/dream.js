import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { audit } from "../dream/auditor.js"
import { HARNESS_CAPABILITIES } from "../dream/capabilities.js"
import { createProposal, promoteProposal, rejectProposal, listProposals, learningSummary } from "../dream/learning.js"
import { dreamImprove } from "../dream/runner.js"
import { success, warn, error, info, section } from "../cli/index.js"

/**
 * `dream` — capacidade de auto-melhoria com review humano (PRD14 §4.5):
 *   dream audit                     → promessas vs evidência (REAL/PARTIAL/...)
 *   dream learn --from-run <id>     → proposta de LIÇÃO (determinística, do provenance)
 *   dream propose-skill --from-run <id> → draft de skill (humano completa)
 *   dream promote <id> --reviewed   → AgentShield + staging (nunca escreve no corpus)
 *   dream reject <id>               → descarta a proposta
 *   dream status [--json]           → resumo audit + proposals
 */

function flagValue(args, flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

function emit(json, obj, human) {
  if (json) { process.stdout.write(JSON.stringify(obj) + "\n"); return obj }
  human(obj)
  return obj
}

function learnCmd(cwd, args, json, kind) {
  const fromRun = flagValue(args, "--from-run")
  if (!fromRun) return emit(json, { error: "missing_from_run" }, () => error("Uso: dream learn --from-run <runId>"))
  const p = createProposal(cwd, { kind, fromRun })
  return emit(json, p, () => {
    section(`dream ${kind === "skill" ? "propose-skill" : "learn"}`)
    if (p.error) { error(`Run não encontrado no provenance: ${fromRun}`); return }
    success(`Proposta ${p.id} criada (provenance: ${p.provenance.receipts} recibo(s), chain ${String(p.provenance.chainHash).slice(0, 12)})`)
    info(`  Revise e promova: dream promote ${p.id} --reviewed`)
  })
}

function promoteCmd(cwd, args, json) {
  const id = args.filter((a) => !a.startsWith("-"))[1]
  const r = promoteProposal(cwd, id, { reviewed: args.includes("--reviewed") })
  return emit(json, r, () => {
    section("dream promote")
    if (r.error === "needs_review") { error("Promoção exige revisão HUMANA: repita com --reviewed."); return }
    if (r.error === "blocked_by_agentshield") { error(`AgentShield BLOQUEOU a proposta (${r.shield.findings.map((f) => f.id).join(", ")}).`); return }
    if (r.error) { error(`Proposta não encontrada: ${id}`); return }
    success(`Promovida para staging: ${r.to} (shield: ${r.shield})`)
    warn(`  ${r.next}`)
  })
}
function claimIcon(status) {
  return status === "REAL" ? "✓" : status === "RISK" ? "⚠" : status === "PLACEBO" ? "✗" : status === "NOT_PROVED" ? "○" : "•"
}

function auditCmd(ctx) {
  // PRD42 S42.0B: o modo COMPORTAMENTAL é o default do CLI — arquivo presente não vale
  // como REAL (vira NOT_PROVED). O modo legado (por arquivo) só sob opt-in `--files-only`.
  const r = audit({ root: ctx.root, behavioral: !ctx.filesOnly })
  return emit(ctx.json, r, () => {
    section("dream audit — promessas vs evidência (determinístico, sem LLM)")
    for (const c of r.claims) {
      info(`  ${claimIcon(c.status)} [${c.status}/${c.severity}] ${c.claim}`)
      c.missing.forEach((m) => info(`        falta: ${m}`))
    }
    info("")
    info(`  Resumo: ${Object.entries(r.summary).map(([k, v]) => `${k}:${v}`).join(" · ")}`)
  })
}

function rejectCmd(ctx) {
  const id = ctx.args.filter((a) => !a.startsWith("-"))[1]
  const r = rejectProposal(ctx.cwd, id)
  return emit(ctx.json, r, () => { section("dream reject"); r.error ? error(`Proposta não encontrada: ${id}`) : success(`Rejeitada: ${id}`) })
}

function proposalsCmd(ctx) {
  const all = listProposals(ctx.cwd)
  return emit(ctx.json, { proposals: all }, () => {
    section("dream proposals")
    if (!all.length) info("  (nenhuma proposta — `dream learn --from-run <id>`)")
    all.forEach((p) => info(`  • ${p.id} [${p.status}] ${p.title}`))
  })
}

function notImplementedCmd(ctx) {
  const payload = { error: "not_implemented", subcommand: ctx.sub, note: "learn/promote/reject/improve já existem; este subcomando ainda é roadmap" }
  return emit(ctx.json, payload, () => {
    section(`dream ${ctx.sub}`)
    warn("Ainda não implementado (honesto). Já existem: audit, learn, propose-skill, promote --reviewed, reject, proposals, improve, status.")
  })
}

// `dream improve` (PRD25 25.4): fluxo ISOLADO — worktree, proposta revisável,
// verify como gate, NUNCA auto-merge. --dry-run gera plano sem escrever nada.
function renderImprove(r) {
  section("dream improve — isolado, revisável, sem auto-merge")
  if (r.mode === "dry-run") { info(`  Plano (${r.plan.items.length} item(ns)) — nada foi escrito.`); r.plan.items.slice(0, 8).forEach((i) => info(`    • [${i.kind}] ${i.action}`)); return }
  if (r.mode === "proposal") { success(`  Proposta gravada: ${r.file}`); warn(`  ${r.note}`); return }
  success(`  Executado em worktree (branch ${r.branch}) — verify: ${r.verify.status}`)
  warn(`  ${r.note}`)
}
function improveCmd(ctx) {
  const r = dreamImprove({ cwd: ctx.cwd, dryRun: ctx.args.includes("--dry-run"), deps: ctx.improveDeps || {} })
  return emit(ctx.json, r, () => renderImprove(r))
}

// PRD46 S46.2: candidates detectados pelo closeout (src/dream/detector.js) vivem
// embutidos em cada .gstack/runs/<runId>/closeout.json — read-only, sem persistência
// própria ainda (dedupe/promotion chegam em sprints seguintes). `candidates` só lê.
function loadCloseout(cwd, runId) {
  const p = join(cwd, ".gstack", "runs", runId, "closeout.json")
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null }
}

function detectedCandidates(cwd) {
  const dir = join(cwd, ".gstack", "runs")
  if (!existsSync(dir)) return []
  const runIds = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  return runIds.map((id) => loadCloseout(cwd, id)).filter((c) => c?.learning?.candidate).map((c) => c.learning.candidate)
}

function candidatesCmd(ctx) {
  const candidates = detectedCandidates(ctx.cwd)
  return emit(ctx.json, { candidates }, () => {
    section("dream candidates")
    if (!candidates.length) info("  (nenhum candidato detectado ainda — rode `start` até um closeout com sinal de golden path)")
    candidates.forEach((c) => info(`  • ${c.id} [${c.classification}/${c.validity.status}] ${c.title}`))
  })
}

function trustLabel(level) {
  return level === "strong" ? "✓ forte" : level === "partial" ? "~ parcial" : "⚠ best-effort"
}

function statusCmd(ctx) {
  const r = audit({ root: ctx.root, behavioral: !ctx.filesOnly })
  const payload = { audit: r.summary, harnesses: HARNESS_CAPABILITIES, learning: learningSummary(ctx.cwd) }
  return emit(ctx.json, payload, () => {
    section("dream status")
    info("  Modo: AUDIT + LEARNING + IMPROVE (proposta→review→staging · improve isolado em worktree, sem auto-merge)")
    info(`  Audit: ${Object.entries(r.summary).map(([k, v]) => `${k}:${v}`).join(" · ")}`)
    info(`  Learning: ${Object.entries(payload.learning).map(([k, v]) => `${k}:${v}`).join(" · ")}`)
    info("  Confiança por harness (matriz de capacidades):")
    for (const c of Object.values(HARNESS_CAPABILITIES)) info(`    ${c.id}: ${c.mode} — ${trustLabel(c.trustLevel)}`)
    r.summary.RISK > 0 ? warn(`${r.summary.RISK} claim(s) RISK — rode \`dream audit\`.`) : success("Sem claims RISK no momento.")
  })
}

// Continuous learning seguro (PRD14 §4.5): proposta → review humano → staging.
const SUBCOMMANDS = {
  audit: auditCmd,
  learn: (ctx) => learnCmd(ctx.cwd, ctx.args, ctx.json, "lesson"),
  "propose-skill": (ctx) => learnCmd(ctx.cwd, ctx.args, ctx.json, "skill"),
  promote: (ctx) => promoteCmd(ctx.cwd, ctx.args, ctx.json),
  reject: rejectCmd,
  proposals: proposalsCmd,
  candidates: candidatesCmd,
  plan: notImplementedCmd,
  improve: improveCmd,
  inspect: notImplementedCmd,
  accept: notImplementedCmd,
  status: statusCmd,
}

export async function dreamCommand(args = [], opts = {}) {
  const sub = args.find((a) => !a.startsWith("--")) || "status"
  const ctx = { sub, args, json: args.includes("--json"), filesOnly: args.includes("--files-only"), root: opts.root, cwd: opts.cwd || process.cwd(), improveDeps: opts.improveDeps }
  return (SUBCOMMANDS[sub] || statusCmd)(ctx)
}
