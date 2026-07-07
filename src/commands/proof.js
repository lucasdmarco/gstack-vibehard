import { execFileSync } from "child_process"
import { runVerify } from "../project-plan/verify-runner.js"
import { audit } from "../dream/auditor.js"
import { buildReadiness } from "../tools/readiness.js"
import { success, warn, error, info, section } from "../cli/index.js"

/**
 * `gstack_vibehard proof [--profile release|full|quick] [--json]` (PRD26 26.B).
 *
 * A RESPOSTA ÚNICA para "pode publicar/entregar?": agrega os gates que já existem
 * (verify, dream audit, tool readiness, graphify freshness, headroom claim, git
 * tree) num veredito determinístico `gstack.proof.v1`. NÃO reimplementa nenhum
 * gate — compõe e decide. LLM nunca participa. Exit 0 só com `ready:true`.
 *
 * Injetável (`deps` = { verify, dream, readiness, git }) → testes herméticos.
 */

export const PROOF_SCHEMA = "gstack.proof.v1"

const defaultGitPorcelain = (cwd) => {
  try { return String(execFileSync("git", ["status", "--porcelain"], { cwd, stdio: "pipe", encoding: "utf-8", timeout: 15000 })).trim() }
  catch { return null } // sem git = not_applicable
}

// ── checks individuais (cada um devolve { ok, blocker?, warning?, ...dados }) ──
const verifyBlockerMsg = (profile, v, failed) =>
  `verify ${profile}: ${v.status} (failed: ${failed.join(", ") || "-"})`
function checkVerify(deps, cwd, profile) {
  const v = (deps.verify || runVerify)({ cwd, profile })
  const failed = v.failed || []
  const ok = v.status === "ready"
  return { ok, status: v.status, failed, timedOut: v.timedOut || [], blocker: ok ? null : verifyBlockerMsg(profile, v, failed) }
}
function checkDream(deps) {
  // O dream audit do proof mede O PRODUTO (package root do gstack), não o cwd —
  // rodar `proof` em C:\Users\x auditava o HOME e dava 0 REAL (pego na máquina
  // limpa real). O `scope` no resultado declara o root auditado.
  const d = (deps.dream || audit)({})
  const s = d.summary
  const ok = s.RISK === 0 && s.PLACEBO === 0
  return { ok, summary: s, scope: d.scope, blocker: ok ? null : `dream audit: ${s.RISK} RISK / ${s.PLACEBO} PLACEBO` }
}
// fresh=ok · stale=BLOQUEIA (grafo existe e mentiria) · absent/unknown=WARNING com
// ação (fora de projeto/sem grafo é estado honesto, não falha — máquina limpa real).
const graphifyResult = (state, action) => ({
  fresh: { ok: true, state, recommendedAction: null, blocker: null, warning: null },
  stale: { ok: false, state, recommendedAction: action, blocker: `graphify stale — ${action}`, warning: null },
}[state] || { ok: true, state, recommendedAction: action, blocker: null, warning: `graphify ${state} — ${action}` })
function graphifyCheck(tools) {
  const f = tools.graphify.freshness || {}
  const action = f.recommendedAction || "rode `tools refresh --changed`"
  return graphifyResult(f.state || "unknown", action)
}
function toolsWarnings(tools) {
  const out = []
  for (const [name, t] of Object.entries(tools)) {
    if (t.status === "timeout_degraded") out.push(`${name}: probe em timeout (NÃO é missing) — re-rode ou chame a ferramenta direto`)
    if (t.status === "missing") out.push(`${name}: ausente`)
  }
  return out
}
function checkReadiness(deps, cwd) {
  const r = (deps.readiness || buildReadiness)({ cwd })
  return {
    tools: Object.fromEntries(Object.entries(r.tools).map(([k, t]) => [k, t.status])),
    graphify: graphifyCheck(r.tools),
    headroom: { status: r.tools.headroom.status, note: "callable_not_routed é o claim honesto; routing é opt-in" },
    warnings: toolsWarnings(r.tools),
  }
}
function checkGitTree(deps, cwd) {
  const porcelain = (deps.git || defaultGitPorcelain)(cwd)
  if (porcelain === null) return { ok: true, state: "not_applicable" }
  const files = porcelain.split("\n").filter(Boolean)
  const ok = files.length === 0
  return { ok, state: ok ? "clean" : "dirty", files: files.slice(0, 5), blocker: ok ? null : `git tree sujo (${files.length} arquivo(s)): ${files.slice(0, 3).join(", ")}` }
}

/** Monta o proof completo. PURO exceto pelos runners default. */
export function buildProof(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const profile = opts.profile || "release"
  const deps = opts.deps || {}
  const verify = checkVerify(deps, cwd, profile)
  const dream = checkDream(deps)
  const readiness = checkReadiness(deps, cwd)
  const gitTree = checkGitTree(deps, cwd)
  const blockers = [verify.blocker, dream.blocker, readiness.graphify.blocker, gitTree.blocker].filter(Boolean)
  const warnings = [...readiness.warnings, readiness.graphify.warning].filter(Boolean)
  return {
    schemaVersion: PROOF_SCHEMA,
    profile,
    generatedAt: new Date().toISOString(),
    ready: blockers.length === 0,
    blockers,
    warnings,
    checks: { verify, dreamAudit: dream, toolReadiness: readiness.tools, graphifyFreshness: readiness.graphify, headroomRouting: readiness.headroom, gitTree },
  }
}

function renderProof(p) {
  section(`proof — perfil ${p.profile} (${PROOF_SCHEMA})`)
  const rows = [
    ["verify", p.checks.verify.ok], ["dream audit", p.checks.dreamAudit.ok],
    ["graphify fresh", p.checks.graphifyFreshness.ok], ["git tree", p.checks.gitTree.ok],
  ]
  for (const [name, ok] of rows) (ok ? success : error)(`  ${name}: ${ok ? "ok" : "FALHOU"}`)
  info(`  headroom: ${p.checks.headroomRouting.status} (honesto; routing é opt-in)`)
  p.warnings.forEach((w) => warn(`  aviso: ${w}`))
  p.blockers.forEach((b) => error(`  bloqueio: ${b}`))
  ;(p.ready ? success : error)(p.ready ? "\n  PRONTO — todos os gates determinísticos verdes." : "\n  NÃO PRONTO — resolva os bloqueios acima.")
}

const profileFrom = (args) => {
  const i = args.indexOf("--profile")
  return i >= 0 ? args[i + 1] : "release"
}
export async function proofCommand(args = [], opts = {}) {
  const proof = buildProof({ cwd: opts.cwd || process.cwd(), profile: profileFrom(args), deps: opts.deps })
  process.exitCode = proof.ready ? 0 : 1
  if (args.includes("--json")) { process.stdout.write(JSON.stringify(proof) + "\n"); return proof }
  renderProof(proof)
  return proof
}
