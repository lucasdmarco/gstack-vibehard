import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { join, dirname } from "path"

/**
 * Skill Evidence Ledger (PRD29 29.4 / PRD34 F5-A).
 *
 * A skill aconselha; o gate decide; a EVIDÊNCIA prova. Cada run registra provas
 * tipadas (question/file/command/screenshot/verify/proof) em `skill-evidence.json`.
 * O release (proof) FALHA se houver um skill-gate P0 pendente — bloqueio/violação
 * registrada e nunca resolvida. verifier determinístico, LLM nunca aprova. PURO/testável.
 */

export const SKILL_EVIDENCE_SCHEMA = "gstack.skill-evidence.v1"
export const EVIDENCE_KINDS = Object.freeze(["question", "file", "command", "screenshot", "verify", "proof"])

const defaultIo = Object.freeze({
  exists: existsSync,
  readJson: (p) => { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } },
  write: (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s) },
  readdir: (p) => { try { return readdirSync(p) } catch { return [] } },
})

const evidencePath = (root, runId) => join(root, ".gstack", "runs", runId, "skill-evidence.json")
const emptyLedger = (runId) => ({ schemaVersion: SKILL_EVIDENCE_SCHEMA, runId, entries: [] })

/** Registra uma prova tipada no ledger do run (append). */
export function recordSkillEvidence({ root, runId, kind, gate = null, status = "recorded", detail = "", io = defaultIo } = {}) {
  const p = evidencePath(root, runId)
  const ledger = (io.exists(p) && io.readJson(p)) || emptyLedger(runId)
  ledger.entries.push({ kind, gate, status, detail, at: new Date().toISOString() })
  io.write(p, JSON.stringify(ledger, null, 2) + "\n")
  return ledger
}

export function readSkillEvidence({ root, runId, io = defaultIo } = {}) {
  const p = evidencePath(root, runId)
  return (io.exists(p) && io.readJson(p)) || emptyLedger(runId)
}

// Um run tem P0 pendente se registrou violação OU um gate bloqueante ficou blocked.
function runPending(runDir, io) {
  if (io.exists(join(runDir, "skill-gate-violations.json"))) return "skill-gate-violations"
  const dsPath = join(runDir, "design-system-gate.json")
  const ds = io.exists(dsPath) ? io.readJson(dsPath) : null
  return ds && ds.blocked ? "design-system-gate" : null
}

/**
 * Avalia o release: varre `.gstack/runs/*` por skill-gate P0 pendente. `ok:false`
 * com blocker se algum run tem violação/bloqueio não resolvido.
 */
export function evaluateSkillGateRelease({ root, io = defaultIo } = {}) {
  const runsRoot = join(root, ".gstack", "runs")
  const pending = []
  for (const name of io.readdir(runsRoot)) {
    const gate = runPending(join(runsRoot, name), io)
    if (gate) pending.push({ run: name, gate })
  }
  return {
    ok: pending.length === 0,
    pendingGates: pending,
    blocker: pending.length ? `skill-gate P0 pendente em ${pending.length} run(s): ${[...new Set(pending.map((x) => x.gate))].join(", ")}` : null,
  }
}
